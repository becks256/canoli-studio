# Native curved span integration — 2026-11-04

The previously isolated curved original-span fix is now integrated in the main
checkout. Before transfer, esbuild verified that the formatted main preimages and
the tested branch preimages compiled identically. This preserves the deployment
build ordering and exact compiler artifacts repaired in e0f61f1.

Path spans accumulate original signed cluster allocations. RTL parent preparation
retains source and screen layout grids; straight spans retain their native
fragment accumulation. Negative vertical paths with multiple original spans use
joint complete-source assembly even with one owned font. Cross-span shaping
clusters retain other preparations. Existing placements, original text/font/axis
identity and exact complete native ink/color ownership checks remain mandatory.
No comparison pixels determine a displacement or acceptance tolerance.

## Current main verification

- Build/typecheck passes, including generated font runtimes before scripting.
- All 3,427 unit/API tests across 346 files pass.
- Nine focused browser tests pass: sixteen straight/curved span controls,
  original signed fallback controls, native calibration/cleanup, and three
  independent affine original-font Float32 references. Every RGB/alpha and
  partition word agrees, including alpha 1e-8 and overlapping colored glyphs.
- The existing twenty-one production regressions pass.
- Two new production workflows open source-bearing OO projects, render the actual
  curved TextLayer through the emitted app, edit opacity through isolated Scripts,
  undo once and reopen the saved project. LTR/RTL affine cases retain identical
  native PNG bytes, complete document geometry/styles and original font bytes.
  No developer global or prepared matcher adapter supplies the source capture.
  These workflows establish production wiring and persistence; the separate
  independent Float32 tests establish their stated numerical coverage.
- The new tests initially used the REST PNG reader, which correctly rejects the
  app's profiled output. Browser PNG decoding fixes that test harness. Both corrected
  workflows pass; the original failure log is retained.
- Final build/typecheck/guides and the combined 23-case production run pass with
  zero skipped/flaky cases. All 243 affected source cases across 40 files pass in
  30.4 minutes, with zero skipped/flaky cases. Every one of the 3,831 frozen source/
  test/build/release hashes remains unchanged through the terminal source result.
- The tested 177-file release is copied by value into the ignored local checkpoint
  before the documentation status refresh. Its final rebuild/typecheck and emitted
  no-JavaScript guide check pass. Only `dist/developer/float-text.html` changes from
  the frozen inventory; every engine/test/script/generated/runtime byte remains
  identical to the passing source/production matrices.

Raw current logs, reports, integration preimages and frozen input identities are
under `/tmp/canoli-native-curved-main-2026-11-04/` and the ignored local checkpoint
`.canoli/checkpoints/native-curved-spans-2026-11-04/`. Earlier branch verification
remains under `/tmp/canoli-curved-span-integration-2026-11-02/validation/`:
243 source cases, 21 production cases, 9 focused cases and 3,427 unit/API cases
passed there. Earlier branch evidence does not replace current main validation.

[Compact current receipt](native-curved-integration-2026-11-04.json.gz) retains
input identities and current reports. [Independent cross-span diagnostics](native-cross-span-2026-11-04.md)
identify a remaining native character-addressing problem; they are not a product fix.

## Broad original native acceptance still fails

The separate visual-order/script-spacing experiment is terminal. Its 872 frozen
file hashes remain unchanged. Five tests pass and five fail in 36.8 minutes, with
zero skipped/flaky cases. Its six original 64-layout cohorts report these matched
statuses:

| Cohort | Matched status | Original layouts |
| --- | ---: | ---: |
| Marks | 57 | 64 |
| Bidirectional | 61 | 64 |
| Joining | 61 | 64 |
| CJK | 30 | 64 |
| Variable axes | 64 | 64 |
| Cross-span color | 5 | 64 |

Its 36 independent Float32 references pass, including the six vertical Arabic
controls that previously failed. This does not prove the full 384-layout gate:
upright marks, transformed bidi/joining, CJK path placement and clusters crossing
authored color spans remain unresolved. The experimental changes remain outside
main. Its runner used an explicit 12-second per-match deadline; timeout rows are
not evidence that the ordinary 60-second gate would pass. Raw results remain in
`/tmp/canoli-native-visual-frozen-2026-11-02/`.

The 243-case affected suite does not include the unresolved broad 384-layout
matrix. Both that matrix and all 36 references remain required acceptance for
the final implementation. Complete public typography, original-resolution/device/
memory/performance, photographic/precision/workflow, provider/installed ChatGPT/
live identity/commercial and every other unfinished original roadmap gate remain
in scope. This checkpoint does not complete F08/F10 or the full goal.
