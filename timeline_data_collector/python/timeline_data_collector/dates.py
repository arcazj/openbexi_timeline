"""Inclusive calendar selectors resolved once at the job boundary, in UTC."""
from datetime import date, datetime, timezone, timedelta
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


def repeat_range(selector=None, end=None, lookback_hours=0):
    """Resolve a moving UTC window for each pass, including midnight rollover."""
    if isinstance(lookback_hours, bool) or not isinstance(lookback_hours, (int, float)) or not 0 <= lookback_hours <= 87600:
        raise ValueError('lookback_hours must be between 0 and 87600')
    if selector and selector.lower() == 'today':
        if end: raise ValueError('A moving today window cannot have a fixed end date')
        now = datetime.now(timezone.utc)
        return (now-timedelta(hours=lookback_hours)).date().isoformat(), now.date().isoformat()
    return date_range(selector, end)
