# Filter syntax

Open **Filters** in the secondary menu bar to show Sorting & Filtering, then
select **Filter syntax** for help beside the editor. **Search options** chooses
Text, Pattern or Legacy search. The field/operator/value builder creates filters;
the removable **Filter: \<filter name\>** label shows the active saved filter.
An invalid expression shows its character position and keeps the last valid
filter active. **Sort by** remains a separate setting saved with each preset.
Choose the grouping field before **Save** or **Save new filter** to store it with
the expression. **Apply** changes grouping in the current view; save the preset
to retain that change for later visits. Selecting a preset restores its saved
grouping in both the main timeline and Overview.

## Legacy expressions

Existing expressions keep their meaning: `include|exclude`, with semicolon (`;`)
for alternatives and plus (`+`) for required terms. Exclusion wins. Each term is
a case-sensitive regular expression over the serialized event or whole session,
including its activities. For example:

```text
status:STARTED;status:SCHEDULE
namespace:operations+status:STARTED|description:Cancelled
```

## Advanced expressions

Start with `expr:`. This explicit prefix lets existing regular expressions keep
their meaning even when they contain parentheses or words such as `AND`.

```text
expr: namespace = "operations" AND status IN ("STARTED", "SCHEDULE")
expr: priority >= 3 AND NOT status = "CANCELLED"
expr: title CONTAINS "Ground station" AND (enabled = true OR EXISTS(data.owner))
expr: data.owner STARTS_WITH "Team" AND data.owner ENDS_WITH "A"
```

| Syntax | Meaning |
| --- | --- |
| `AND`, `OR`, `NOT`, parentheses | Boolean conditions; precedence is parentheses, NOT, AND, OR. |
| `=`, `==`, `!=` | Typed equality/inequality. Number `3` differs from string `"3"`. |
| `<`, `<=`, `>`, `>=` | Numeric comparison, or case-sensitive lexical comparison of two strings. |
| `CONTAINS`, `STARTS_WITH`, `ENDS_WITH` | Literal text comparisons. |
| `IN (value, value)` | Any listed value matches. |
| `EXISTS(field)` | The field exists, including a field whose value is null. |

Field names and text values are case-sensitive; operator keywords ignore case.
Dotted paths address nested fields. Bare names first look at the event/session,
then its `data` object. Comparisons against missing fields return false; use
`NOT EXISTS(field)` to select missing values. Quote timestamps and text containing
spaces or punctuation. Both quote styles work; escape quotes and backslashes with
a backslash. `\n`, `\r`, and `\t` are supported. Values may be strings, numbers,
booleans or null. Limits: 4096 characters, 512 tokens, 32 nested levels.

Filtering selects each top-level event or session as a unit. A selected session
retains its activities within the requested time range. Legacy exclusions inspect
the full session before that time scoping. Search highlighting is a separate
operation; applying a filter removes excluded records from the server response.

## Connected timelines

The JSON file provider applies source `filter.include` / `filter.exclude` rules
and the active saved expression before paging and serialization. Source rules
also accept `expr:` expressions. The user expression cannot override source
exclusions. REST and SSE use the same filtering path.

A request without `filter` resolves the current preset in `filters/` for its
`userName` and `timelineName`. An explicit `filter=` clears that user condition.
An explicit expression overrides the saved user expression. Filter settings
remain local files; quoted expressions and Sort by round-trip without changing
the existing JSON format. Guest settings use the guest timeline profile when
present, with `default_filter_setting.json` as the fallback.

SSE connects with the same range, filter, user and timeline parameters as finite
reads. Its change notifications contain revision IDs, without event payloads.
The client reconciles a changed revision through bounded, filtered JSON requests;
it does not download the entire unfiltered dataset. Changes outside the active
filter can still produce a revision notification. Changing filters replaces the
subscription and invalidates the old filtered cache.
