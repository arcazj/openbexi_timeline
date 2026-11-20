"""The historical seeded generator, implemented without a Java runtime.

The 48-bit random stream and its draw order are part of the public data format:
changing them changes stable IDs and descriptions for existing seeded requests.
"""
from datetime import date, datetime, timedelta, timezone
from uuid import UUID
from timeline_data_collector.acquisition import legacy_utc_text


class Random:
    def __init__(self, seed): self.seed = (seed ^ 0x5DEECE66D) & ((1 << 48) - 1)

    def bits(self, count):
        self.seed = (self.seed * 0x5DEECE66D + 11) & ((1 << 48) - 1)
        return self.seed >> (48 - count)

    def integer(self, minimum, maximum):
        bound = maximum - minimum
        if bound & (bound - 1) == 0: return minimum + ((bound * self.bits(31)) >> 31)
        while True:
            bits = self.bits(31)
            value = bits % bound
            if bits - value + bound - 1 < 1 << 31: return minimum + value

    def long(self):
        high, low = self.bits(32), self.bits(32)
        if high >= 1 << 31: high -= 1 << 32
        if low >= 1 << 31: low -= 1 << 32
        return ((high << 32) + low) & ((1 << 64) - 1)

    def uuid(self): return str(UUID(int=(self.long() << 64) | self.long()))
    def color(self): return '#' + ''.join(str(self.integer(0, 9)) for _ in range(6))


ICONS = ['icon/ob_' + name + '.png' for name in (
    'stop start yellow_flag check red_flag green_flag info error check_failed warning connect phone '
    'conflict bug lost_connection swap blue_square orange_square green_square purple_square yellow_square '
    'data_issue data sync out_of_sync loading').split()]


def calendar_text(moment):
    return legacy_utc_text(moment, pad_year=False)


def generate(request, context):
    first, last = date.fromisoformat(request['start']), date.fromisoformat(request['end'])
    count = request['count']
    if not isinstance(count, int) or not 1 <= count <= 100000 or not 0 <= (last - first).days <= 366:
        raise ValueError('Generation bounds exceeded')
    namespace = request['namespace']
    records = []
    for offset in range((last - first).days + 1):
        day = first + timedelta(days=offset)
        midnight = datetime.combine(day, datetime.min.time(), timezone.utc)
        stamp = lambda value: '' if value is None else calendar_text(midnight + timedelta(milliseconds=value))
        seed = request['seed'] ^ (day - date(1970, 1, 1)).days
        random = Random(seed)
        draw = random.integer
        random.color()  # The historical writer consumed an unused initial color.
        for index in range(count):
            context.check_cancelled()
            color = random.color()
            status = {1: 'STARTED', 2: 'RUNNING'}.get(draw(0, 4), 'FINISHED')
            priority, tolerance = str(draw(0, 5)), '100'
            original_start = original_end = None
            presets = {
                0: (4, 0, 1000000, 0, 100000), 1: (3, 0, 1000000, 0, 100000),
                3: (1, -1500000, 1500000, -1800000, 1400000),
                4: (6, 2000000, 3000000, 2000000, 300000), 5: (2, 2000000, 3000000, 2000000, 300000),
                6: (1, 2000000, 5500000, None, None), 7: (1, 2500000, 3000000, 2400000, 290000),
                8: (1, -1000000, None, None, None), 10: (1, -1000000, None, None, None),
                12: (1, -1000000, None, None, None), 20: (1, 5000000, None, None, None),
                24: (2, 4000000, None, None, None), 30: (12, 5000000, 8000000, 5000000, 800000),
            }
            if index in presets:
                activities, start, end, original_start, original_end = presets[index]
                if index == 3: tolerance = '1000'
            elif 20 < index < 29: activities, start, end = 1, 4000000, None
            elif 50 < index < 60: activities, start, end = 1, 600000, None
            elif 61 <= index <= 71: activities, start, end = 1, 5200000, None
            else:
                a, aa = draw(2, 6), draw(0, 10)
                activities = a if aa == 0 else 1
                t, t2 = draw(2, 30), draw(0, 20)
                start = t * (1000000 + t2 * 100000)
                tolerance = str(draw(0, 30) * draw(0, 30))
                end = None if t2 < 10 else start + t2 * 200000
                if end is not None: original_start = start - t2 * 2000
            dates = dict(start=stamp(start), end=stamp(end), original_start=stamp(original_start), original_end=stamp(original_end))
            title = ('Events' if end is None else 'Session_') + str(index)
            if activities > 1: title = 'Activity_' + str(index)
            record = dict(id=random.uuid(), namespace=namespace, **dates)
            descriptor = draw(0, 2) == 0
            data = dict(namespace=namespace, title=title, status=status, type='type1', system='system1', priority=priority)
            if tolerance != '0' or descriptor: data['tolerance'] = tolerance
            data['description'] = f'description_{index} {title}' + ('_read_descriptor_in_file' if descriptor else '')
            record['data'], record['render'] = data, {'color': color}
            icon = draw(0, 40)
            if end is None and icon < len(ICONS) - 1: record['render']['image'] = ICONS[icon]
            record['activities'] = []
            for activity in range(activities):
                child = dict(id=random.uuid(), namespace=namespace, **dates)
                title = ('Events_' if end is None else 'Session_') + f'{index}_{activity}'
                if activities > 1: title = f'Activity_{index}_{activity}'
                descriptor = draw(0, 2) == 0
                if not descriptor:
                    long_text, length = draw(1, 10), draw(1, 15)
                    if long_text > 7: title += '_long_text' * length
                data = dict(namespace=namespace, title=title, status=status, priority=priority)
                if tolerance != '0' or descriptor: data['tolerance'] = tolerance
                if descriptor: data['type'] = 'type1'
                data['description'] = f'description_{title}_activity_{activity}' + ('_read_descriptor_in_file' if descriptor else '')
                child['data'], child['render'] = data, {'color': color}
                show_icon = end is None or draw(1, 10) > 7
                if show_icon and icon < len(ICONS) - 1: child['render']['image'] = ICONS[icon]
                record['activities'].append(child)
            records.append(record)
        if request['zones']:
            random = Random(seed ^ 0x5DEECE66D)
            for index, (start, end) in enumerate(((-1800000, 720000), (3600000, 4680000), (6120000, 7920000)), 1):
                records.append(dict(id=random.uuid(), zone='zone', start=stamp(start), end=stamp(end),
                                    data=dict(text=f'zone_{index}', description=f'zone_{index}'), render=dict(color=random.color())))
    return records
