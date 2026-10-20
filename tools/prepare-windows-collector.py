"""Prepare a self-contained Windows collector from the reviewed public wheel manifest."""
from pathlib import Path
import argparse
import csv
import hashlib
import json
import shutil
import subprocess
import sys
import urllib.request
import zipfile

VERSION = '3.13.16'
PYTHON_SHA256 = '97dae5274cc54867065e8d5a3226e48c35017ed332a0fdb0e27d5b5821961297'
PUBLIC = {'timeline_data_collector', 'filesources', 'timeline_json', 'default', 'earthquake', 'volcano', 'mqtt', 'loki'}


def prepare(root, payload):
    root, payload = root.resolve(), payload.resolve()
    if not payload.is_relative_to(root / 'dist'): raise ValueError('Payload must be inside project dist')
    runtime = payload / 'python'
    runtime.mkdir()
    cache = root / 'dist/downloads'; cache.mkdir(exist_ok=True)
    archive = cache / f'python-{VERSION}-embed-amd64.zip'
    if not archive.exists():
        urllib.request.urlretrieve(f'https://www.python.org/ftp/python/{VERSION}/{archive.name}', archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != PYTHON_SHA256: raise ValueError('Python runtime checksum mismatch')
    with zipfile.ZipFile(archive) as bundle:
        for name in bundle.namelist():
            if not (runtime / name).resolve().is_relative_to(runtime): raise ValueError('Invalid runtime path')
        bundle.extractall(runtime)
    (runtime / 'python313._pth').write_text('python313.zip\n.\nLib/site-packages\nimport site\n', encoding='ascii')
    manifest = json.loads((root / 'dist/collector/manifest.json').read_text())
    if {item['package'] for item in manifest['packages']} != PUBLIC: raise ValueError('Incomplete or nonpublic plugin build')
    wheels = []
    for item in manifest['packages']:
        artifact = root / 'dist/collector' / item['name']
        if artifact.name != item['name']: raise ValueError('Invalid artifact name')
        if hashlib.sha256(artifact.read_bytes()).hexdigest() != item['sha256']: raise ValueError('Plugin checksum mismatch')
        if artifact.suffix == '.whl': wheels.append(str(artifact))
    subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check', '--no-compile', '--only-binary=:all:',
                    '--platform', 'win_amd64', '--python-version', '3.13', '--implementation', 'cp', '--abi', 'cp313',
                    '--target', str(runtime / 'Lib/site-packages'), '-r', str(root / 'release/windows/collector-requirements.txt'),
                    *wheels], check=True)
    site = runtime / 'Lib/site-packages'
    # pip's build-machine script launchers and direct URLs are not portable.
    # Only this newly created, verified payload tree may be changed here.
    for file in site.glob('*.dist-info/direct_url.json'): file.unlink()
    for name in ('bin', 'Scripts'):
        generated = site / name
        if generated.exists():
            if generated.is_symlink() or not generated.resolve().is_relative_to(runtime): raise ValueError('Unexpected script directory')
            shutil.rmtree(generated)
    for record in site.glob('*.dist-info/RECORD'):
        with record.open(newline='', encoding='utf-8') as handle: rows = list(csv.reader(handle))
        with record.open('w', newline='', encoding='utf-8') as handle:
            csv.writer(handle).writerows(row for row in rows if (site / row[0]).is_file())
    commands = {'timeline-data-collector': '-m timeline_data_collector'}
    for name in ('default', 'earthquake', 'volcano', 'mqtt', 'timeline_json'):
        module = 'timeline_plugin_json' if name == 'timeline_json' else 'timeline_plugin_' + name
        commands['timeline-convert-' + name] = f'-c "from {module} import main; raise SystemExit(main())"'
    for name, command in commands.items():
        (payload / (name + '.cmd')).write_text('@echo off\nset "JAVA_HOME=%~dp0runtime"\n"%~dp0python\\python.exe" ' + command + ' %*\nexit /b %errorlevel%\n', encoding='ascii')
    for directory in runtime.rglob('timeline_private_*'): raise ValueError('Private package entered Windows payload: ' + str(directory))
    subprocess.run([str(runtime / 'python.exe'), '-B', '-m', 'timeline_data_collector', '--version'], check=True)
    (runtime / 'RUNTIME-MANIFEST.json').write_text(json.dumps(dict(python=VERSION, python_sha256=PYTHON_SHA256,
        plugins=manifest['packages']), indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--payload', type=Path, required=True)
    args = parser.parse_args(); prepare(args.root, args.payload)
