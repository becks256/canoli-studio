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


## Normal-production text input and glyph-shadow work — 2026-10-16

Build with `npm run build` (without VITE_BENCHMARK), start `npm run preview`, then run:

```sh
CANOLI_TYPING_OUTPUT=/tmp/canoli-text-input-run node scripts/benchmark-text-input.mjs
```

The harness uses isolated Scripts to create eighteen 800×600 fixtures: short text, 100/600 repeated lines, 600 unique lines, a 9,900-character line, 64 plain/overlay/shadow layers, larger blurred type, a long shadowed line, and four paragraph cases (240/9,900 characters at width 320, a selected paragraph among 64 layers, and a nearly full-width 9,900-character paragraph), plus the same four paragraph cases with native inter-word justification. It edits the first visible line from its beginning, waits for each of twenty real keys to reach a matching native glyph draw copied into the connected viewport canvas, and requires exact final text, twenty matched presentations, changed pixels and no page errors. Point text matches the complete first hard line; paragraphs match the complete growing first token at a visual-line start, rejecting retained old frames. The displayed backend must be Standard rendering. After observer/hooks stop, twenty shared document undos must restore exact original text and viewport pixels. Successful cases restore prototype hooks and observers before closing each context; every context closes in finally, including failed cases. Source seeding, font readiness and before/after pixel serialization are outside timing. Each case gets a new context; this does not flush OS/browser caches or measure sustained fast-typing throughput.

`CANOLI_TYPING_CASES=shadow-64,shadow-64-large,shadow-64-long` selects named fixtures. `CANOLI_TYPING_URL` selects a frozen release preview for paired runs. `CANOLI_TYPING_PROFILE=1` records CDP CPU profiles; those runs add overhead and are diagnostic, not latency baselines. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects installed Chromium. Use a fresh output directory: JSON creation rejects overwrites. Raw samples, nearest-rank p95 (sample 19 of 20), maximum, every observed long task, captured first/last timestamps, overlapping tasks, backend, loaded entry script URLs, browser/CPU/OS and explicit limits are saved. Task intervals are tested for overlap so a task starting just before input capture is retained. Each run first requires a real 75 ms native long-task positive control in a separate disposable page, outside measured fixtures. Preserve separate source/release hashes when making before/after comparisons.

This is an input-event-to-matching-glyph canvas-copy proxy. Browser composition and physical display can follow the observed call. There is no hardware-independent pass threshold, peak memory claim, complete F14 acceptance, or comparison against differently shaped development fixtures. The companion correctness tests compare cold/warm bounded shadows to cache-disabled native rendering, including transformed text, regions, masks, font changes, missing metrics and undo.

Final three-pair observations are sealed in [text-shadow-performance-2026-10-16.json](benchmarks/text-shadow-performance-2026-10-16.json). Median per-run p95 for ordinary 64-layer shadows falls from 32.8 to 19.2 ms; larger type/blur from 35.1 to 22.0 ms; and the long shadowed line from 33.6 to 22.7 ms. This is a 32.4–41.5% reduction in these local fixtures. Corrected candidate p95 spans 15.4–22.8 ms, with a 26.0 ms maximum individual sample and no observed fixture long tasks. All six deliberate native task controls pass. Initial runs used a start-only task filter; those reports remain separate historical observations and are not pooled into the final comparison. Native pixel tests remain exact across bounded/full-region paths. All-tool, sustained-use, memory and physical-device acceptance remains open.


## Normal-production vector and Pen input — 2026-10-16

Build a normal release with `npm run build`, start `npm run preview`, generate a shared native corpus once, then run:

```sh
node --import tsx scripts/create-vector-fixtures.ts /tmp/canoli-vector-corpus
CANOLI_VECTOR_FIXTURES=/tmp/canoli-vector-corpus CANOLI_VECTOR_OUTPUT=/tmp/canoli-vector-run node --import tsx scripts/benchmark-vector-input.mjs
```

Five constructor-built 800×600 projects contain 20/200/1,000 ordinary paths, 200 paths with 64 total layers, and 200 curved paths with 100 anchors each. The dense curves are synthetic small shapes, not representative illustration quality. Native project Open deliberately avoids the separate automation command-payload complexity limit; that existing trust boundary remains enforced. Original file hashes and byte counts are recorded, and all comparison builds must reuse the same generated files. Generating into an occupied corpus/report path rejects overwrites. Projects contain no raster assets.

The default Pen run sends twenty real ArrowRight keys. A distinctive vector point is followed through Canvas/image-bitmap copies into the connected viewport. Each accepted Pen frame must also place the actual displayed first-anchor center at the expected document position. The harness installs hooks before import so the initial cached frame remains observable during later revisits; hooks restore and contexts close. Read-only isolated Scripts verifies final x/path count, then every input is undone and original canvas pixels must return exactly. Neither developer globals nor direct document DTO mutation is used. The actually displayed backend must be Standard rendering; hardware WebGPU needs separate instrumentation, without silently disabling acceleration.

`CANOLI_VECTOR_CASES=paths-1000,curves-200` selects fixtures; `CANOLI_VECTOR_TOOL=move` records the Move control workload. `CANOLI_VECTOR_ROUNDS=3` sends 20 right, 20 left and 20 right keys, revisiting retained positions within the 60-entry history boundary. Reports retain each frame's native point, displayed SVG center, expected coordinates, first/last timestamps, every observed task and overlapping long tasks, individual/block p95, maximum, source hashes, backend, browser/CPU and entry URLs. A separate native 75 ms positive control must prove observation of a task beginning before capture. `CANOLI_VECTOR_PROFILE=1` records diagnostic CDP profiles with extra overhead; these are not latency baselines. `CANOLI_VECTOR_URL` selects a separate frozen release preview.

Import, font/control setup and pixel serialization/undo are outside the input interval. Setup time is recorded as a combined automation-assisted import/selection/fit/tool-entry observation, not a standalone import or Pen-entry benchmark. Per-key presentation means matching canvas copy and displayed anchor layout; later native paint/composition/display may follow, so overlapping long tasks are reported independently. Three short repeated rounds do not establish continuous typing, hour-long stability, heap bounds, reference-desktop/hardware input-to-photon or complete F14/all-tool acceptance.


Final precision-corrected three-pair observations are sealed in [pen-translation-performance-2026-10-16.json](benchmarks/pen-translation-performance-2026-10-16.json). Median per-run p95 changes from **113.0 to 28.4 ms** for 1,000 paths and **537.4 to 37.1 ms** for 20,000 curved anchors. The smaller 20/200-path and 200-path/64-layer fixtures observe baseline/candidate medians of 16.5/17.5, 32.2/18.8 and 43.9/25.0 ms. All builds reuse exact native fixture bytes and all frames verify both copied geometry and displayed anchors. The 1,000-path candidate records no routine long tasks in the paired runs or the additional 60-move repeat (26.2 ms overall p95). The dense curved case remains variable: paired p95 spans 32.7–99.3 ms; the 60-move repeat records 90.4 ms overall p95 and 26 native long tasks. It therefore does not meet the <=33 ms/<50 ms gate. All eight independent native task controls pass. No physical-display, continuous-use, heap or complete F14 acceptance is claimed.

## Normal-production Pen anchor dragging — 2026-10-16

Generate native projects once and reuse their exact bytes across comparison builds:

```sh
node --import tsx scripts/create-pen-drag-fixtures.ts /tmp/canoli-pen-drag-corpus
CANOLI_PEN_DRAG_FIXTURES=/tmp/canoli-pen-drag-corpus CANOLI_PEN_DRAG_OUTPUT=/tmp/canoli-pen-drag-run node --import tsx scripts/benchmark-pen-drag.mjs
```

The three 800×600 constructor-built fixtures contain 20/2,000 four-anchor paths and one 8,000-anchor path. The long path is a synthetic self-intersecting grid with collapsed handles, not representative illustration quality. All anchors lie inside the document. The harness imports real projects through Open, selects Pen and sends twenty paced pointer moves during one drag. The timestamp is captured at the beginning of the pointer capture handler, before viewport bounds/layout reads. Native beginPath/moveTo/fill hooks follow the actual first path point through Canvas/image-bitmap copies into the connected viewport, while every accepted frame also requires the displayed anchor center at the expected pointer position. It validates final point coordinates and path count through read-only isolated Scripts, requires changed pixels, and undoes the whole drag once to restore exact initial pixels. No developer globals or direct DTO mutations are used.

`CANOLI_PEN_DRAG_CASES=drag-8000-anchors` selects fixtures; `CANOLI_PEN_DRAG_URL` selects a frozen normal release. The harness requires the displayed Standard rendering backend. `CANOLI_PEN_DRAG_PROFILE=1` adds CDP CPU profiles and diagnostic overhead; do not use profiled samples as speedup baselines. Reports retain every frame/expected/native/SVG position, all native task intervals with overlap filtering, first/last timestamps, fixture/build/browser/CPU identity, p95 and maximum. Each run separately verifies a genuine 75 ms task that starts before the capture interval. Fresh corpus/report paths reject overwrites. Hooks restore on success; contexts and the browser close in finally. Import, handle setup, pointer-down, snapshots, release/commit, read-only verification and undo are outside the timed movement interval. This is a canvas-copy/anchor-layout proxy: later native paint, composition and physical display can follow. Paced input does not establish continuous throughput, heap bounds or complete F14/device acceptance.


Final local-slice/capture-corrected observations are sealed in [pen-control-blocks-2026-10-16.json](benchmarks/pen-control-blocks-2026-10-16.json). Three alternating unprofiled pairs retain all 360 movement samples, exact shared fixture hashes, matched native geometry/SVG centers, one-step pixel undo and six raw native observer controls. Median per-run p95 changes from **25.9 to 22.5 ms** for one 8,000-anchor path, **28.7 to 27.3 ms** for 2,000 four-anchor paths, and **10.9 to 10.3 ms** for 20 paths. Dense candidate p95 spans 19.6–23.7 ms with one long task per run, versus 25.3–28.3 ms and 3/2/6 baseline tasks. The many-path candidate spans 26.2–32.5 ms and retains 6/12/3 long tasks; its second trial regresses. These modest local changes do not establish general Pen or <=33 ms/<50 ms F14 acceptance. Earlier full-path-prop/timestamp-after-bounds measurements and profiled pilots remain separately labeled, never pooled into final results. Blocks now retain at most 64 point references each, without a peak-memory claim. Correctness covers all markers, original overlapping paint order, length transitions, actual artwork/mask anchor and handle edits, preview/cancel and exact undo; all-tool, sustained, heap and physical-device gates remain open.


### Native paragraph input observations

Three ordinary-production runs of the fourteen-fixture harness include the following paragraph cases. Each case verifies twenty newly shaped presentations, exact final text and exact twenty-entry document undo. Timing excludes setup, snapshots and undo; all three overlapping native-task controls pass.

| Paragraph fixture | Per-run p95 (ms) | Median p95 (ms) | Maximum sample (ms) |
| --- | --- | --- | --- |
| paragraph-240 | 16.8 / 16.3 / 16.7 | 16.7 | 17.1 |
| paragraph-9900 | 17.3 / 17.1 / 17.0 | 17.1 | 21.9 |
| paragraph-64 | 21.5 / 18.0 / 18.3 | 18.3 | 24.4 |
| paragraph-wide | 15.7 / 17.2 / 16.2 | 16.2 | 21.1 |

Across all fourteen fixtures, the largest observed p95 is 25.5 ms; 0 overlapping native long tasks were observed. Three paced runs are local canvas-copy proxies and do not establish sustained/all-tool/heap/physical-device acceptance. Constructor measurement diagnostics are separate from input latency. Raw samples, complete point/shadow regressions, build identity and limitations are sealed in [text-paragraph-2026-10-16.json](benchmarks/text-paragraph-2026-10-16.json).

### Native inter-word justification input observations

Three unprofiled ordinary-production runs cover eighteen point/paragraph/justified fixtures. Justified cases verify actual UI mode, expanded native word-spacing observations, twenty newly shaped presentations and exact text/pixel undo. Native task controls prove overlap observation before every run.

| Justified fixture | Per-run p95 (ms) | Median p95 (ms) | Maximum sample (ms) |
| --- | --- | --- | --- |
| justify-240 | 17.2 / 15.7 / 15.3 | 15.7 | 23.1 |
| justify-9900 | 18.4 / 17.5 / 18.4 | 18.4 | 18.7 |
| justify-64 | 19.0 / 20.8 / 21.9 | 20.8 | 23.9 |
| justify-wide | 18.9 / 20.4 / 18.7 | 18.9 | 21.1 |

Across all eighteen fixtures, the largest p95 is 29.7 ms; 0 overlapping native long tasks were observed. Native spacing precision can accumulate along very wide lines; the authored frame remains exact. This is a local canvas-copy proxy, without sustained/all-tool/heap/physical-display acceptance or a before/after speedup claim. Raw data, point/shadow regressions, native precision/failure history and frozen build identity are sealed in [text-justify-2026-10-16.json](benchmarks/text-justify-2026-10-16.json).


## Native TIFF output scheduling — 2026-10-17

Normal production HeadlessChrome 153 on this Linux environment exported a 4096 × 4096 paint/text composition to actual TIFF Blob downloads in 927.6, 873.6 and 869.1 ms. Real click and download-dispatch boundaries bracket native PerformanceObserver entries and animation frames; each trial observed its separate deliberate 75 ms positive control. No overlapping native long tasks were observed; frames advanced 15/16/16 times. Maximum gaps of 89.5/95.0/79.9 ms remain above a general 33 ms interaction goal. Animation callbacks are scheduling evidence, not physical display measurements or a desktop/device acceptance result.

A separate native 50 MP source/save/reopen and full PNG/classic/BigTIFF check retained exact source bytes and every decoded RGBA pixel through independent Pillow/libtiff comparison. Three outputs used 1,185 released at-most-2048×64 native tile surfaces and took about 6.54 seconds before independent decoding. Source bitmaps, compressed output and tile tables/directory remain resident or output-dependent; working-allocation bounds do not establish whole-process peak memory. TIFF storage respects PNG's canonical native sampling grid even for very wide, shorter-strip documents. Cancellation/progress and font/asset lifetime checks are tested, but individual native calls are non-preemptible. See [delivery evidence](benchmarks/tiff-export-2026-10-17.json) and the roadmap work log. F14 and the full professional-editor objective remain incomplete.
