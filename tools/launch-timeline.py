"""Shared source-checkout launcher preserving caller-relative configuration paths."""
from pathlib import Path
import os
import sys


def main(arguments=None):
    root = Path(os.getenv('OPENBEXI_TIMELINE_HOME') or Path(__file__).resolve().parents[1]).resolve()
    arguments = list(sys.argv[1:] if arguments is None else arguments)
    if not arguments:
        configuration = next((os.environ[name] for name in ('OPENBEXI_HBDS_CONFIG', 'OPENBEXI_TIMELINE_CONFIG', 'OPENBEXI_TIMELINE_DATA_PATH') if os.getenv(name)), None)
        if configuration:
            arguments = ['-data_conf', configuration]
        elif (root / 'HBDS/workspace.json').exists():
            arguments = ['--workspace', str(root / 'HBDS/workspace.json')]
        else:
            arguments = ['-dataconf', str(root / 'HBDS/yaml/DEMO_default.yml'), '-serverconf', str(root / 'HBDS/service.yml'), '--hbds-root', str(root / 'HBDS')]
    path_flags = {'--workspace', '--root', '--state', '--hbds-root', '--data-directory', '-serverconf', '--server-conf', '--ssl-certfile', '--ssl-keyfile'}
    list_flags = {'-data_conf', '-data_path', '-dataconf', '--data-conf'}
    resolved, path_values = [], False
    single = False
    for argument in arguments:
        if argument.startswith('-'):
            if '=' in argument:
                flag, value = argument.split('=', 1)
                if flag in path_flags | list_flags:
                    argument = flag + '=' + str(Path(value).resolve())
            path_values = argument in path_flags | list_flags
            single = argument in path_flags
            resolved.append('-data_conf' if argument == '-data_path' else argument)
        elif path_values:
            resolved.append(str(Path(argument).resolve()))
            if single:
                path_values = False
        else:
            resolved.append(argument)
    if os.getenv('OPENBEXI_HBDS_CONFIG'):
        os.environ['OPENBEXI_HBDS_CONFIG'] = str(Path(os.environ['OPENBEXI_HBDS_CONFIG']).resolve())
    sys.path.insert(0, str(root / 'python'))
    os.chdir(root)
    sys.argv = ['openbexi_timeline_server', '--root', str(root), *resolved]
    from openbexi_timeline_server.__main__ import main as serve
    serve()


if __name__ == '__main__':
    main()
