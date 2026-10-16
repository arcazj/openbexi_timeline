import os
import re
from pathlib import Path

class FileChangedError(OSError): pass

def output_directory_pattern(model):
    import os
    tokens = {'yyyy': '\\d{4}', 'mm': '\\d{2}', 'dd': '\\d{2}'}
    parts = Path(model).resolve().parts
    return re.compile(re.escape(os.path.normcase(parts[0])) + re.escape(os.sep).join((tokens.get(part, re.escape(os.path.normcase(part))) for part in parts[1:])))

def fingerprint(st):
    return f'{st.st_dev}:{st.st_ino}:{st.st_size}:{st.st_mtime_ns}:{st.st_ctime_ns}'
