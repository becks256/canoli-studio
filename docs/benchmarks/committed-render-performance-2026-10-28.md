# Committed viewport admission — 2026-10-28

Baseline `3932702f2af789696ffd89e7d02aa7fc484bf35c`. This bounded T01/F14 increment accepts earlier admission for eligible committed revisions on an already-presented document. Full F14 and the complete original roadmap remain open.

## Behavior and method

Private viewport jobs capture the actual Document instance as well as its source snapshot. A content command may bypass an additional animation-frame wait only with the same presented owner, stable queued view/region/zoom, assets, native-font/backend/color context, and no gesture or paint/wet preview. A new eligible edit wakes an older view wait; the single active drain consumes the latest queued job. New owners, geometry/view changes and previews retain their cadence. Existing cancellation, source validation, complete-frame publication, fallback and resource leases remain.

The frozen baseline and candidate each contain 142 resources and use the same Chromium 153 host, one worker, unchanged documents, viewport and assertions. Three alternating pairs run before/after, after/before, before/after. Each version has 12 actual font-control clicks at 16 layers and 12 at 64 layers per pair; no cold sample or outlier is dropped. The existing unchanged control test measures capture-phase click through matching canvas publication, including command, React admission, preparation and presentation. This is canvas publication, not physical display latency.

Instrumented CPU/frame diagnostics are separate from clean measurements. Baseline warm preparation was approximately 6–7 ms but frame gates often delayed preparation by 40–60 ms. All 12 candidate diagnostic edit windows have zero additional requestAnimationFrame requests; baseline windows do request frames. Native preparation, resource readiness, synchronous setup and individual native calls can still be slow.

## Actual font controls

Each cell is median / p95 milliseconds, with nearest-rank p95. Twelve samples make p95 the maximum; all samples remain in the archive. There is no claim that median improvements satisfy tail-latency or sustained 60fps acceptance.

| Pair | Layers | Baseline click → canvas | Candidate click → canvas | Baseline click → preparation p95 | Candidate click → preparation p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 16 | 53.3 / 65.9 | 11.6 / 57.6 | 55.3 | 10.1 |
| 1 | 64 | 60.4 / 104.7 | 16.7 / 96.6 | 64.6 | 10.6 |
| 2 | 16 | 55.5 / 72.5 | 10.3 / 59.5 | 69.7 | 8.4 |
| 2 | 64 | 59.3 / 122.8 | 17.0 / 70.9 | 70.3 | 9.9 |
| 3 | 16 | 52.6 / 67.9 | 10.3 / 27.7 | 65.1 | 7.2 |
| 3 | 64 | 56.5 / 98.8 | 17.9 / 149.4 | 66.0 | 17.7 |

Typical completion is substantially earlier. Cold completion remains mixed: the third 64-layer candidate reaches 149.4 ms versus 98.8 ms baseline, with 131.6 ms inside preparation. This is retained as an unresolved tail, not discarded or hidden by warm-only statistics. Preparation also grows in other samples despite earlier admission; this change removes the extra frame gate and does not claim cheaper native font preparation.

All paired font-test long tasks are retained with timestamps. None intersects its actual click-to-publication windows; they occur during setup before the controls. This does not imply that unobserved tasks cannot occur, or that cold asynchronous preparation is a single blocking task.

## Verification

- `npm test -- --maxWorkers=2`: 2871 tests / 286 files passed. `npm run build` passed with benchmark mode removed.
- 357 accepted browser executions / 324 distinct targets, with no skips, retries or flaky accepted cases. Initial failed locator and expected baseline failures are separately preserved.
- 69 source-development cases across 15 files cover native rendering, affine/clipping, text bounds/shadows, cancellation, fonts, float lifecycle, live gesture invalidation, layer task scheduling and the four new committed-frame checks.
- Four controlled-frame cases pass against both source and the frozen candidate, including a final compiled run: committed font edit/Undo/Redo with zero frame advances and exact model/native PNGs; pending-view interruption with the latest scale; coalesced view-only updates and first-owner fitting; and a different Document instance with identical logical ID/data and exact pixels.
- The unchanged baseline fails both new committed-edit and pending-view interruption checks while the frame clock is paused, and passes the two view/owner admission cases. The negative control preserves the failure reports and deadlines.
- 79 editor performance cases across 32 files passed, retaining real 50 MP import/save/export, paint and sustained sessions, transforms, history, document operations, retouching, native text, scripts, recovery and storage observations.
- 175 normal-production cases passed against the normal release. Native codecs and the genuine 50 MP output/interchange cases retain independent readers, original resolution and exact-source checks. Normal production keeps diagnostic globals absent.
- 144 paired complete cold-render digests / 276,480,000 RGBA bytes are identical across both releases. Two independent native construction comparisons cover 3,840,000 channels with zero differing channels; cancellation/retry and stale-frame rejection pass.
- Pixel WASM `bd6a519864eb8c8893e1ff8ef23ce5da6b8910c39532467fae9828ba9b305311`, four tracked native codecs and isolated script runtime `4813592f23e5b63bba1d923a33422731b64ff547ec7454984ca6d5474c3d2014` remain unchanged. 2996 tested source inputs, 50 generated resources and 142 normal-release files are fingerprinted.

## Remaining measured tails

The following are recorded p95 metrics above 33 ms from the full candidate sweep, sorted by duration. These are observations from mixed fixtures and operations, not a uniform SLO or attribution of all setup/long tasks to the named control. The full audit retains every extracted metric.

| Case | Metric | p95 ms |
| --- | --- | ---: |
| scripts on a stroke-heavy document record snapshot transport latency | script-transport-latency / [].ms | 269.9 |
| fresh isolated script workers report initialization, document and command costs | script-runtime-phases / [].totalMs | 194.4 |
| font replacement 64 text layers records matching canvas presentation and long tasks | font-replacement-latency / longTasks | 189.0 |
| font replacement 64 text layers records matching canvas presentation and long tasks | font-replacement-latency / taskDetails[].duration | 189.0 |
| crop resize and isolated scripts with 64 layers record presentation latency | document-operations-latency / samples[].presentMs | 181.2 |
| spot-heal repeated gestures record completion and main-thread stalls | retouch-latency / samples | 180.9 |
| crop resize and isolated scripts with 64 layers record presentation latency | document-operations-latency / samples[].commitMs | 178.3 |
| crop resize and isolated scripts with 64 layers record presentation latency | document-operations-latency / samples[].scriptRuntimeMs | 167.0 |
| crop resize and isolated scripts with 5 layers record presentation latency | document-operations-latency / samples[].presentMs | 148.5 |
| crop resize and isolated scripts with 5 layers record presentation latency | document-operations-latency / samples[].commitMs | 147.0 |
| crop resize and isolated scripts with 5 layers record presentation latency | document-operations-latency / samples[].scriptRuntimeMs | 140.8 |
| font replacement 64 text layers records matching canvas presentation and long tasks | font-replacement-latency / samples[].presentMs | 139.0 |
| scripts on a stroke-heavy document record snapshot transport latency | document-reconstruction-latency / [].ms | 132.1 |
| pixel operations 2000x1500 record completion and frame gaps | pixel-operation-latency / samples[].ms | 128.8 |
| font replacement 64 text layers records matching canvas presentation and long tasks | font-replacement-latency / samples[].prepareMs | 128.4 |
| spot-heal repeated gestures record completion and main-thread stalls | retouch-latency / phases[].ms | 116.5 |
| filter-mask brush on 2000px smart filter stack with 16 strokes records live response | filter-mask-latency / samples | 110.5 |
| float gradient-map controls record matching model and independently checked canvas pixels | float-control-latency / samples[].verifiedReadbackMs | 95.0 |

## Evidence and boundaries

`committed-render-performance-2026-10-28.zip` is a version-2 content-addressed manifest with SHA-256 payloads, logical paths and byte counts. It includes changed sources, frozen baseline/candidate/normal releases, generated runtime, raw reports/ledgers/artifacts, CPU profiles and clocks, process observations, hashes, analysis and runnable helpers. Its sealed SHA-256 and exact committed file identities are recorded by the verification receipt. Existing earlier artifacts and commits are retained.

The first candidate pilot passed the scheduling/model/pixel assertions but failed an incorrect exact-text `Ready` locator. The actual status bar combines `Ready` with geometry; its snapshot is preserved. The test now checks the status bar contains `Ready`; no product behavior, deadline, history or pixel assertion was relaxed.

Process observations sample descendant RSS/PSS/CPU at 500 ms and include browser/server/test overhead. RSS double-counts shared memory; PSS is proportional. Transients, exited/orphaned processes and physical GPU allocations may be missed. Controlled frame clocks prove admission/cadence behavior, not a physical monitor or a general CPU/memory budget.

Full F14 remains active: cold native preparation, synchronous setup/command/graph and script/document/retouch tails, sustained all-tool/device/global-memory acceptance and physical GPU/display/tablet validation remain. The complete original professional-editor roadmap also retains broader float/HDR/working-space and photographic/interchange quality, provider/AI/evaluation, live ChatGPT installation/identity, collaboration, specialist and commercial gates. No public constructor, serialization, command/history, REST, scripting, plugin grant or account contract changes.
