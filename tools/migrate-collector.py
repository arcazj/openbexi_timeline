"""Preview/apply the namespace v2 -> v3 migration, with exact rollback backups."""
from pathlib import Path
import argparse
import json
import shutil
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'timeline_data_collector/python'))
import yaml
from timeline_data_collector.namespace_config import read_yaml, validate_namespace, validate_service
from timeline_data_collector.io import atomic_write


def migrate(workspace, *, apply=False, mapping=None, static=False):
    workspace=Path(workspace).resolve()
    document=json.loads(workspace.read_text(encoding='utf-8-sig'))
    mappings=json.loads(Path(mapping).read_text(encoding='utf-8-sig')) if mapping else {}
    changes=[]
    for reference in document['namespace_files']:
        path=workspace.parent/reference;value=read_yaml(path);original=path.read_bytes()
        if value.get('config_version') not in (2,3): raise ValueError('Migrate combined legacy documents to namespace files first')
        value['config_version']=3
        for source in value['sources']:
            for field in ('source_plugin','converter_plugin'):
                source[field]=mappings.get(field,{}).get(source[field],source[field])
            if static: source['converter_plugin']='NONE'
        validate_namespace(value,path,workspace.parent)
        encoded=yaml.safe_dump(value,sort_keys=False).encode()
        if read_yaml(path)==value: continue
        changes.append((path,original,encoded))
    service=workspace.parent/document.get('service','service.yml')
    if service.exists():
        value=read_yaml(service);value['config_version']=3;validate_service(value,service)
        if value!=read_yaml(service): changes.append((service,service.read_bytes(),yaml.safe_dump(value,sort_keys=False).encode()))
    if apply:
        for path,original,encoded in changes:
            backup=path.with_suffix(path.suffix+'.pre-v3.bak')
            if backup.exists() and backup.read_bytes()!=original: raise ValueError('Existing rollback backup differs: '+str(backup))
        completed=[]
        try:
            for path,original,encoded in changes:
                atomic_write(path.with_suffix(path.suffix+'.pre-v3.bak'),original)
                atomic_write(path,encoded);completed.append((path,original))
        except BaseException:
            for path,original in reversed(completed): atomic_write(path,original)
            raise
    return {'applied':apply,'files':[str(path) for path,_,_ in changes]}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace',required=True);parser.add_argument('--apply',action='store_true')
    parser.add_argument('--mapping',help='Local JSON maps source_plugin/converter_plugin IDs; never publish operational mappings')
    parser.add_argument('--static',action='store_true',help='Explicitly mark every source in this workspace as NONE')
    args=parser.parse_args()
    print(json.dumps(migrate(args.workspace,apply=args.apply,mapping=args.mapping,static=args.static),indent=2))
