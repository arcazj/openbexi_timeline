"""Build the Python server, collector and reviewed public plugin wheels."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import sys
import zipfile

ROOT=Path(__file__).resolve().parents[1]
PUBLIC=('filesources','timeline_json','default','earthquake','volcano','mqtt','loki')


def run(arguments):
    subprocess.run([str(value) for value in arguments],cwd=ROOT,check=True)


def checksum(path):
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    path.with_name(path.name+'.sha256').write_text(digest+'  '+path.name+'\n',encoding='utf-8')
    return digest


def build(selected=()):
    names=list(selected or PUBLIC)
    if any(name not in PUBLIC for name in names): raise ValueError('Only explicitly reviewed public plugins may be distributed')
    output=ROOT/'dist/collector';output.mkdir(parents=True,exist_ok=True)
    manifest=[]
    projects=[ROOT, ROOT/'timeline_data_collector',*(ROOT/'HBDS/plugins'/name for name in names)]
    for project in projects:
        name='openbexi_timeline_server' if project==ROOT else project.name
        run([sys.executable,'-m','build','--wheel','--no-isolation','--outdir',output,project])
        import tomllib
        metadata=tomllib.loads((project/'pyproject.toml').read_text())['project']
        prefix=metadata['name'].replace('-','_')+'-'+metadata['version']+'-'
        wheels=[path for path in output.glob('*.whl') if path.name.startswith(prefix)]
        if len(wheels)!=1: raise ValueError('Expected one independently built wheel for '+name)
        wheel=wheels[0]
        with zipfile.ZipFile(wheel) as archive:
            for entry in archive.namelist():
                if any(part in {'.git','.venv','.local-private','tests','__pycache__'} for part in Path(entry).parts) or 'timeline_private_' in entry or Path(entry).suffix.lower() in {'.jar', '.class', '.java'}:
                    raise ValueError('Nonpublic content in wheel: '+entry)
        manifest.append({'name':wheel.name,'sha256':checksum(wheel),'package':name})
    (output/'manifest.json').write_text(json.dumps({'api_version':'1','packages':manifest},indent=2)+'\n',encoding='utf-8')
    return manifest


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plugin',action='append',choices=PUBLIC)
    args=parser.parse_args();print(json.dumps(build(args.plugin),indent=2))
