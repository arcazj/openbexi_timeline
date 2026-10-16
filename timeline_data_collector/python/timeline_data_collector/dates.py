"""Inclusive calendar selectors resolved once at the job boundary, in UTC."""
from datetime import date, datetime, timezone
import calendar
import re


def date_range(selector=None, end=None):
    if selector is None:
        if end: raise ValueError('--end-date requires --date')
        return None, None
    selector = selector.replace('_', '-')
    if selector.lower() == 'today':
        first = last = datetime.now(timezone.utc).date()
    elif re.fullmatch(r'\d{4}', selector):
        first, last = date(int(selector), 1, 1), date(int(selector), 12, 31)
    elif re.fullmatch(r'\d{4}-\d{2}', selector):
        year, month = map(int, selector.split('-'))
        first, last = date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])
    else: first = last = date.fromisoformat(selector)
    if end: last = date.fromisoformat(end.replace('_', '-'))
    if last < first: raise ValueError('End date precedes start date')
    return first.isoformat(), last.isoformat()
