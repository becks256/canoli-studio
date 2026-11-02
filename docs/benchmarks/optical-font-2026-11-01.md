# Private optical sizing and effective native em size — 2026-11-01

This F08/F10 increment connects automatic optical size to selected-source
shaping and captures native platform em size independently of authored glyphs.
It retains complete native matching before paint publication. Full float
TextLayer authoring and the original roadmap remain unfinished.
[Contract and remaining scope](../FLOAT_TEXT.md#automatic-optical-sizing-in-the-private-canvas-matcher).

| Verification                                              | Result                                                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full build / TypeScript                                   | Pass                                                                                                                                                         |
| Complete unit/API suite                                   | 3,396 pass across 336 files                                                                                                                                  |
| One full affected native-browser run                      | 80 pass across eight files                                                                                                                                   |
| Production emitted worker/matcher and existing typography | Nine pass                                                                                                                                                    |
| Independent static FontTools references                   | 16 complete instances pass exact geometric, metric and identity checks                                                                                       |
| Complete compressed optical source                        | Original avar/gvar/HVAR and untransformed tables, cmap, metrics and all three glyphs match independent FontTools decoding                                    |
| Independent native RGBA/advance comparisons               | 86 exact complete-run pairs across TTF/WOFF2, device scales 1/2, affine/identity placement, automatic sizes, range clamps and overrides                      |
| Emitted complete production matcher                       | 12 complete native matches, including hard fractional sizes, with prepared source/glyph fixture fonts and the actual emitted shaping worker                  |
| Actual Float32 WASM paint                                 | Exact independently computed ordered alpha, signed HDR RGB, alpha 1e-8 and window words                                                                      |
| Probe faults and lifecycle                                | Abort, timeout, descriptor tampering, removal and nonfinite metadata clean up and permit retry; reads of Canvas pixels are forbidden throughout these checks |
| Existing 50 MP RAW/variable-font regression               | Original identity/dimensions retained; all 480,000 RGBA samples in the independent 600 × 200 text region match; full PNG bytes match the accepted parent     |

The original geometric fixture has opsz/wght axes, nonidentity optical avar,
outline deltas and HVAR metrics. Complete static instances retain an exact
integer lattice, avoiding reference instancing rounding. Native comparisons
cover 4–96 px requests, a fractional 13.5 px request, two transforms and two
device pixel ratios. Explicit opsz wins over automatic sizing; an unrelated wght
tuple retains automatic opsz. Captured settings/requests remain immutable and
later sizes remain valid after source model/history removal. A wrong instance
returns no placements. Ordinary registrations, authored sources/model/history
and public contracts are unchanged.

The first native pilot reproduced the old default-opsz mismatch. Adding the
requested optical coordinate fixed it. A later 13.64123012345 px request exposed
a different advance failure, also observable with independent static fonts.
The host's effective em size differs from the requested size; it is now measured
with an original 880-byte one-em font, without artwork pixels, source-glyph
advance fitting, browser-name assumptions or expanded matching tolerances.
Complete native matches now cover 13.625, 13.64123012345 and 40.123456789 px,
including TTF/CFF sources without optical axes. The original requested size
still supplies opsz and the native paint request; the measured em size supplies
source-unit placement. Both are retained in match evidence.

The initial probe-fault pilot also exposed a blank-pixel allocation read in the
shared readback Canvas helper. The metadata-only probe now uses a non-readback
Canvas; no pixel read is needed. Its temporary loaded face and Canvas retire on
success/failure, and late font loading after timeout cannot publish a face.
Failed/corrected raw runs are retained in the compact receipt.

Production verification executes the actual emitted matcher and its one-em
capture with a prepared fixture font adapter, plus first-message optical
shaping against independent static metrics. Full source/parent ownership is
verified by the source browser matrix. This component verification does not
establish admitted float TextLayer editing or complete production text plumbing.

Full native/legacy/font/collection/CSS and bidi/script/fallback coverage,
missing/intrinsic paint, SVG/path/vertical matching, connected float TextLayer
authoring/scenes/export/shared transport/persistence and every unfinished
original professional-editor/device/quality/performance gate remain required.
No universal browser optical-selection, full 50 MP pixel, photographic quality
or sustained editor-wide responsiveness claim is made.

[Compact source/release/raw-run/reference receipt](optical-font-2026-11-01.json.gz).
Large local evidence remains under `/tmp/canoli-optical-font-2026-11-01`;
no raw benchmark ZIP is committed.
