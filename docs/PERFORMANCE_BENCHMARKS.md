# Performance benchmark harness

Run `npm run benchmark` after installing Playwright Chromium, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a compatible Chromium executable. The command builds optimized production assets with `VITE_BENCHMARK=1` to expose the diagnostic host bridge only for this build, then starts a dedicated preview server on port 4173. Do not deploy the benchmark build; run `npm run build` again for normal production assets.

The versioned corpus manifest is `tests/fixtures/performance/corpus.json`. It currently contains a generated 50 MP raster and a 2048×2048 composition with six groups and 36 text layers. Source images are synthetic colored geometric patterns; these fixtures are not representative photographic assets or an image-quality evaluation corpus.

Each case takes three fresh-page samples. Measurements separate source import, a tone-edit command, rendering the edited viewport without cache reuse, and full-resolution PNG export. Fixture generation and hashing are outside timed intervals. Reports retain source SHA-256 and byte counts, output dimensions/byte counts, every sample, medians, browser version/user agent, host CPU/OS/architecture/memory, and available JS-heap diagnostics. Output dimensions are checked. Pixel-correctness gates remain in the separate editor/rendering regression suites.

JSON reports are written to each Playwright test output directory and attached as `performance-report`. There are no hardware-independent latency thresholds. JS heap values exclude decoded image, GPU, WASM and total process memory. Fresh pages do not flush browser or operating-system caches. Use matching hardware/browser/corpus/build configurations for comparisons, and retain individual samples rather than quoting only a median. This is an initial harness; representative real-world image/parser corpora and deeper resource profiling remain required by T01/F14.

Initial recorded run (2026-09-30): [50 MP report](benchmarks/2026-09-30-raster-50mp.json), [complex-layer report](benchmarks/2026-09-30-complex-layers.json). On that recorded host, median import/edit-command/edited-viewport/export timings were 228.3/4.2/65.6/3144.1 ms for the 50 MP fixture and 32.4/10.2/293.1/1064.2 ms for the complex composition. These observations are machine-specific baselines, not product-wide guarantees.

## Healing pipeline — 2026-10-01

Run a production host benchmark with `VITE_BENCHMARK=1 npm run build`, then `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome npx playwright test --config playwright.retouch-benchmark.config.ts`. Reports include hardware/browser details, all timing samples, worker round-trip phases, and correctness checks before accepting results. The host interval includes fresh worker startup, brush coverage, native sampling, donor search, solve, PNG encoding/decoding and undoable commit. Verification render and undo are outside timing. Phase durations may overlap and must not be summed.

| Brush diameter | Baseline median | Packed-support median |
| -------------- | --------------- | --------------------- |
| 16 px          | 51.6 ms         | 49.8 ms               |
| 32 px          | 70.8 ms         | 62.6 ms               |
| 64 px          | 150.4 ms        | 111.3 ms              |
| 128 px         | 1095.7 ms       | 317.0 ms              |

Artifacts: [baseline](benchmarks/healing-pipeline-baseline-chromium-2026-10-01.json), [packed support](benchmarks/healing-pipeline-packed-chromium-2026-10-01.json). This is a flat synthetic context with one red blemish, not representative photo-quality evidence. The 16 px result is too close to 50 ms to imply a reliable device-independent pass, and larger cases fail. The complete under-256px gate remains open; 256px and textured/adversarial cases have not been measured by this pipeline benchmark.

### Exact zero-score pruning and textured reference coverage

The next search optimization packs boundary validity together with support when alpha is uniform, then skips RGB scoring for valid candidates that cannot beat a zero-score winner on distance. Donor/score/count parity remains exact against the scalar reference. The unchanged flat fixture measured medians 44.9/55.0/91.4/255.9 ms at 16/32/64/128px; see [pruned report](benchmarks/healing-pipeline-pruned-chromium-2026-10-01.json).

The expanded benchmark now includes periodic 8px texture and checks every output pixel against its clean reference, with exact alpha and RGB tolerance 1/255. [Expanded report](benchmarks/healing-pipeline-textured-chromium-2026-10-01.json): flat medians 43.8/54.3/88.8/253.4 ms; periodic texture 39.6/55.0/84.0/253.8 ms. Both retain a central 3x3 blemish and the same brush/search geometry. The under-256px <=50ms gate still fails; synthetic periodic texture does not replace real-photo/adversarial corpus evaluation.

### WASM packed-validity backend

[WASM pipeline report](benchmarks/healing-pipeline-wasm-chromium-2026-10-01.json) retains the same flat and periodic fixtures and full-image output checks. Median host times at 16/32/64/128px: flat **40.0/48.7/68.9/162.5 ms**; periodic **37.5/45.3/66.0/169.6 ms**. This follows the previous 253–254 ms results at 128px. These runs include fresh numerical-worker startup and image encode/decode. Small cases on this machine fall below 50 ms, but larger cases and the unmeasured remainder of the under-256px range prevent declaring the performance gate complete.

### Captured sampling reuse

[Sampling reuse report](benchmarks/healing-pipeline-sample-reuse-chromium-2026-10-01.json): median host times at 16/32/64/128px are flat 42.7/45.2/63.7/160.3 ms and periodic 37.9/47.0/64.1/168.3 ms. Interior repairs now use one native sampling pass rather than three. The small timing differences from the preceding WASM report are within the range where run-to-run variation matters; no large end-to-end speedup is claimed. Full-image correctness checks pass. Larger cases still fail the 50ms gate.

## Filter-mask updates — 2026-10-01

Reproduce with `VITE_BENCHMARK=1 npm run build`, then `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome npx playwright test --config playwright.filter-benchmark.config.ts`. The production harness measures three cached/uncached pairs per case and records actual spatial-filter worker request counts, source hashes/dimensions, browser/host identity and all samples. Cached and uncached outputs must match byte-for-byte before a report is accepted.

[Recorded report](benchmarks/filter-mask-native-cache-chromium-2026-10-01.json):

| Source / viewport                 | Filter stack           | Cached median | Uncached median | Cached / uncached filter calls per update |
| --------------------------------- | ---------------------- | ------------- | --------------- | ----------------------------------------- |
| 512×512 / 512×512                 | Blur + unsharp         | 19.3 ms       | 100.0 ms        | 0 / 8                                     |
| 2048×2048 / 1024×1024 fitted      | Two blur/unsharp pairs | 2944.3 ms     | 2919.4 ms       | 64 / 64                                   |
| 10000×5000 / native 1024×768 crop | Two blur/unsharp pairs | 63.5 ms       | 705.2 ms        | 0 / 48                                    |

The fitted 2048 case exceeds the 32 MiB native-pair cache working set. Sequential LRU traversal evicts tiles before the next update reaches them, eliminating reuse despite correctness. This case is unsuitable for responsive painting and requires a cache admission/retention or sampling redesign; merely having a cache does not meet the interaction goal. The 50 MP case retains original source dimensions but only measures a native crop, not fit-to-window or full-resolution export. These renderer intervals exclude pointer dispatch, React, presentation and pixel-verification readback. Synthetic stripes, three ordered samples and a shared headless host do not establish device-independent performance. All three cases had zero pixel difference.

### Filtered-pixel priority under memory pressure

[Filtered-priority report](benchmarks/filter-mask-filtered-priority-chromium-2026-10-01.json) reruns the same production fixtures with the same 32 MiB cache budget. The cache now discards original copies before evicting filtered results; masked renders reconstruct missing originals through the source renderer. All three cases performed **zero spatial-filter calls** on every warmed mask update and retained exact pixel parity.

| Case              | Previous cached median | Filtered-priority cached median | Current uncached median |
| ----------------- | ---------------------- | ------------------------------- | ----------------------- |
| 512 square        | 19.3 ms                | 19.6 ms                         | 97.7 ms                 |
| 2048 fitted       | 2944.3 ms              | 301.0 ms                        | 2871.2 ms               |
| 50 MP native crop | 63.5 ms                | 71.1 ms                         | 688.9 ms                |

The fitted case improves about 9.8×, eliminating the measured all-miss traversal. It remains too slow for fluid brush interaction; source reconstruction, mask rasterization, mixing and composition still contribute to the full render interval. The small-case/crop variations are not claimed as improvements. Working sets larger than retained filtered pixels can still exceed the budget. No hardware-independent latency gate is declared complete.

### Uniform filter-mask tiles

[Verified uniform-tile report](benchmarks/filter-mask-uniform-verified-chromium-2026-10-01.json) repeats the same production fixtures. Paint-mask tiles proven fully revealed skip coverage rasterization and mixing; fully hidden tiles also skip filtering. Transformed stroke bounds and the complete feather halo must not intersect the padded tile before the shortcut is used. Fractional or uncertain coverage follows the full path.

| Case              | Filtered-priority cached median | Uniform-tile cached median | Uncached median |
| ----------------- | ------------------------------- | -------------------------- | --------------- |
| 512 square        | 19.6 ms                         | 12.6 ms                    | 93.6 ms         |
| 2048 fitted       | 301.0 ms                        | 86.8 ms                    | 2684.2 ms       |
| 50 MP native crop | 71.1 ms                         | 25.8 ms                    | 699.9 ms        |

All warmed updates issued zero spatial-filter requests and matched uncached pixels exactly. A separate browser regression compares the shortcut directly with full mask rasterization, including transparency, inversion, fractional density, transformed strokes and feather entering the tile. This independent reference matters because both benchmark paths use the shortcut. The fitted case still exceeds a 60 Hz frame interval; broader working sets, dense masks, real input-to-presentation timing and device coverage remain open. The preceding sampling and synthetic-corpus limitations still apply.

### Selective cache reads

[Selective-read report](benchmarks/filter-mask-selective-cache-chromium-2026-10-01.json) measures the same fixtures after avoiding unused original/filtered copies at uniform endpoints. Cached medians are 13.4 ms (512 square), 77.9 ms (2048 fitted), and 23.1 ms (50 MP crop); uncached medians are 93.5/2698.6/658.8 ms. Exact pixel parity remains intact. The prior run measured 12.6/86.8/25.8 ms: these limited samples do not establish a stable device-independent improvement. The fitted case still fails the proposed interaction target. Browser checks additionally cover warmed hidden/revealed transitions with no repeated filters and exact full-render parity.

### Dense and feathered mask baseline

[Dense baseline report](benchmarks/filter-mask-dense-baseline-chromium-2026-10-01.json) adds two 2048×2048 sources fitted to 1024×1024. Each mask begins with sixteen horizontal 80px soft brush strokes spanning the source, spaced 128px apart; one case additionally uses 12px feathering. The same three incremental edits, paired cache bypass, exact pixel comparison and timing exclusions apply. The harness now records filtered-mix worker calls for every case and asserts dense cases exercise mixing.

| 2048 fitted mask    | Cached median | Uncached median | Warm spatial-filter / mix calls |
| ------------------- | ------------- | --------------- | ------------------------------- |
| Sparse strokes      | 91.8 ms       | 2745.9 ms       | 0 / 1                           |
| Dense, no feather   | 569.3 ms      | 3165.3 ms       | 0 / 16                          |
| Dense, 12px feather | 866.7 ms      | 3519.3 ms       | 0 / 16                          |

Every output matches exactly. This broadens the known performance failure: uniform-tile shortcuts do not provide interactive dense-mask painting. Zero repeated spatial-filter calls rules out repeated filtering in the warm path; coverage replay, feathering, pixel transfer/mixing and composition still need profiling. Ordinary mask stroke-prefix retention already exists but is not currently supplied to filter-mask coverage; reuse must be tested against cache pressure, independent instances, transformed masks and cache bypass before adoption. No end-to-end latency gate is complete.

### Retained raw filter-mask coverage

[Coverage-retention report](benchmarks/filter-mask-retained-coverage-chromium-2026-10-01.json) uses the existing ordinary-mask prefix/active-stroke cache for filter masks without adding a memory budget. Dense unfeathered cached median changes from 569.3 to 374.8 ms; dense feathered changes from 866.7 to 932.8 ms. Sparse 2048 fitted measures 93.3 ms. All pixels remain exact; spatial filters still execute zero times per warm update. A browser regression observes actual prefix hits after appending a stroke and compares output against cache bypass.

This improves the measured unfeathered case but does not establish an across-the-board improvement. The feathered case is slower in this run and remains unresolved. Profiling needs to distinguish cache capacity/admission, repeated feather computation, transfer/mixing and composition before further changes; every case still inherits the report's synthetic-corpus and timing limitations.

### Consolidated feather regions

[Consolidated feather report](benchmarks/filter-mask-consolidated-feather-chromium-2026-10-01.json) processes small native coverage regions in one job when the full halo fits the unchanged four-million-pixel budget. Dense feathered median falls from 932.8 to 644.4 ms; dense unfeathered measures 383.3 ms and sparse fitted 88.0 ms. The full interaction target remains unmet. Production cached/bypass comparisons remain exact.

An independent 560px transformed-brush fixture uses one feather job rather than four, and compares against a 1025px-wide render forced through six 512px jobs. Maximum difference is one alpha level. Running the same fixture with the previous tiling also produced a one-level difference; the regression retains that measured tolerance rather than asserting false byte identity across Canvas rasterization layouts. Ordinary-mask retained preview/commit comparisons remain exact.

### Worker round-trip attribution

[Worker profile](benchmarks/filter-mask-worker-profile-chromium-2026-10-01.json) instruments actual worker requests by ID and measures from host postMessage to the matching response. These intervals include queueing, transfers, execution and response scheduling; they are not isolated kernel timings. The harness records all per-render stage samples alongside the existing counts and pixel checks.

| Warm case            | Total median | Filter round trip | Mix round trips | Feather round trips |
| -------------------- | ------------ | ----------------- | --------------- | ------------------- |
| 512 square           | 12.8 ms      | 0                 | 2.9 ms          | 0                   |
| 2048 sparse fitted   | 85.3 ms      | 0                 | 6.8 ms          | 0                   |
| 2048 dense           | 371.8 ms     | 0                 | 139.6 ms        | 0                   |
| 2048 dense + feather | 645.9 ms     | 0                 | 146.7 ms        | 208.1 ms            |
| 50 MP crop           | 25.3 ms      | 0                 | 2.2 ms          | 0                   |

Entries are independently computed medians, so subtracting columns is only approximate. Dense cases each issue sixteen mixes; the feathered case also issues sixteen feather jobs. All cached/reference pixels match exactly. The evidence supports investigating the mixed-pixel worker path and feather path while retaining separate attention to coverage drawing and composition. No stage alone explains the entire dense render interval, and the existing end-to-end/corpus/device limitations remain.

### Transfer private mixing snapshots

[Transfer profile](benchmarks/filter-mask-transfer-profile-chromium-2026-10-01.json) includes the already-private filtered and mask arrays in the worker transfer list instead of cloning them again. Dense unfeathered mixing round trips measure 84.0 ms versus 139.6 ms previously; dense feathered mixing measures 98.9 ms versus 146.7 ms. Total cached medians are 306.1 ms unfeathered and 610.8 ms feathered, versus 371.8/645.9 ms in the preceding profile. Sparse fitted measures 74.8 ms. All production pixel comparisons remain exact. These limited samples do not establish a device-independent speedup or meet the interaction target; feathering and non-worker work remain substantial.

### Identical-pixel mixing shortcut

[Invariant-mix profile](benchmarks/filter-mask-invariant-mix-chromium-2026-10-01.json) skips interpolation for identical visible original/filtered pixels and directly clears intermediate all-transparent mixtures. Dense mixing round trips measure 73.4/82.6 ms without/with feathering, versus 84.0/98.9 ms previously. Total dense medians are 296.5/563.7 ms; sparse fitted is 94.9 ms, slower than the preceding run. Exact cached/reference pixels remain unchanged. Stripe fixtures contain many unchanged pixels, so this does not establish equivalent improvement on photographs or overall device-independent latency. The interaction target remains unmet.

### Finished mask composites and local invalidation

[Pressure experiment](benchmarks/filter-mask-composite-pressure-chromium-2026-10-01.json) retained both raw mask prefixes and finished composites in the shared Canvas cache. Dense medians regressed to 544.2/862.8 ms; this policy was replaced. [Finished-composite priority](benchmarks/filter-mask-composite-priority-chromium-2026-10-01.json) omits intermediate prefix retention for filter masks and retains final native tiles within the same 64 MiB budget.

Cached medians are 49.8 ms sparse fitted, 78.9 ms dense unfeathered, 86.7 ms dense feathered and 15.8 ms for the 50 MP native crop. Dense prior medians were 296.5/563.7 ms. All pixels match cache bypass exactly. A browser regression verifies four cold tile mixes, one mix for a local stroke, two for a boundary-crossing stroke, and four after changing global feather settings, with exact reference pixels throughout. Cache capacity remains finite, and the fixture's local edits do not establish performance for strokes spanning the entire image or larger working sets. The end-to-end interaction gate remains open.

### Direct presentation of completed tiles

[Direct-cache report](benchmarks/filter-mask-direct-cache-chromium-2026-10-01.json) draws cache hits synchronously under the output clip/transform, avoiding a temporary native canvas copy. Cached medians are 10.3 ms (512 square), 35.5 ms (sparse fitted), 57.1 ms (dense), 75.4 ms (dense feathered), and 14.0 ms (50 MP crop). The preceding finished-composite report measured 49.8/78.9/86.7 ms for the three fitted cases. Exact cached/reference comparisons pass. These renderer intervals still exclude input/React/presentation, and the interaction gate remains unproven. Nineteen browser checks cover cache invalidation/history, affine placement, masks, clipping and nested filters.

### Full-frame mask changes

[Full-frame report](benchmarks/filter-mask-full-frame-chromium-2026-10-01.json) adds two dense 2048px fixtures where each new 48px soft stroke traverses four horizontal bands, spanning every native tile. The harness requires sixteen cached mix calls for each update, preventing accidental measurement of a localized edit. Existing source, reference pixels, worker timing and three paired samples remain unchanged.

Cached full-frame medians are **639.1 ms without feathering** and **893.9 ms with 12px feathering**; corresponding local dense edits in the same run measure 48.8/80.0 ms. All warm spatial-filter counts are zero, all full-frame mix counts are sixteen, and every cached pixel matches reference output exactly. Finished-tile reuse therefore helps local changes but does not solve full-frame mask work. Incremental coverage and/or worker-side reuse for changed tiles remain performance requirements, alongside real-photo, device and input-to-visible validation. These tests append completed strokes; active gesture/pointer scheduling remains outside the measurement.

### Reusable mask replay scratch surface

[Scratch-reuse report](benchmarks/filter-mask-scratch-reuse-chromium-2026-10-01.json) avoids allocating a separate coverage scratch canvas for each overlapping stroke. Full-frame cached medians measure 597.3/879.7 ms without/with feathering, versus 639.1/893.9 ms previously. Local dense edits measure 52.8/73.4 ms. The limited run shows only modest timing changes and does not resolve the interaction failure. All cached/reference pixels remain exact. A separate browser test compares clipped hide/reveal replay against fresh per-stroke surfaces and verifies changes outside the earlier clip, guarding against leaked pixels or composite state.
