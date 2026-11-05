# Original native fallback matrix — terminal result, 2026-11-05 UTC

The complete original 384-layout run has finished against the isolated source
that matches main commit `ea27ff2` byte for byte across all 750 non-generated
source files. Every layout keeps its original text, font priority, transforms,
paths, spacing, directions, axes and exact ink/ownership assertions. Every match
uses the ordinary 60-second deadline. The whole run completes in 59.2 minutes
under shared load; this is functional evidence, not a performance acceptance.

| Cohort | Exact matches | Mismatches | Timeouts |
| --- | ---: | ---: | ---: |
| Marks | 59 | 5 | 0 |
| Bidi | 62 | 0 | 2 |
| Joining | 61 | 1 | 2 |
| CJK | 64 | 0 | 0 |
| Variable axes | 64 | 0 | 0 |
| Colored spans | 36 | 2 | 26 |
| **Total** | **346** | **8** | **30** |

All 36 original independent Float32 paint references pass. The browser harness
reports three passing tests and four failing cohort tests, with zero skipped or
flaky tests. Every cohort records its complete 64 rows. All six document
snapshots remain unchanged, with zero remaining probe nodes or private font
faces. All 3,956 frozen source/test/original/release identities remain unchanged
through the terminal result. A separate audit also checks every matched row,
including 2,176 glyphs with original family/axis identity and 1,352 runs with the
complete original shaping text. Every matched row retains exact ink and ownership;
the failed cohort tests do not need to reach their later assertions for this audit.

These results close observation of the earlier running matrix. They do not close
F08/F10, the original 384/36 acceptance target, or any other unfinished public
native typography, transport, device, memory, performance, professional-editor,
AI/provider/evaluation, ChatGPT/identity, workflow or commercial roadmap gate.
The full original implementation objective remains active.

The [terminal source and evidence receipt](native-fallback-matrix-2026-11-05.json.gz)
retains the complete report, all cohort rows/progress, exact engine/test source
and frozen input identities, with each embedded file hash verified. It supplements
the historical [search checkpoint](native-search-2026-11-04.json.gz); that earlier
partial-run receipt is preserved unchanged. Raw terminal evidence remains under
`/tmp/canoli-native-search-2026-11-04/`.
