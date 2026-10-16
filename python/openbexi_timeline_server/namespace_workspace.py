"""HBDS editor projection backed by namespace YAML and shared model files."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import threading

import yaml

from .hbds import Store, HBDSError, validate, changes, decode, read_bytes
from .namespace_config import Bundle, read_yaml, validate_namespace, resolve_namespace_files
from .storage import atomic_json


def atomic_text(path, text):
    import os, tempfile
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(dir=path.parent,suffix='.part')
    try:
        with os.fdopen(fd,'w',encoding='utf-8',newline='\n') as stream:
            stream.write(text); stream.flush(); os.fsync(stream.fileno())
        os.replace(name,path)
    finally:
        if os.path.exists(name): os.unlink(name)


class NamespaceWorkspace(Store):
    def __init__(self, configuration):
        self.root=configuration.root
        self.metadata=Path(configuration.hbds_root)
        self.workspace_path=configuration.workspace_path or self.metadata/'workspace.json'
        self.bundle=Bundle(configuration.namespace_files,configuration.service_path,self.metadata,self.workspace_path)
        self.path=self.metadata/'.workspace'
        self.lock=threading.RLock(); self._stamp=None; self._cached=None
        self.model_paths={}; self._default_ids={}

    def describe(self):
        if self._cached is None: self.read()
        return {'kind':'namespace-files','files':[p.name for p in self.bundle.paths],
                'service':self.bundle.service_path.name if self.bundle.service_path else None,
                'workspace':self.workspace_path.name,
                'defaultIds':deepcopy(self._default_ids)}

    def defaults_path(self, name):
        if name not in ('users','groups','roles'): return None
        for base in (self.metadata,self.root/'HBDS'):
            path=base/name/'defaults.json'
            if path.exists(): return path
        return None

    def registry(self, name, *, defaults_only=False):
        """Public defaults are read-only; private index entries override them by ID."""
        records={}
        paths=[self.defaults_path(name)]
        if not defaults_only: paths.append(self.metadata/name/'index.json')
        for path in paths:
            if path is None or not path.exists(): continue
            entries=decode(read_bytes(path))
            if not isinstance(entries,list): raise ValueError(name+' registry must be an array')
            seen=set()
            for entry in entries:
                identity=entry['id']
                if identity in seen: raise ValueError('Duplicate '+name+' identity: '+identity)
                seen.add(identity);records[identity]=entry
        return list(records.values())

    def read(self, *, copy_result=True):
        with self.lock:
            self.bundle.paths=resolve_namespace_files(self.bundle.paths,self.metadata,self.workspace_path)
            tracked=[*self.bundle.paths,*self.model_paths.values()]
            tracked+=list((self.metadata/'models').glob('*.json'))
            if self.workspace_path.exists(): tracked.append(self.workspace_path)
            if self.bundle.service_path: tracked.append(self.bundle.service_path)
            tracked += [self.metadata/name/'index.json' for name in ('users','groups','roles','grants','filters') if (self.metadata/name/'index.json').exists()]
            tracked += [path for name in ('users','groups','roles') if (path:=self.defaults_path(name)) is not None]
            stamp=tuple((str(p),p.stat().st_mtime_ns,p.stat().st_size) for p in tracked)
            if self._cached is not None and stamp==self._stamp:
                return deepcopy(self._cached) if copy_result else self._cached
            config=self.bundle.read()
            result={'schemaVersion':1,'defaultNamespaceId':'','namespaces':[],'models':[],'sources':[],
                    'connectors':[],'tabs':[],'users':[],'groups':[],'roles':[],'grants':[],
                    'deployment':{k:deepcopy(v) for k,v in config.items() if k not in ('data_sources','config_version','connectors')}}
            models={}; model_paths={}
            for n,entry in enumerate(config['data_sources']):
                name=entry['namespace']; model_path=Path(entry['model']); model_id='model_'+model_path.stem
                if model_id in model_paths and model_paths[model_id]!=model_path:
                    raise ValueError('Model filenames must be unique in the metadata workspace')
                models[model_id]=decode(read_bytes(model_path)); model_paths[model_id]=model_path
                result['namespaces'].append({'id':name,'namespace':name,'modelId':model_id,'render':entry.get('render',{}),
                                             'filter':entry.get('filter',{}),'connectorIds':entry.get('connectors',[])})
                result['tabs'].append({'id':'tab_'+name,'namespaceId':name,'title':name,'order':n,'enabled':entry.get('enable',True)})
                configuration={k:deepcopy(v) for k,v in entry.items() if k not in ('namespace','model','config_version','connectors','render','filter')}
                configuration['type']='json_file'
                result['sources'].append({'id':'source_'+name,'namespaceId':name,'order':n,'configuration':configuration})
            for model_path in (self.metadata/'models').glob('*.json'):
                model_id='model_'+model_path.stem
                if model_id not in models:
                    models[model_id]=decode(read_bytes(model_path));model_paths[model_id]=model_path
            result['models']=[{'id':key,'configuration':value} for key,value in models.items()]
            result['connectors']=[{'id':c['id'],'protocol':c['type'],'port':c['port']} for c in config.get('connectors',[])]
            for name in ('users','groups','roles','grants'):
                result[name]=self.registry(name)
            default_ids={name:[entry['id'] for entry in self.registry(name,defaults_only=True)]
                         for name in ('users','groups','roles')}
            selected_names={n['id'] for n in result['namespaces']}
            result['grants']=[g for g in result['grants'] if g['namespaceId'] in selected_names]
            result['defaultNamespaceId']=result['namespaces'][0]['id']
            if self.workspace_path.exists():
                workspace=json.loads(self.workspace_path.read_text(encoding='utf-8'))
                selected={n['id'] for n in result['namespaces']}
                tabs=workspace.get('tabs',[])
                if tabs and {t['namespaceId'] for t in tabs}==selected:
                    result['tabs']=tabs
                    result['defaultNamespaceId']=workspace.get('default_namespace_id',result['defaultNamespaceId'])
            validate(result,self.root)
            revision=hashlib.sha256(json.dumps(result,sort_keys=True).encode()).hexdigest()
            self.model_paths=model_paths
            self._default_ids=default_ids
            self._cached=(result,revision); self._stamp=stamp
            return deepcopy(self._cached) if copy_result else self._cached

    def save(self, document, expected):
        if not expected: raise HBDSError(428,'If-Match is required')
        validate(document,self.root)
        with self.transaction():
            self._stamp=None
            old,revision=self.read()
            if expected!='"'+revision+'"': raise HBDSError(412,'Configuration changed; reload before saving')
            if document['connectors']!=old['connectors'] or document['deployment']!=old['deployment']:
                raise HBDSError(422,'Change listener definitions and service settings in the service configuration and restart')
            if {n['id'] for n in document['namespaces']}!={n['id'] for n in old['namespaces']}:
                raise HBDSError(422,'Add or remove namespace files through the startup file list; existing data is retained')
            writes={}; paths=[]
            models={m['id']:m['configuration'] for m in document['models']}
            original_models={m['id']:m['configuration'] for m in old['models']}
            for namespace,original_path in zip(old['namespaces'],self.bundle.paths):
                updated=next(n for n in document['namespaces'] if n['id']==namespace['id'])
                if updated['namespace']!=namespace['namespace']: raise HBDSError(422,'Namespace identity requires an explicit migration')
                model_path=self.model_paths.get(updated['modelId'])
                if model_path is None: raise HBDSError(422,'Select an existing model; import new model files into the metadata workspace first')
                value=read_yaml(original_path)
                sources=[s['configuration'] for s in document['sources'] if s['namespaceId']==namespace['id']]
                if len(sources)!=1: raise HBDSError(422,'Edit the sources list within this namespace configuration')
                old_sources=[s['configuration'] for s in old['sources'] if s['namespaceId']==namespace['id']]
                if updated==namespace and sources==old_sources:
                    paths.append(original_path)
                    continue
                for key in old_sources[0].keys() | sources[0].keys():
                    if key=='type' or sources[0].get(key)==old_sources[0].get(key): continue
                    if key in sources[0]: value[key]=deepcopy(sources[0][key])
                    else: value.pop(key,None)
                if updated['modelId']!=namespace['modelId']: value['model']='models/'+model_path.name
                for key,field in (('render','render'),('filter','filter'),('connectorIds','connectors')):
                    if updated[key]!=namespace[key]: value[field]=deepcopy(updated[key])
                destination=original_path.with_name(namespace['namespace']+'_'+model_path.stem+'.yml')
                validate_namespace(value,destination,self.metadata)
                if destination!=original_path and destination.exists(): raise HBDSError(409,'Configuration filename already exists')
                if value!=read_yaml(original_path): writes[destination]=yaml.safe_dump(value,sort_keys=False)
                paths.append(destination)
            for key,model in models.items():
                if key in self.model_paths and model!=original_models[key]: writes[self.model_paths[key]]=json.dumps(model,indent=2)+'\n'
            for name in ('users','groups','roles','grants'):
                if document[name]!=old[name]:
                    target=self.metadata/name/'index.json';content=document[name]
                    defaults={entry['id']:entry for entry in self.registry(name,defaults_only=True)}
                    if not defaults.keys()<={entry['id'] for entry in content}:
                        raise HBDSError(422,'Default '+name+' must remain present; changes are stored privately')
                    content=[entry for entry in content if entry!=defaults.get(entry['id'])]
                    if name=='grants' and target.exists():
                        selected_names={n['id'] for n in old['namespaces']}
                        content=[g for g in json.loads(target.read_text(encoding='utf-8')) if g['namespaceId'] not in selected_names]+content
                    writes[target]=json.dumps(content,indent=2)+'\n'
            # Workspace metadata records filenames and UI state, never configuration copies.
            workspace_path=self.workspace_path
            workspace=json.loads(workspace_path.read_text(encoding='utf-8')) if workspace_path.exists() else {}
            aliases=dict(workspace.get('aliases',{}))
            for old_path,new_path in zip(self.bundle.paths,paths):
                if old_path!=new_path:
                    aliases={k:(new_path.name if v==old_path.name else v) for k,v in aliases.items()}
                    aliases[old_path.name]=new_path.name
            if list(self.bundle.paths)!=paths or document['tabs']!=old['tabs'] or document['defaultNamespaceId']!=old['defaultNamespaceId']:
                import os
                workspace.update(namespace_files=[os.path.relpath(p, workspace_path.parent).replace('\\', '/')
                                                  if p.drive == workspace_path.drive else str(p) for p in paths],aliases=aliases,
                                 tabs=document['tabs'],default_namespace_id=document['defaultNamespaceId'])
                writes[workspace_path]=json.dumps(workspace,indent=2)+'\n'
            backup={p:p.read_text(encoding='utf-8') if p.exists() else None for p in writes}
            original_paths=self.bundle.paths
            try:
                for path,text in writes.items(): atomic_text(path,text)
                self.bundle.paths=tuple(paths); self._stamp=None
                saved,new_revision=self.read()
            except Exception:
                for path,text in backup.items():
                    if text is None: path.unlink(missing_ok=True)
                    else: atomic_text(path,text)
                self.bundle.paths=original_paths; self._stamp=None; self._cached=None
                raise
            return {'document':saved,'revision':new_revision,**changes(old,saved)}
