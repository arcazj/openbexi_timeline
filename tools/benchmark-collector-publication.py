"""Measure small publications against an isolated copy of an existing namespace."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import re
import shutil
import tempfile
import time

from timeline_data_collector.configuration import load
from timeline_data_collector.contracts import RecordBatch
from timeline_data_collector.io import model_root
from timeline_data_collector.publication import read_publication
from timeline_data_collector.publisher import Publisher
from timeline_data_collector.target_recovery import TargetRecovery


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True)
    parser.add_argument('--namespace', required=True)
    parser.add_argument('--iterations', type=int, default=3)
    args = parser.parse_args()
    if args.iterations < 1: parser.error('--iterations must be positive')
    config = load(args.workspace)
    group, _ = config.sources(namespace=args.namespace)[0]
    origin = model_root(group['target_path']) / '.timeline-collector'
    # Pin one generation; its immutable parts remain valid during collection.
    raw = (origin / 'publication.json').read_bytes()
    index = json.loads(raw)
    with tempfile.TemporaryDirectory(prefix='collector-publication-benchmark-') as temporary:
        root = Path(temporary)
        state = root / '.timeline-collector'
        state.mkdir()
        (state / 'publication.json').write_bytes(raw)
        for part in index.get('event_parts', []):
            if not re.fullmatch(r'parts/[a-f0-9]{64}\.json', part['path']):
                raise ValueError('Invalid publication part path')
            relative = Path(part['path'])
            target = state / relative
            target.parent.mkdir(exist_ok=True)
            shutil.copyfile(origin / relative, target)
        print('Isolated publication copy ready', flush=True)
        value = read_publication(state / 'publication.json')
        key, source = next(iter(value['sources'].items()))
        checkpoint = source.get('checkpoint', {}).get('_collector_scopes', {}).get('current', {})
        record = deepcopy(value['events'][-1])
        record['id'] = 'collector-publication-benchmark'
        record.pop('activities', None)
        writer = Publisher(str(root / 'yyyy/mm/dd'), args.namespace, recovery=TargetRecovery())
        # Use the existing metadata revision: this benchmark measures publication,
        # not a one-time metadata migration.
        writer.normalizer.revision = value.get('metadata_revision', writer.normalizer.revision)
        del value
        from timeline_data_collector import publication
        if hasattr(publication, '_FILE_CACHE'): publication._FILE_CACHE.clear()
        durations = []
        for iteration in range(args.iterations):
            record.setdefault('data', {})['description'] = 'benchmark iteration %d' % iteration
            started = time.perf_counter()
            outcome = writer.publish(key, source['source_id'], source['plugin'],
                RecordBatch([record], checkpoint), checkpoint_scope='current', preserve_missing=True)
            elapsed = round(time.perf_counter() - started, 3)
            durations.append(elapsed)
            print(json.dumps(dict(iteration=iteration + 1, seconds=elapsed,
                created=outcome['records_created'], updated=outcome['records_updated'])), flush=True)
        print(json.dumps(dict(namespace=args.namespace, seconds=durations)), flush=True)


if __name__ == '__main__':
    main()
