"""OS-owned locks: automatically released when a monitor process exits/crashes."""
import os
from pathlib import Path

class SourceLock:
    def __init__(self,path): self.path=Path(path); self.stream=None
    def acquire(self):
        self.path.parent.mkdir(parents=True,exist_ok=True)
        self.stream=self.path.open('a+b')
        self.stream.seek(0,os.SEEK_END)
        if not self.stream.tell(): self.stream.write(b'0'); self.stream.flush()
        self.stream.seek(0)
        try:
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(self.stream.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(self.stream.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            return True
        except OSError:
            self.stream.close(); self.stream=None; return False
    def release(self):
        if self.stream is not None:
            try:
                if os.name=='nt':
                    import msvcrt
                    self.stream.seek(0); msvcrt.locking(self.stream.fileno(),msvcrt.LK_UNLCK,1)
                else:
                    import fcntl
                    fcntl.flock(self.stream.fileno(),fcntl.LOCK_UN)
            finally: self.stream.close(); self.stream=None
