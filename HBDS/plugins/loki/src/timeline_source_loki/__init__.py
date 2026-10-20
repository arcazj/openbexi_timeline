"""Public Loki reader; converter implementations remain independently installed."""
from timeline_data_collector.plugin import manifest_for


class Plugin:
    @staticmethod
    def manifest():
        return manifest_for(__file__)

    def acquire(self, context):
        from .source import acquire
        acquire(context)

    def read(self, context):
        from .source import read
        yield from read(context)
