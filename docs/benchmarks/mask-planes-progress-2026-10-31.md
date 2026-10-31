# Retained mask-plane progress — 2026-10-31

Status at recording: uncommitted integration candidate, not a release or completed-roadmap
receipt. Accepted baseline remains `7ef37e7`.

The candidate preserves original mask geometry/grid and native/document filter
mixing phase through projected relinking. Complete mapped brush and coupled wet
fields retain editable commands, source assets and history. Brush fields sample
on the original native grid without an intermediate logical-size bitmap.
See [the exact candidate contract](../MASK_PLANES.md).

| Check | Observed result |
| --- | --- |
| Fresh build | Pass, Node 26.13.0, isolated candidate output |
| Complete unit/API/native suite | 3,215 passed, 312 files, two workers |
| Initial default-concurrency full run | 3,208 passed, seven five-second timeouts; retained |
| Earlier focused actual-WASM/model probes | 61 passed |
| Initial complete new browser run | 27/29 passed; translated-basis implementation and trailing-comment fixture fixed |
| Expanded new browser run | 32/33 passed; remaining failure was the expected error-wording assertion |
| Corrected malformed-pigment assertion | Focused rerun passed; actual invalid pigment already rejected |
| All-kind relinking | Every RGBA byte retained across five ordinary and ten filter phase/kind cases |
| Native-grid brush controls | Exact prior output at native pixel dimensions 0.5x and 2x logical dimensions |
| Genuine 50 MP source | 10000x5000 original retained; SHA `b457af22024ac92524b87f06ada74fd652484835edbaafbb20470a8a9bb3897f`; masked alpha 128→64 |
| New tools/transport | Brush/Mixer exact private preview/commit, native Pen controls, shape capture, project reopening, original bytes, isolated example rollback, shared REST revisions/atomic missing-grid rejection and Undo |
| Performance | No new latency claim or regression clearance |

The local evidence root is `/tmp/canoli-mask-planes-2026-10-31`. The compact
`mask-planes-progress-2026-10-31.json.gz` records successful and failed reports,
logs and source fingerprints. Raw ZIP archives remain local and ignored.
Candidate output lives under that temporary root; the accepted `dist` target is
preserved. No push was performed.

Required next acceptance includes the full existing relevant browser regression
matrix, normal production and bundled-worker workflows, nested/master/current
frames, geometry-only source swapping/ownership, all-kind edits, wet pickup and
cancellation, copy/recipe/workspace/retained history, SVG/Photoshop/GPU fallback,
and wider float/horizon/resource/lifetime tests. Original source resolution,
complete fields and strict external prepared-pixel validation remain invariants.
The broad F03/F06/F14, <=33 ms live-input p95 / <50 ms routine-task, sustained /
device/process-memory, float wet tools and every unfinished original roadmap
requirement remain open. No account, upload or paid call was introduced.
