# Native float text — implementation in progress

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
Paint decomposition, intrinsic color-glyph sources and exact authored-alpha
composition still need an implementation. The float TextLayer/tool gates remain.

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

The preparation owner retains whole shaping chunks; the next required step is
a native paint decomposition that preserves those chunks and paint primitives. SVG typographic-character geometry is
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
