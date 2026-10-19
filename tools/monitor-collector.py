"""Independent collector watchdog. Health records stay local, including after server exit."""
from datetime import datetime, timezone
from pathlib import Path
import argparse
import json
import logging
import os
import time
from urllib.request import urlopen
from urllib.error import URLError
from urllib.parse import urlsplit


def sample(url, output):
    now = datetime.now(timezone.utc)
    try:
        with urlopen(url.rstrip('/')+'/api/health', timeout=15) as response:
            raw = response.read(1024*1024+1)
            if len(raw) > 1024*1024: raise ValueError('Health response exceeds 1 MiB')
            result = json.loads(raw)
            if (not isinstance(result, dict) or result.get('status') not in {'ok', 'degraded'}
                    or not isinstance(result.get('sources'), list) or not isinstance(result.get('alerts'), list)
                    or any(not isinstance(alert, str) for alert in result['alerts'])):
                raise ValueError('Invalid collector health response')
    except (OSError, URLError, ValueError) as error:
        result = dict(status='unreachable', sources=[], alerts=[str(error)])
    result.update(observed_at=now.isoformat(), monitor_pid=os.getpid())
    output.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(result, ensure_ascii=False, separators=(',', ':'))
    temporary = output/'latest.json.tmp'
    temporary.write_text(raw, encoding='utf-8')
    deadline = time.monotonic()+10
    while True:
        try:
            os.replace(temporary, output/'latest.json')
            break
        except PermissionError:
            if os.name != 'nt' or time.monotonic() >= deadline: raise
            time.sleep(.05)
    with (output/(now.strftime('%Y-%m-%d')+'.jsonl')).open('a', encoding='utf-8') as history:
        history.write(raw+'\n')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8765')
    parser.add_argument('--output', type=Path, default=Path('.local-private/timeline-collector/monitor'))
    parser.add_argument('--interval-seconds', type=float, default=60)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    if urlsplit(args.url).hostname not in {'127.0.0.1', 'localhost'}: parser.error('Use a local collector URL')
    if not 1 <= args.interval_seconds <= 3600: parser.error('Interval must be between 1 and 3600 seconds')
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    previous = None
    try:
        while True:
            try:
                result = sample(args.url, args.output)
                state = (result['status'], tuple(sorted(result['alerts'])))
            except OSError as error:
                result = {'status':'monitor_error'}
                state = ('monitor_error', (str(error),))
            if state != previous:
                logging.log(logging.INFO if state[0] == 'ok' else logging.WARNING,
                            'Collector %s%s; health history: %s', state[0], ': '+ '; '.join(state[1]) if state[1] else '', args.output)
                previous = state
            if args.once: return 0 if result['status'] == 'ok' else 1
            time.sleep(args.interval_seconds)
    except KeyboardInterrupt: return 130


if __name__ == '__main__': raise SystemExit(main())
