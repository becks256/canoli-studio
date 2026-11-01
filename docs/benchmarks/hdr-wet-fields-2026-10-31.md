# Prepared HDR wet assets and fields — 2026-10-31

Status: verified private implementation dependency from `f45f0d5`. The full
original implementation-roadmap goal stays active. This does not enable public
HDR wet document editing or tools.

Completed Float32 straight pixels now persist losslessly in native RGBA32 TIFF
pairs with the complete linear-sRGB ICC. Complete original samples and pair
coverage validate before field capture. Ordered premultiplied color, replacement
alpha and independent removal coverage stay Float64 through native mapped/
projective sampling; final native composition stores straight Float32 once.
This avoids an extra Float32 premultiplication: the independent control changes
**2,818 reference words**, while the new full-removal path retains completed
positive-alpha Float32 replacements exactly. [Contract](../HDR_WET_FIELDS.md).

## Acceptance

Passed: **3,261 unit/API/native tests across 315 files; 73 source-browser cases across 8 files; 11 selected production cases across 6 files**. Those complete runs have zero failed/skipped cases,
retries, flakes or runner errors. The build/typecheck passes and 1,661 product,
test, fixture and build-input identities stay frozen throughout acceptance.

Independent scalar/NumPy references compare every word for four compositions
and two projective fields, including a horizon and origins at 2^38. Real worker
checks add streamed fields, exact identity, nested input ownership, malformed
replies, overflow, disposal and healthy retry. Native scratch/caller partitions
retain output through a 65,539-pixel composition. Existing scalar and byte wet
field validation/math keep their accepted domains and behavior.

Two browser pipelines prepare retained native float strokes from real 131x79
and genuine 10000x5000 originals, encode four color/coverage tile pairs each,
close the source, project/compose and reopen files. Independent native libtiff
reads all **16 TIFF assets**, their native Float32 samples and complete ICC;
NumPy replays them and matches every recorded expected/actual/reopened word.
Each original-derived **64x48** window independently matches native libtiff/Linux
CMM samples. This is bounded-window prepared-asset acceptance, **not every-pixel
50 MP wet document editing/delivery**. The existing full 50 MP float pipeline
also remains exact across all 200 million samples, as its separate reader report
records; that is a shared-kernel regression check.

The complete affected source matrix retains existing projected/mapped byte wet
rendering and gestures, mask planes, retained float sessions and original-source
processing. Production repeats the new built HDR worker references and checks
its new guide at 390 px with JavaScript disabled. Existing built scalar/mapped
fields, projected Mixer controls, float-mask delivery and float wet-tool gating
pass. There are now 45 built developer pages. These selected checks do not claim
full-production coverage, photographic/device acceptance or sustained 60fps.

## Reproduced precision issues

The first two browser pilots exposed identity drift from a general homography
solve and zero-alpha signed-zero canonicalization. The new HDR compiler detects
exact parallelograms and uses affine arithmetic, including forward/input/origin
mapping. Native sampling retains valid signed zeros and clears only nonzero
pigment when alpha underflows to zero. Actual field/pixel word comparisons stay
exact. Zero coefficient signs are equivalent geometry; coefficient assertions
compare them numerically while strict pigment word assertions remain. Earlier
failure reports are retained. No product threshold, timeout or numeric tolerance
was widened. Legacy scalar/byte homography compilation remains unchanged.

## Evidence

[Compact SHA-addressed receipt](hdr-wet-fields-2026-10-31.json.gz) contains complete
unit/browser/production reports, all 17 exact new worker fixture outputs,
prepared TIFFs and native samples, both independent libtiff/NumPy reports,
fixture/source identities, artifact hashes, build logs and final runtime-asset
comparison. Large existing pipeline files remain local with hashes in the
receipt. No new ZIP is tracked. References are regenerated explicitly with
`scripts/generate-hdr-wet-field-fixtures.py`; independent file verification uses
`scripts/check-hdr-wet-assets.py` and native libtiff/NumPy.

Reproduce with `npm run build`, `npm test -- --maxWorkers=2` and the exact source/
production specs/configs retained in `/tmp/canoli-hdr-wet-field-2026-10-31/`.
Product/test sources are unchanged through acceptance. Private prepared TIFF
validation does not restrict the existing original TIFF import workflow; working
window budgets remain independent of original image geometry. Full validation
uses native rows, so extreme row widths still depend on available memory.

## Still required

Versioned public HDR wet strokes/assets, guarded host/shared-command validation,
FloatScene replay in operation order, projection/resize and original-bearing
history/project/workspace/recipe transport, independent REST/isolated surfaces
as scoped, authoring previews/commit and actual tools remain required. Current
schema 56, public byte wet constructors and plugin grants remain unchanged.
Float Smudge/Mixer stay disabled. Every other unfinished original professional,
AI, workflow, ChatGPT/live identity, commercial, specialist, motion, quality and
performance gate stays active. No paid call, upload, new account, physical pigment
simulation or browser/REST synchronization is inferred.

Receipt: **1075055 bytes**, SHA-256
`507565ed42af5b79b7c035d7d2c8f6eedc243f26d3d923990095132d2bc851f2`. Independent unpacking verifies every stored object
identity/length and all 17 worker fixture outputs. The final build retains
**101 runtime resources byte-identical** to the tested build; all generated
developer pages also match.
