# Native rejected-paint terminal verification — 2026-11-05 UTC

Review `5d21356` passes the complete canonical source suite (262 cases / 48
files) and all 57 selected production workflows / 17 files. The same frozen
source matches 364/384 original native layouts, retaining all 362 prior matches.
Two mismatches and 18 matching-budget errors remain, so the seven-spec matrix
exits 1. Its 72 independent Float32 references pass. All accepted checks have
zero skips, retries and flaky results. All 4,036 frozen inputs are unchanged.

Matched-layout audits validate 2,318 glyph metadata records and 1,406 original
full-context requests, original font priority and axis tuples, native GIDs,
colors, both opacity samples, whole ink and ownership. Every cohort retains
original document data and leaves zero probes/private faces.

The separate corrected horizontal source suite passes 259 cases / 47 files
with all 4,031 inputs unchanged. Its original failed 258/259 invocation remains
in the earlier receipt. The tracked-source reference replaces an internal
representation assertion while retaining every numeric/partition/font gate.

The prior core receipt contains the implementation, full 3,431-test / 347-file
unit run, 16 focused browser tests, retirement faults and duplicate-work
diagnostics. The terminal receipt records complete broad runs; it does not
infer lower user latency, full native acceptance or completion of the roadmap.

[Raw reports, configurations, frozen identities, source controls and audits](native-rejected-paint-terminal-2026-11-05.json.gz).
