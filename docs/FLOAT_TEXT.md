# Native float text — implementation in progress

## Complete rejected-paint verification

Review `5d21356` passes the complete 262-case canonical source suite across
48 files and all 57 selected production workflows across 17 files, with zero
skips, retries, unexpected or flaky results. All 4,036 frozen inputs remain
unchanged through the terminal source, production and seven-spec matrix runs.

The original 384-layout matrix now matches 364 layouts exactly, retaining every
prior 362 match, all original 352 matches and the earlier 44 colored matches.
CJK, marks and axes match 64/64 each; bidi and joining match 62/64 each; colored
matches 48/64. Two colored RTL affine curves with negative tracking newly match
in mixed and sideways orientations. Two mismatches and 18 matching-budget errors
remain. The matrix invocation therefore exits unsuccessfully; full native
acceptance and the broader roadmap are still open.

All 72 independent Float32 references pass in that same invocation. The audit
checks 2,318 matched glyph records and 1,406 complete original-text shaping
requests, retaining source font priority, axes, GIDs, colors and zero native
ink/ownership errors. Every cohort leaves the document unchanged and retires
its measurement probes and private font faces. This increases completed coverage;
it does not establish lower user latency or sustained editor-wide performance.

The separate corrected horizontal source invocation also passes all 259 cases
across 47 files with all 4,031 inputs unchanged. Its original 258/259 run and
representation-specific tracking assertion remain preserved. The replacement
assertion checks actual tracked original-source ink against zero tracking while
retaining every independent Float32, HDR/tiny-alpha, partition and font gate.
These are separate complete invocations, not a union of partial results.
[Terminal reports, exact inputs and audits](benchmarks/native-rejected-paint-terminal-2026-11-05.md).

## Rejected native paint reuse (private review)

One fallback matching operation retains a bounded LRU of exact ordered paint
identities that already failed complete ink or ownership verification. Font-owner
identity, geometry, styles, authored colors and paint order distinguish entries.
Every hit still checks the captured source, font owners and cancellation. Only a
previous rejection can be skipped; a published match still runs the complete
original ink and ownership gates. Keys and rejections retire with the operation.

The one-MiB key budget limits retained verification work, not document geometry,
source resolution or the number of candidate preparations. Larger keys bypass
the cache and keep normal verification. Key preparation yields between glyphs.
Public constructors, commands, schema, grants and independent REST contracts
retain their existing behavior. This review does not solve the remaining curved
source-placement differences or complete native/full-roadmap acceptance.
The isolated core passes `npm run build`, all 3,431 unit/API tests across
347 files, and 16 focused browser tests with zero skips/retries/flaky results.
Three new real-browser faults abort, release the plan or remove its captured
font on a rejection-cache hit: all withhold publication, retire resources and
permit a healthy original-source retry. All nine independent tracked Float32
outputs retain exact HDR/tiny-alpha values and partition words; actual original
source ink differs from its zero-tracking control in every case.

The unchanged original colored sideways diagnostic still reaches its 60-second
matching deadline. The implementation avoids 1,034 repeated renders and visits
138 distinct candidates, versus 38 in the uncached source. It publishes no result
and retires every private face/probe without changing the document. This measures
duplicate work, not a solved rendering case, lower user latency or editor-wide
performance. All 4,036 frozen core inputs remain unchanged through terminal checks.
The complete 262-case source suite, original 384-layout matrix, 57 selected
production workflows and broader roadmap acceptance remain required.
[Core reports, frozen inputs and diagnostics](benchmarks/native-rejected-paint-2026-11-05.md).

## Complete horizontal review and tracked-paint assertion correction

The complete original matrix at review `3c1fcfa` matches 362/384 layouts:
three mismatches and 19 matching-budget errors remain. CJK, marks and axes match
64/64 each, bidi 62/64, joining 62/64 and colored 46/64. Every prior 361 match,
original 352 match and 44 earlier colored match remains. The new exact control
is horizontal RTL affine joining with negative letter tracking.

All 72 independent Float32 references pass in the same seven-spec fallback
invocation. The audit checks 2,302 matched glyph metadata records and 1,398
original full-context requests, retaining font priority, axes, GIDs and colors,
with zero ink/ownership errors. All six cohorts retire probes/private faces
without changing the document. All 4,031 frozen inputs remain unchanged through
the original source and matrix invocations.

The original canonical source run passes 258/259 cases. Its one failure requires
nonzero private `paintLetterSpacing` for a mixed Arabic/Hebrew fixture, although
all nine independent Float32 outputs, HDR/tiny alpha and partitions already
match exactly. Tracking can also be encoded in retained positions. The corrected
test compares actual original-source ink with the otherwise identical zero-tracking
source and retains every numeric, original-font, invalid-input and partition gate.
Its fresh focused invocation passes all nine outputs and shows visible tracking
in every case. All 766 engine/source files remain unchanged. A complete corrected
259-case source invocation and main integration remain required; a combined green
source result is not inferred from separate runs. Twenty-two native layouts and
all unfinished broader roadmap gates remain required.
[Terminal reports, original assertion and visible-tracking reference](benchmarks/native-horizontal-terminal-2026-11-05.md).

## Horizontal script-aware source placement (private)

The original screen preparation remains available. An additional preparation
suppresses letter tracking inside cursive words while retaining authored space
tracking and word spacing. If a negative space starts the visual run, its complete
original native caret addresses supply the paint start before the following
source glyphs are placed. A shared horizontal paint address comes from an original
glyph in native visual order. Source text, GIDs, font priority, axis tuples and
linear colors remain intact; no comparison pixel fits a displacement. Complete
native ink at both opacity samples and per-color ownership still decide
publication. No constructor, command, schema, isolated/plugin grant or independent
REST boundary changes.

The isolated core passes build/typecheck, all 3,428 unit/API tests with four
workers, 72 native controls, 72 independent Float32 references and 57 selected
production workflows. The new workflows cover both directions with fallback and
single-font source text, exact opacity/Undo and original-bearing reopening.
The complete original joining cohort matches 62/64, retaining all 61 previous
matches. Its remaining vertical-curve cases are explicitly recorded, not waived.
All 4,031 frozen inputs remain unchanged through terminal core checks. The initial
review had 71/72 controls, 55 production workflows and 66 independent references;
its single-font failure and complete preimages are retained before the source-space
correction. A fresh worktree's initial TypeScript check lacked generated font
workers; the canonical build generated them and passed. Full 259-case canonical
source and original 384-layout matrix acceptance, main integration, and broader
public/host/device/memory/performance and complete-roadmap gates remain required.
[Core reports, source identities and diagnostic evidence](benchmarks/native-horizontal-origin-2026-11-05.md).

## Shared native source paint origin (private)

Complete original-span allocation now also covers a single authored span across
font items, preserving raw fragment advances before layout-unit conversion.
Existing per-cluster preparations remain available. A separate sideways
preparation retains the first captured source paint address and expresses the
unchanged relative glyph poses through affine translation. This keeps relative
offsets out of separate per-glyph SVG text-address grid conversions. All source text, font priority,
GIDs, axes and colors remain retained; no comparison pixel determines a pose.
Original whole ink at both opacity samples and per-color ownership still decide
publication. Private evidence identifies `nativeSharedOrigin`; public constructors,
commands, schema, isolated/plugin grants and independent REST contracts stay
unchanged.

The isolated core review passes build/typecheck, all 3,428 unit/API checks with
four workers, 56 native controls, all 64 original mark layouts, 60 independent
Float32 references and 53 production workflows, including the formerly failing
RTL sideways affine saved project. The initial unrestricted unit run had eight
timeouts, and the first reference invocation was interrupted by a Vite navigation;
both are retained with the successful unchanged-engine reruns. The new single-color
reference was also routed to the existing per-glyph overlap assertion; all 60
comparisons were exact before that fixture correction. All 4,030 final inputs
remain unchanged through the terminal reference rerun; earlier core identities
and the single test-file change are retained separately. Complete canonical
source and original 384-layout matrix reruns and broader public/host/device/
memory/performance and full-roadmap acceptance are still required.
[Core reports and diagnostic evidence](benchmarks/native-shared-origin-2026-11-05.md).

The complete review `f020fb1` now passes one canonical source invocation of
258 cases across 46 files, including the actual 48-reference source-parent test,
with zero retries, skips, flaky or unexpected results. Its original 384-layout
matrix finishes at 361 exact matches, three mismatches and 20 matching-budget
errors. Every prior 360 full-matrix match, original 352 match and 44 earlier
colored-cohort match remains. Cohorts are CJK 64/64, marks 64/64, bidi 62/64,
joining 61/64, axes 64/64 and colored 46/64. The last original mark control is
now exact; 23 native layouts and broader roadmap acceptance still require work.

All 60 independent fallback Float32 references pass in that same fallback
invocation. The audit checks 2,296 matched glyph metadata records and 1,395
original full-context requests, including font priority and axis tuples, with
zero ink/ownership errors. Every cohort retires probes/private faces without
model changes. All 4,030 frozen inputs remain unchanged through both terminal
runs. The newer horizontal development is separate and contributes no cases to
this aggregate. Main integration and broad public/host/device/memory/performance
and original roadmap gates remain required.
[Terminal reports and retention audit](benchmarks/native-shared-origin-terminal-2026-11-05.md).

## Correlated native position review — 2026-11-05 UTC

An additional private preparation rounds shaped and nominal positions together
in screen pixels, retaining original captured runs, complete font sources, GIDs,
axis tuples, text context and colors. Existing fractional preparations remain
necessary for identity-transform controls. Every preparation still requires
exact complete original ink at both opacity samples and exact color ownership.

The isolated review passes build/typecheck, all 3,428 unit/API checks, eight
existing styled upright controls, sixteen original mark controls with/without
owned fallback, 45 emitted production workflows and 48 independent fallback
Float32 references. Original 37 production workflows and all 42 earlier fallback
references remain. The complete 257-case source suite passes in one invocation.
The complete original matrix finishes at 360/384, with four mismatches and
20 matching-budget errors. All previous 352 full-matrix and 44 colored-cohort
matches remain. The 24 remaining layouts, full public/native/device/performance
and broader roadmap gates stay open.
[Terminal reports and retention audit](benchmarks/native-rounded-positions-terminal-2026-11-05.md). [Raw evidence, failed pilots and remaining gates](benchmarks/native-rounded-positions-2026-11-05.md).


## Vertical source-parent integration — 2026-11-05 UTC

A new private parent preparation retains original per-font advances and the first
native anchor when a cross-span Latin mark makes later SVG character addresses
unreliable. Complete text, original fonts/GIDs/axes and source colors remain;
exact original ink at both opacities and per-color ownership still decide
acceptance. A separate sixteen-plane operation-owned reference cache avoids
repeated source-image work while retaining every exact comparison and sample.

The identical isolated source passes build/typecheck, all 3,428 unit/API checks,
all four original upright identity controls and all 33 production workflows.
The four new production cases preserve native PNGs, isolated opacity changes,
exact Undo and original-bearing project reopening without development globals.
The complete 256-case affected source suite and all 36 independent paint references
also pass. The original colored cohort matches 42/64 layouts and retains every
prior cache match; 22 colored layouts still fail. Main integration `0a36bb8` also
passes build/typecheck, all 3,428 unit/API checks, all 33 production workflows and
the focused four-control browser regression. Its complete original main matrix
finishes at 352/384 exact matches; all 36 independent references pass. Affine and
full native/public/host/device/memory/performance and
broader roadmap acceptance remain open.
[Source, evidence and exact verification status](benchmarks/native-vertical-parent-integration-2026-11-05.md).

The separate signed-attachment review `bd15104` also passes both original upright
affine negative-tracking controls by retaining native zero-advance poses after
source/visual span placement. Canonical build, all 3,428 unit/API checks, eight
upright controls, 37 emitted production workflows and 42 independent Float32 paint
references pass. Its original colored cohort finishes at 44/64 and retains every
prior main colored match. Its source run passes 255 cases; the identical tracked
48-reference test omitted by a temporary filename alias also passes separately.
These are separate runs. Main integration also passes build/typecheck, all 3,428
unit/API checks, all 37 production workflows and the eight original colored
upright controls. Its one complete canonical source run now passes all 256 cases
across 46 files, including the 48-reference source-parent test in the same
invocation. Complete native acceptance stays open.
[Canonical source completion](benchmarks/native-signed-attachments-source-2026-11-05.md).
[Integration and exact boundaries](benchmarks/native-signed-attachments-integration-2026-11-05.md).

## Repeatable native-text acceptance

`npm run test:native-text` selects the canonical source regression, isolated legacy
checks, all 384 original fallback layouts and the expanded independent paint
references. Missing filenames fail discovery. A dedicated server belongs to the
tested checkout. `npm run test:native-text:source` selects the 257 source cases, including the new mark-control test;
the full fallback project remains an additional required acceptance gate with
known failures. Source coverage does not establish complete native typography.


The private original-script and complete styled paint-order dependencies are
verified by 3,415 unit/API tests across 341 files, 203 affected native-browser cases
across 24 files and fifteen production cases. All 96 mixed-script layouts and 64
styled bidi layouts match complete native ink; the styled cases also retain exact
per-color ownership. Nine independent colored bidi Float32 compositions retain
signed/HDR color, tiny alpha and every partition word. Prior original-font,
styled, vertical, path and complete ordinary 50 MP regressions also pass. This
remains private groundwork; float TextLayer/tool gates below still apply.
[Verification and limits](benchmarks/native-styled-bidi-2026-11-01.md).

Schema 60 now connects the existing TextLayer and Text tool to the main float
scene. This integration is under verification, with the earlier private native
results above serving as its dependency evidence. The exact public contract is
below; broad typography and the original roadmap remain unfinished.

## Connected TextLayer contract (schema 60, under verification)

Existing constructors and attached commands retain their options/defaults. Float
text requires each resolved style's first requested family to be a declared
FontFile backed by its complete original source in that document's AssetStore.
The Text tool stages bundled Manrope WOFF2 and admits its declaration and layer
in one ordinary transaction. Other fonts require explicit trusted embedding.
Unowned primary requests reject model admission/conversion atomically. Already
owned ordered fallbacks retain original priority; actual unowned/missing/intrinsic
or unmatched glyph paint rejects native capture, never substitutes partial output.

Native measurement preserves full character/paragraph/path/writing inputs and
world transforms. Every nonempty line passes complete original ink and per-color
ownership checks before source-linear glyph paint is retained. Empty lines retain
layout and paint transparent. Glyph coverage supplies scalar alpha only; finite
signed/HDR colors never traverse byte Canvas RGB. Existing masks, clipping,
fill/layer opacity, styles, shadows and group composition apply to native fields.
SDR display remains a final conversion. Trusted TIFF/PNG/PDF output uses the
native scene and retains its existing color/output contracts. Unsupported float
interchange remains an explicit rejection.

Renderer-owned preparations survive viewport requests and wrapper-only edits.
A 16-cell LRU retains canonical 256×256 Float32 RGBA cells (16 MiB of retained
pixel data), with caller-owned output copies. Preparation capacity defaults to
128 and never evicts pinned scenes. These are cache budgets, not image/document
limits or total process-memory bounds. A cancelled view releases its waiter;
owner clear/disposal aborts work and invalidates leases. Original sources, font
declarations and all private native registrations are checked even on pixel hits.
Private source/font checks stay separate from match deadlines and avoid recursive
glyph-owner callbacks.

Whole-layer and selected-character custom color fields retain full CSS strings.
Use explicit `color(srgb-linear r g b / a)` for source-linear values. Existing
10,000-unit text, typography/native preparation, script and transport budgets
remain; there is no new import-resolution/file-size limit. Invalid/contextual
colors, stale or missing sources, changed native registrations, unsupported glyph
paint, invalid native layout, deadline, cancellation and owner retirement reject
capture/delivery before output publication. Ordinary commands remain reversible;
a rendering failure does not silently rewrite or flatten authored text.

Scripts/plugins reuse declared FontFile.family through the existing OO surface,
private native-face preload, shared validation and one-Undo commit. No chooser,
source bytes, pixel renderer, file, network or new grant is exposed. Independent
REST supports the same data/ownership/history with estimated headless metrics;
it has no native text renderer or browser synchronization. Native project 5,
workspace, semantic recipe/package and history formats retain existing font-source
closure. Schema labels before 60 reject float TextLayers; valid older documents
migrate without changing typography. No new public layer class is introduced.

The isolated predecessor passed nine real browser cases, including actual Text
tool/native source SHA, Undo/Redo/project reopening, exact windows/cache lifetimes,
scripts/inert plugins/recipes/redo-only workspace, styled scenes and independently
composed original-font Float32 TIFF samples read by native libtiff. Ten focused
model/API cases pass after adding the schema gate. Warm isolated 64×48 cached
reads measured 1–1.4 ms on this host; this does not establish cold preparation or
editor-wide responsiveness. Main build/typecheck, all 3,427 unit/API tests, eleven focused browser cases
(including selected-character HDR editing and a genuine 50 MP edit window),
and twenty-one production cases pass. The complete affected 240-case source
regression also passes with zero skipped or flaky cases.
All 384 fallback layouts/36 independent references, curved/cross-span/default-
ignorable/missing/intrinsic/native/legacy/optical/host acceptance and every other
unfinished original roadmap gate remain required. Earlier sections below retain
private implementation history and its original narrower acceptance boundaries.

## Source-parent, authored-item and inherited-baseline preparation

The main engine now includes the source-derived parent stream, original authored
item selections, visual-span preparation and script-aware vertical spacing.
Original fonts, complete shaping text and glyph identities remain; only exact
complete native ink and per-color ownership can admit a candidate. Screen-size
native font metrics retain inherited central baselines across owned fallback
fonts. Straight vertical text also retains original-span allocation at zero
tracking, fixing colored CJK export without flattening or changing typography.

The baseline transfer passes main build/typecheck, all 3,427 unit/API checks,
nineteen focused browser cases and all 29 production workflows. The subsequent
common-preparation search priority retains every finite candidate and passes
main build/typecheck, all 3,428 unit/API checks, all 29 production workflows,
all 64 original CJK layouts and all 36 independent paint references. All 3,912
frozen main inputs remain unchanged through completion; browser runs have zero
skips or flakes. All 750 non-generated main source files match the isolated
implementation that passes the complete 255-case affected source suite. The
complete 384-layout target still has other failures, and all unfinished native/
public/host/device/performance and broader roadmap gates remain required.
[Implementation, failures and exact verification status](benchmarks/native-parent-baseline-2026-11-04.md).

## Original script and native direction items (private)

The curved original-span preparation retains native per-cluster allocation and
both source/screen layout grids for RTL parents. Joint whole-source assembly now
handles negatively tracked multi-span vertical paths with one owned font as well
as ordered owned fallback. Eight direction/affine/font-stack controls match exact
original ink and color ownership, and three independent affine Float32 references
match every output/partition word, including alpha 1e-8. Actual production source
capture, native PNG output, isolated opacity edits, one Undo and original-bearing
project reopening pass in both directions. All 243 affected main source cases
pass, with zero skipped/flaky cases and unchanged source inputs. Cross-span clusters, wider upright/Arabic/CJK/font/host cases and the
original 384/36 acceptance requirements remain open. No comparison-pixel fitting
or relaxed exact-ink check is introduced.
[Integration evidence and remaining gates](benchmarks/native-curved-integration-2026-11-04.md).

The horizontal SVG matcher now selects script and resolved-direction ranges
inside an existing original span. Every item retains the entire normalized line
as shaping context and selects an original UTF-16 range. It never creates new
character spans or changes authored text. Successful results expose all `runs`;
`run` remains the first run. Original font glyph IDs and captured source-linear
paint remain separate from native geometry and comparison pixels.

`native-text-items.ts` interprets whole-source caret metadata on original
grapheme boundaries, using unfolded metadata for curves. Native caret progression
selects direction; zero-width cases retain Unicode directional intent or resolved
neighbors. Unicode 17 script/extension sets and paired brackets select compatible
script ranges. Property lookup covers every code point, including declared
defaults; original sources, hashes, license and reproducible generation are in
`third_party/unicode-17` and `scripts/build-unicode-text.py`. This is a pinned
private dependency, not a claim to match every host's Unicode itemization.

A separate whole-source native probe removes negative spacing and curve
placement to recover visual order and resolved direction without clamped
rectangles. Its positions only rank original items; they never supply authored
glyph poses, IDs, source colors or actual coverage. Original fonts/tuples, text,
span boundaries and paragraph direction remain. The source caret/path geometry
still supplies paint coordinates. This avoids substituting paragraph direction
or logical item order for the host's resolved bidi paint order.

Native character rectangles can reorder the endpoints of negative tracked
advances. Signed original shaping advances and native caret geometry retain the
correct anchor. Cursive scripts follow the host's separate spacing handling.
Native visual order retains glyph order inside each original shaping run.
No position is searched or fitted from reference pixels. Exact complete
original/candidate ink at both opacity samples still guards publication;
mismatches return no glyph fields.

Private `FloatGlyph.paintLetterSpacing` retains SVG fragment allocation without
changing original font metrics, outlines or hinting. It defaults to zero and must
be finite and SVG-only; it is not document data or persisted state. Curved native
placement can require original tracking plus the original glyph's GPOS advance
difference. Candidate metrics are keyed by both original glyph ID and spacing,
because the same glyph can have different contextual allocation. Actual native
coverage and original path metadata remain authoritative.

The focused 96-layout matrix now matches every Latin/Hebrew/Arabic, paragraph-
direction, straight/curve, identity/affine and ordinary/negative-tracking case.
Nine independent original-font Float32 compositions match every alpha/RGB value
and partition word, including signed/HDR colors and alpha 1e-8. A Hebrew-only
control needs no tracked fragments; mixed-script and GPOS cases exercise the new
allocation. The reference uses independent FontTools glyph sources and literal
SVG at separately verified poses; it does not independently discover poses.
Three visual-probe faults (abort, removed host and nonfinite geometry) reject,
clean up and permit retry. Invalid paint spacing rejects before compositing.
Six focused pure units include independent property checks for all 1,114,112
Unicode code points, all 128 brackets and the existing 10,000-character budget.

Full build/typecheck, all 3,415 unit/API cases across 341 files and fifteen
production cases pass. The production path case includes nine transform/tracking
variants; it uses prepared source adapters and does not establish complete native
source capture. The complete affected 203-case source run across 24 files passes
without retries, skips or flakes. Independent readers compare every RGBA sample in both
complete ordinary 50 MP curve and vertical outputs against complete native SVG
references: 200 million samples each, zero error and identical PNGs. The separate
RAW regression retains its exact 100,000,672-byte original, complete 600 × 200
text-reference region and preceding accepted full PNG bytes. These are ordinary
byte regressions, not public Float32 TextLayer acceptance.

Earlier complete matrix attempts matched 55/96, 75/96, 90/96 and 94/96 before the
signed anchor, native visual ordering, tracked allocation and original GPOS
allocation corrections. Their failures and diagnostics remain retained; no
cases or exact-ink assertions were removed. An initial numerical fixture used
Hebrew letters where Arabic was intended: the passing Hebrew numerical control
is retained, and mixed Arabic/Hebrew and GPOS cases expand the final matrix to
nine. The current complete targets all remain required.

Owned fallback-font selection, broader mixed-bidi itemization and paint ordering,
intrinsic/missing paint, broader script/vertical/host itemization and connected
public Float32 text remain required. This private increment does not admit public
TextLayer authoring, scenes, export, shared transport or persistence.

The design follows the separate shaping-run properties described in the
[HarfBuzz manual](https://harfbuzz.github.io/text-runs.html), native character
geometry in [SVG 2](https://www.w3.org/TR/SVG/text.html), and the native rectangle
conventions visible in [Chromium's character queries](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/layout/svg/svg_text_query.cc).

## Cross-span native paint order (private)

Original UTF-16 source-cluster provenance travels with private SVG glyph
primitives through horizontal, path and vertical projections. It supplies no
position or color and is not public document data or persisted state. Complete
horizontal line assembly ranks original clusters using captured native visual
metadata, retaining shaped order inside a cluster and preserving ties. Missing
or out-of-range provenance and nonfinite ordering reject before publication.
Exact per-item and whole-line native ink plus per-color ownership remain required
at both opacity samples. Original spans, fonts/tuples, source colors and glyph
poses remain unchanged.

A native positional-range candidate handles path anchoring when summed advances
differ from the native extent. It uses original unfolded caret metadata, cached
only for immutable arrays; original negative fragment allocation and source
GPOS remain. It follows the range-based anchor rule in
[Chromium's SVG layout](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/layout/svg/svg_text_layout_algorithm.cc).
A mixed-font RTL negative curve reports advance 68 while its native unfolded
extent is 62. Using that extent resolves the remaining case exactly. No inverse
curve-distance or reference-pixel fitting supplies paint coordinates.

All 64 original color/font/size, Latin/Hebrew/Arabic/CJK, paragraph-direction,
straight/curved, identity/affine and ordinary/negative-tracking layouts retain
complete native ink and color ownership. Nine independent original-font colored
Float32 references retain exact alpha/RGB, overlapping colors, signed/HDR values,
alpha 1e-8 and every partition word. These references verify coverage/composition
at separately verified poses; they do not independently discover native poses.
The emitted production matcher also retains original source clusters and actual
native paint order in overlapping Latin and Hebrew cases, using prepared source
adapters. Complete capture/lifetime runs in the source browser matrix.

The initial diagnostic matched 40/64 layouts. The first asserted complete-line
ordering attempt matched 63/64; the remaining per-span curve already failed in
the baseline. Temporary diagnostic-only instrumentation retained original native
geometry and every projection error. An SVGPoint serialization error was fixed
in a separate diagnostic run. Geometry-only curve inversion was investigated
and not shipped. No target, exact-ink assertion or ownership gate was removed.
Full 3,415-unit/203-source/15-production/build and independent large-image checks
pass; [findings and compact evidence](benchmarks/native-styled-bidi-2026-11-01.md)
retain boundaries and corrections. Owned fallback, missing/intrinsic paint,
broader native itemization/hosts/extents, public Float32 text integration and all
unfinished original roadmap gates remain required.

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

## Styled source-glyph items (private)

`plan.matchStyledGlyphLine(lineIndex,control={})` can capture the original font
files/explicit tuples for existing styled spans and prepare private glyph fields.
It requires captured linear paint/character metadata and nonempty spans. Index,
positive integer time budget (default 60,000 ms), source ownership and native
measurements validate before publication. Missing owned sources, fallback stacks,
missing/intrinsic glyphs and unsupported native layouts return unavailable or
mismatch without partial fields. This is not a public scripting/REST method and
does not admit Float32 TextLayer/tool/scene/persistence.

Metric-style groups retain the complete normalized UTF-16 line as HarfBuzz
context and select original item ranges. The matcher starts with original span
boundaries and extends compatible ranges when exact native ink requires a
retained ligature or combining cluster. It never rewrites original DOM text or
introduces character spans. Existing horizontal, native-path and vertical
positioning consumes those source ranges; cluster-leading captured colors follow
the native paint owner. Different original font sources and explicit axis tuples
keep separate private owners. Original file bytes, public fonts and document data
remain intact. Successful results retain frozen `runs` and `glyphs`; `run` is the
first run. The complete line is checked again after item assembly.

Whole-line union alpha cannot verify a glyph's color or occlusion order. A
separate canonical comparison selects each distinct captured color: its R
component is white, other colors' R is black, and G/B carry distinct temporary
paint labels. The scalar red-byte-times-alpha-byte plane is compared exactly at
opacities 1 and 0.5 over the same complete source/candidate union. Ordinary alpha
comparison keeps those distinct labels too. Original spans remain in place; zero
scalar fill opacity hides unrelated source paint during item verification.
These synthetic comparison signals never supply glyph IDs, coordinates, actual
coverage fields, authored RGB or source alpha. Working colors still come from
the original CSS/linear capture; actual WASM composes independent original glyph
coverage. The oracle is native byte coverage, not an independent high-precision
color raster or universal native-host proof. Invalid native pixel-array type or
length rejects.

Native SVG paint and native carets differ at fragment boundaries: the browser
rounds each fragment's line top while painting. The private vertical companion
can recover the original fragment's CSS inline offset from whole-source native
metadata on its 1/64 grid, apply that rounding, and rotate the correction on a
curve. Publication still requires exact original ink and ownership equality. No
displacement is searched or fitted from reference pixels. The rule follows
[Chromium fragment painting](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/paint/text_fragment_painter.cc)
and [line-relative transforms](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/paint/line_relative_rect.cc).

Parent/deadline/observer checking remains separate from child-font checking:
children invoke the parent check, so including those same children in their own
parent callback would recurse. Aggregate checks validate all completed owners
between work steps. Abort, release, malformed reads and failed comparisons retire
temporary readers/images/URLs/probes and cannot publish partial fields. Full
native script/bidi/font fallback, missing/intrinsic/host/extents behavior, connected
Float32 TextLayer authoring/scenes/export/shared transport/persistence and all
unfinished original roadmap/device/quality/performance requirements remain.

The complete affected source run passes all 196 cases across twenty files and
the complete production run passes fifteen cases, without retries/skips/flakes.
All 3,406 unit/API tests across 338 files and full build/typecheck pass. The
72-case styled matrix, twelve independent original-font Float32 compositions,
ownership negative controls and fault/retry checks retain exact native coverage,
source colors and original data. Emitted production matching uses prepared
fixture source/plan adapters; complete source capture/ownership is verified in
the source matrix. Independent decoding retains all 200 million ordinary RGBA
samples each for curved and vertical 50 MP outputs, plus the separate RAW
original/complete text-reference region. These byte regressions do not establish
public Float32 TextLayer or universal host support.
[Findings and remaining scope](benchmarks/svg-styled-glyph-2026-11-01.md) and
[compact verification receipt](benchmarks/svg-styled-glyph-2026-11-01.json.gz)
retain failed/corrected pilots, raw results and source/release identities.

## Owned native fallback under verification (private)

The developing `matchStyledGlyphLine` path now assembles source-owned fonts
inside original spans. It walks authored family order, shapes complete original
native items with full UTF-16 context, and assigns supported complete clusters
to the first covering source. A missing glyph invalidates the entire shaped
cluster, including supported bases with missing combining marks. Remaining
ranges continue through the stack. Unknown families before a usable source and
uncovered/intrinsic glyphs return unavailable without partial paint; an unused
trailing generic can remain. This does not implement system-font discovery or
unowned/color/missing-glyph integration.

Each selected owner retains original source data and its effective clamped,
filtered fallback tuple. Only private preparation uses that tuple as its virtual
primary; original authored stacks, primary coordinates, colors and SVG chunks
remain unchanged. No character or font-range spans are inserted. Whole-source
script/bracket/direction resolution is reused and clipped by binary search,
without a complete text scan for every selected range.

Lazy candidates deliberately have no matched status. The ordinary single-source
entry points retain their exact native ink gate. Fallback assembly explores
coherent and independent original-item projections, reuses only byte-identical
paint candidates from the same owner, and validates complete native union ink at
opacities 1 and 0.5 plus canonical per-color ownership before publication. It
retains original within-cluster glyph order while checking captured native and
source-item paint ordering. Synthetic labels never supply actual RGB, alpha,
glyph identities or coordinates. Source/parent/font checks, iterator cleanup,
cooperative yields and the existing matching deadline remain required.

The first nine-case implementation pilot matched seven supported owned stacks
exactly and correctly withheld fields for unowned-first and missing emoji cases.
Independent FontTools fixture generation retains source glyph IDs/layout and
records narrower fallback variation ranges. Eleven coverage, source-priority,
complete-search and itemization unit checks pass. These are focused evidence,
not release acceptance. Expanded negative-tracking vertical tests exposed native
anchor, direction, clipping/orientation and inline rounding gaps. The current
extended eight-case pilot passes three and returns mismatches for five, without
partial fields. Full build/typecheck, all 3,422 unit/API checks across 343 files, and all fifteen
existing production regressions now pass. The complete 210-case source run is
still active. Its new durable-owner tests reproduce the matching-deadline leak
for both single-source and fallback fields; abort/release/decode/timeout cleanup,
healthy retry and font-stack priority cases pass. Independent Float32/large-
original acceptance for this developing change remains incomplete.

The native diagnostic confirms an unfolded path can hide a negatively tracked
cluster and report rotation zero; a translated diagnostic path restores its
metadata. The browser's
[SVG character-query implementation](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/layout/svg/svg_text_query.cc)
also explicitly returns zero geometry/orientation for hidden layout items.
Restored diagnostic coordinates are observations, not permission to fit poses
from pixels or substitute a rewritten text layout. Complete fallback and native
layout handling, durable owner lifetimes, all connected public Float32 text
controls/scenes/export/shared transport/persistence, and every unfinished
original roadmap gate remain required.

### Durable glyph ownership after matching

The developing styled/fallback matchers now end only their invocation deadline
when matching and iterator cleanup finish. Their retained source/font/parent,
registration and abort checks remain active for the captured plan's lifetime.
A prepared glyph owner must not expire merely because more than 60 seconds have
passed since the completed match. The fix awaits fallback completion before
retiring the outer deadline; it does not remove source observers or cancellation.

The complete pre-fix source regression finished with 208 passes and the two new
deadline failures. Both failures then pass with the fix in the workspace; all
seven source lifetime/cleanup/priority checks pass, including explicit abort
retirement after clock advancement. Typecheck passes. Existing production
coverage now additionally checks the emitted capture callbacks after advancing
the clock; all fifteen production regressions pass. Full acceptance remains
open for the broader fallback change, including vertical tracking and independent
Float32/large-original verification.

### Signed native path allocation under verification

Negative path preparation now additionally captures `paint.inlineAllocation` in
the original SVG/font context. Disposable complete-source probes retain original
spans and spacing, expose clipped clusters on a padded straight baseline, and
measure native start/end anchor separation. The padding follows measured native
source geometry; it is not a source-size limit. Original `pathCharacters` stay
separate because clamped character rectangles and signed typographic allocations
serve different purposes. Invalid reads, cancellation and host removal retire
both clones and their baseline definition before publication.

The private vertical candidate stream now also retains signed source/private
fragment allocation, half-grid native anchors and original zero-advance mark
attachment. A separate straight-inline candidate retains native RTL rounding.
Existing candidates remain available; every successful assembly still requires
the complete original ink and paint-ownership gates. Space counts are cached per
original cluster rather than rescanned for every attached glyph.

Before the shaping-scale/frame correction below, the actual captured-plan
negative mixed-vertical pilot matched seven of eight layouts exactly, compared
with three previously; the transformed RTL curve exceeded the full matching
budget. Four new browser tests pass,
including eight source-restoration controls and abort/removal/nonfinite cleanup;
typecheck passes. The first independent colored Float32 pilot also stopped on a
matching deadline before completing its comparisons. Its reference painter now
retains writing/baseline styles after assigning CSS, and records completed rows
incrementally for subsequent verification. No fallback acceptance or connected
public Float32 TextLayer is established. Full post-change regression and all
384 layout/36 independent-reference targets remain required.

### Independently measured native shaping scale (under verification)

The existing one-em raster-advance calibration is insufficient to recover native
GPOS scale at fractional transformed sizes. A second original CC0 calibration
font retains a one-em A advance and adds exactly one em to A+A through GPOS.
`captureNativeLayoutSize` measures kerned pair width minus unkerned pair width;
it neither reads source artwork nor fits coordinates to reference pixels. It
uses private registration, original host-state/abort/deadline checks and final
cleanup. The reproducible generator is
`scripts/build-native-layout-size-font.py`; the 944-byte font has SHA-256
`98c1d44caa15fa4a75d89e66f99a0304cfff3553462fda7a5fb6fca71ca3c72f`.
Native SVG metric projection uses this shaping scale while native source glyph
advance/bounds callbacks remain independently measured. The prior raster probe
and its non-native projection remain intact.

`native-svg-inline-frames.ts` assembles complete original single-span signed
layout advances across owned font items before rounding the inline frame.
Enclosed/clamped character rectangles cannot supply that signed allocation.
Existing placements remain available alongside the correction: the first
integration regression caught a previously matching straight RTL preparation
being displaced, so replacement of existing candidates was corrected. Both
variants require complete original ink and per-color ownership equality. Multiple
authored spans still need native parent allocation; the helper returns no guessed
per-span correction. Candidate deduplication retains allocation metadata, and
reversed source-item ordering uses the same selected corrected/original poses.

An independent FontTools reference empties every original Shaping outline except
GID8's combining mark, retaining byte-identical cmap/hmtx/vmtx/vhea/GSUB/GPOS/GDEF.
It observes actual native mark placement without using the renderer's glyph
preparation. Actual shaping WASM proves the independent calibration's one-em
pair adjustment. The corrected source browser run passes all 21 focused checks,
including four fractional mark sizes, all eight signed fallback controls, native
calibration cleanup, durable ownership and independent Float32 paint checks.
Fresh build/typecheck, all 3,424 unit/API tests across 344 files, fifteen existing
production checks and the separately selected emitted native metric/worker/
independent-mark check pass. The full 219-case source regression is active. This
does not establish the complete 384 layouts, 36 Float32 references, public text
authoring/scene/transport or full roadmap acceptance.

### Original straight-span allocation candidates (under verification)

Straight negative-tracking preparation additionally retains native physical
glyph advances and Float32 spacing for each original shaping fragment. The new
`native-svg-span-frames.ts` assembles complete authored spans before layout-unit
truncation. Per-cluster truncation can lose a layout unit at transformed sizes;
SVG character-query rectangles do not recover that allocation. An additional
RTL preparation retains an unrounded parent for a single cluster and signed
span extent for multiple clusters. These are candidate states with no publication
authority: complete original ink and per-color ownership must still match.
Existing raw/single-span preparations remain available. Original DOM spans,
source fonts/tuples, glyph IDs, styles and linear color stay intact. Cross-span
clusters and paths retain other preparations; their full acceptance remains open.

The actual captured-plan regression matches all eight single-font/fallback,
LTR/RTL and identity/affine controls, preserving source priority, complete original
contexts and colored ownership. Four real-font cancellation, missing-spacing,
nonfinite and incomplete-coverage tests withhold partial fields and permit retry.
The full focused source run passes 22 tests; the four assembly checks pass
separately. Twelve independent FontTools/actual-WASM Float32 controls cover both
directions and affine states at three alpha values, including tiny alpha. Every
alpha/RGB result and window word matches exactly with nonzero colored overlap.
These tests are retained in the repository. A fresh full build/typecheck, all
3,424 unit/API tests across 344 files and all seventeen production checks pass.
Production includes the actual emitted span matcher/metrics/shaping worker with
prepared original-font adapters and independent original native SVG spans in
four direction/affine controls. The expanded 225-test source regression completed
with all 225 passing, zero skipped and zero flaky cases. This includes the
ordinary 50 MP native text workflows and the original-bearing RAW regression.
The preceding sizing/frame integration completed all 219 source tests, zero
skipped/flaky, including its 50 MP vertical workflow; it is pre-span-change evidence.
All original 384-layout/36-reference targets and connected public Float32 text
authoring, complete scenes/transport and the full roadmap remain required.

### Initial connected authoring prototype (predecessor evidence)

An isolated copy now connects the existing OO TextLayer to native linear scene
paint, including a Text tool that retains the bundled original Manrope font in
the same undoable transaction. A real browser check verifies source identity,
layer/font Undo and Redo, editable signed/HDR color, and native-project save and
reopen. A separate browser check independently composes original-font glyph
coverage in Float32 and matches every output alpha with unchanged authored
geometry. The corrected reference has zero alpha error; this run also has
identical byte-projected alpha. An earlier run recorded two one-byte overlap
differences, retained for investigation rather than classified as accepted
precision behavior. No tolerance replaces the exact matching/reference gates. A scene test also preserves
every Float32 word across window partitions and preparation reuse.

These three passing prototype cases do not establish product integration,
complete scene/style/export/transport behavior, durable cache ownership,
responsiveness or full native fallback acceptance. The prototype lives outside
product source at `/tmp/canoli-float-text-authoring-2026-11-02/`. At that stage
main still rejected public float text; subsequent schema-60 integration is
described above. All original acceptance targets remain required.

### 2026-11-02 connected integration verification update

The main build/typecheck passes. All 3,427 unit/API cases across 346 files pass,
and all eleven new native browser workflow cases pass. The latter include the
actual selected-character HDR Inspector workflow, the tested scripting-guide
example, inert plugins/recipes/redo-only workspace, styled scenes and exact native
TIFF samples. The genuine 50 MP original retains its complete source and 10000×5000
geometry; all 16,384 edited-window words match independent original-font Canvas
coverage composed over the native base, with exact Undo/Redo. This is window
acceptance, not a full 50 MP rendered-output or process-memory claim.

The first full unit run had one obsolete blanket-text-rejection error assertion;
the corrected complete rerun passes. Equivalent legacy isolation assertions now
check the missing-original-font error while retaining atomic rollback. The first
production run passes twenty cases, including the actual new Text tool/source/
HDR/Undo/project/native TIFF flow and existing vector regressions. Its sole failure
is the old guide assertion that float text is unavailable; the assertion now
checks schema 60, original source ownership and the remaining full native gates.
The corrected production run and complete affected source regression are pending.
The failed discovery run, failure logs, corrected runs and exact snapshots remain
at `/tmp/canoli-float-text-integration-2026-11-02/`. No release sealing, full native
fallback/typography or roadmap completion is claimed.

Corrected production verification: all twenty-one cases pass, with zero skipped
or flaky cases. The new Text tool/HDR/native-source/Undo/project/native TIFF flow
runs without development globals; the no-JavaScript guide now verifies current
schema-60 ownership and unfinished native acceptance. Actual test discovery and
the live browser-run header confirm 240 affected source cases across 38 files,
including all 225 preceding native cases, eleven connected workflows and four
legacy isolated atomic-refusal cases. That run is active, not yet a passing
result. Source, tests and scripts are frozen for it. No full fallback release,
final acceptance/sealing/commit or roadmap completion is claimed.

### 2026-11-02 terminal checkpoint and remaining curved failures

The full affected source regression is terminal: all 240 cases across 38 files
pass, zero skipped and zero flaky, in 28.7 minutes. All earlier 225 native cases,
eleven connected workflows and four legacy isolation checks remain selected.
Build/typecheck, all 3,427 unit/API checks across 346 files, the eleven focused
browser cases and all twenty-one production cases pass. A source-hash audit
confirms no engine/test/script drift during the complete run. These results form
a development checkpoint, not complete F08/F10 or roadmap acceptance.

Further isolated curved-span work retains raw native fragment advances before
whole-span rounding, complete original text/font context and the exact ink/color
ownership gates. It still passes only six of eight original controls. Retaining
each authored span as a separate source selection also leaves both transformed
RTL controls failing the real 60-second matching budget. These experiments are
not product code. Native paint isolation locates the single-font discrepancy in
the first `AV ` span; the combining-mark and final spans match independently.
Chromium paint-command traces expose a different internal paint origin. This is
diagnostic evidence, not permission to fit coordinates from pixel differences.
Plain/positive-spacing controls and current Chromium source consultation do not
yet establish the correct native parent-allocation rule. All original 384-layout/
36-reference targets and broader native/public/font/host/performance acceptance
remain. [Checkpoint findings and exact evidence](../docs/benchmarks/native-float-text-2026-11-02.md).
