# Complete rounded-position review — 2026-11-05 UTC

Reviewed source `a82a49f` passes one complete canonical source invocation:
257 cases across 46 files, with zero retries, skips, flaky or unexpected results.
The run includes the actual canonical 48-reference source-parent test.

The complete original 384-layout matrix finishes at **360 exact matches,
four mismatches and 20 matching-budget errors**. The full matrix is not green.
Every previous 352 full-matrix match and all 44 previous colored-cohort matches
remain. Cohorts finish at CJK 64/64, marks 63/64, bidi 62/64, joining 61/64,
axes 64/64 and colored 46/64. No original layout or assertion is removed.

Matched layouts retain original full shaping contexts, GIDs, font priority and
axis tuples, exact ink at both opacity samples and exact color ownership.
Every cohort leaves the document unchanged with zero probes/private faces.
All 48 independent fallback Float32 reference compositions pass in the same
fallback invocation. All 3,935 frozen inputs remain unchanged through both runs.
Earlier core checks pass build/typecheck, all 3,428 unit/API checks, 24 native
controls and 45 emitted production workflows.

The additional complete-single-span development checkout matches all 64 original
mark layouts and passes its unit, 40-control and 54-reference checks, but fails
one of 53 production workflows on the actual RTL sideways affine project.
That development is not accepted or integrated. Its separate cohort result is
not used to invent a new combined aggregate. The original 24 remaining native
layouts and all broader public/host/device/memory/performance/roadmap acceptance
still require work.

[Raw reports, original and review rows, source identities, per-layout retention and verification scripts](native-rounded-positions-terminal-2026-11-05.json.gz).
