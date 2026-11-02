# Styled source-glyph paint — 2026-11-01

Status: private styled glyph dependency verified. The complete implementation-
roadmap goal remains active.

The private styled-line matcher keeps original spans, full UTF-16 shaping context,
source font glyph IDs and separate font/axis ownership. It selects original item
ranges, extending compatible ranges when exact native ink requires a retained
ligature or combining cluster. It does not rewrite source text or split it into
new character spans. Original captured linear colors supply working paint.

Complete native union alpha checks geometry. A separate per-color synthetic
red-times-alpha comparison checks paint ownership and occlusion order, including
overlapping glyphs whose union alpha alone cannot expose reordered colors. G/B
labels preserve captured color distinctions. These comparison planes never
supply authored colors, glyph IDs, coordinates or actual glyph coverage.

## Evidence and corrections

The focused matrix passes all 72 combinations of nine styled scenarios,
horizontal/vertical writing, straight/curved baselines and identity/affine
placement. Cases retain equivalent color spellings/spaces, ligatures, kerning,
combining marks, Arabic context across size changes, multiple original fonts and
different explicit variable-axis tuples. Every successful line has zero native
union-alpha and ownership error at both opacity samples, unchanged document data
and no remaining measurement probes or private glyph faces.

Twelve actual WASM Float32 composition runs independently paint the original
font glyph at separately verified poses. Every alpha/RGB value and partition
word matches, including signed/HDR RGB, colored overlap and alpha 1e-8. These
references verify coverage/composition; they do not independently discover native
positions. Negative controls reject reordered and recolored overlap while the
reordered union alpha still matches. Abort, release and malformed native reads
reject, retire temporary URLs and allow a healthy retry. A separate unit invariant
retains 10,000 distinct synthetic labels without altering source colors.

The initial matrix used a weight below its fixture's declared range; the fixture
input was corrected. An aggregate lifetime callback recursively checked its own
child fonts; separating parent checks from child checks fixes that ownership
error. Fourteen vertical styled variants then exposed native fragment line-top
rounding. Replaying the browser's rounding rule from complete source metadata on
its CSS 1/64 grid fixes all fourteen. No displacement is searched or fitted from
reference pixels. Extent, input-coordinate, selector-orientation and palette
experiments did not establish an alternative correction; their outputs remain
retained. A malformed-read pilot initially intercepted the 1×1 allocation probe;
the corrected harness targets the actual glyph read while retaining the same
rejection and cleanup assertions.

Full build/typecheck and all 3,406 unit/API tests across 338 files pass. All
fifteen production cases pass without retries, skips or flakes. The production
styled case exercises the actual emitted matcher, complete shaping worker and
native coverage/ownership with prepared source/plan fixture adapters. Complete
source capture and ownership run separately in the source browser matrix.

The first complete browser attempt omitted the established Vite configuration
for generated-worker symlinks. Worker requests were denied by the server before
font behavior could execute; that run was stopped and preserved. The corrected
complete source run passes all 196 cases across twenty files without retries,
skips or flakes. No runtime code or test assertions were changed to repair the
server invocation.

Independent Pillow decoding compares every RGBA sample in both complete ordinary
10,000 × 5,000 curved and vertical outputs against independently authored complete
native SVG references: 200 million samples each, zero channel error and identical
PNG files. The separate RAW/variable-font case preserves the exact 100,000,672-byte
original, its independent complete 600 × 200 text-reference region and preceding
accepted full PNG bytes. These ordinary byte regressions do not establish public
Float32 TextLayer or universal native-host support.

The [compact receipt](svg-styled-glyph-2026-11-01.json.gz) binds changed source,
the complete accepted release/generated manifests, twelve production artifact
checks, raw runs, failed/corrected pilot outputs and independent verifier code.
New raw ZIP evidence stays local and ignored.

## Remaining required scope

This dependency does not admit public Float32 TextLayer authoring, tool behavior,
scene/export/shared transport or persistence. Full native script/bidi/font
fallback, missing/intrinsic paint, broader layouts and native/legacy/optical
hosts/extents remain required. Current item selection greedily accepts the first
exact compatible prefix; the matrix does not prove universal native itemization.
Canonical native byte planes are not an independent high-precision color raster.
All unfinished original professional-editor, quality/device/performance and
other roadmap requirements remain active. Public model/history/grants,
original-resolution policy and separate REST/browser sessions are unchanged.
