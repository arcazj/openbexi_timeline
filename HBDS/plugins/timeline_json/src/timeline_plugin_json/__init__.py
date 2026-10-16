"""Validate and publish incoming JSON that already uses the timeline record format."""
import gzip
import json
from pathlib import Path
from timeline_data_collector.contracts import RecordBatch
from timeline_data_collector.io import normalize, timestamp
from timeline_data_collector.plugin import manifest_for, standalone


class Plugin:
    @staticmethod
    def manifest(): return manifest_for(__file__)

    def convert(self, batch, context):
        records = []
        for item in batch.items:
            context.check_cancelled()
            if isinstance(item, Path):
                if item.suffix.lower() not in {'.json', '.jsonl', '.ndjson', '.gz'}: continue
                raw = gzip.decompress(item.read_bytes()) if item.suffix.lower() == '.gz' else item.read_bytes()
                if item.suffix.lower() in {'.jsonl', '.ndjson'} or item.name.lower().endswith(('.jsonl.gz', '.ndjson.gz')):
                    for line in raw.decode('utf-8-sig').splitlines():
                        if line.strip(): records.extend(normalize(json.loads(line), context.namespace, context.source_key))
                    continue
                document = json.loads(raw.decode('utf-8-sig'))
            elif isinstance(item, bytes): document = json.loads(item.decode('utf-8-sig'))
            elif isinstance(item, str): document = json.loads(item)
            else: document = item
            records.extend(normalize(document, context.namespace, context.source_key))
        if context.start_date: records = [record for record in records if timestamp(record.get('end') or record['start']).date().isoformat() >= context.start_date]
        if context.end_date: records = [record for record in records if timestamp(record['start']).date().isoformat() <= context.end_date]
        return RecordBatch(records, batch.checkpoint, snapshot=context.options.get('snapshot', False), acknowledge=batch.acknowledge)


def main(): return standalone('timeline_json')
