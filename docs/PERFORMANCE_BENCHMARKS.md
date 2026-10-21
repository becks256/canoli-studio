# Performance benchmark harness

## Native frequency tiling — exact band requests, measured full-frame reduction

Unit-native frequency-band planes with safe integer placement now use a 512-pixel tile cap when the worst-case padded footprint fits the existing 4 MP/8192-edge budget. They cover the outer composition tile plus overscan without a tiny extra request. Affine/fractional placement, unsafe halos, composition tiles and retouch canvas regions retain their prior grids. This changes no original resolution, persistent/public model, API, source bytes or undo semantics.

Fourteen frozen-renderer/candidate PNG pairs are exact across low/high/correction, zero radius, alpha, filter masks/inversion, affine/fractional placement, disabled filters and soft low/high/both retouch. New browser tests compare equivalent disabled-filter documents at 256/512 seams under native, affine, fractional and tone/mask appearances. A large-halo test captures matching actual canvas/input geometry before intentionally skipping its expensive kernel; full radius-280 output/performance is not claimed.

Three clean alternating unprofiled pairs on Linux, AMD Ryzen 9 3900X and Chromium 153.0.8010.12 export the same opaque 10,000×5,000 scene with sigma 2 and a full-frame low-band green retouch. Median export decreases **40,316.5 → 34,662.6 ms (14.0%)**. Every run drops Gaussian requests **6,241 → 3,160** and sampled Gaussian pixels **75,169,920 → 71,064,000**. Independent Pillow decoding hashes every RGBA byte in all six PNGs: they match each other and differ from the original. All document snapshots and source hashes remain unchanged. No build/tests ran during the pairs; external host activity remains uncontrolled.

Six injected 75 ms positive controls are observed; no overlapping native long task is reported during exports. Per-run animation callback p95 is about 19.3 ms for reference and 19.7–20.0 ms for candidate; maximum gaps range 40.6–63.1 ms and 45.3–48.0 ms respectively. These are headless scheduling proxies, not physical presentation, tool input-to-visible latency, sustained/hardware/tablet or general 60fps acceptance. Full-frame export still takes roughly 35 seconds; peak process/source bitmap memory remains unmeasured.

An excluded variant also enlarged native composition regions. It changed three/four soft-brush edge pixels in three retouch cases, at clipping boundaries: alpha is unchanged, straight RGB differs by up to four bytes and premultiplied RGB by up to two. It was not applied. This exposes a separate ordinary-brush crop-invariance investigation; fixed vector-mask grids already address an analogous coverage issue. No pixel tolerance was relaxed to accept the band-only change.

The main build, all **1,381 unit/API cases in 171 files**, **60 affected native cases**, and all **84 normal-production workflows** pass. The new source branch also passed all 24 isolated feature/interchange checks. Initial harness warm-up/type-annotation/path issues and the first Vite-optimization reload are retained separately from accepted results. [Sealed source, native PNGs, rejected comparison, raw timing/check reports and reconstruction](benchmarks/frequency-native-tiling-2026-10-19.json) preserve all 34 earlier artifacts. Full F05/F06/F14 and the complete original roadmap remain active.

## Schema-37 preview/shared-radius baseline — native workflow verification

Native previews retain one private full-resolution capture and compute an original-pixel crop plus genuine Gaussian support. Single-flight publication drops obsolete requests; compare/pan, independent frame lifetime, retryable commits and no-before-commit host edits are verified. Schema 37 groups derive one shared radius without changing protected child data. Scope capture survives isolated scripts, rasterization, conversion, document copies, actual SVG/PSD/PSB output, workspace contents links and portable radius-patch recipes. Native capture creation itself is not a new recipe action.

An exact structural identity can draw the captured source outside conservative retouch bounds. All altered states use full decomposition; native alpha/appearance and sampling-budget failures retain their semantics. A separate per-render 8 MiB scratch cache shares the actual rounded Gaussian and source pixels across frequency siblings, even for uncached export. Source resolution is unchanged. Recursive smart-tile and PNG task checkpoints preserve input/cancel opportunities after the reduced worker traffic.

The frozen schema-36 and current renderer were profiled separately on the same opaque 10,000×5,000 source, sigma 2, using offscreen documents and fresh renderers after editor readiness. These are single intrusive local CPU-profile observations, not an alternating unprofiled benchmark or a physical-device/frame-rate guarantee:

| Scene | Frozen baseline | Current | Current Gaussian requests / pixels |
| --- | ---: | ---: | ---: |
| Unchanged separation | 61,681.5 ms | 4,791.9 ms | 0 / 0 |
| 32×24 low-band retouch | Not separately profiled | 4,822.9 ms | 2 / 24,528 |
| Full-frame low-band retouch | 62,465.2 ms | 40,961.9 ms | 6,241 / 75,169,920 |

The matched full-frame baseline issues 18,723 Gaussian requests over 225,509,760 pixels. Current profiles report no long tasks, with no new injected positive control; this diagnostic is not general responsiveness acceptance. The initial identity implementation exposed 50–87 ms tasks and was corrected with cooperative yields. Baseline Vite denied font-file requests, but the measured raster-only scene contains no text and timing begins after readiness. No competing build/tests ran during profiles. Full-frame export still takes about 41 seconds in this instrumented scene.

A separate real 50 MP edited PNG is independently decoded with Pillow/NumPy: every pixel outside the 32×24 rectangle equals the original; changed pixels inside are nonzero. Its native reference crop, forced through full decomposition, matches exactly. Original/captured dimensions and source hashes survive project reopen; working canvases stay at most 639,920 pixels/2,048 pixels per side. Complete process peak memory, source-sized decoded bitmap cost, sustained/tablet/hardware/backend and editor-wide acceptance remain open.

Build, all **1,381 unit/API cases in 171 files**, **207 native browser cases**, and **84 normal-production workflows** pass. Default unit concurrency alongside browser work first hit six existing five-second timeouts; the complete four-worker run passes with unchanged assertions/timeouts. The first shared-control fixture omitted its asynchronous tab wait and is excluded. The accepted matrix has no skips, retries or flakes. All 33 prior evidence artifacts remain byte-identical. [Sealed source/results](benchmarks/frequency-workflow-2026-10-19.json) retain raw failures, final reports and profile scope. Full F05/F14 and the complete original roadmap remain active.

## Schema-36 frequency foundation baseline — historical export cost

The final native 50 MP fixture retains its 10,000×5,000 original and captured source dimensions/bytes, exact sampled native/full-PNG pixels, one-step undo and project reopen. The final run takes 2,283.2 ms for private capture/assembly and 61,056.5 ms for the complete native PNG export. Two earlier clean runs measure 2,275.1/60,831.7 ms and 2,335.8/61,380.2 ms. These are local observations, not a device guarantee or performance acceptance. Instrumented working canvases peak at 639,920 pixels with a 2,048-pixel longest side; decoded original/capture bitmaps remain source-sized and complete process peak memory is unmeasured. No arbitrary source-resolution or import-size cutoff was added.

A fresh 64×32 retouch fixture performs one Gaussian for the three sibling planes, zero additional Gaussian work on repeat, and zero after a real retouch-master edit. Its cached and fresh pixels are exact. The uncached reference performs three Gaussians; export profiling and per-render sharing are still to be investigated. This is an identified export cost, not evidence that all 61 seconds are Gaussian work. Actual software-WebGPU correctness tests cover the two new blend equations, partial alpha, masks, opacity, adjustments and separate erasing. They do not establish physical GPU/tablet performance, full F05/F14 or 60fps.

See [frequency evidence](benchmarks/frequency-separation-2026-10-19.json) for source/release correspondence and the retained failed oracle. The full original roadmap and editor-wide responsiveness objective remain active.

## Stable cursor adapters and two-column panel geometry — functional fixes; timing mixed

Normal-production release CPU profiles map repeated native viewport reads into CanvasCursor's synchronous refresh. App previously created fresh footprint/symmetry callbacks on every render. Stable adapters now invalidate only for real tool preferences, source/selection/gesture and viewport/panel geometry, read current tool data on use, and skip coordinate lookup when symmetry is Off. The original cursor scheduling remains unchanged. A native regression holds the document/settings constant across three real tool-error notifications: baseline makes six viewport reads and the candidate makes zero. With animation frames held, an actual size change still makes one immediate read and displays the correct radius; blur restores the native pointer and document/history stay unchanged. The unchanged baseline fails only the redundant-read assertion.

Panel fitting and keyboard limits also shared an obsolete 54 px rail assumption after the requested two-column layout. The real baseline browser exposes a 166 px canvas column at a 900 px window. Both limits now share 88 px rail + 12 px dividers + 200 px canvas reservation; real resize/save-failure/reload checks include 900 px and the supported 760 px minimum. A corrected pure geometry assertion reproduces the old 794 > 760 failure before the fix. Saved preference format and source-document geometry are unchanged.

The isolated final build, all **1,354 unit/API tests across 167 files**, **115 native browser cases across ten files**, and **82 normal-production workflows** pass once with no accepted skips/retries/flakes. Actual main build, all 1,354 unit/API cases across 167 files and all 115 native cases across ten files pass. All 51 other release resources exactly match the isolated release that passes all 82 production workflows; only updated architecture/design-system/requirements guides differ. The final update changes only the two nongenerated decision-log Markdown files and leaves every release byte unchanged.

Two separate three-pair alternating normal-production studies each retain 720 newly matched movements, 36 native task controls, 108 complete native PNGs and 108 independently decoded saved projects. Every stroke retains all 21 x/y points, only the intended operation and exact undo. Their layouts/endpoints differ and must not be pooled. The fixed 1440×1000 benchmark uses unchanged default panel widths; the shared panel-budget fix affects constrained layouts.

| Fixture | Pointer p95 median, baseline → candidate (ms) | Release to History median (ms) | Release to final canvas copy median (ms) |
| --- | ---: | ---: | ---: |
| mixer-layer | 78.6 → 82.4 | 29.4 → 29.3 | 37.0 → 36.7 |
| smudge-layer | 75.3 → 76.3 | 28.7 → 28.8 | 37.7 → 36.0 |
| mixer-mask | 95.0 → 96.5 | 28.9 → 28.8 | 41.0 → 42.8 |
| smudge-mask | 80.0 → 73.6 | 27.5 → 28.8 | 42.2 → 43.3 |
| mixer-filter-mask | 98.8 → 92.4 | 30.0 → 30.9 | 56.2 → 57.0 |
| smudge-filter-mask | 89.5 → 91.3 | 30.2 → 29.1 | 60.8 → 57.4 |

Pointer medians are mixed: two decrease 6.5–8.0%, while four increase 1.3–4.8%; release medians also vary by fixture. These data do not establish a general speedup or universal non-regression. All pointer medians remain above 33 ms. The concrete acceptance is redundant-work removal, preserved synchronous geometry and repaired canvas space, not a latency-target claim. Three observations/runs per fixture on one headless host, native-copy/DOM endpoints and uncontrolled external host activity do not establish sustained/high-rate/representative-photo/tablet/hardware-GPU/physical-display/process-memory or editor-wide 60fps acceptance.

The [complete source and measurement record](benchmarks/cursor-adapters-panel-layout-2026-10-18.json) retains the final and intermediate studies separately. The earlier frame-queued cursor candidate passes functional checks but has mixed input timing (including +8.1% Smudge/filter-mask median) and is not adopted. The chosen adapters preserve original scheduling instead. An intermediate two-file linked-test setup mistake was repaired from untouched verified main originals before final checks; all frozen sources/releases and 30 earlier immutable artifacts verify exactly. No failed baseline demonstration or diagnostic profile is pooled into accepted timing. Public schema34/project3/workspace2, OO commands/history, isolated permissions and independent REST sessions remain unchanged. Full F06/T16/F14 and every other unfinished original-roadmap requirement remain active.

## Direct wet-prefix delivery plus paired image preparation — rejected combined candidate

The isolated candidate delivers ready wet prefixes directly to the viewport, coalesces same-owner React snapshots, retains/deduplicates frame leases and prepares each native tile's pixel/coverage PNG and decoder pair concurrently. Both variants include the same requested two-column rail and distinct tool icons. The final isolated build, all **1,354 unit/API tests across 167 files**, **92 native browser cases across 13 files** and **82 production workflows** pass. The complete unit suite ran alone after the browser suites; its two earlier failed runs are retained and excluded (sandbox listener/spawn errors and timeouts, followed by two five-second timeouts under concurrent browser work). No assertion or timeout was relaxed.

Two separate three-pair, alternating, unprofiled production studies each preserve 720 newly matching pointer samples, 36 native task controls, 108 complete native PNGs and 108 independently decoded project containers. All 72 combined stroke records retain all 21 x/y points, only the intended native operation and exact undo. Source/release HTTP identity is checked around every run. Pointer and release studies use different layouts/endpoints and must remain separate.

| Fixture | Pointer p95, baseline → candidate (ms) | Release to History (ms) | Release to final canvas copy (ms) |
| --- | ---: | ---: | ---: |
| mixer-layer | 92.7 → 78.3 | 39.8 → 43.0 | 64.6 → 60.0 |
| smudge-layer | 94.4 → 82.1 | 35.2 → 41.6 | 42.7 → 60.2 |
| mixer-mask | 94.1 → 81.2 | 42.1 → 42.4 | 67.3 → 65.1 |
| smudge-mask | 93.8 → 83.1 | 34.9 → 43.9 | 51.2 → 60.8 |
| mixer-filter-mask | 129.7 → 97.0 | 35.1 → 47.4 | 70.4 → 104.6 |
| smudge-filter-mask | 118.9 → 103.4 | 34.9 → 39.4 | 70.3 → 80.3 |

All six median per-run pointer p95 values decrease 11.4–25.2%, but all remain above 33 ms. Release-to-History medians increase in all six fixtures, and final-canvas-copy medians increase in four. The combined candidate is **not applied**. Three releases per fixture/release, headless DOM/native-copy proxies and uncontrolled external host activity limit these observations; no sustained/high-rate/physical-display/tablet/hardware-GPU/process-memory or universal 60fps acceptance follows. A faster pointer proxy does not complete the broader responsiveness requirement.

The [sealed experiment](benchmarks/brush-wet-direct-prefix-experiment-2026-10-18.json) preserves both complete studies, test failures and final acceptance reports, reconstructs the six isolated runtime/native changes, and retains all 29 earlier immutable artifacts. A separate compact numerical-transfer pilot and intrusive development phase traces remain diagnostic only. No combined performance code is adopted; main changes in this continuation are documentation, while the already verified user-requested rail remains. The next experiment must separate direct prefix delivery from paired image preparation and verify both interaction phases. Full F06/T16/F14 and every other unfinished original-roadmap requirement remain active.

## Dependent-dab packet experiment — rejected; main engine unchanged

An isolated candidate groups at most 32 consecutive same-cell/same-copy dabs into one private worker packet using the existing spatial sampler and actual WASM kernels. The full native planes still travel across the worker boundary. The isolated build, all 1,358 unit/API cases across 167 files, 68 native browser cases across 11 files and 82 normal-production workflows pass. Those are isolated functional results, not main adoption or performance acceptance.

Three clean alternating unprofiled normal-production pairs preserve all 720 newly matching movements, 36 native task controls, 108 complete native PNGs and 108 independently decoded projects. Every stroke retains all 21 x/y coordinates, one intended native operation and exact model undo. PNGs match the previous sealed release.

| Fixture | Baseline median per-run p95 (ms) | Isolated packet candidate (ms) |
| --- | ---: | ---: |
| mixer-layer | 92.0 | 95.3 |
| smudge-layer | 89.4 | 98.3 |
| mixer-mask | 100.2 | 100.1 |
| smudge-mask | 86.4 | 94.3 |
| mixer-filter-mask | 108.1 | 126.7 |
| smudge-filter-mask | 121.8 | 107.1 |

Four measured medians increase by 3.6–17.2%; one decreases about 0.1% and one about 12.1%, with variable individual trials. No overlapping native long tasks were observed. This candidate is **not applied**: fewer worker round trips do not establish an end-to-end input improvement. No separate release study was run for the rejected candidate.

Separate intrusive diagnostics observe 286 wet-mix requests in each pre-packet twenty-movement fixture, versus 20 packet requests and 54 fallback wet-mix requests in the candidate. These round-trip intervals overlap other work and are not isolated kernel costs. CPU and native-phase profiles remain diagnostic and must not be pooled into clean timing results. The cause of the mixed end-to-end results is not established; compact support-region transfers and preparation/presentation scheduling remain investigations.

[sealed rejected experiment](benchmarks/brush-wet-dependent-dabs-experiment-2026-10-18.json) reconstructs all eight isolated engine/test inputs, retains complete raw reports/profiles/PNGs/projects, captures the HTML build entry explicitly and preserves all 28 earlier artifacts. Build-entry and test-typing failures remain excluded. These are small paced synthetic headless native-copy observations on one Ryzen9 3900X host, not sustained/high-rate input, representative photographs, physical display/GPU/tablet or whole-process peak-memory acceptance. Main runtime/public/schema/OO/script/plugin/REST boundaries remain unchanged. Full F06/T16/F14 and the complete original roadmap remain active.

## Prepared prefix reuse and shared cadence — release improvement; pointer target open

The isolated candidate passes build, all 1,354 unit/API cases across167 files,65 native browser cases across10 files and82normal-production workflows. Native checks include real50MP sources, exact mask/affine/WGSL pixels, captured epoch hints/reverted cells, independent snapshots/frames, version-invalidated resident/zero-cache workspaces, closed prepared bitmaps, failed replacement cleanup and a real render-hook cadence fixture. The actual main build, all 1,354 unit/API cases and all 65 native cases pass. All 51 non-documentation release resources, including app/worker/WASM, exactly match the isolated 82-workflow production release; only three generated documentation pages differ.

Two separate clean studies each use three alternating unprofiled normal-production pairs after correctness/setup jobs stop. Linux/x64 AMD Ryzen9 3900X,24 logical CPUs,HeadlessChrome153.0.8010.12. Both preserve720 newly matching pointer samples,36 native task controls,108 complete native PNGs and108independently decoded projects. Every36stroke audit proves one intended native operation, all 21x/y points and exact model/pixel undo. All PNGs match the earlier sealed output. Their layouts/endpoints differ; do not pool their timings.

The unchanged pointer harness measures20trusted moves per case and nearest-rank per-runp95, summarized by the median of three runs:

| Fixture | Before pointer p95 median (ms) | Candidate pointer p95 median (ms) |
| --- | ---: | ---: |
| mixer-layer | 92.0 | 88.1 |
| smudge-layer | 88.7 | 78.7 |
| mixer-mask | 100.2 | 98.0 |
| smudge-mask | 83.0 | 83.5 |
| mixer-filter-mask | 104.3 | 106.6 |
| smudge-filter-mask | 100.8 | 96.5 |

Four medians decrease2.2–11.3%; Smudge mask and Mixer filter-mask increase0.6% and2.2%, with variable/overlapping trial ranges. All six remain above33 ms. No general continuous-pointer speedup is established. Both releases have zero observed overlapping native long tasks and16.8msmaximum observed animation gaps; callbacks do not prove equally frequent ink updates.

The separate release study opens the actual History tab before drawing. A trusted pointerup starts timing; the new named History row marks a DOM commit proxy, and the first subsequent artwork drawImage return marks a final native-canvas-copy proxy. Whole saved projects prove the actual commit/undo. There are only three releases per fixture/release: report medians, not p95. Pointer timings collected with this layout are functional diagnostics only.

| Fixture | History UI before → candidate median (ms) | Final canvas before → candidate median (ms) |
| --- | ---: | ---: |
| mixer-layer | 56.1 → 29.9 | 71.5 → 36.5 |
| smudge-layer | 52.2 → 32.2 | 58.5 → 40.9 |
| mixer-mask | 60.7 → 28.9 | 79.3 → 45.6 |
| smudge-mask | 56.8 → 30.4 | 78.2 → 47.1 |
| mixer-filter-mask | 59.1 → 32.7 | 87.8 → 64.4 |
| smudge-filter-mask | 53.5 → 32.6 | 86.6 → 63.2 |

Release medians improve across six fixtures. Native task controls pass with zero observed overlapping release tasks. These are small synthetic local UI/canvas-copy observations, not physical display, representative photos, sustained/high-rate input, hardware/tablet/GPU or whole-process peak-memory acceptance. First-stage lifecycle-gap checks, intrusive native-phase profiling, the earlier reuse-only mixed timing and the first frame-clock fixture are separately retained; they do not establish the current candidate's acceptance. The clock fixture initially paused pointer batching and was replaced with independently prepared real prefixes using the actual rendering hook.

[prefix evidence](benchmarks/brush-wet-prefix-reuse-2026-10-18.json) retains complete raw studies, PNG/project bytes, reconstructed source and explicit scope. Prepared output leases share bitmaps with current frames and scale with affected output; numerical working budgets are not source-resolution caps. Full F06/T16/F14 and every other unfinished original-roadmap requirement remain active.

## Resident wet epochs — verified local latency reduction; target open

The applied cache retains intermediate private epochs within the existing 32 MiB budget, atomically persists dirty evictions and flushes referenced originals/results before final ownership transfers. Independent native prefix stores pair original/result writes. Actual main build and all 1,352 unit/API cases across 167 files and 56 native browser cases across nine files pass. All 51 non-documentation release resources are byte-identical to the isolated candidate that passes all 82 production workflows; only three generated developer pages differ. Native cache/quota/cancel/store-invalidation/pixel-parity and real 50 MP regressions are functional evidence, not latency results.

Three clean, alternating, unprofiled production pairs ran after every known correctness/setup job finished, in A/B, B/A, A/B order. On Linux/x64 AMD Ryzen 9 3900X (24 logical CPUs), HeadlessChrome 153.0.8010.12, each fresh fixture records 20 trusted moves reaching newly matching pixels copied into the connected artwork canvas. All 720 samples and 36 native task controls pass. All 108 complete before/after/undo PNGs match the earlier verified output exactly. Independent decoding of 108 project containers proves each of 36 strokes adds only one intended native operation with all 21 x/y coordinates, and one undo restores the complete model.

| Fixture | Pre-cache median per-run p95 (ms) | Resident-cache median per-run p95 (ms) |
| --- | ---: | ---: |
| mixer-layer | 163.9 | 88.1 |
| smudge-layer | 155.0 | 89.0 |
| mixer-mask | 173.0 | 104.1 |
| smudge-mask | 155.1 | 89.6 |
| mixer-filter-mask | 177.6 | 119.7 |
| smudge-filter-mask | 167.3 | 101.5 |

These observations show **32.6–46.2% lower local median per-run p95**, with all six fixtures still above **33 ms**. No overlapping native long tasks were observed; the largest observed animation gap is 33.3 ms for the pre-cache release and 16.8 ms for the candidate. Continued animation callbacks do not establish equally frequent ink updates. This small synthetic, paced native-canvas-copy proxy on one host is not sustained/high-rate input, representative photographic work, physical GPU/display/tablet or process peak-memory acceptance. Prefix materialization and remaining worker/storage/scheduling costs still require profiling; full F06/F14 and the complete original roadmap remain open.

[sealed evidence](benchmarks/brush-wet-resident-cache-2026-10-18.json) retains complete raw samples, PNG/project bytes, exact source/release identities, accepted reports and excluded runs. The first restricted unit run failed local binding/child-process permissions and is excluded. The first broad native run expected quota failure from an unloaded transparent no-op and is also excluded; its corrected fixture deposits real pigment, keeps every rejection/cleanup assertion and disposes any unexpected result. Only this ignored native fixture changed after isolated unit/production capture; all runtime, unit, production and 54 release bytes remained identical. Main checks use the corrected fixture. Later result documentation changes only five Markdown files and three generated pages, with runtime/unit/native/production inputs unchanged.

## Wet pointer input — verified working-set improvement; latency target open

Build normal production with `npm run build`, start `npm run preview`, then run `CANOLI_WET_INPUT_OUTPUT=/tmp/canoli-wet-input-run node --import tsx scripts/benchmark-wet-input.mjs`. The output directory must be new. `CANOLI_WET_INPUT_URL` selects a frozen normal-production preview. `CANOLI_WET_INPUT_CASES` selects comma-separated names from mixer-layer, smudge-layer, mixer-mask, smudge-mask, mixer-filter-mask and smudge-filter-mask. The harness rejects developer globals and requires displayed Standard rendering at actual100%zoom.

Each fresh context builds a512×128fixture through isolated Scripts and configures actual tool controls. Twenty trusted, paced pointer moves must each reach a newly matching pixel copied into the connected artwork canvas. Layer cases require visible pure carried pigment at a previously different point, without assuming finite pigment stays opaque. Mask/filter cases require exact known coverage/tone pixels. The timestamp ends at native drawImage return before diagnostic readback; actual RGBA and probe duration are retained. Native75mscontrols prove long-task observation, and overlap filtering includes tasks/frame intervals crossing measurement boundaries. Every fixture verifies all21recorded points, exact model/pixel undo, actual saved projects and no page errors. Complete before/after/undo PNGs support independent RGBA comparison.

`CANOLI_WET_INPUT_DIAGNOSTIC=1` labels shared-load runs diagnostic. `CANOLI_WET_INPUT_PROFILE=1` forces that label and records private IndexedDB transaction and pixel-worker round trips, restoring hooks afterward. These intervals include scheduling/copying/response overhead, can overlap and must not be summed as isolated kernel costs. Diagnostic profiling identified substantial full-cell numerical work and private write traffic. The applied candidate crops numerical support/halo work and groups bounded private writes. Its isolated build,1,352unit/API cases and50native cases pass, including quota rollback/cache consistency; six production workflows preserve18independently decoded PNGs exactly against the frozen release.

A preliminary alternating series completed with all720newly matched points,36native task controls and exact PNG/undo checks, but overlapped lightweight source-ownership and Markdown work early in the series. Retain its raw observations and exclude it entirely from latency acceptance. Actual head build,1,352unit/API cases,50native browser cases and82normal-production workflows now pass. The clean comparison completed after setup and correctness jobs stopped; its exact source/release identity and raw evidence are sealed below. No diagnostic timing is promoted as a speedup or latency gate. This small synthetic, paced canvas-copy proxy does not prove sustained throughput, representative-photo behavior, physical GPU/display/tablet latency, whole-process memory or completeF06/F14 acceptance. Working policies remain independent of original image resolution.


### Clean paired results — 2026-10-18

The [sealed working-set evidence](benchmarks/brush-wet-gesture-performance-2026-10-18.json) records three alternating unprofiled release pairs on Linux/x64, AMD Ryzen9 3900X(24logical CPUs), HeadlessChrome153.0.8010.12. Both releases remained frozen. All720newly matched points,36native75mscontrols,108independently decoded full PNGs and108saved projects pass. An independent project audit proves one intended operation, all21x/y coordinates and exact one-step model undo in every fixture.

| Fixture | Baseline median per-run p95(ms) | Head median per-run p95(ms) |
| --- | ---: | ---: |
| mixer-layer | 257.3 | 171.1 |
| smudge-layer | 264.0 | 155.7 |
| mixer-mask | 287.9 | 172.3 |
| smudge-mask | 293.9 | 157.4 |
| mixer-filter-mask | 298.4 | 187.5 |
| smudge-filter-mask | 297.3 | 175.4 |

These local observations show33.5–46.4%lower median per-runp95, but every fixture still fails the33mstarget. No overlapping native long task was observed after the36positive controls; the largest observed animation gap was16.8msin either release. Continued callbacks do not mean ink updates at60fps. Paced synthetic canvas-copy timing, one host and three pairs do not establish sustained/high-rate input, representative-photo behavior, physical GPU/display/tablet or whole-process memory acceptance. Remaining backing-store and prefix-materialization work requires further profiling. The preliminary series remains excluded entirely.

## Textured-tip source preparation — functional evidence, 2026-10-18

The internal image-backed sampling service now prepares caller-owned alpha/luminance coverage tiles through the real worker/WASM kernel, with private cache budgets and stale/cancelled-result rejection. A genuine 50 MP source retains exact original bytes and native dimensions across ordinary project save/reopen; sampling uses a native 128×64 crop and 200×100 whole-source proxy, with no sampling canvas larger than 200×100. This is source-preparation correctness, not delivered texture authoring or textured-preset persistence.

[Sealed source evidence](benchmarks/brush-texture-source-2026-10-18.json) records the actual build, 1,232 unit/API cases, 288 accepted browser cases across two explicitly audited source-compatible stages and 75 normal-production workflows on the same byte-identical release. The original complete matrix's thumbnail-count fixture failure remains in the report; all earlier texture-file cases are excluded and the complete corrected thirteen-case file passes. Every other runtime/test/documentation/release hash remains identical. The initial broad browser matrix and production suite ran concurrently with separate ports/output directories; their timing attachments are functional observations under shared load. This is not a controlled latency/speedup, sustained input, physical-display/GPU/tablet, process-peak-memory or general 60fps/F14 benchmark. Original decoded bitmaps, worker/caller copies and output tiles still consume source- and workload-dependent memory. Authored texture strokes, rendering/tool/UI integration and portable source-bearing presets remain unfinished.

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

### Native raster PDF export — 2026-10-17

Three serial unprofiled bundled-app runs use a 4096 × 4096 paint/text scene, actual Export .pdf click-to-Blob-download timing, native PerformanceObserver and a deliberate 75 ms native positive control per trial. No developer globals are available. Export-ready proxies are **825.7 / 894.2 / 769.4 ms**, with **13 / 15 / 13** animation frames and no overlapping native long tasks observed. Maximum frame gaps are **84.1 / 91.8 / 90.9 ms**; the general 33 ms interaction gate is not met by those gaps. These are local Chromium scheduling observations, not physical presentation or an established cause for the gaps. No before/after speedup, continuous-throughput, peak-memory, hardware/tablet/device or full F14 claim is made.

The separate genuine 50 MP source/save/reopen/PDF check prepares output in about **1,962.7 ms** locally, releases all 395 native render regions and passes exact independent stored/rendered-pixel checks for that fixture. This is not a reader/process peak-memory measurement. Source/row width, compressed output and PDF-reader image-plane memory remain data dependent. DPI controls physical size without resampling; one streamed image avoids the failed independently placed tile design's 300-DPI edge shifts. Raw final production/native observer reports, correctness matrices, failed experiments, code/release hashes and reproduction commands are sealed in [pdf-export-2026-10-17.json](benchmarks/pdf-export-2026-10-17.json). Earlier records remain unchanged.


### Native PSB delivery and remaining export stalls — 2026-10-17

The normal-production suite now records the same 4096-square paint/text fixture through default-layered PSB output, with three serial unprofiled click-to-real-Blob-download samples: **3,620.0 / 3,763.3 / 3,655.1 ms**, **50 / 52 / 49** animation frames and maximum frame gaps **142.3 / 119.0 / 146.4 ms**. Every trial observes a deliberate native **75 ms** long-task positive control. No overlapping task is observed in trial one; trial two records **59 / 86 ms**, and trial three **57 ms**. This exposes remaining F14 stalls; it is not <=33 ms/<50 ms acceptance, continuous throughput, physical display, peak-memory or hardware/device proof. No controlled before/after speedup claim is made.

A separate genuine 50 MP source/import/save/reopen/PSB gate prepares output in about **4,012.4 ms** locally, releases all **395** native surfaces and passes exact independent merged/layer pixels while retaining original source bytes. External 30,001- and 100,000-pixel-wide PSB inputs pass exact pixels and project/output round-trips without an import canvas wider than 96 pixels; numeric >4 GiB lengths are synthetic. Complete decoded input planes, compressed output and reader allocations remain data-dependent memory. Raw final timing/native observer controls, independent-reader and lifecycle results, frozen hashes, failed pilots/reader limits and reproduction commands are sealed in [psb-export-2026-10-17.json](benchmarks/psb-export-2026-10-17.json). Earlier TIFF/PDF evidence remains unchanged; the original roadmap and F14 remain incomplete.


### Photoshop private encoding: paired production evidence — 2026-10-17

Use a normal release, a preserved baseline release and the exact same saved native project. `scripts/benchmark-photoshop-export.mjs` requires a fresh `CANOLI_PHOTOSHOP_OUTPUT`, accepts `CANOLI_PHOTOSHOP_URL` (default local preview), `CANOLI_PHOTOSHOP_FIXTURE`, `CANOLI_PHOTOSHOP_FORMAT` (psb/psd), `CANOLI_PHOTOSHOP_ROUNDS` (default 3), and optional diagnostic `CANOLI_PHOTOSHOP_PROFILE=1`. `CANOLI_PSB_PYTHON` selects the independent reader. Without a fixture it creates/saves the standard 4096-square paint/text document through isolated Scripts. It rejects developer globals, records source/fixture/native-PNG/entry hashes and actual backend, downloads real files, verifies native long-task controls and checks independent preview/layer pixels. Output JSON refuses overwrites. Profiled samples include overhead and must not be pooled with unprofiled timing.

Three alternating unprofiled pairs, three exports per release per pair, retain identical native project/PNG hashes and **all 18 byte-identical PSB outputs**. Median of nine export-ready proxies changes from **3,603.3 to 1,886.4 ms (47.6%)**. Baseline has six observed overlapping native tasks (**74 / 104 / 54 / 104 / 57 / 87 ms**); none are observed in the nine worker exports. Each trial proves the native observer with a separate **75 ms** task. Maximum frame gaps remain **160.2 / 108.9 ms** for baseline/candidate, so this does not satisfy general input-frame/F14 acceptance. The production regression suite's separate three PSB timing samples (**1,702.4 / 1,660.3 / 1,684.7 ms**) are not pooled into that comparison.

A diagnostic profile identified channel/PackBits work and per-row Blob allocations on the main thread. Private per-export workers now encode captured strips into reused scratch/owned channel Blobs, with host response/source/font validation and abort termination. Only export-owned pixels transfer. Native rendering/readback stays on the host; complete source/output/reader memory, synchronous input parsing and remaining frame delays remain open. A separate 50 MP output check observes **1,916.2 ms**, exact independent pixels/source retention and all **395** native surfaces released, without a paired 50 MP or process-peak-memory claim. Full build, 1,109 unit/API, 152 affected-browser and 53 production checks pass. [Sealed evidence](benchmarks/photoshop-encoding-2026-10-17.json) includes the exact incremental source reconstruction/patch, frozen hashes, diagnostic/pilot failures, real worker ownership/error tests, final paired/raw reports and reproduction controllers. Earlier evidence remains unchanged; physical-display, sustained all-tool, heap/device and the full professional-editor roadmap remain incomplete.


### Photoshop input: worker parsing and remaining readiness cost — 2026-10-17

`scripts/benchmark-photoshop-import.mjs` accepts fresh `CANOLI_PHOTOSHOP_IMPORT_OUTPUT`, optional URL/fixture/reference/rounds variables under the same prefix, and uses real file input/preflight/import/download controls without developer globals. It records native 75 ms task controls, complete overlapping task/frame gaps, browser/CPU/source/reference identity and independently checks every imported RGBA sample. Timing ends at matching preflight/committed-layer DOM, not physical display. Outputs refuse overwrites.

Three alternating normal-release pairs use the same independently generated 50 MP RGB8/RLE PSD and opaque reference. Baseline inspection has **644 / 687 / 650 ms** main-thread tasks and two observed frames per run; worker inspection has no observed tasks and **41 / 40 / 42** frames, with maximum gap **695.3 → 88.1 ms**. Baseline commit has **644 / 680 / 688 ms** tasks; worker commit has none, with maximum gap **687.2 → 100.3 ms**. All twelve deliberate controls pass and all native output pixels match. Total median readiness increases **673.6 → 717.2 ms** for inspection and **2,097.2 → 2,212.3 ms** for import. The tradeoff removes measured half-second stalls while retaining local overhead; it is not a throughput/60fps/full-F14 claim. Commit frame counts also fall from **65/64/66 to 54/50/48**, so task removal must not be presented as a universal cadence win.

Preflight now retains 423 bytes of metadata for the independent 50 MP fixture rather than decoded planes. Full parse still happens inside each worker, and legacy returned ImageData/native bitmaps/output remain memory dependent. Native bitmap decode/upload and residual frame gaps remain outside the moved parsing work; no peak-memory or hardware/device guarantee is made. [Sealed evidence](benchmarks/photoshop-import-2026-10-17.json) includes final 1,113 unit/API, 181 browser and 54 production checks, exact edit/undo/project pixels, codec/grayscale/stale/ownership/error/paging gates, paired raw measurements and controls, source reconstruction/hashes, limits and reproduction scripts. Earlier evidence remains unchanged and the full professional-editor objective stays incomplete.


## Photoshop ZIP decoder acceptance and scheduling limits (2026-10-17)

Trusted PSD/PSB workers now decode native 8-bit ZIP and ZIP prediction using exact geometry/checksum validation and the shared binary parser. Independent psd-tools 1.10.9 fixtures verify RGB/Gray alpha, both import modes, 100,000-pixel PSB rows, malformed output extents and a genuine 50 MP ZIP file. All native imported/project-reopened/exported pixels are checked independently. Missing Deflate support, bad streams, cancellation and stale/private publication remain explicit failures with retry. The synchronous compatibility helpers still report ZIP unsupported, and higher precision/color/mask/group fidelity remains open.

The final browser run records one native 50 MP ZIP import observation of **2,080.5 ms**, **122 animation callbacks** and a **423-byte metadata report**. These are functional workflow observations, without a native long-task control, paired codec-speed experiment, physical-display measurement or sustained/all-tool/heap/device acceptance. Do not infer a ZIP-versus-RLE speedup, 60fps or F14 completion. Streaming native inflation still retains complete decoded output/input planes, returned images and native sources; inspection is not metadata-only parsing or a constant-memory guarantee.

[Sealed evidence](benchmarks/photoshop-zip-2026-10-17.json) contains the exact source/release/fixture identities, independently confirmed malformed older files, all failed/interrupted pilot history, **1,126 unit/API**, **201 browser** and **59 production** passing checks, raw attachments and reproduction controller. All six preceding evidence artifacts remain unchanged; this codec increment does not replace their separately scoped timing conclusions or complete the professional-editor roadmap.


## Photoshop pixel-mask correctness and memory boundary (2026-10-17)

Supported eight-bit user masks now retain original-resolution bitmap coverage as separate native PNG sources instead of rectangular geometry. Black/white outside coverage, effective inversion, density, disabled state and local/document placement use the existing mask model. Private conversion reuses its decoded mask image; white backgrounds use complemented alpha plus inversion without padded document-sized coverage. Group/non-raster, feather/combined/rendered/higher-precision and standalone vector cases remain explicit unsupported layered paths with real merged fallback.

The independent corpus includes a **50 MP image plus a full 50 MP mask**, a 100,000-pixel PSB mask, fractional small masks and known source-grid references. Final browser and production workflows retain both full-size assets, source hashes/model state, OO mask edits and exact undo/project-reopened/native PNG pixels. An initial native case was still opening sources at the default five-second assertion; the explicit longer correctness wait and complete retry preserve full dimensions and exact samples. This is not a performance target or evidence of 60fps, native long-task bounds, process peak-memory, sustained input or hardware/device acceptance. Original/decoded/result/native/output allocations still depend on source data, and inspection is not metadata-only parsing.

[Sealed evidence](benchmarks/photoshop-mask-2026-10-17.json) contains independent fixtures/references, all failed/interrupted pilot history and observer diagnostics, frozen source/release identities, raw **1,140 unit/API**, **262 browser** and **65 production** passing reports/attachments, exact source patch and reproduction controller. The existing matting permission observer was corrected to hook its loaded dependency and gate preparation before revocation, preserving all cleanup/rollback checks. All seven preceding artifacts remain unchanged; their separately scoped timing results are not replaced or pooled. Photoshop feather/vector/group/color/precision fidelity and full F14/roadmap acceptance remain incomplete.


### Native pass-through groups: functional scope and performance boundary — 2026-10-18

Schema-28 pass-through groups now blend children/adjustments against the actual sibling backdrop. Full opacity without an effective mask paints directly; opacity/masks require bounded before/after/coverage surfaces and one premultiplied interpolation. Native source geometry remains independent of viewport/strip/cache working budgets. Backdrop-dependent tonal/patch prefix caches are disabled within this external-backdrop scope to avoid stale pixels after sibling changes. Visible pass-through selects the document-wide Canvas2D/WASM fallback, including on a tested otherwise-operational software-WebGPU path. Hardware GPU support for pass-through remains unfinished.

The independent group corpus includes 100,000-pixel PSB rows and an actual 50 MP source; native output, OO undo, project source retention, native export prefixes and cancellation/allocation-error cleanup are functional correctness gates. Small/wide external-reference alpha canonicalization and the separate analytic translucent-alpha check are explicitly recorded in [sealed evidence](benchmarks/photoshop-groups-2026-10-18.json). No new timing benchmark, speedup, process-peak-memory, physical-display, sustained-use or general 60fps/F14 acceptance is claimed from these tests. Existing recorded dense vector/filter-mask/export slow paths remain open.

Functional verification passes the actual release build, **1,159 unit/API tests**, **395 distinct affected browser cases** across four explicitly audited stages and all **68 production cases**. The 50 MP group reference now requires **60,000 changed pixels** after a production edit assertion exposed a no-op patch over black; the visible-edit assertion remains required. Final source/release/prior-evidence hashes remain unchanged.

## Native Photoshop folder and user-mask output — 2026-10-18

The host PSD/PSB writer now retains supported native folder records and separate document-bounded pixel-mask channels, using existing bounded native strips and a validated one-channel private encoding-worker reply. Native group fill folds into opacity; unstyled Normal pixel fill remains separate, while non-Normal fill/masks, styled-group internals and unsupported scoped dependencies bake with reported losses. Enabled/disabled mask state survives; original mask controls/linkage/off-canvas coverage do not.

Functional gates compare every independent 50 MP preview/source/mask sample, wide PSB rows, all sixteen ordinary folder modes, translucent alpha, scoped styles/adjustments, empty folders, source/undo/project persistence and worker cleanup/retry. The final build, 1,167 unit/API tests, 448 source-validated browser cases and all 70 production cases pass; the browser aggregate preserves one preliminary stale-expectation failure and the complete six-case affected-file rerun. Exact source/release identities, independent results and limitations are in [sealed evidence](benchmarks/photoshop-hierarchy-export-2026-10-18.json).

There is no controlled speedup comparison or new general frame-rate/memory acceptance claim. Source bitmaps, compressed output and row tables remain data dependent; masks currently cover the document rectangle and supported native pass-through still selects Canvas/WASM fallback. Existing production frame/long-task controls are local scheduling evidence. Full editor-wide F14, sustained input, whole-process peak memory, hardware GPU/tablet/device/physical display and independent Photoshop desktop acceptance remain open.


## Authored brush pressure response — functional boundary, 2026-10-18

Schema-29 pressure curves now share native/SVG/supported-WGSL size/alpha/spacing/bounds, with legacy-default compatibility and explicit zero coverage. Empty response segments avoid unnecessary stamp-grid iteration; nonempty replay retains half-pixel spacing and numerical safety checks. Mixed subpixel/precision-sensitive pressure can select the complete Canvas reference path. Real WGSL checks use SwiftShader and do not certify hardware GPU performance. Pen event checks use trusted Chromium protocol input, not a physical tablet.

Functional verification passes the final build, **1,184 unit/API tests**, **218 source-validated browser cases** and all **71 production cases**. The browser aggregate retains 208 unchanged passing cases plus ten complete final-source tools-file cases after correcting actual imported-example fixture preparation; all product/runtime inputs and all 53 release files are identical between stages. The original failure remains in [sealed evidence](benchmarks/pressure-curves-2026-10-18.json), alongside native/SVG/WGSL checks, standalone positive SVG analytic comparisons, real 50 MP source/undo/project comparisons, complete reports and frozen hashes.

This is correctness, isolation, persistence and scheduling-regression evidence, not a controlled pressure speedup or frame-rate benchmark. Denser response-dependent stamps, source/native surfaces and export buffers remain data dependent. Existing recorded slow paths, sustained all-tool F14, process-peak memory, physical tablet/tilt, hardware GPU/display and broad device acceptance remain open.


## Saved brush presets — functional and precision boundary, 2026-10-18

The preset library saves existing tool/dynamics metadata in native IndexedDB transactions and pages visible rows in groups of 100 while searching the complete collection. Applying prepares future settings; actual strokes retain ordinary shared command/history data. Current spacing/smoothing controls and preset summaries preserve fractional percentages, and spacing exposes the existing 1–1000% range. Quota/corruption/concurrency/cancellation and backup-matching recovery protect saved values; non-JSON raw data refuses lossy backup/reset. These choices do not impose an image-resolution/import cap.

The final build, **1,198 unit/API tests**, **233 browser cases in one final-source run**, and all **73 normal-production cases** pass without final failures/skips/retries. Native coverage includes actual pen output, 250 stored presets with paged/full search, trusted focus fallback, Blob byte preservation, real portable/project/PNG downloads, one-step undo and source/50 MP regression workflows. Exact post-preset-deletion project pixels and the independent native two-surface alpha reference remain required. [Sealed evidence](benchmarks/brush-presets-2026-10-18.json) retains every failed/interrupt pilot, final reports, source/release/prior hashes, reconstruction data, UI review and independent probes. Interrupted review runs contribute no accepted final cases.

This is functional, precision, isolation, persistence and scheduling-regression evidence, not a controlled preset speedup or a general frame-rate benchmark. JSON parsing, record validation, library size, browser quota and native image/export buffers remain device/data dependent. Physical tablet/tilt, textured brushes/mixer/symmetry, hardware GPU/display, process-peak memory, sustained all-tool F14 and the broader professional-editor roadmap remain unfinished.


## Authored brush-tip and spherical tilt correctness — 2026-10-18

[Sealed tip evidence](benchmarks/brush-tip-2026-10-18.json) verifies shared Canvas/SVG/software-WGSL ellipse and rotated-pencil geometry, affine pen/mask-master input, captured clone/healing coverage, warmed cache invalidation, project/workspace undo/redo and version-2 portable presets. The native 50 MP erasure retains source bytes and independently compares all undo/reopened pixels. Final verification includes the actual build, 1,212 unit/API cases, 255 browser cases in one source-frozen run and all 74 normal-production workflows. All 1,040 input hashes, 54 release hashes and twelve preceding artifacts remain verified; reconstruction matches all 60 changed/new files.

These are functional correctness checks, not a new latency benchmark, speedup, tablet/hardware-GPU certification, physical input-to-photon result, peak-process-memory measurement or universal 60fps/F14 acceptance. Thin or numerically unsuitable tips explicitly use complete Canvas fallback. The cursor avoids copying mask/master artwork on hover, without claiming measured end-to-end improvement. Existing dense vector/filter-mask/export slow paths and sustained/device gates remain open. Project 3/workspace 2 and original source resolution/bytes remain intact; no image-import cap or provider/network privilege was added.


## Mirror/radial brush symmetry correctness — 2026-10-18

[Sealed symmetry evidence](benchmarks/brush-symmetry-2026-10-18.json) verifies complete native/SVG/software-WGSL affine-copy footprints, mask/master input, cloned source regions, healing coverage, prefix/full-pixel parity, warmed cache invalidation, workspace redo and portable presets. The genuine 50 MP erasure covers two distant regions while retaining original bytes and all undo/reopened pixels. Final checks pass the actual build, 1,226 unit/API cases, all 275 browser cases in one runtime-frozen run and all 75 normal-production cases. A documentation-only descriptive-link correction is independently hash-validated, with the corrected build/unit/75-production checks run fresh; application/runtime/CSS/test bytes remain identical to the browser run. All 1,045 inputs, 54 release files and thirteen preceding artifacts verify; reconstruction matches all 60 changed/new files.

Merged clipped stamp-index ranges avoid walking invisible gaps between copies; no sample/copy is dropped to fake speed. Ghost cursor SVGs remain viewport-sized. These functional invariants and actual positive subpixel/zero-response checks do not establish a new latency speedup, physical-tablet/hardware-GPU/display result, sustained all-tool 60fps or peak-process-memory guarantee. Copy count increases real rendering work, and distant healing copies can enlarge existing search/solve buffers. Numerical/device suitability still selects complete Canvas fallback. Existing dense mask/vector/export slow paths and full F14 remain open; source geometry/resolution is preserved without an arbitrary import cap.

## Native textured-stroke replay — internal functional boundary, 2026-10-18

[Sealed native evidence](benchmarks/textured-stroke-native-2026-10-18.json) verifies direct original-bitmap affine sampling, complete oriented/tilted/copied footprints and privately staged incremental raw-ink replay. Five transformed synthetic fixtures and a 2048px dab split into four tiles have zero alpha/premultiplied difference from independent whole-surface native references. Cancellation preserves caller pixels and the retained prefix; resume from index one matches a full replay. Zero-pressure endpoints, queue invalidation, mutable-input ownership, source replacement and ephemeral replay above the 16 MiB retained threshold pass. A real 50 MP source retains exact original/project bytes while supplying native detail to a 128×64 visible crop, without larger captured working canvases.

The actual build, 1,236 unit/API cases, one complete final 148-case relevant browser matrix and all 75 normal-production workflows pass. Initial failed gesture-ID fixtures remain recorded and are excluded from final counts. Browser/production matrices ran concurrently on separate ports/output directories; their timing attachments are functional observations under shared load. No controlled speedup, sustained latency/frame rate, hardware/tablet/display or process-peak-memory result is claimed. The 16 MiB prefix/32 MiB private cache and 1024px sampling tiles do not include all caller/staging/worker/source/browser memory; decoded originals remain source dependent. This adapter is not yet connected to authored texture metadata, app tools/composition, SVG/GPU texture replay or portable presets. F06/F14 and the complete roadmap remain unfinished.

## Authored image-backed texture integration — functional verification, 2026-10-18

[Sealed authored-texture evidence](benchmarks/brush-texture-authoring-2026-10-18.json) verifies schema-32 OO/isolated/REST contracts, original-source collection/remapping, native paint/mask/filter/erasure/tonal/healing/clone coverage, SVG source-resolution coverage images and actual software WebGPU mask composition/whole-paint fallback. Analytic alpha/luminance/inversion samples, native/SVG flow-before-opacity with selection, exact cache/undo/project pixels, redo-only workspace sources, copy closure/collisions, portable recipe bytes and source-change rejection pass. A genuine authored 50 MP texture retains exact original/reopened bytes and independently verified native crop detail after its raster layer is removed. The actual build, all 1,250 unit/API cases, one complete corrected-source 348-case browser matrix and all 76 production workflows pass; all 71 changed/new files reconstruct exactly.

These are functional checks, not a controlled speedup, universal 60fps, sustained all-tool/heap/physical-display/tablet/hardware-GPU result or full F14 acceptance. Browser and production matrices ran concurrently under shared load. Working tiles, retained prefixes and the shared sampler cache remain independent of original image geometry and do not describe whole-process memory. Complete source-resolution coverage images can make SVG output/memory source dependent, and cross-viewer sampling/edge rounding remains explicit. Active-tool texture controls/ownership/cursors and original-source portable brush preset/library integration remain unfinished, as do existing dense mask/vector/export slow paths and the broader roadmap.

## Explicit texture-source ownership — functional resource verification, 2026-10-18

[Sealed ownership evidence](benchmarks/brush-texture-owner-2026-10-18.json) verifies shared native pixels/closure order, exact original/TIFF choices, independent document/project ownership, failed/stale/cancelled preparation, idempotent document references, script output promotion, matting-view cleanup and unchanged isolation. A real 50 MP source reuses the same 10,000×5,000 bitmap with no observed extra decoding or canvas creation during synchronous capture/sharing; original/reopened hashes and dimensions remain exact. Native project reload deliberately decodes an independently owned bitmap afterward. The final build, 1,272 unit/API cases, 382 accepted browser cases across two audited stages and all 76 production regressions pass. Only a cancellation test's observed module/gate changes between browser stages; exact hashes preserve every application/runtime/other test and all release bytes. All twelve changed/new files reconstruct exactly.

This is resource/source-preservation evidence, not zero whole-process memory, a controlled latency/throughput comparison, universal 60fps, sustained all-tool acceptance or tablet/hardware-GPU/physical-display certification. Source bitmaps, references, private proxies and output remain data dependent. Concurrent broad browser/production observations and the separately corrected matting run are not pooled into a performance comparison; native matting long tasks remain visible in the raw reports. Texture source controls, active gesture/cursor integration and original-source portable presets remain unfinished, alongside existing dense mask/vector/export paths and the broader F14/device/precision gates.


### Texture controls and source-preserving pointer workflow — functional evidence, 2026-10-18

The actual source dialog and brush-family pointer tools now retain original images independently of document tabs. Native functional checks cover real brush/pencil/eraser/clone/tonal/healing coverage, masks/filter-mask master planes, exact undo/project/workspace bytes, cancellation/stale source identity, TIFF review and a genuine 50 MP source through source-document closure and project reload. A separate 16-bit TIFF dialog check requires explicit precision-loss consent while retaining the exact original TIFF bytes. A native screenshot comparison of the 128-square cursor proxy against the identical hidden-proxy frame changes the covered sample from RGB 64 to 130 and leaves the empty sample at RGB 64; this proves displayed coverage in that fixture, not general cursor visibility or frame rate.

[Sealed evidence](benchmarks/brush-texture-controls-2026-10-18.json) records the final build, **1,274 unit/API tests**, one complete corrected-source **430-case/35-file browser run**, and **77 normal-production workflows** on the identical 54-file release. No accepted browser/production case skips, retries or flakes. The initial browser stage was interrupted to correct a separately reproduced source-identity commit bug; all of its cases are excluded. The repeated exact native audit now rejects without editing the document or deleting the foreign replacement. All 1,062 source inputs, generated WASM, eighteen prior immutable artifacts and nineteen reconstructed changed/new files verify. SHA-256: `56a17fb6960ddad74aae040e6d76722f2a833c5e1df691d7e42fdd9dfb4c6363`.

The main browser and production suites ran concurrently on separate ports; their timing attachments are observations under shared load. These are functional/pixel/source-lifetime results, not controlled latency, continuous-throughput, physical-display/tablet/hardware-GPU, process peak-memory or general 60fps/F14 acceptance. Original decoded source bitmaps and compressed/output data remain workload dependent. Original-source portable texture presets and the wider F06/T16/roadmap remain unfinished.


### Original-source brush packs and recovery — functional evidence, 2026-10-18

Preset/pack4 now retains original image Blob sources separately from decoded editing/cursor pixels, with native dimensions/MIME/name, SHA-256 and TIFF choices. Actual UI/native checks verify source-preserving save/export/delete/reload/import, exact pixels/undo, TIFF page2/16-bit consent persistence, stale/cancelled native Apply, original-ID collision protection, source-aware rollback/backup/reset, same-size corruption/File timestamp guards and a genuine50MP source after source-document closure and reimport. A native mutation audit confirms only the changed preset record is written/deleted while an unrelated original retains exact bytes and revision; this is a storage-work invariant, not a latency benchmark.

[Sealed evidence](benchmarks/brush-texture-portable-2026-10-18.json) records the actual build, **1,289 unit/API tests**, one complete **447-case/36-file browser run** and the complete corrected **78-case production file** on the identical54-file release. Source compatibility is explicit: only an ignored production documentation-link selector changed after the browser run; all1066 other inputs, unit/native tests, runtime/WASM/release bytes remain identical. The first production stage's77passes/1ambiguous-selector failure is retained but entirely excluded from acceptance. Final cases have no skips/retries/flakes. Twenty-one changed/new files reconstruct exactly,1,067 source inputs and nineteen prior immutable artifacts verify. Artifact SHA-256: `d04f6024520fa0e40236d7d59064c8a42a72502b59c99336fcdd6ee6811fa0f7`.

A normal-production pack download/reimport in a fresh independent storage context reproduces every native output pixel, original project source bytes and one-step undo without developer globals, independently checked with PIL. The binary container concatenates compressed originals without base64; checksum array buffers, JSON metadata, decoded originals and output still consume workload-dependent memory. Native write-lock keepalive supports atomic content verification/recovery; it is not a proof of large-library throughput or continuous input responsiveness. Unsupported directory-relative File/raw non-JSON recovery values reject rather than silently erase metadata. Browser/production ran concurrently on separate ports; timing attachments are observations under shared load. Physical tablet/GPU/display, process peak-memory, sustained/all-tool F14, mixer/smudge and full-roadmap acceptance remain open; no universal60fps or speedup claim is made.


## Native wet-paint numerical dependency — functional verification, 2026-10-18

[Sealed source evidence](benchmarks/brush-wet-paint-core-2026-10-18.json) records the actual build, 1,303 unit/API cases across 162 files, 465 accepted browser cases across 41 complete files and 78 complete normal-production cases. All 1,072 source inputs, 54 release files and generated WASM remain identical across accepted native/production verification; 20 previous artifacts remain unchanged. Seven patches plus five full additions reconstruct all 12 changed inputs exactly, and every source/assembly/server/test/script file belongs to the frozen inventory. There are zero accepted browser/production skips/retries/flakes. The five-case initial native pilot remains separate and is not pooled into acceptance.

Fourteen new unit tests and five real browser-worker cases cover actual-WASM carried pigment, finite loading, premultiplied color/alpha deposit/lifting, pre-deposit pickup, wetness/flow/coverage, fractional Float32 reservoir retention, exact per-dab tile partition/order, separate final whole-stroke opacity/selection, buffer ownership, concurrent operations, memory growth, invalid inputs/results and disposal. The independent numerical corpus spans 65,536 alpha/coverage pairs across five settings, allowing at most one RGBA byte and 1e-7 absolute reservoir error against separately weighted equations; direct endpoint and tile-partition cases require exact values. Existing 50 MP image/matting/TIFF regressions pass, but no native wet-stroke large-image workflow exists yet.

This is functional/numerical evidence for an internal dependency. Full-stroke spatial replay, ordered authored layer replacement, source/result persistence, tool controls/gestures/preview/cancel/presets and export/automation integration remain unfinished. Encoded-sRGB interpolation is not a physical/spectral paint model. Per-request working buffers admit 4,000,000 pixels independently of source/document/stroke geometry; larger regions require tiling. Original/working/caller/worker/WASM/result storage remains workload dependent. Concurrent browser/production timings do not establish speedup, throughput, universal 60fps, sustained all-tool F14, process peak memory or hardware/tablet/display acceptance. The original full roadmap remains active.


## Native spatial wet preparation — functional evidence, 2026-10-18

[Sealed evidence](benchmarks/brush-wet-spatial-2026-10-18.json) records the actual build, 1,314 unit/API cases across 163 files, all 28 selected native browser cases across four complete files and all 78 normal-production cases. The 1,079 frozen inputs, 54 release files and actual WASM remain unchanged during acceptance, and 21 previous artifacts remain intact. Three patches plus seven additions reconstruct all ten changes exactly. Every accepted browser/production result passes once with zero skips/retries/flakes; all initial pilot results are excluded.

Eleven new unit cases and seven new native cases verify spatial striped pigment rather than average-color smear, turns, alpha lifting, original-first overlapping symmetry with independent reservoirs, fixed-order bilinear sampling under affine/tilt/pressure/texture, exact backing-tile/cache partition parity, viewport cropping after complete replay, once-only selection/opacity, untouched hidden RGB, owned outputs and input capture. Native IndexedDB/Web Lock tests verify cross-job isolation, disposal, actual worker-termination cleanup, quota/cancellation and foreign-source replacement. Independent inverse-basis/bilinear equations use six-digit closeness assertions; native/unit partition cases require exact resulting pixels.

A real 50 MP RGBA source retains original dimensions and full blob SHA-256 through source-project reopening. Native alpha128 pigment moves from (9000,4000) to (9004,4000), and prepared output remains available after input closure without changing the document/history. Canvas dimension setters record allocations before release; observed preparation working canvases stay within the existing 4,000,000-pixel policy. These observations do not measure original bitmap/decoded/source/backing/metadata/scratch/worker/WASM/result or whole-process peak memory.

This is internal read-only preparation. The production release changes only three generated guides, with app/worker/WASM bytes unchanged; normal-production tests do not exercise a new mixer/smudge UI. Authored ordered target replacement, neutral content planes, OO/history/assets/persistence, tool gestures/previews/cancel/presets and export/automation integration remain unfinished. Current replay has no incremental gesture prefix. Browser/production suites ran concurrently on separate ports; timing attachments are functional observations, not controlled speedup, sustained throughput, universal60fps or hardware/tablet/display acceptance. Browsers without Web Locks/database enumeration retain explicit disposal but lack automatic abandoned-job identification. The original full roadmap remains active.


## Authored wet integration boundary — 2026-10-18

[Sealed integration evidence](benchmarks/brush-wet-authoring-2026-10-18.json) records authored prepared values, neutral native preparation, ordered alpha replacement, native reconstruction, expanded raster support/resize, persistence and isolated/REST publication. Browser comparisons use complete native composition as a reference, actual SVG/PSD exports, real gestures and a 50 MP original with recorded canvas allocations. Normal production exercises the prepared constructor through isolated Scripts and visible file controls without globals. These are functional/source-ownership checks, not throughput or process peak-memory measurements. Complete stroke replay has no incremental live gesture prefix; no sustained 60fps/all-tool/device acceptance is implied. Original decoded/source/result/backing/worker/WASM and output memory remain workload dependent. Actual mixer/smudge tools, masks/filter-mask targets, controls/presets and the rest of F06/T16/F14 remain open.


## 2026-10-18 — Red-eye functional conformance; F14 remains open

Manual selection-masked red-eye correction passes actual WASM/worker processing and 120 actual-WGSL comparisons on Chromium SwiftShader software WebGPU. Observed maximum premultiplied RGB error is one byte, maximum mean RGB error 0.0916667 and alpha mismatches zero across threshold boundaries, partial alpha, masks, opacity and normal/multiply blending. The native feature suite exports a full 50 MP PNG while preserving source bytes, native region detail, editable masks and project reopening. Final build, 1,363 unit/API cases, 38 focused browser regressions, seven final feature checks and 83 production workflows passed. A guide-only final release change was verified with two affected production checks; all app/worker/WASM/other guide files remain byte-identical to the full production-tested release. [Source/release and check evidence](benchmarks/red-eye-2026-10-18.json).

This is numerical and functional evidence, not real-hardware presentation latency, portrait-quality evaluation, complete F05/F14 acceptance or a 60fps claim. Existing wet-gesture and editor-wide performance failures remain open. Working tile budgets do not cap source/document geometry.


## Textured input and native composition — 2026-10-20

The [sealed alternating studies](benchmarks/texture-frequency-production-performance-2026-10-20.json) compare twelve synthetic opaque-texture fixtures through normal production UI, with twenty paced trusted movements per gesture and three runs per variant. Native matching-canvas-copy timestamps precede the one-pixel validation read; every sample must newly match known exact RGBA. Saved original/edited/undo projects independently preserve source blobs, all21 points and exactly one authored operation. Complete PNG/model undo and native75ms long-task controls are verified. The reference is the pre-texture-correction release; changed legacy edge appearance is recorded separately from speed.

| Fixture | Reference median run p95 (ms) | Current median run p95 (ms) |
| --- | ---: | ---: |
| Small brush/layer | 13.4 | 14.0 |
| Small pencil/mask | 7.9 | 14.7 |
| Small eraser/filter mask | 23.4 | 21.2 |
| 2048 brush/layer | 20.3 | 14.3 |
| 2048 pencil/mask | 95.7 | 31.6 |
| 2048 eraser/filter mask | 34.9 | 34.5 |
| 1800 brush/layer | 17.9 | 14.6 |
| 1800 pencil/mask | 89.0 | 31.9 |
| 1800 eraser/filter mask | 37.7 | 36.8 |
| 900 brush/layer | 13.9 | 14.0 |
| 900 pencil/mask | 55.1 | 32.4 |
| 900 eraser/filter mask | 22.8 | 28.3 |

Two current fixture medians still fail33ms, and individual900-pixel pencil runs exceed33ms. No overlapping gesture long task is observed. Six final appearances remain identical to the old renderer; three brush-edge and three filter-mask appearances change. An independent32768-subrow circle-area integral matches every current alpha pixel in all three circle fixtures, but does not establish broader image quality. These results do not establish sustained/editor-wide, physical/tablet/display or whole-process-memory acceptance.

A separate unprofiled offscreen native50MP full-frame low-retouch study compares corrected256/512 composition cores. Three alternating pairs on Linux/Chromium153.0.8010.12, AMD Ryzen9 3900X, observe median37313.6→32177.7ms (13.8% locally),3160→3081 Gaussian requests and71064000→70432320 sampled pixels. Independent complete RGBA decoding matches all six outputs; source/model hashes remain unchanged and all outputs differ from the original. Native long-task controls are positive and no overlapping export long task is reported. Animation-gap p95 is19.9–20.3ms, a headless scheduling proxy. No competing builds/tests ran. A roughly32-second export and the remaining input misses still require work; no general60fps or complete F14 claim is made.


### Literal-raster native band overscan

The [band-overscan follow-up](benchmarks/frequency-band-overscan-2026-10-20.json) compares unchanged512-pixel composition cores with512 versus1024 native band sampling cores. The larger read is eligible only over a literal unchanged native raster, without a filter mask, under the same4MP/8192-edge halo budget. Three alternating unprofiled50MP pairs observe median32243.4→29017.1ms (10.0% locally),3081→1580 Gaussian requests and70432320→68432000 sampled pixels. All six complete outputs match RGBA exactly and contain the intended retouch; source/model identities remain unchanged. All six native long-task controls are observed and no overlapping export task is reported. No competing tests/builds ran. This is one synthetic full-frame low-retouch fixture on the same named host/browser, with headless callbacks as scheduling proxies. It does not establish general speed, physical display, sustained/editor-wide or process-memory acceptance. A29-second export still needs work.


### 2026-10-21 — Rectangular native frequency and blend work

[Sealed strip-batching evidence](benchmarks/frequency-strip-batching-2026-10-21.json) compares the committed 1024-band/512-composition renderer against aspect-aware native sampling and independent blend partitions. Three clean alternating unprofiled pairs on Linux, Chromium153.0.8010.12, AMD Ryzen9 3900X observe:

| Full-frame 50 MP low-retouch export | Reference | Candidate |
| --- | ---: | ---: |
| Median elapsed time | 29162.1 ms | 21795.6 ms |
| Gaussian requests | 1580 | 395 |
| Gaussian sampled pixels | 68432000 | 66458000 |
| High/correction encoding requests | 3160 | 790 |
| Encoding pixels | 136864000 | 132916000 |
| Linear Light/Burn requests | 3160 | 790 |
| Blended pixels | 107170560 | 106532640 |

Median elapsed time is 25.3% lower locally. Independent complete RGBA decoding matches all six 10000×5000 outputs and the frozen reference. All contain the intended edit, preserve model/source hashes and have positive native long-task controls; no overlapping export long task is observed. All 37 scene pairs (74 independently decoded PNGs) match exactly, including texture/wet/erase/outer-mask variants. Application engine/WASM and all39 previous benchmark artifacts remain byte-identical throughout measurement. No competing builds/tests ran.

This is one synthetic offscreen full-native low-retouch workload. Headless animation callbacks are scheduling proxies. No general/editor-wide input, sustained-use, physical GPU/tablet/display, portrait-quality or process-memory acceptance follows. A roughly22-second export and the previously measured large filter-mask input misses still require work.


### 2026-10-21 — Extreme bitmap precision and capture scheduling

[Precision evidence](benchmarks/bitmap-projection-precision-2026-10-21.json) records Chromium returning entirely transparent pixels for visible bitmap masks/textures at1e9 and1e12 transforms. Fractional source crops, local quads and texel rebasing also fail in that experiment. Bounded double-precision native sampling restores actual source/mask/texture pixels, affine support and native wet/filter projection. A separate huge-circle case exposed alpha61 instead of64; stable chord evaluation corrects the floating-point cancellation rather than changing the expected pixel assertion.

A full64-sample/1,000,000-pixel numerical texture batch initially starts all64 native captures before a queued timer can run. Serial gathering with a shared task deadline observes the timer before any native capture starts, then returns all64 outputs with every byte correct. This proves a task boundary in this fixture, not input-to-display p95 or physical60fps. Clear/dispose stop subsequent numerical probes and late worker conversion; cache retirement completes independent reads. Mutable Canvas inputs retain captured pixels and private bitmap snapshots close once on success/cancellation.

The genuine50MP fixture retains its original10000×5000 decoded dimensions and exact source Blob through project reopening; complete extreme-view PNGs match an independent Pillow oracle and observed working canvases stay within4MP/8192 edges. This is scoped allocation evidence, not whole-process memory acceptance. All37 ordinary scene pairs and independently decoded74 PNGs remain exactly equal to the committed renderer. Existing editor-wide/sustained/release/device/quality/process-memory gates and the previous input-latency misses remain open.
