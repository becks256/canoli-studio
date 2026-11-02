# Retained projective mask maps — 2026-10-31

This advances the private transport needed for preserving-position projective
mask relinking. Baseline: `e58ecc5`. Public linkage still rejects active perspective.
A retained matrix alone cannot preserve a mask's native rasterization lattice;
the remaining model, original-grid/source provenance, tools and persistence work
is described in [the integration gates](../PERSPECTIVE_ENGINE.md#remaining-projective-mask-plane-integration).
The full F03/F06/F14 and original roadmap remain required.

## Implemented dependency

`FieldMapping` owns nine finite invertible homogeneous pull coefficients plus
independent input/source origins. The input origin is subtracted before the
matrix is evaluated; the integer source origin is restored only for native
field addressing. Coefficients are retained unchanged, without normalization or
another corner solve. This admits charts whose horizon crosses an arbitrary
reference rectangle, including the coordinate origin, while preserving finite
coverage deviations and constant infinite background.

`compileMappedField` uses the existing scalar WASM ABI. Native/host/actual worker
boundaries validate map shape, source/output geometry, coverage and owned buffers.
Both scalar entry points share the existing bounded streamer, conservative
empty-footprint proof, bilinear neighbors, horizon splitting, cancellation and
source-lifetime checks. Ordinary linked-mask capture retains its compiled map;
forward brush transport retains its existing direction/affine-input contract.
The WASM algorithm, public constructor/model/schema/history/API/grant boundaries
are unchanged. No original-source limit or extra interpolation pass is added.

## Native and browser pilot evidence

All **53 focused native cases across three files** pass on actual WASM.
New cases compare every native ABI float64 word and every output float32 word
with the prior corner path, including independent existing scalar fixtures and
irregular partitions. Additional cases cover independent complete bilinear
coverage across a horizon, origin-on-horizon maps, separated large coordinate
origins, captured affine input, unknown support, bounded 50 MP address-space
reads, immutable map ownership, changed-source/cancellation guards, singular
maps, malformed replies and missing neighborhoods.

The initial real-browser pilot passes all eight cases across two files, including
all existing captured mask kinds/refinements/settings and a genuine 50 MP original
alpha field checked independently. Two initial test-only readonly/tuple type
annotations were corrected before the final accepted build; their logs remain.
The later forged-packet case is covered by the final expanded matrix rather than
this earlier eight-case pilot.

Both the original and retained-map production worker contracts pass all **four**
actual bundled-worker cases. These check independent fixture coverage, ownership,
unknown/singular geometry and invalid coverage rejection, and successful retry.
The final release builds on Node 26.13.0; the documentation rebuild changes only
`developer/perspective-engine.html`. Every application, worker and kernel byte
matches the candidate measured below. The baseline/candidate WASM kernels are
identical; no native algorithm or tolerance changed.

## Ordinary-production output and feedback

Each pair covers affine/projected raster, ordinary mask and filter mask, with
twelve actual pointer events per gesture. New endpoint witnesses must reach the
real foreground canvas. Complete frame hashes are recorded after timing;
readback is included. Twelve samples make p95 the maximum. These small headless
observations do not establish physical presentation or sustained/editor-wide
performance. All six workflows in each build use ordinary production without
developer globals or CPU profiling.

Both pairs preserve **72 complete foreground hashes and six PNG exports per
pair**, original source bytes, twelve accepted points and exact one Undo/Redo.
No long task is observed in these small gestures. Full latency acceptance remains
open, including slower observations below.

### Pair 1 — baseline then candidate

| Target                  | Median before → after | P95 before → after |
| ----------------------- | --------------------: | -----------------: |
| Affine raster           |        74.3 → 76.2 ms |   101.1 → 102.1 ms |
| Affine ordinary mask    |        76.8 → 80.0 ms |   118.8 → 107.0 ms |
| Affine filter mask      |        95.7 → 84.7 ms |   122.0 → 120.2 ms |
| Projected raster        |      104.5 → 117.5 ms |   149.2 → 146.4 ms |
| Projected ordinary mask |      129.8 → 116.4 ms |   179.5 → 179.3 ms |
| Projected filter mask   |      133.2 → 131.1 ms |   216.1 → 233.1 ms |

### Pair 2 — candidate then baseline

| Target                  | Median before → after | P95 before → after |
| ----------------------- | --------------------: | -----------------: |
| Affine raster           |        82.0 → 70.9 ms |     96.2 → 90.4 ms |
| Affine ordinary mask    |        90.5 → 75.7 ms |   129.8 → 101.8 ms |
| Affine filter mask      |        87.5 → 91.2 ms |   116.5 → 126.1 ms |
| Projected raster        |      100.1 → 138.5 ms |   149.0 → 183.4 ms |
| Projected ordinary mask |      117.2 → 121.9 ms |   161.8 → 180.0 ms |
| Projected filter mask   |      134.4 → 134.4 ms |   229.4 → 231.1 ms |

Projected-raster medians worsen in both ordinary pairs (104.5→117.5 ms and
100.1→138.5 ms); other controls vary. A separate matched CPU-profile pair has
nearly flat medians (106.9→107.2 ms) but a slower candidate p95 (163.2→179.3 ms).
CPU sampling is explicitly diagnostic and excluded from the ordinary tables.
Those profiles do not identify a causal new hotspot or disprove a regression.
All initial timings and profiles remain retained; no universal speedup or
performance-regression clearance is claimed. Every measured p95 exceeds 33 ms.
The original ≤33 ms live-input p95 / <50 ms routine-task and full all-tool /
sustained/device/process-memory acceptance remain required.

## Expanded final browser verification

All **167 affected browser cases across 24 files** pass in one complete run,
without failures, retries, skips or flakes. This includes the four new retained-map
worker/native-source cases, all five captured mask kinds and refinements, scalar
and coupled fields, horizon/partition checks, ordinary/filter-mask brushes and
wet tools, reflected/placed gestures, original 50 MP byte/float sources,
project/workspace/SVG/Photoshop delivery, source ownership and cancellation.
The genuine native-source checks retain the existing independent checker and
numeric gates. The actual worker rejects unknown/singular mappings, missing
neighborhoods and invalid coverage, then succeeds on the same worker with caller
pixels intact. All application/worker bytes remain those of the frozen candidate.

The complete `npm test -- --maxWorkers=2` run passes all **3,207 unit/API/native
tests across 311 files** on Node 26.13.0. Its 22 new retained-map cases include
homogeneous scales 2^-500 and 2^500 and exact signed-zero background. The isolated
scale probe intentionally selected one case; full acceptance includes every case
without that selection. The full-suite WASM matches the final release kernel.

## Reproduction and evidence

Use `npm run build` and `npm test`, the new mapped-field unit/development/production
worker tests, the affected mask/perspective/wet/rendering browser files, and
`npx playwright test --config playwright.wet-feedback.config.ts` for ordinary
production feedback. Exact task configurations, commands, source reconstruction,
release/kernel identities, complete reports, checker output, native/browser
artifacts, both production pairs and diagnostic CPU profiles are retained in the
compact receipt. Larger artifacts, if any, retain exact local byte/hash references.
Raw ZIP archives remain ignored. This is verified transport progress; public
projective relinking and every unfinished original roadmap gate remain required.

[Compact evidence archive](retained-mask-maps-2026-10-31.json.gz):

- Compressed bytes: **1,531,023**.
- SHA-256: `6b4be1ec0251b5a07a8c25ce32e2f91ab6a523a1bf29119c65b1a6d8848cdeb3`.
- Retained artifacts: **453**; reconstructable changed files: **13**.
- Every artifact fits this receipt; no larger local-only reference is needed.
