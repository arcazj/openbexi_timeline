"""Read-only Loki HTTP client. No private deployment knowledge or credentials on disk."""
from collections import Counter
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request


class Unavailable(OSError):
    pass


class Incomplete(ValueError):
    pass


def selector(labels):
    if not labels or any(not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]*', key) for key in labels):
        raise ValueError('Loki returned invalid stream labels')
    return '{' + ','.join(key + '=' + json.dumps(value) for key, value in sorted(labels.items())) + '}'


def partitions(streams):
    """Disjoint existence selectors cover every discovered stream, including absent labels."""
    remaining = list(streams)
    excluded, result = [], []
    while remaining:
        counts = Counter(key for item in remaining for key, value in item.items() if value)
        if not counts:
            raise Incomplete('Cannot query a stream without any nonempty label')
        key = next((name for name in ('app', 'service_name') if name in counts),
                   sorted(counts, key=lambda name: (-counts[name], name))[0])
        if not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]*', key):
            raise Incomplete('Invalid discovered label name')
        # Separate dynamically discovered families so a noisy application cannot
        # consume every page before quieter operational streams get a turn.
        for value in sorted({item[key] for item in remaining if item.get(key)}):
            result.append('{' + ','.join([key + '=' + json.dumps(value)] +
                                        [name + '=""' for name in excluded]) + '}')
        excluded.append(key)
        remaining = [item for item in remaining if not item.get(key)]
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    # Do not forward tenant/auth headers to an unconfigured redirect destination.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, settings, context):
        self.settings, self.context = settings, context
        self.endpoints = [settings['base_url'], *settings.get('fallback_base_urls', [])]
        for endpoint in self.endpoints:
            url = urllib.parse.urlsplit(endpoint)
            if url.scheme not in {'http', 'https'} or not url.hostname or url.username or url.password or url.query or url.fragment:
                raise ValueError('Loki endpoints must be HTTP(S) URLs without credentials, query, or fragment')
        self.headers = {}
        for header, name in settings.get('headers_env', {}).items():
            if not re.fullmatch(r'[A-Za-z0-9-]+', header):
                raise ValueError('Invalid HTTP header name')
            self.headers[header] = os.environ[name]
        if settings.get('tenant_env'):
            self.headers['X-Scope-OrgID'] = os.environ[settings['tenant_env']]
        if settings.get('bearer_token_env'):
            self.headers['Authorization'] = 'Bearer ' + os.environ[settings['bearer_token_env']]
        self.active = None
        self.opener = urllib.request.build_opener(NoRedirect())

    def get(self, route, params=()):
        errors = []
        for endpoint in self.endpoints:
            for attempt in range(self.settings.get('retries', 2) + 1):
                self.context.check_cancelled()
                try:
                    request = urllib.request.Request(endpoint.rstrip('/') + route + '?' +
                                                     urllib.parse.urlencode(params, doseq=True), headers=self.headers)
                    with self.opener.open(request, timeout=self.settings.get('timeout_seconds', 30)) as response:
                        document = json.load(response)
                    if document.get('status') != 'success' or document.get('warnings'):
                        raise Incomplete('Loki reported an unsuccessful or incomplete query response')
                    self.active = endpoint
                    return document['data']
                except urllib.error.HTTPError as error:
                    # Responses/URLs may contain sensitive query or authorization details.
                    errors.append('HTTP ' + str(error.code))
                    if error.code not in (408, 429, 500, 502, 503, 504):
                        break
                except (urllib.error.URLError, TimeoutError, ConnectionError):
                    errors.append('connection/timeout')
                except (ValueError, KeyError) as error:
                    if isinstance(error, Incomplete):
                        raise
                    raise Incomplete('Invalid Loki JSON response') from None
                if attempt < self.settings.get('retries', 2):
                    self.context.cancel.wait(min(2 ** attempt, 4))
        raise Unavailable('Loki acquisition unavailable (' + ', '.join(sorted(set(errors))) + ')')

    def discover(self, start, end):
        bounds = dict(start=str(start), end=str(end))
        labels = self.get('/loki/api/v1/labels', bounds)
        if not labels:
            return []
        if any(not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name) for name in labels):
            raise Incomplete('Invalid label discovery response')
        streams = {}
        # /series accepts repeated match[] with union semantics. Batch to bound URL size.
        for offset in range(0, len(labels), 16):
            matches = ['{' + name + '=~".+"}' for name in labels[offset:offset + 16]]
            for item in self.get('/loki/api/v1/series', dict(bounds, **{'match[]': matches})):
                selector(item)  # Validate labels before using them in generated queries.
                streams[json.dumps(item, sort_keys=True)] = item
        return list(streams.values())

    def query(self, query, start, end):
        data = self.get('/loki/api/v1/query_range', dict(
            query=query, start=str(start), end=str(end), direction='forward',
            limit=self.settings.get('page_size', 5000)))
        if data.get('resultType') != 'streams':
            raise Incomplete('Expected raw Loki streams')
        records = []
        count = 0
        for stream in data['result']:
            labels = stream['stream']
            selector(labels)
            for value in stream['values']:
                count += 1
                stamp = int(value[0])
                if start <= stamp < end:
                    records.append((labels, stamp, value[1]))
        return records, count >= self.settings.get('page_size', 5000), self.active
