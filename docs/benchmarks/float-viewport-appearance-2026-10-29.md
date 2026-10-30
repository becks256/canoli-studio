# Native float appearance reuse — 2026-10-29

Baseline: `8f4c26c4be2302a7bc90b3199f762c955b28e589`. This is a bounded F14
viewport increment. The complete professional-editor/AI/provider/workflow/
installed ChatGPT/live identity/commercial roadmap remains active.

Production-mode stage profiling placed median viewport preparation near 62 ms,
scene evaluation near 50 ms, and database opening near 0.5 ms. Reusing a database
connection alone would not address the main drag cost. The implementation instead
retains one complete native float appearance, including finite shadow support
outside the artboard, for an eligible small raster in an aligned 100% view.

The cache has one plane of at most 262,144 RGBA pixels (4 MiB), at most 2,048
pixels per axis. Keys include effective appearance/source interpretation and weak
immutable-original identity, excluding unrelated authored metadata. Exact integer
sampling arithmetic, identity geometry, Normal blend, unmodified source dimensions,
no active tone/erasures/overlay/Blend If, and no effective mask or a linked hard
rectangular mask are required. Unsupported cases use the existing renderer.
Every render still captures/prepares and checks current sources, lifetime and
cancellation, and performs actual native display/proof conversion. Hits reuse
verified native samples without rereading derived source tiles. No quantized
appearance, source lease, history state or viewport canvas is retained. Explicit
`cache:false`, native reads and file delivery bypass the appearance cache.
[Contract and limits](../FLOAT_DOCUMENTS.md#float-viewport-work-and-display-ownership-f14).

## Production input measurements

Three sequential baseline/candidate pairs, each in a fresh normal-production
browser context, use the unchanged 12 real-pointer-input scenario. Each input is
measured through the first independently matching canvas-alpha frame and the
following animation-frame opportunity. Native 256-square TIFF, linked hard mask,
zero Fill, fractional-offset Gaussian shadow, snapping disabled, one Undo/Redo,
retained original bytes, and absence of developer globals are verified. Timing
runs begin only after the heavy native and production verification suites finish.

| Pair | Baseline p95 | Candidate p95 | Drag long tasks, baseline / candidate |
| --- | ---: | ---: | ---: |
| 1 | 85.9 ms | 38.2 ms | 0 / 0 |
| 2 | 100.4 ms | 37.0 ms | 0 / 0 |
| 3 | 85.5 ms | 36.0 ms | 0 / 0 |

Across 36 inputs per build, nearest-rank p95 is **85.9 → 37.0 ms**.
These are warm eligible-view observations on one local Linux/Chromium device,
not physical-display, continuous-60fps, cold-build, large-layer or all-tool
acceptance. The target remains 33 ms. Import remains about 120 seconds and
requires separate work. Each first cache build evaluates complete bounded support;
this cost is not included in the warm drag measurement. Transient evaluation,
source/alpha/other caches and process memory have separate costs. No global-memory
or device-wide F14 claim follows.

## Verification

- Full `npm run build` passes; a final full build after the key refinement passes
  again. All 2,959 unit/API tests across 289 files pass.
- All 49 native browser cases across 14 files pass with real WASM and no
  skips, retries, flakes or failures. The earlier three focused cases also pass.
- All 14 relevant normal-production float workflows pass. Six additional
  paired timing sessions pass the same independent pixel/original/history checks.
- All 5,006,020 saved native RGBA words across 110 outputs match the actual
  accepted baseline byte for byte. Reference engine source hashes are checked
  against `8f4c26c`; compressed float outputs are compared after decompression.
- The unchanged 50 MP source, persistence and full shadow workflow pass. Every
  PNG channel is checked independently; the complete 50 MP shadow PNG container
  also matches the accepted baseline exactly. Visible outside-mask witnesses
  prevent empty-output acceptance.
- Complete displayed RGBA parity against uncached rendering covers outside-
  artboard construction and entering edges, positive/negative integer moves,
  cropped viewports, proof changes, zero Fill and explicit clear. Changed opacity,
  shadows, masks, feather/linking, zoom, fractional view/layer placement, affine
  transforms, extreme coordinates, active tone and extra graph layers retain
  exact displayed output. Warm missing-source, invalid-proof, cancellation,
  disposal and recovery checks pass without stale output publication.

Normal production and native browser sessions retain immutable source identities
before/after; production sessions also retain complete served-distribution hashes.
The final build/timing driver verifies source stability throughout. The earlier
stage profiler used a diagnostic production-mode build with the existing benchmark
flag; it is excluded from normal-production acceptance.

The first focused attempt rejected only the cancellation-message assertion; all
pixel comparisons were exact. Initial test typing errors were corrected. A later
build could not start because of `ENOSPC`. The current regenerable distribution
was copied and completely hash verified in task RAM storage; 15 large duplicate
files were replaced by exact-content links, reclaiming 14,289,183 bytes while
preserving existing preview paths/content. No source, Git history, toolchain or
historical evidence was removed. Final builds and raw test artifacts use task RAM
storage; the ignored root distribution remains the preserved baseline. These
excluded attempts and receipts remain in the evidence record.

[Compact verification record](float-viewport-appearance-2026-10-29.json.gz):
212,479 bytes; SHA-256 `7b40f0ba70173b1830a5501c91ef0252d074d035eaedc265740ccdb32a782429`. It contains all terminal
outcomes, individual case statistics, source/distribution identities, per-input
measurements, independent reader receipts, native parity hashes and raw artifact
hashes. Full raw artifacts remain under
`/run/lock/canoli-float-appearance-2026-10-29`; RAM storage is temporary.

Reproduction requires the repository's pinned browser/native reader dependencies.
Run the full build and `npm test`, the native float matrix including
`tests/float-appearance.e2e.ts`, and the production tests selected by
`production float`. The production pointer case is
`production float shadow pointer updates match independent frames and retain one Undo`.
The complete source/release hashes and exact commands are in the compact record.

Other sizes/graphs/views/tools, first-render/import latency, sustained all-tool
input performance, process/global memory and device coverage remain required F14
work. Other native float/HDR/color/interchange and every unfinished original
roadmap gate remain active. No threshold, deadline, reference comparison or
original-resolution import allowance was relaxed.
