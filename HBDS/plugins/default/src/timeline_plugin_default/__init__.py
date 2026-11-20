"""Reproducible Python session/event/activity and zone generator."""
from datetime import datetime, timezone
from timeline_data_collector.contracts import RecordBatch
from timeline_data_collector.io import identity
from timeline_data_collector.plugin import manifest_for, standalone
from .generator import generate


class Plugin:
    @staticmethod
    def manifest(): return manifest_for(__file__)

    def collect(self, context):
        options = context.options
        first = context.start_date or datetime.now(timezone.utc).date().isoformat()
        request = dict(namespace=context.namespace, start=first, end=context.end_date or first,
                       seed=options.get('seed', 0), count=options.get('count', 100), zones=options.get('zones', True))
        checkpoint = {'request': identity(request), 'version': context.source.get('_converter_version')}
        if checkpoint == context.checkpoint and not context.force: return
        records = generate(request, context)
        yield RecordBatch(records, checkpoint)


def main(): return standalone('default')
