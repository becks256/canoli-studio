# Original script and native direction items — 2026-11-01

Status: private script/direction and tracked native fragment dependency verified. The full implementation-roadmap goal
remains active.

The private matcher retains original UTF-16 context and existing spans while
selecting source-font script/direction runs. Unicode 17.0.0 Script,
Script_Extensions, bidi classes and paired brackets are checksum-pinned, licensed
and generated offline. Independent units compare every one of 1,114,112 code
points and all 128 brackets against complete original property sources. Native
whole-source metadata resolves visual order and direction; it does not supply
original glyph IDs, source colors or authored paint coordinates.

Negative tracking can clamp native character rectangles and reverse their
endpoints. Signed original advances select the correct caret anchor. A separate
whole-source probe removes tracking and curve placement to recover native visual
ranking only. Original native geometry, complete original font sources and
HarfBuzz runs still supply poses and glyph identities. Original spans and
paragraph direction remain intact; glyph order within each shaped run remains.

Private SVG fragment spacing retains original outlines, metrics and hinting.
Curved placement uses original tracking and, when needed, original contextual
GPOS advance differences. Candidate advance allocation is keyed by original
GID and spacing. Complete native/candidate ink equality at opacity 1 and 0.5
still guards publication. No displacement or position is fitted from pixels.

The focused original-source matrix matches all 96 combinations of six texts,
two paragraph directions, straight/curved paths, identity/affine transforms and
ordinary/extreme-negative tracking. It covers Latin, Hebrew, Arabic, combining
marks, ligatures and kerning. Full source contexts, unchanged model data and
complete probe/private-face cleanup are verified.

Nine actual WASM Float32 composition runs match every alpha/RGB value and every
137-pixel partition word, including signed/HDR RGB and alpha 1e-8. An independent
FontTools selector font and independently authored literal SVG supply reference
coverage at separately verified poses. These checks prove coverage/composition,
not independent pose discovery. A Hebrew-only control retains zero tracked
fragments; mixed Arabic/Hebrew and GPOS cases exercise tracked allocation.
Invalid nonfinite/non-SVG spacing rejects before any compositor call. Three
native visual-probe faults (abort, removed host, nonfinite geometry) reject
without publication, retire probes/faces and permit a healthy retry.

Earlier complete matrix attempts matched 55, 75, 90 and 94 of the same 96 targets.
Signed anchors, native visual ordering, tracked fragment allocation and original
GPOS allocation respectively resolve the remaining failures. No targets or exact
ink assertions were removed. Diagnostic-only runs retain geometry, image and
canonical sampling observations; they are not feature acceptance. An initial
numerical fixture used Hebrew where Arabic was intended: its passing numerical
control remains, and intended mixed-script/GPOS cases expand the final matrix to
nine. Failed/corrected reports and exact source/configuration snapshots remain
retained. The generated shaping-worker source remains identical to the accepted
parent: 1,398,165 bytes. An earlier emitted/minified size referred to a different
artifact and does not establish source drift.

Full build/typecheck and all 3,412 unit/API tests across 340 files pass. Fifteen
production cases pass with no retries/skips/flakes. The production path case
covers nine identity/affine/reflection and zero/negative-tracking combinations
using the actual emitted coverage code. Production source adapters are prepared
fixtures; complete native source capture and lifetime checks run separately in
the source browser matrix.

One complete affected source run passes all 201 cases across 22 files, with no
retries, skips or flakes. Prior 72 styled layouts/twelve independent styled
Float32 cases, 576 vertical-font layouts, 108 vertical direction cases and
24 vertical Float32 cases remain exact. New source-capture, 96-layout, numerical,
invalid-placement and fault/retry checks all run in this same complete pass.

Independent Pillow readers compare every RGBA sample in both complete ordinary
10,000 × 5,000 curve and vertical outputs against independently authored complete
native SVG references: 200 million samples each, zero channel error and identical
PNG files. The separate RAW/variable-font case retains the exact 100,000,672-byte
original, complete independent 600 × 200 reference region and preceding accepted
full PNG bytes. These remain ordinary byte regressions and do not establish
public Float32 TextLayer or universal native-host support.

The [compact receipt](native-text-items-2026-11-01.json.gz) binds changed source, immutable accepted release/generated
manifests, twelve production artifact checks, original property source hashes,
raw runs, failed/corrected diagnostics and independent verifier code. New raw
benchmark ZIPs remain local and ignored.

Owned font fallback, cross-span mixed-bidi colored paint ordering, missing and
intrinsic paint, wider scripts/layouts/vertical/native/legacy/optical hosts and
extents remain required. Public Float32 TextLayer authoring, tools, scene/export,
shared transport and persistence remain unavailable. This dependency does not
establish full F08/F10, universal native itemization or sustained device
performance. All unfinished original professional-editor, provider, live identity,
commercial, quality/device/performance and other roadmap gates remain active.
Public model/schema/history/grants, source-resolution policy and separate
REST/browser session contracts are unchanged.
