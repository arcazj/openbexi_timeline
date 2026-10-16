"""USGS volcano adapter around the migrated, independently built Java parser."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
from timeline_data_collector.contracts import RecordBatch
from timeline_data_collector.io import identity
from timeline_data_collector.plugin import manifest_for, standalone
from timeline_data_collector.runtime import java_records


class Plugin:
    @staticmethod
    def manifest(): return manifest_for(__file__)

    def collect(self, context):
        options = context.options
        request = dict(output_root=str(context.workdir / 'acquired'), namespace=context.namespace, archive=options.get('archive', False))
        checkpoint = {}
        if options.get('input_file'):
            path = (context.workspace.parent / options['input_file']).resolve()
            checkpoint = {'input': hashlib.sha256(path.read_bytes()).hexdigest(), 'configuration': identity(context.source),
                          'range': [context.start_date, context.end_date]}
            if checkpoint == context.checkpoint and not context.force: return
            request['input_file'] = str(path)
        elif context.offline: raise ValueError('Offline volcano conversion requires options.input_file')
        if options.get('api_base'): request['api_base'] = options['api_base']
        records = java_records(Path(__file__).parent, 'timeline-plugin-volcano-1.0.0.jar',
                               'org.openbexi.volcano.CollectorBridge', request, context)
        yield RecordBatch(records, checkpoint or {'last_acquired': datetime.now(timezone.utc).isoformat()})


def main(): return standalone('volcano')
