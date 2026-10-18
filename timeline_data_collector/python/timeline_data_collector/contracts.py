"""Version 1 plugin contract. Plugins own acquisition/conversion, the core owns output."""
from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Protocol
import logging
import threading


class Cancelled(Exception):
    """Cooperative cancellation; a committed batch is never rolled back."""


@dataclass
class InputBatch:
    items: list[Any] = field(default_factory=list)
    checkpoint: dict = field(default_factory=dict)
    acknowledge: Callable[[], None] | None = None


@dataclass
class RecordBatch:
    records: list[dict] = field(default_factory=list)
    checkpoint: dict = field(default_factory=dict)
    # Missing records are not deletions. Replacement requires an explicit snapshot.
    snapshot: bool = False
    deleted_ids: list[str] = field(default_factory=list)
    acknowledge: Callable[[], None] | None = None
    # Progressive converters publish intermediate results without accepting input.
    commit_input: bool = True


@dataclass
class Context:
    workspace: Path
    namespace: str
    source: dict
    source_key: str
    workdir: Path
    checkpoint: dict
    start_date: str | None = None
    end_date: str | None = None
    offline: bool = False
    force: bool = False
    mode: str = 'once'
    cancel: threading.Event = field(default_factory=threading.Event)
    logger: logging.Logger = field(default_factory=lambda: logging.getLogger('timeline_data_collector'))

    @property
    def options(self):
        from .io import expand_env
        return expand_env(self.source.get('options', {}))

    def check_cancelled(self):
        if self.cancel.is_set():
            raise Cancelled('Conversion cancelled')


class Reader(Protocol):
    def read(self, context: Context) -> Iterable[InputBatch]: ...


class Converter(Protocol):
    def convert(self, batch: InputBatch, context: Context) -> RecordBatch: ...


class Pipeline(Protocol):
    """Optional combined source/converter capability, selected with the same ID."""
    def collect(self, context: Context) -> Iterable[RecordBatch]: ...
