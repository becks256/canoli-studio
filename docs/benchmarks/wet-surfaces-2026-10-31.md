# Native wet footprint surfaces — 2026-10-31

This F06/F14 increment reuses private brush-footprint drawing storage while
retaining complete native coverage, originals, all accepted input and shared
Undo. The full professional-editor roadmap and all-tool performance gates
remain required. The reference release is `68a6c0f`.

## Behavior and resource ownership

Default native wet sessions reuse one idle 260×260 canvas on the original
256-pixel raster cell with its two-pixel gutter. Reset the touched transform and
compositing state and clear the complete surface before drawing again. Keep the
original shape/gradient, grid, antialiasing, texture sampling and coverage bytes.
No viewport clipping, source downsampling, sample omission or approximate preview
is introduced. Custom coverage callbacks retain their path.

A pending texture operation owns its borrowed surface until finally. Concurrent
borrows use separate surfaces. Disposal closes idle storage immediately, rejects
late output and releases borrowed storage when the operation retires; it cannot
reset a surface under a held texture read. Independently returned coverage arrays
and completed native snapshots remain readable after session cleanup.

## Native verification

- All **90 complete fresh/reused coverage comparisons** pass across soft/hard
  brushes, pencil, reflected/nonuniform/sheared bases, negative cell boundaries
  and distant origins. Every case has nonzero coverage. The reference draws
  **306 fresh native cells**; the reused path creates **one surface** for those
  same cells. Only that idle surface remains live, and disposal releases it.
  A retained coverage array stays exact after reuse and disposal.
- Eight actual-WASM textured pressure/tilt/symmetry/selection sessions match every
  changed pixel from the fresh path across 8/128 tile sizes, zero/one-MiB caches
  and reflected transforms. Output hashes agree across partitions; original
  texture bytes remain exact.
- Two concurrent held texture operations keep separate borrowed surfaces intact
  after disposal, reject both late results and release every surface afterward.
- Native session finish, abort, injected processor failure and explicit disposal
  each allocate one footprint, release it and retain an earlier snapshot exactly.
  Finish and processor failure release automatically before explicit disposal.
- The affected **119-case browser matrix** passes in one run. Four final coverage
  cases also pass, adding one session-lifecycle case: **120 distinct affected
  native browser cases** in total. This includes real 50 MP source preservation,
  masks, storage/quota/cache failures, source lifetime, cancellation, ordered
  selection authority and shared renderer admission. No accepted run retries,
  skips or flakes.

The first two new fixture failures omitted required constructor points, before
coverage ran; the initial typecheck also caught incomplete texture options.
Corrected typed fixtures keep the exact output, lifetime and resource assertions.
Raw failed/fixed reports remain in the evidence. The allocation count proves this
private surface policy, not bounded total browser/process memory or device
acceptance. Fresh native Canvas coverage is a regression reference; existing
independent numerical WASM references remain in the complete suite.

## First ordinary-production pair

Both ordinary production builds run the same six workflows without developer
globals or CPU profiling, with twelve actual pointer events per target. Time from
event timestamp to new matching foreground-canvas pixels on animation frames;
readback is included and complete frame hashing happens after each timing.
Endpoints are more than three brush diameters apart and have pre-event witnesses.

| Target | Median before → after | P95 before → after |
| --- | ---: | ---: |
| Affine raster | 84.4 → 70.4 ms | 123.0 → 90.2 ms |
| Affine mask | 94.6 → 70.7 ms | 131.2 → 90.2 ms |
| Affine filter mask | 139.2 → 72.3 ms | 249.9 → 104.3 ms |
| Projected raster | 157.3 → 94.3 ms | 250.4 → 114.8 ms |
| Projected mask | 158.8 → 119.0 ms | 200.2 → 147.3 ms |
| Projected filter mask | 166.1 → 119.2 ms | 279.5 → 200.4 ms |

All **72 complete foreground hashes and six final PNGs** match the reference.
Every operation retains twelve accepted samples, original source bytes, one Undo
restoring the entire prior document and exact Redo document/PNG. No long task
was observed in these small gestures. Twelve samples make p95 the maximum;
these measurements do not establish sustained, physical, GPU/device or
editor-wide performance. Every fixture still exceeds **33 ms live-input p95**.
Full F06/F14 and all other unfinished roadmap gates remain open.

## Reproduction and complete acceptance

Run `npm run build`, the complete `npm test`, the affected native Playwright
files including `wet-coverage.e2e.ts`, and ordinary-production feedback with
`npx playwright test --config playwright.wet-feedback.config.ts`. The evidence
retains the exact temporary configurations, commands, source reconstruction and
release identities used on Node 26.13.0 / Chromium 153.0.8010.12 / Linux WSL.

The final full build passes; all **3,181 unit/API/native tests across 309 files**
pass in one run. All **145 release files** match the earlier production-tested
candidate except the updated generated scripting guide. No runtime byte changes
after production/native acceptance. The second pair reverses order: candidate
first, baseline second. Both six-case runs pass without retries/skips/flakes,
and all 72 foreground hashes and six final PNGs remain exact. Both complete
pairs retain all raw observations; two pairs and twelve samples per target still
limit general performance claims. Keep compact findings/receipts in Git; new raw
ZIPs stay local.

| Counterbalanced target | Median before → after | P95 before → after |
| --- | ---: | ---: |
| Affine layer | 73.3 → 60.8 ms | 86.3 → 78.7 ms |
| Affine mask | 72.9 → 60.5 ms | 93.5 → 77.8 ms |
| Affine filter-mask | 86.0 → 72.0 ms | 102.6 → 105.4 ms |
| Projected layer | 101.5 → 86.9 ms | 132.3 → 130.8 ms |
| Projected mask | 121.2 → 103.5 ms | 147.2 → 142.1 ms |
| Projected filter-mask | 119.8 → 120.3 ms | 197.9 → 202.0 ms |

The counterbalanced pair improves five of six medians. Projected filter-mask
median is essentially unchanged (119.8→120.3 ms); affine filter-mask p95 rises
102.6→105.4 ms and projected filter-mask p95 rises 197.9→202.0 ms. The first pair
improves all six medians/p95s, but absolute timings vary between pairs. This is
verified allocation/correctness progress with measured, mixed latency evidence,
not universal latency or 60 fps acceptance. All six targets still exceed 33 ms.

[Compact evidence archive](wet-surfaces-2026-10-31.json.gz):

- Compressed bytes: **1,190,101**.
- SHA-256: `741688d46bf8cb87be200cf737fe42d2048b99d0111bf2590415bedcaebecea1`.
- Retained artifacts: **273**; reconstructable changed files: **7**.
