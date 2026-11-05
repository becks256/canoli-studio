# Complete shared-origin review — 2026-11-05 UTC

Review `f020fb1` passes one complete canonical source invocation: 258 cases
across 46 files, with zero retries, skips, flaky or unexpected results. The actual
canonical source-parent test and all 48 of its independent references are inside
that invocation.

The complete original 384-layout matrix finishes at **361 exact matches,
three mismatches and 20 matching-budget errors**. Full native acceptance is not
green. All 360 previous full-matrix matches, all original 352 matches and all
44 prior colored-cohort matches remain. Cohorts are CJK 64/64, marks 64/64,
bidi 62/64, joining 61/64, axes 64/64 and colored 46/64. The new match is the
original RTL sideways straight affine mark layout with tracking -30.

All 60 independent fallback Float32 reference compositions pass in the same
fallback invocation. Every matched layout has exact full ink at both opacity
samples and exact color ownership. The audit verifies 2,296 glyph records and
1,395 original full-context shaping requests, retaining GIDs, owned font priority
and axis tuples. Every cohort leaves its model unchanged with zero remaining
probes/private faces. All 4,030 frozen inputs remain unchanged through both runs.

The isolated core already passes build/typecheck, 3,428 unit/API cases, 56 native
controls and 53 production workflows. The final documentation build/guide check
and exact runtime/source identity verification are separately recorded in the
receipt. Main integration is not claimed here. The newer horizontal development
is separate; its cohort results are not mixed into this complete matrix result.
The 23 remaining native layouts, broader public/host/device/memory/performance
acceptance and every unfinished original roadmap gate remain required.

[Raw complete reports, current and prior layout rows, frozen identities, metadata and retention audits](native-shared-origin-terminal-2026-11-05.json.gz).
