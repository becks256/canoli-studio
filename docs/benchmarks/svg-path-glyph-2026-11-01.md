# Native baseline glyph decomposition — 2026-11-01

This private F08/F10 increment retains native curved baselines during
source-owned Float32 glyph paint. Full float TextLayer editing and the original
roadmap remain unfinished.
[Contract](../FLOAT_TEXT.md#native-baseline-glyph-paint-private).

| Verification | Result |
| --- | --- |
| Full build / TypeScript | Pass |
| Complete unit/API suite | 3,399 pass across 336 files |
| Complete affected native-browser run | 148 pass across twelve files |
| Production emitted components and typography | Twelve pass |
| New complete font/layout combinations | 84 exact matches: seven sources/instances, three alignments, identity/affine placement, original/reversed baselines |
| Reflected direction/path-end combinations | 18 exact matches: twelve RTL, six LTR; six entirely hidden lines publish no glyphs |
| Independent original-font Float32 runs | Twelve exact comparisons: ordinary/tight tracking, reflection, three alphas including 1e-8, HDR RGB and every 137px partition word |
| New measurement faults | Abort, removal and nonfinite metadata reject, retire probes and permit retry |
| Actual emitted baseline coverage | Original-font pixels and exact partition words under identity, affine and reflection, with a prepared fixture adapter |
| Ordinary 50 MP curved text | All 200,000,000 independent RGBA samples and complete PNG bytes match; original source/model retained |
| Separate 50 MP RAW/variable-font regression | Original 100,000,672-byte source, all 480,000 independent text-region samples and preceding accepted complete PNG bytes retained |

The source matrix covers original TTF, compressed WOFF2, CFF, explicit variable
axes, optical sources and complete pinned Manrope. Original glyph IDs, ligatures
and combining marks remain whole. Native character geometry supplies rotation,
cluster anchors and off-path visibility. Exact complete native/candidate ink at
alpha 1 and 0.5 gates publication. Source-linear RGB/alpha remain separate from
scalar coverage.

The first curve matrix matched 39/48 lines. Midpoint and matrix-only rotation
representations did not fix all native placement differences. Replaying original
baselines fixed several cases. An unfolded plain-text probe still lost native
textPath typographic itemization; a complete straight textPath probe now retains
it. Independent candidate SVG advances, native inline metadata and original GPOS
supply baseline replay. Center alignment retains half-unit positioning. The
checked native-unit projection follows the verified host's Float32/1/64 arithmetic;
other hosts may refuse a match. Reference pixels never fit coordinates/axes,
and alpha thresholds remain exact. Original failed cases remain in the matrix.

Derived baseline strings and SVG path definitions are shared across glyphs.
Private baseline/rotation data snapshot before awaits and require finite metadata
and SVG surfaces. Native measurement checks ownership between reads. Preparation
yields between bounded groups and checks distinct font owners. No sustained
all-tool or cross-device performance claim follows.

Independent Float32 references use the original unmodified Regular font in
separately rendered native single-glyph paths. Their phases follow the fixture's
known original advance/tracking, independently of selectors or fitted poses.
Actual WASM retains exact ordered alpha and signed/HDR RGB. Production tests run
the actual emitted baseline coverage module with prepared fixture fonts; source
ownership/itemization/matching is verified separately in the native source suite.

The ordinary 50 MP verifier decodes complete PNGs outside the browser and compares
every RGBA sample in bounded row groups with an independently authored complete
native SVG. Both PNGs have SHA-256
`37b7c867d90b2e2c81dfe4a38ac15864c59f8c496ed10139f26f51a159446c8a`.
This proves that ordinary byte regression, not full Float32 TextLayer authoring,
physical-device fidelity or universal extents. The separate RAW workflow's
independent reference remains limited to its 600 × 200 text region.

Full styled/bidi/script/font fallback, missing/intrinsic paint, vertical and
broader path layouts, universal native/legacy/optical extents and hosts, connected
float TextLayer scenes/tools/export/shared transport/persistence and every
unfinished original professional-editor/device/quality/performance requirement
remain required. Public models, sources, commands/Undo, isolated grants,
independent REST and ordinary native appearance retain their existing contracts.

[Compact source/release/raw-run/reference receipt](svg-path-glyph-2026-11-01.json.gz).
Large raw artifacts remain under `/tmp/canoli-svg-path-2026-11-01`; no benchmark
ZIP is committed.
