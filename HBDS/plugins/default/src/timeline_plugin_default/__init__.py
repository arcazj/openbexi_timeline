"""Reproducible Java session/event/activity and zone generator."""
from datetime import datetime, timezone
from pathlib import Path
from timeline_data_collector.contracts import RecordBatch
from timeline_data_collector.io import identity
from timeline_data_collector.plugin import manifest_for, standalone
from timeline_data_collector.runtime import java_records


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
        request['output_root'] = str(context.workdir / 'generated' / checkpoint['request'][:24])
        records = java_records(Path(__file__).parent, 'timeline-plugin-default-1.0.0.jar',
                               'com.openbexi.timeline.CollectorBridge', request, context, filter_dates=False)
        yield RecordBatch(records, checkpoint)


def main(): return standalone('default')
