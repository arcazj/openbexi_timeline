"""Dry-run-first conversion of combined configurations to namespace documents."""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import yaml

from .namespace_config import read_yaml, rename_fields, resolved_path, validate_namespace, NAME
from .namespace_workspace import atomic_text

def atomic_write(path,data):
    atomic_text(Path(path),data.decode('utf-8') if isinstance(data,bytes) else data)


def plan(config, hbds_root, *, legacy_base=None, model_path=None, targets=None):
    config=Path(config).resolve(); root=Path(hbds_root).resolve()
    original=read_yaml(config); data=rename_fields(original)
    if 'data_sources' not in data: raise ValueError('Migration requires a combined configuration')
    base=Path(legacy_base or Path.cwd()).resolve()
    files={}; namespaces={}; connectors={}
    service={'config_version':2, **{k:v for k,v in data.items() if k not in ('data_sources','model','config_version')}}
    for entry in data['data_sources']:
        entry=deepcopy(entry); name=entry.get('namespace')
        if not isinstance(name,str) or not NAME.fullmatch(name): raise ValueError('Each entry needs a portable namespace')
        model=Path(model_path or resolved_path(entry.get('model',data.get('model','')),base))
        if not model.is_file(): raise ValueError('Referenced display model is missing; supply --model with its actual location')
        model_name=model.stem
        if not NAME.fullmatch(model_name): raise ValueError('Model name is not portable')
        files[root/'models'/model.name]=model.read_bytes()
        target=resolved_path((targets or {}).get(name,entry.get('target_path')),base)
        if name not in target.replace('\\','/').split('/'):
            raise ValueError('Output path lacks a complete namespace component; choose an explicit output migration before proceeding')
        ns=namespaces.setdefault(name,{'config_version':2,'namespace':name,'model':'models/'+model.name,
                                      'target_path':target,'enable':entry.get('enable',True),'sources':[],'connectors':[]})
        if ns['target_path']!=target or ns['model']!='models/'+model.name or ns['enable']!=entry.get('enable',True):
            raise ValueError('Conflicting entries for one namespace')
        for key in ('render','filter','permission','timezone'):
            if key in entry:
                if key in ns and ns[key]!=entry[key]: raise ValueError('Conflicting namespace defaults')
                ns[key]=entry[key]
        raw=entry.get('connector',[])
        for token in ([raw] if isinstance(raw,str) else raw):
            for spec in token.split('|'):
                protocol,port=spec.strip().rsplit(':',1); ident=f'{protocol}_{port}'
                listener={'id':ident,'type':protocol,'port':int(port),'host':'127.0.0.1','owner':'java'}
                if protocol not in ('http','no_secure'):
                    # Explicit external TLS references; migration never exports credentials.
                    listener['tls']={'keystore':'${TIMELINE_KEYSTORE}','password_env':'TIMELINE_KEYSTORE_PASSWORD'}
                connectors[ident]=listener
                if ident not in ns['connectors']: ns['connectors'].append(ident)
        sources=entry.get('sources',[entry])
        for source in sources:
            source=deepcopy(source)
            kind=source.get('source_plugin',source.get('type','local'))
            if kind=='json_file': kind='local'
            value={'id':source.get('id',f'input_{len(ns["sources"])+1}'),'enable':source.get('enable',True),
                   'source_plugin':kind,'converter_plugin':source.get('converter_plugin',source.get('format','legacy'))}
            if kind=='s3': value['source_path']='s3://'+source['bucket']+'/'+source.get('prefix','').lstrip('/')
            elif kind=='sftp': value['source_path']='sftp://'+source['host']+'/'+source['source_path'].lstrip('/')
            elif 'source_path' in source: value['source_path']=resolved_path(source['source_path'],base)
            if 'source_path' in value and name not in value['source_path'].replace('\\','/').split('/'):
                value['allow_external_namespace_path']=True
            excluded={'id','enable','namespace','model','target_path','sources','connector','render','source_path',
                      'type','source_plugin','converter_plugin','format','converter2events_class','bucket','prefix','options'}
            options={k:v for k,v in source.items() if k not in excluded}
            value['options']={**options,**source.get('options',{})}
            # Nested definitions take precedence, matching the previous loader.
            signature={k:v for k,v in value.items() if k!='id'}
            if not any({k:v for k,v in old.items() if k!='id'}==signature for old in ns['sources']): ns['sources'].append(value)
    for name,document in namespaces.items():
        path=root/'yaml'/f'{name}_{Path(document["model"]).stem}.yml'
        validate_namespace(document,path,root)
        files[path]=yaml.safe_dump(document,sort_keys=False).encode()
    service['connectors']=list(connectors.values())
    files[root/'service.yml']=yaml.safe_dump(service,sort_keys=False).encode()
    for path,content in files.items():
        if path.exists() and path.read_bytes()!=content: raise ValueError('Migration destination already contains different content')
    return files


def apply(files, backup_dir):
    backup=Path(backup_dir).resolve(); backup.mkdir(parents=True,exist_ok=True)
    created=[]
    try:
        for path,content in files.items():
            if path.exists(): continue
            atomic_write(path,content); created.append(path)
        manifest=backup/'migration.json'
        previous=json.loads(manifest.read_text()) if manifest.exists() else {'created':[],'sha256':{}}
        previous['created']=list(dict.fromkeys(previous['created']+[str(p) for p in created]))
        previous['sha256'].update({str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in created})
        atomic_write(manifest,json.dumps(previous,indent=2))
    except Exception:
        for path in reversed(created): path.unlink()
        raise


def rollback(backup_dir):
    """Remove only files created by this migration that have not since changed."""
    manifest=Path(backup_dir).resolve()/'migration.json'
    value=json.loads(manifest.read_text())
    paths=[Path(p).resolve() for p in value['created']]
    for path in paths:
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest()!=value['sha256'][str(path)]:
            raise ValueError('A migrated file was edited; rollback requires reviewing those edits first')
    for path in reversed(paths): path.unlink(missing_ok=True)
    atomic_write(manifest,json.dumps(dict(value,rolled_back=True),indent=2))


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config',type=Path)
    parser.add_argument('--hbds-root',required=True,type=Path)
    parser.add_argument('--legacy-base',type=Path)
    parser.add_argument('--model',type=Path)
    parser.add_argument('--target',action='append',default=[],metavar='NAMESPACE=PATH',help='Explicit new target; existing event data is never moved')
    parser.add_argument('--apply',action='store_true',help='Write validated output; default is dry run')
    parser.add_argument('--backup-dir',type=Path)
    args=parser.parse_args(argv)
    targets={}
    for item in args.target:
        if '=' not in item: parser.error('--target requires NAMESPACE=PATH')
        name,path=item.split('=',1);targets[name]=path
    files=plan(args.config,args.hbds_root,legacy_base=args.legacy_base,model_path=args.model,targets=targets)
    if args.apply:
        if not args.backup_dir: parser.error('--apply requires --backup-dir outside HBDS')
        if args.backup_dir.resolve().is_relative_to(args.hbds_root.resolve()): parser.error('Backups must be outside HBDS')
        args.backup_dir.mkdir(parents=True,exist_ok=True)
        backup=args.backup_dir/'original.yml'
        if not backup.exists(): shutil.copy2(args.config,backup)
        apply(files,args.backup_dir)
    print(f'{len(files)} files '+('written or already current' if args.apply else 'planned; no files changed'))


if __name__=='__main__': main()
