# Connected startup corrections

These generic notes preserve the implementation findings without publishing
private deployment settings, event data, source identifiers, or raw screenshots.

Legacy point events can have a blank or absent end timestamp. Range checks now
use the start timestamp for those records and nested point activities. Invalid
nonblank dates remain invalid; source data is not rewritten.

The client renders its timeline shell before the first provider response. Loading
and failures therefore remain visible, and later requests can recover. Dateless
filter/settings requests skip date parsing. Initial bands have finite visible
heights even when the first request fails or the provider returns no records.

Bounded scans prioritize requested partitions before archived data and report
unavailable sources and skipped invalid records. Valid records remain visible.
Incomplete coverage disables authoritative Fit matches and retains uniform Auto
spacing. Response timestamps are normalized to UTC after searching the original
values, preventing mixed legacy time zones from inverting ranges in the browser.

Public regression coverage is in
[timeline-results.test.mjs](../../../tests/timeline-results.test.mjs) and
[MatchProtocolTest.java](../../../tests/java/com/openbexi/timeline/data_browser/MatchProtocolTest.java).
Tests use generic configuration and synthetic records rather than private files
or running deployment services.
