# Native float text — implementation in progress

The private vertical source-glyph dependency is verified by 3,405 unit/API tests,
190 affected native-browser cases and fourteen production cases. Eight original
font matrices retain 576 complete layouts; 108 direction/reflection/path cases
and twenty-four independent Float32 coverage runs preserve exact native ink,
HDR/tiny alpha and every partition word. This remains private groundwork; the
float TextLayer/tool gates below still apply.
[Verification and limits](benchmarks/svg-vertical-glyph-2026-11-01.md).

TextLayer integration remains required for the full F08/F10 roadmap. Float
documents still reject text and the text tool remains unavailable. The private
color dependency below is implemented; it is not a public text-rendering API or
evidence that native float typography has shipped.

## Authored CSS color capture

`engine/float-text-color.ts` captures immutable working-linear Float32 RGBA
values from existing authored text-color strings. Exact hex sRGB values use the
shared transfer function. Other colors use the browser's relative CSS color
engine. Declared sRGB retains its encoded space until the shared transfer;
equivalent hex, named and byte-RGB colors agree. Wide-gamut and explicit linear
CSS values keep finite signed/HDR channels rather than being clipped to sRGB8.

Computed CSS strings have fewer significant digits than Float32. Separate
native residual reads recover the RGB and alpha components before final
Float32 storage; alpha residuals travel through an unclamped RGB channel.
No Canvas, glyph, display or proof pixels supply working RGB. A 1x1 Canvas is
used only to validate the same CSS style syntax as the existing text renderer.

The call snapshots requested strings, deduplicates colors, yields between
bounded groups of resolutions and returns frozen values. Abort, invalid CSS,
nonfinite values, missing browser capability or reentrant probe retirement
reject without partial output. The private DOM and validation Canvas retire on
success and failure. The source probe fixes its own light color context and
opts out of forced-color substitution; UI color modes do not rewrite artwork.
Non-hex colors require a browser supporting relative CSS colors. There is no
pixel/file/network capability, font permission or new public mutation surface.

## Source-owned native preparation

`captureStyledTextPlan` now prepares the original normalized native SVG chunks
before bitmap allocation. The existing styled-text rasterizer consumes the same
plan. It owns immutable source text/styles, complete embedded font definitions,
font leases, exact authored variable-font tuples and native line metrics. A
checked markup getter rejects after release; release is idempotent and retires the retained font
lease and measurement host. `retireMeasurement()` ends native measurement
after its consumer finishes preparation; source/font checks remain valid. The
ordinary rasterizer keeps measurement checked through bitmap publication and
retires it at the original boundary. Removing live model/history references does
not collect a retained plan's sources. Font registration/source changes, asset retirement and cancellation
invalidate it.

Private `captureLinearPaint: true` also captures the authored linear colors in
original line/span order and native addressable-character start/end/extent/
rotation metadata. Coordinates remain in each original SVG text element's local
space, before its line/path placement and the scene transform. These indices are
native addressable-character indices, not promised UTF-16 ranges, glyph IDs or
independently paintable clusters. Source text and span boundaries remain in the
scene. No new spans or grapheme splitting are introduced. All returned metadata
is frozen; nonfinite geometry or reentrant host retirement rejects and cleans up.

The ordinary byte renderer requests neither linear colors nor per-character
geometry. It therefore retains its existing browser requirements and avoids the
additional measurements. The preparation plan creates no image/bitmap. Existing
bitmap preparation still waits for SVG load/decode, checks sources through
publication and closes failed/cancelled bitmaps. This is a private renderer
boundary, with no new public constructor, mutation method or isolated grant.

This owner is required groundwork, not completed native float glyph painting.
Complete native text decomposition, intrinsic color-glyph sources and connected
Float32 composition still need integration. The float TextLayer/tool gates remain.

## Owned glyph selection and native float paint (private)

A captured text plan can now retain `captureGlyphFont(id,settings,control)` for
one of its captured original font files and `renderGlyphs(primitives,window,
processor,check)` for glyph resources owned by that plan. These are private
renderer operations, not scripting methods or a second document mutation API.
They consume already-resolved glyph IDs/poses; they do not discover native glyph
runs, perform fallback or replace whole-chunk shaping.

A separate small worker copies selected uncompressed TTF/OTF glyph, hint,
metric, variation and intrinsic paint tables. It adds collision-free private
Unicode selectors while retaining the original mappings that native hinting can
rely on. Already-resolved glyph paint retains GSUB/GPOS/GDEF for native hint/script
classification, and disables their declared features on the temporary face; originals remain unchanged in the source store, native
project and authored SVG. Complete retained-table bytes, mappings, selector IDs
and SFNT checksums validate before private native registration. Validation yields
between bounded groups. Original and derived faces have independent lifetimes;
private aliases never enter document data. Worker parsing shares the existing
single active font-job queue and cancellation/deadline boundary.

Monochrome glyphs now supply independent canonical native alpha coverage on the
fixed world lattice. Actual WASM composes their source-linear Float32 colors and
unquantized source alpha in paint order. Overlapping half-alpha glyphs reach
0.75 rather than a union-mask alpha of 0.5; two opaque-coveraged glyphs at source
alpha 1e-8 retain approximately 2e-8. Signed/HDR RGB never enters Canvas. Window
partitions retain exact output words. Parent/source/native-face retirement and
cancellation reject without publishing a field, and parent release retires its
child registrations.

This dependency accepts selected native TTF/OTF/WOFF/WOFF2 sources with supported
Unicode cmap formats 0/4/6/10/12/13. It explicitly rejects glyph zero, exhausted
private selector space and intrinsic color-font float paint. Existing font imports and ordinary rendering are not
restricted. Complete native fallback/glyph-run identification,
missing-glyph and intrinsic color painting remain required, together with the
connected float TextLayer tool/scene/export/transport/persistence acceptance.
The float document and tool gates remain in place. This is actual private
per-glyph float painting, not completed float typography.

## Source-font shaping and whole Canvas-run matching (private)

`NativeGlyphFont.shapeRun(input,control)` shapes one original-font item from
retained selected sources, with complete private SFNT decoding for compressed fonts. Inputs retain the entire original
UTF-16 text (existing 10,000-character budget), scalar-aligned `itemOffset` and
`itemLength`, direction `ltr`/`rtl`/`ttb`/`btt`, optional four-letter script,
language (default `und`) and global OpenType feature tag/value pairs. Omitted
range covers the remaining text; omitted direction is `ltr`. The captured
resource's exact explicit variation settings apply, with no byte conversion.
The full HarfBuzz 15.0.0 runtime preserves source vertical metrics. This performs
one source-font shaping run; browser bidi, script/language and font fallback
itemization remain separate required work.

Returned immutable metadata identifies original GIDs, original UTF-16 clusters,
unsafe flags and signed x/y advances/offsets in design units (1/64-unit shaping
precision). Glyph zero is explicit in shaping output; it is not paintable yet.
The disposable worker shares the single font-job queue, defaults to a 60-second
active time budget, transfers typed glyph rows and terminates before checked
cooperative host validation completes. Invalid font identity, nonfinite metrics,
invalid GIDs/clusters/order, malformed Unicode/ranges, retirement, cancellation
or timeout reject without publication. Parent glyph release aborts child jobs.
Snapshots precede awaits; original source leases survive model/history removal.

`plan.matchGlyphRun(font,input,control)` verifies a complete uniform Canvas run
using a font owned by that captured plan. Input supplies text, optional ltr/rtl
direction, script/language, existing character metric/feature properties and a
six-number affine transform (identity by default). Family and variation tuple
come from the retained font. Source-native exact variable instances stay pinned.
The matcher retains whole reference text, uses original GSUB/GPOS placements,
clusters and paint order, and compares the complete union of native/candidate
ink in fixed 256-pixel cells with two-pixel gutters. Native advance must agree
within the accumulated 1/64-design-unit rounding bound; every compared alpha
sample at opacity 1 and 0.5 must agree exactly. Auto kerning may test both native
kerning choices; nonzero tracking disables optional ligatures. Spaces use the
existing word-spacing request. Work yields and checks ownership between bounded
groups and tiles; document/font geometry is not capped by tile allocation.

Only `status:"matched"` returns immutable color-free glyph paint placements and
the source run. Its receipt records bounds, complete compared-pixel count,
advances, sampled opacities and maximum alpha error. Colors still come from the
authored source-linear color owner, never from those white verification pixels.
`mismatch` publishes its reason/evidence and no placements; `unavailable` does
the same for missing/fallback or intrinsic-color glyph requirements. Foreign
plan fonts reject. These are private renderer methods, with no public scripting,
REST, plugin, document-model or persistence contract change.

This is native uniform Canvas-run matching at the compared transform, not a
complete browser text shaper. Mixed bidi, script/fallback itemization, automatic
optical/broader CSS selection, compressed collection selection, glyph zero/intrinsic
paint, native SVG character/path/vertical layout and full text scene/controls/
interchange remain required. A mismatch cannot fall back to a byte-flattened
Float32 image. Full TextLayer/tool gates and broad roadmap acceptance remain.
Build pins, rebuild steps and licenses are in [the codec source](../src/fonts/codec/README.md).

## CSS-selected source font instances (private)

Whole Canvas matching now captures the native numeric weight, stretch and closest
owned face descriptor, including relative weights and descriptor-range clamping.
An authored numeric weight stays numeric: Canvas can serialize `639.75` as `639`
without actually discarding that fraction from rendering. Matching therefore
uses the original numeric request; relative/custom values use the resolved native
shorthand. Invalid native font shorthand rejects rather than inheriting a pooled
canvas's previous font. Frozen source descriptors and axis ranges cannot retarget
a captured source.

Private source-shaping input accepts optional `css:{weight,width,style,styleAxis?,opticalSize?}`
for an already selected native face request. Weight is finite in [1,1000], width
is a positive percentage and style is normal/italic/oblique. `styleAxis` may be
ital/slnt/none. Source-range clamps apply to wght/wdth and at most one automatic
style axis, then the original authored axis tuple overrides them. Unrelated
axes retain source defaults. `opticalSize`, when supplied, is finite and positive;
it applies only to an original opsz axis, with source-range clamping before
explicit settings. An omitted `css` preserves explicit-only shaping.
The returned run's `settings` records the effective merged coordinates; its
request, CSS metadata, descriptors and source-axis metadata are immutable.

The matcher checks supported ital/slnt and original-default modes against the
unchanged complete native run. This handles observed native differences when
both style axes exist, and declared faces whose automatic ital value is not
applied by the host. Only exact native ink/advance matching publishes paint
placements; it does not fit arbitrary axis values or change the requested font.
Explicit original settings win in every mode. This follows the separation of
native face selection, descriptor clamps and authored settings in
[CSS Fonts 4 variation resolution](https://www.w3.org/TR/css-fonts-4/#font-feature-resolution),
while recording actual browser results rather than assuming one native mapping.
The ordinary renderer, font registrations and authored appearance remain.

This resolves the private weight/width/style dependency for verified native
runs; full CSS/fallback itemization, native registration
behavior for every font/browser, complete collection/legacy cases and missing/intrinsic paint,
SVG/path/vertical matching and complete float TextLayer integration remain
required. In particular, this does not repair or promise automatic italic-axis
selection in the existing ordinary native host. Explicit authored ital remains
available through the existing variable-axis controls.

## Automatic optical sizing in the private Canvas matcher

The matcher captures the native font size in CSS pixels as `css.opticalSize`.
The original numeric size is retained before any await, including fractions
rounded by Canvas shorthand serialization. Source shaping applies it to an
existing opsz axis, clamps to that source's range and lets the original font's
avar/gvar/HVAR tables perform interpolation. No opsz axis is invented for fonts
without one. Omitted optical metadata preserves explicit-only/default behavior.
Explicit authored opsz wins; an unrelated authored axis keeps automatic opsz.

Affine canvas placement, viewport scale and device pixel ratio do not multiply
the captured font size. The requested optical coordinate and effective native
em size are separate. A private 880-byte original geometric font with exactly
one-em advance reads the latter through native text metadata before shaping;
it reads no source glyphs, artwork pixels or reference advances. This handles
platform size quantization without browser-name rules or fitted geometry. Its
native face and measurement Canvas retire on success, cancellation, timeout,
invalid metadata or registration tampering. Complete match evidence records
both original `fontSize` and measured `nativeFontSize`. Source-unit placements
use the native em size; glyph painting keeps the original native CSS request.
Private native glyph faces retain the same original automatic optical behavior
or explicit tuple as their source faces. Complete
native advance and ink at opacity 1 and 0.5 must still match before placements
are returned; a different host selection cannot silently publish a default or
fitted optical instance. Fonts and already returned run metadata remain owned
and immutable through later size requests, model/history removal and release.

[CSS Fonts 4 optical sizing](https://www.w3.org/TR/css-fonts-4/#font-optical-sizing-def)
allows hosts to consider other factors and specifies supported-range clamping.
Using the untransformed requested size matches the verified native Canvas host;
this is not a universal browser/device selection guarantee. The source-only
shaper's CSS metadata is internal, not a new authored optical-sizing property,
constructor, scripting method or plugin/REST grant. Ordinary native registration,
text appearance, source bytes, model and transport remain unchanged. Native SVG,
path/vertical matching, bidi/script/fallback, missing/intrinsic paint and full
float TextLayer authoring/scenes/export/shared transport/persistence remain.

## Complete compressed font preparation (private)

Captured glyph fonts now decode selected WOFF and WOFF2 to complete private SFNT
bytes before selector preparation. Public original/render font Blobs, source IDs,
authored mappings, document/font model, registrations and transport stay unchanged.
The original source lease, shared single font-job queue, 60-second active budget
and cancellation cover decoder work, host validation, native load and selector
preparation. Cancellation/error paths retire their workers without private faces;
release clears the private SFNT shaping cache and aborts child jobs. Subsequent
source shaping uses those checked complete cached bytes, with original layout/
variation tables; it does not decode or reread the compressed source on every run.
Uncompressed inputs retain the separate small SFNT-selector worker path.

WOFF1 uses native Deflate streams and complete table repacking. WOFF2 uses a
pinned full Google WOFF2 decoder with Brotli 1.2.1 in a self-contained disposable
WASM worker, including glyph/loca/hmtx transforms, composites and instructions.
The worker installs its first handler before async initialization. The stream
writer does not trust the advisory original-SFNT size and has no application
output-size tier. Existing upstream format/compression-ratio checks and actual
WASM/browser/native memory limits remain; no image import limit is introduced.

Before private registration the host checks original/decoded SHA-256 fingerprints,
complete source-directory correspondence, table bounds/overlap/lengths, per-table
and whole-SFNT checksums, original units/glyph count and unregistered native
loading. WOFF table checksums also bind to its original directory. WOFF2 glyf/loca
reconstruction may change byte lengths, so its advisory size is not treated as a
fixed output allocation. Checks yield between bounded groups and check lifetime
through publication. These are strict host format/native checks, not a claim that
a digest alone proves decompression correctness. Independent table/instruction/
outline/metric/native references verify the implemented decoder separately.

Source GSUB/GPOS/GDEF data must remain in temporary glyph faces: removing these
can change native hinting of glyphs not present in the original character map.
The private face disables each declared OpenType feature instead of discarding
those tables. All retained payload bytes still validate against checked SFNT
source bytes. A single-glyph substitution control verifies already-resolved paint
cannot reapply a source substitution. The isolated Manrope ligature failure and
its correction are consistent with FreeType's documented use of OpenType data to
classify unencoded glyphs for auto-hinting; this host's rasterizer internals were
not instrumented. [FreeType driver properties](https://freetype.org/freetype2/docs/reference/ft2-properties.html).

This adds selected compressed-source preparation and fixes that native hinting
dependency. It does not complete WOFF2 collection selection, every font/host/
legacy shaping case, native bidi/script/fallback/optical selection, missing or
intrinsic-color paint, SVG/path/vertical matching, connected float TextLayer or
broader performance/device/quality acceptance. [Rebuild pins, runtime, licenses
and actual limits](../src/fonts/decode-codec/README.md).

## Captured horizontal SVG lines (private)

`StyledTextPlan.matchGlyphLine(font,lineIndex,control)` connects a captured
uniform horizontal SVG line to its original-source glyph IDs and source-linear
colors. The font must belong to that plan and match the line's single owned
family/explicit axis instance. The plan must have requested `captureLinearPaint`.
Original chunks remain whole: no per-character tspan rewriting, bitmap RGB
flattening or document mutation is introduced. Native UTF-16 addressing must
cover the source exactly. Mixed styles, missing/fallback glyphs, intrinsic color and
unsupported addressing return unavailable. Uniform horizontal paths use the
baseline dependency below; vertical lines use the private vertical dependency.

Original HarfBuzz supplies glyph IDs and within-cluster offsets. Captured native
character metadata supplies cluster baselines, including native alignment and
RTL ligature ranges. Those metrics do not alone prove glyph paint. Source-owned
temporary SVG font definitions retain complete checked selector SFNT bytes,
original native hint/layout context and disabled resolved-glyph features. The
renderer compares the complete original SVG line against the complete candidate
at opacities 1 and 0.5 on fixed world cells before publishing any primitives.
The comparison domain includes both reported native and candidate SVG geometry; extra ink
outside the original text box cannot evade verification. Only scalar alpha is
read. Authored working RGB and alpha remain separately captured source values.

SVG caret rectangles can round positions differently from actual glyph paint.
Equivalent matrix/local-origin representations are checked without moving or
reshaping authored text. A separate screen-font projection uses original nominal
HarfBuzz advances, independently measured native advances and the backend's
font-size projection. The nominal worker request adds private `nominal?:boolean`,
default false: true returns cmap IDs/original horizontal advances in LTR source
order without substitutions/GPOS. The vertical companion adds TTB nominal
metrics; RTL/BTT nominal requests reject. Original
UTF-16 ranges, units, glyph identity, queue, deadline and transfer checks remain.
It is an internal metric operation, not a scripting or REST method.

The screen projection follows the font-size/position distinction documented in
[Chromium SVG font scaling](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/layout/svg/layout_svg_inline_text.cc)
and [SVG character queries](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/layout/svg/svg_text_query.cc).
It currently applies only to sources without opsz; optical sources retain the
native metadata representations. No coordinate/axis fitting from verification
pixels or relaxed pixel threshold is used. Other native hosts/projections may
refuse a match. Every mode still requires complete original SVG ink equality.

Matched private FloatGlyphs can retain a native SVG surface, local baseline and
computed paint font size independently of authored style. Canonical cell reads
produce per-glyph alpha; actual WASM composes source-linear Float32 color/alpha
in original paint order. The original source/style/model remains unchanged.
Source definitions cache only for the captured glyph owner's lifetime. Parent
release/abort interrupts queued/active glyph jobs, font encoding and image loads.
Temporary readers, images, object URLs, native faces and measurement hosts clean
up on success and failure; returned fields have independent storage.

This is a renderer bridge for verified captured source lines. It does not admit
float TextLayer or enable its tool. Full styled/bidi/script/font fallback,
missing/intrinsic paint, broader path/vertical layouts, complete scene/tool/export/shared
transport/persistence and all unfinished original acceptance gates remain.

## Native baseline glyph paint (private)

Captured uniform horizontal source lines can retain native path glyph rotation,
line placement, original/reversed/closed baselines, authored start/baseline offsets,
alignment, RTL ligature ranges and native off-path visibility. Source glyph IDs
and within-cluster positioning still come from the complete original font run.
Entirely hidden native path clusters supply no paint primitives. Character
metadata alone never authorizes publication: complete original/candidate ink at
opacities 1 and 0.5 must still match exactly.

Rounded path-caret positions do not recover every original paint transform.
Private `paint.pathCharacters` captures an additional whole-source straight
textPath with identical spans/fonts and native path itemization. Its returned
positions have left alignment in the native user plane; the original source
line, markup and native appearance remain intact. The additional probe is removed
before source serialization. The ordinary byte renderer requests neither this
probe nor other linear paint metadata.

`native-svg-path.ts` recovers native inline units from this metadata and measures
candidate SVG advances independently. Original glyph offsets and cluster advances
place each candidate on the original path; the native path backend supplies the
rotation and clipping. Center alignment retains half-unit placement. The checked
screen-font projection uses native 1/64 units and Float32 path arithmetic as
observed on the verified Chromium host. Other hosts or unsupported layouts may
refuse a match; every published candidate still requires exact full ink equality.
No coordinates or axes are fitted from verification pixels.

Private `FloatGlyph.rotation` carries finite native SVG degrees. Optional
`FloatGlyph.path` retains immutable derived SVG path data, startOffset and
baselineOffset; `origin` is then a local translation of that baseline glyph.
These values require `surface:"svg"` and snapshot before asynchronous work.
They are renderer data, not public path constructors or isolated mutation DTOs.
Baseline strings and serialized path definitions are shared across glyphs.
Preparation yields between bounded groups, checks each distinct font owner,
and retains source/parent/image/URL/measurement lifetimes throughout.

Seven source/instance fixtures currently pass 84 complete curve combinations,
including CFF, compressed/variable/optical sources and full Manrope. Eighteen
additional reflected RTL/closed/clipped cases and twelve actual Float32 runs
match independent original-font curve coverage at three alphas, including 1e-8,
with exact partition words. Fault checks cover abort, host removal and nonfinite
unfolded metadata. Full build/typecheck, 3,399 unit/API tests, 148 affected native
cases and twelve production cases pass. Independent external decoding matches
all 200,000,000 RGBA samples of the ordinary 50 MP curve regression, retaining
source identity and identical complete PNGs. This is ordinary byte acceptance,
not admitted Float32 TextLayer editing.
[Verification and remaining scope](benchmarks/svg-path-glyph-2026-11-01.md).

This dependency does not enable float TextLayer or its tool. Mixed styles, full
bidi/script/font fallback, missing/intrinsic paint, vertical layout, universal
native/legacy/optical extents and hosts, connected scene/tool/export/shared
transport/persistence and every unfinished original roadmap gate remain required.

## Required native paint work

The current ordinary renderer uses whole-line Canvas text; character-formatted,
path and vertical text use native whole-chunk SVG layout/rasterization with
owned font sources and preserved exact variable-font settings. Float integration
must retain those layouts, font identities, bidi, ligatures, marks, paths, vertical
writing, color glyphs and original paint order. Masks, clipping, styles, Fill,
native alpha, Undo and source-bearing scripting/REST/persistence must follow
the existing shared boundaries.

Native browser probes show that one opaque coverage field multiplied by a
color alpha cannot reproduce overlapping glyph paints: two overlapping M
glyphs at alpha 0.5 produce alpha 192/255 in the current native rasterizer.
Adding per-character opacity spans is also insufficient: tightly tracked Latin
and combining-mark cases can move or reshape ink, even when the all-visible
split looks unchanged. Those probes are design evidence, not a rendering
fallback. A byte whole-text RGB flatten or silent glyph-opacity substitution
must not be presented as the completed native float text path.

The preparation owner retains whole shaping chunks. Remaining native paint
decomposition must preserve those chunks and paint primitives. SVG typographic-character geometry is
defined by the [SVG 2 text specification](https://www.w3.org/TR/SVG/text.html);
actual browser behavior must be checked before relying on it for isolation.
Enhanced Canvas text-cluster APIs are not an assumed baseline. The complete
text integration, real controls/export, independent numerical/native references,
large-original workflows and broader photographic/device/performance gates
remain required. The original roadmap stays active.

## Color dependency verification (accepted at 3ebb0df)

Focused tests cover exact hex transfer, immutable requests/results, browser
capability errors, cancellation and reentrant cleanup. Real Chromium checks
cover exact direct-linear Float32 values (including +/-3e38 and alpha 1e-8),
precision lost by ordinary CSS serialization, sRGB aliases, wide-gamut signed
channels, no pixel readback, caller mutation, retry, dark UI and forced colors.
The full build/typecheck pass with 51 developer guides; all 3,357 unit/API
cases across 331 files pass. All four source-browser cases and the 390px
JavaScript-disabled production guide check pass. The initial browser pilot
exposed cross-channel matrix residue for named sRGB red; keeping declared
sRGB in its own space until the shared transfer fixes the issue without
widening the exact-color checks. The tested Chrome host does not expose the
text-cluster or cluster-paint APIs. [Findings](../docs/benchmarks/float-text-color-2026-11-01.md)
and [compact receipt](../docs/benchmarks/float-text-color-2026-11-01.json.gz)
retain the successful checks, failed pilot and glyph probes. No native glyph
or float TextLayer acceptance is claimed here.


## Native preparation verification (2026-11-01)

Full build/typecheck and all 3,357 unit/API cases across 331 files pass. One
complete final native run passes 137 cases across 11 files; four production
checks cover path/character/vertical workflows and the narrow no-JavaScript
guide. The six new cases verify exact source metadata, original shaping chunks,
font/source lifetime, cancellation/reentrant cleanup/retry and the ordinary
renderer's optional-work boundary. Independent decoding matches all RGBA samples
in both complete 50 MP path/vertical references. These large cases verify the
existing byte renderer after the refactor, not native float TextLayer support.
The first broad run exposed early measurement-DOM retirement; restoring the
existing publication boundary fixes the unchanged fault assertion. [Findings
and limitations](../docs/benchmarks/native-text-plan-2026-11-01.md) and
[compact receipt](../docs/benchmarks/native-text-plan-2026-11-01.json.gz) retain
successful runs, failed pilots, source/release identities and complete large
outputs. Full native glyph painting and the original roadmap remain required.


## Private glyph paint verification (2026-11-01)

Full build/typecheck, 3,366 unit/API cases across 332 files, one complete final
37-case source-browser run and four ordinary production regressions pass. Native
TTF/CFF/exact variable glyph pixels match the original in 18 size/affine cases.
Actual WASM retains signed HDR RGB, ordered overlap and alpha 1e-8, with exact
window partitions. Independent FontTools checks original glyph order, retained
source tables/maps and added selectors. Ownership, cleanup, cancellation, timeout
and retry are checked. [Findings and remaining scope](../docs/benchmarks/glyph-paint-2026-11-01.md)
and [compact receipt](../docs/benchmarks/glyph-paint-2026-11-01.json.gz) retain raw
runs, the failed/corrected worker-route harness and native cmap probes. This is
private resolved-glyph paint acceptance; full native text matching, missing and
intrinsic color glyphs, compressed preparation and float TextLayer integration
remain required. No 50 MP float text or universal font/performance claim follows.

## Original-font shaping verification (2026-11-01)

Full build/typecheck and all 3,374 unit/API cases across 333 files pass. Native
browser coverage passes 29 source/font/glyph/plan cases and ten existing variable
font workflows; five production checks include the emitted full shaping worker's
first message and existing path/character/vertical workflows. Sixty complete
Canvas runs match positioned original glyphs exactly across three sizes and two
transforms. An independent native HarfBuzz library matches all IDs/clusters/flags/
metrics in six runs. Actual WASM paint after matching retains exact ordered alpha,
signed HDR RGB, alpha 1e-8 and exact window partitions. Ownership, cancellation,
timeout, invalid output and explicit mismatches remain checked. The existing
50 MP byte workflow preserves the full original identity and matches every RGBA
sample in its complete 600 × 200 independent native text reference region.
[Findings and limitations](benchmarks/font-shaping-2026-11-01.md) and
[compact receipt](benchmarks/font-shaping-2026-11-01.json.gz) retain successful and
failed pilots. Full native layout/fallback/paint and connected float TextLayer,
large-original and remaining roadmap acceptance are still required.

## CSS font-instance verification (2026-11-01)

Full build/typecheck, 3,379 unit/API tests across 334 files, one complete 47-case
native run and six production checks pass. Thirty-six full native/static reference
comparisons match every RGBA sample and native advance across three sizes/two
transforms. Six additional native cases retain relative/fractional weights,
descriptor clamps and non-lattice authored settings with zero whole-run alpha
error and unchanged model/source data. Matched CSS glyphs retain ordered native
Float32 alpha, HDR RGB, alpha 1e-8 and exact partitions. The existing 50 MP byte
workflow retains its original identity and every sample in the complete independent
600 × 200 text reference region. [Findings and limitations](benchmarks/css-font-instance-2026-11-01.md)
and [compact receipt](benchmarks/css-font-instance-2026-11-01.json.gz) include
failed/corrected native-style and static-rounding probes. These results do not
close automatic optical sizing, universal native style/fallback behavior,
compressed/missing/intrinsic paint, full float TextLayer or the original roadmap.

## Complete compressed-font verification (2026-11-01)

Full build/typecheck, 3,392 unit/API tests across 335 files, one complete 66-case
native run and seven production checks pass. Independent FontTools references
verify 17 complete outputs, including four emitted production files: 587 glyphs,
140 composites and 9,810 glyph-instruction bytes, plus exact untransformed tables,
cmap and horizontal metrics. Seventy-two complete native runs match geometric
and full pinned compressed fonts. Source/cache lifetime, corruption/cancel/timeout/
retry and missing private-feature capability cannot publish partial fonts. Actual
Float32 paint retains ordered alpha, HDR RGB, alpha 1e-8 and exact window words.
The ordinary 50 MP byte workflow retains its complete source identity and every
sample in its independent 600 × 200 text reference region; its full PNG bytes
also match the preceding accepted release. [Findings and limitations](benchmarks/font-decode-2026-11-01.md)
and [compact receipt](benchmarks/font-decode-2026-11-01.json.gz) retain the failed
Manrope/precision/ligature trials, isolated diagnosis and corrected hint-table/
feature-control checks. Full native text/tool, collection/fallback/optical,
missing/intrinsic paint and remaining original roadmap acceptance stay required.

## Optical and native em-size verification (2026-11-01)

Full build/typecheck and 3,396 unit/API tests across 336 files pass. One complete
80-case affected native run and nine production checks pass. Sixteen independent
static FontTools instances verify exact outlines/metrics; 86 complete native
RGBA/advance pairs match across TTF/WOFF2, device scales 1/2, automatic/clamped/
fractional sizes, affine placement and explicit overrides. Hard fractional size
requests now match after independent native em capture, including TTF/CFF fonts
without optical axes. The emitted production matcher matches twelve complete
runs with prepared fixture sources. Probe faults cannot leak faces or publish
invalid metadata, and retry succeeds with Canvas pixel reads forbidden.
Actual WASM retains HDR/tiny-alpha paint and exact partition words. The ordinary
50 MP workflow retains its original identity, independent 600 × 200 text-region
pixels and preceding accepted PNG bytes; this is not full 50 MP/float acceptance.

[Findings and limits](benchmarks/optical-font-2026-11-01.md) and the
[compact raw-run/source/release/reference receipt](benchmarks/optical-font-2026-11-01.json.gz)
retain failed/corrected pilots. Full native typography, float TextLayer/tool
integration and all remaining original roadmap gates stay required.


## Native vertical glyph paint (private)

Captured uniform monochrome SVG lines can now use original source-font glyph
IDs for vertical-rl/vertical-lr, mixed/upright/sideways orientation and curved
baselines. This is a private renderer dependency, not public Float32 TextLayer
admission. Source text stays whole. Captured native rotations and resolved caret
directions form item ranges passed alongside the complete original UTF-16 context
to the original HarfBuzz source. Upright items use TTB/BTT; sideways items use
LTR/RTL. Paragraph direction alone is insufficient, including for upright Arabic
required substitutions. Original vert substitutions and GPOS remain authoritative.

The private successful match adds frozen `runs`, one source run per orientation/
direction item; `run` is its first entry for the existing private result shape.
Every glyph keeps the original GID, source owner, linear color and frozen native
writing/baseline metadata. Mixed/upright uses a central baseline; all-sideways uses
alphabetic. Independent candidate SVG caret origins remove the nominal native
origin once. Original path data, unfolded native path metadata, source offsets,
hidden-character metadata and candidate advances retain curved placement. An
equivalent origin/matrix or native-path representation can be selected only when
complete source/candidate union ink matches exactly at opacity 1 and 0.5. No
geometry is fitted from verification pixels. Mismatch/unavailable returns no paint.

Private nominal shaping now accepts LTR or TTB. TTB returns original cmap IDs,
vertical advances and negative vertical origins without GSUB/GPOS; RTL/BTT nominal
requests reject. Non-nominal TTB/BTT still run original source substitution and
positioning. The typed worker output remains version 1 with seven Float64 words
per glyph and existing GID/context/cluster-order/identity validation.

A private optional `nativeMetrics` request snapshots `{em,glyphs}`. Each unique
original `glyphId` has native horizontal/vertical advances, vertical origins and
bounds `{xBearing,yBearing,width,height}` in screen pixels. Finite, signed 16.16
representability, unique/in-range IDs and positive representable em are required.
Float32 pixels convert by truncation toward zero, matching the native integer
callback conversion. Original selected-face/variation font callbacks remain the
parent fallback; only captured GIDs override metrics. Complete original GSUB/GPOS
still executes, and output converts back to original source units. This request
is renderer-owned data, never third-party callback code or a new script grant.

`font.svgMetrics` privately accepts a final `{direction?:'ltr'|'ttb',native?:boolean}`
projection after the existing control argument (defaults LTR/false). Native mode
reads original hmtx/vmtx/VORG and independent Canvas metadata for the captured
selector font: horizontal half advance for x origin, VORG override/default if
present, otherwise native outline top plus original top bearing, or font ascent
when vmtx is absent. Missing vertical advance uses native font height. Bounds and
advance capture reads no artwork pixels. Table counts, lengths and GIDs validate;
original bytes do not change. These native metric choices follow the current
[Chromium shaping callbacks](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/fonts/shaping/harfbuzz_face.cc),
[vertical data](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/fonts/opentype/open_type_vertical_data.cc)
and [16.16 conversion](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/platform/fonts/skia/skia_text_metrics.h).
They remain guarded by native ink equality rather than a cross-platform promise.

Abort, source/parent release, deadline, invalid measurements and host removal
retire temporary resources before publication. Ordinary byte text does not request
these private fields or callback projections. Broader script/bidi/font-fallback/
missing/intrinsic paint, native/legacy/optical extents and hosts, and connected
Float32 TextLayer authoring/scenes/export/shared transport/persistence remain
required. VORG reader unit coverage alone does not establish native CFF/VORG
interop. Current browser/build/large-original acceptance is recorded in the dated
implementation log; do not infer universal font or device support.


## Native vertical glyph verification (2026-11-01)

Full build/typecheck, all 3,405 unit/API tests across 337 files, one complete
190-case affected native run across eighteen files and fourteen production
cases pass. Eight fonts cover original/no-substitution vertical data, TTF/CFF,
variable/optical sources, compressed fonts and complete pinned Manrope. All
576 line layouts and 108 direction/reflection/path variants match complete native
ink exactly. Independent original-font/FontTools coverage with actual WASM
preserves twenty-four HDR/tiny-alpha cases and every window-partition word.
Metric and origin faults clean up and support retry. The emitted vertical worker
and coverage module pass with prepared fixture adapters; complete ownership/
itemization/matching is separately verified in the source matrix.

Independent full-image decoding compares every RGBA sample in both complete
ordinary 50 MP curve/vertical references (200 million samples each), with zero
error. The separate RAW/variable-font workflow preserves the complete original,
exact 600 × 200 reference region and preceding accepted full PNG bytes. None
establish admitted Float32 TextLayer or universal native-font/device support.
[Findings and remaining scope](benchmarks/svg-vertical-glyph-2026-11-01.md) and
[compact source/release/raw-run/reference receipt](benchmarks/svg-vertical-glyph-2026-11-01.json.gz)
retain failed/corrected baseline, metric, path, direction and production-namespace
pilots. Full connected text/tool/scene/export/shared transport/persistence and
every unfinished original roadmap requirement remain active.
