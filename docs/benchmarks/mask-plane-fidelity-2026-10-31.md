# Retained mask-grid and render-frame fidelity — 2026-10-31

This records a verified schema-56 implementation increment against baseline
`7ef37e7`. It does not complete F03/F06/F14 or the full implementation roadmap.
The [current contract](../MASK_PLANES.md) describes constructors, defaults,
errors, phase ordering and remaining acceptance.

| Check                                        | Observed result                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Complete unit/API/native run                 | 3,216 passed, 312 files, two workers; unchanged existing timeouts                                              |
| Complete relevant browser run                | 227 passed, 27 files; zero skips, retries, flakes or runner errors; 1,290.2 seconds                            |
| Production UI                                | Relink, Brush, default Mixer, Undo/Redo, PNG and original-bearing project reopening pass without debug globals |
| Initial wet-grid probes                      | Ten legacy cases pass; both new high-frequency cases fail all 96 samples                                       |
| Corrected wet-grid probes                    | All 12 pass; every prepared value retained on a fresh mask and after a legacy wet prefix                       |
| Inert metadata                               | Zero-opacity mapped Brush/Wet entries leave subsequent legacy reconstruction bit exact                         |
| Initial expanded scoped run                  | 16 pass; three native filter root/document/both cases fail                                                     |
| Corrected scoped probes                      | All eight retained ordinary/filter frame cases pass; full matrix includes all legacy/retained scoped cases     |
| Actual SVG and layered Photoshop round trips | Zero RGBA differences for ordinary, native-filter and document-filter planes; explicit baked-coverage reports  |
| Geometry-only float source                   | Byte wet editing and reopening preserve all 190,816 TIFF bytes at 131x79; display-only thumbnail remains 96x58 |
| Strengthened byte check                      | Focused rerun verifies equal byte lengths and every original byte                                              |
| Source stability                             | Full-run source fingerprints unchanged; kernel and application assets recorded                                 |

The wet defect came from reconstructing finer prepared coverage through a
logical-size bitmap. A positive mapped entry now starts replay on the retained
native grid, while a preceding legacy wet composition stays unchanged. Whole
replacement color/alpha and independent removal coverage still travel together;
external PNG dimensions/premasking checks and source lifetimes remain strict.
Zero-opacity metadata does not select another reconstruction.

The frame defect affected independent native filter masks under external render
frames. Document mask placement must precede the inverse physical owner pose;
linked native masks cancel their owner placement. Original document/root frames
now travel with the model owner through intrinsic rendering and cache signatures.

The first production probe used the Brush canvas box after switching to Mixer.
Tool options had moved the canvas vertically by 48.5 pixels. Reading its current
box fixes the test and preserves default Mixer settings. This is not a claim
that product layout or camera behavior changed.

The evidence root is `/tmp/canoli-mask-planes-2026-10-31`. Compact
`mask-plane-fidelity-2026-10-31.json.gz` retains reports, raw outputs, source
fingerprints and earlier failures/observations. The full browser runner uses
`playwright.full.config.ts`; normal production uses `playwright.production.config.ts`.
Source builds use Node 26.13.0. The original accepted `dist` target remains
preserved. No push was performed, and raw ZIP benchmarks remain local/ignored.

Remaining work includes retained-plane source swapping, specific copy/recipe /
workspace ownership, wider owner/master/pose/all-kind editing, broader float /
horizon/cache/resource behavior and photographic/physical-device/sustained-memory
acceptance. General warp, native float wet tools and the full original roadmap
remain active. These are correctness/functional results: no speedup, 60 fps,
all-tool performance or regression clearance is claimed. The original <=33 ms
live-input p95 and <50 ms routine-task requirements remain.
