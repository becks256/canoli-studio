# Retained mask planes (schema 56)

This is the implemented schema-56 contract. Broader F03/F06/F14 release acceptance remains pending.
Mask link/unlink on projected artwork retains the original mask rasterization
lattice, geometry and placement. It does not bake current pixels into a bitmap
or approximate a projected cubic with another cubic. The broader F03/F06/F14,
float wet-tool and professional-editor roadmap remain open.

## Values and commands

`MaskPlane` is an immutable constructor value exported alongside `LayerMask`:

```ts
const plane = new MaskPlane({
  reference: { assetId: originalAssetId },
  basis: new AffineTransform(),
  pose: {
    width: 100, height: 80,
    perspective: new PerspectiveTransform({
      corners: [{x:0,y:0},{x:1,y:0},{x:.8,y:1},{x:.1,y:1}],
    }),
    transform: AffineTransform.translation(40, 30),
  },
});
```

`reference` is exactly `{assetId}` or `{width,height}`. An asset reference retains
its original native width/height as a geometry dependency; it never samples a
float display thumbnail. Fixed dimensions are finite positive numbers, including
fractional smart-master geometry. The pose has finite positive width/height,
a `PerspectiveTransform`, and an invertible `AffineTransform`. `basis` maps raw
mask geometry to the reference logical frame and defaults to identity. It can
include translation. `phase` defaults to `"document"`; `"native"` retains
pre-projection filter mixing and byte feathering. `steps` defaults to an empty
array of `{pose,inverse?:boolean}`; inverse defaults to false. Unknown fields,
null defaults, mixed references, invalid constructors, singular transforms and
nonfinite values reject. Values/getters/JSON are independently owned.

All five mask kinds accept `plane?:MaskPlane` in construction/`with`.
`mask.plane` returns a value or null; `mask.with({plane:null})` explicitly removes
it. Original shape data and ordered Hide/Reveal/Wet entries remain editable.
Removing a plane changes interpretation and is not preserving-position unlink.
Outer mask x/y/basis and placement offsets remain independently editable.

Use the existing shared OO mutations for ordinary edits:

```ts
const layer = document.selectedLayer;
if (!layer?.mask) throw new Error("Choose a masked layer.");
layer.setMaskLinked(false); // preserve current coverage in document space
layer.paintMask(new BrushStroke({
  points: [{x: 90, y: 70}], size: 12, pressureSize: false,
}), "hide", {space: "placed"});
layer.setMaskLinked(true);  // preserve coverage, follow future owner changes
```

The same behavior applies to `SmartObjectLayer.setFilterMaskLinked` and
`layer.paintMask(...,{space:"placed",filterMask:true})`. Omitted paint space is
`"local"` (raw mask geometry); filterMask defaults to false. Missing/foreign
sources, missing masks, invalid options, locks and existing stroke/point limits
reject through the existing command boundary. Each accepted call is one Undo;
an unchanged link state adds none. Selection/path capture on projected images
uses document/source geometry with an inverse attachment pose. Source paths must
belong to the same document and share a compatible fill rule as before.

`MaskPaintPlacement` additionally accepts
`{width,height,plane:MaskPlane,authoring:AffineTransform}`. This captures complete
brush coverage from an affine authoring frame into retained raw mask geometry.
Its geometry-only DTO is strict
`{kind:"mapped",width,height,geometry:{basis,pose,steps},authoring}`.
Plane reference/phase are not brush settings and do not become extra asset
references on each stroke. Brush/Pencil/Eraser pointer input and cursor use the
layer's affine plane for linked masks and document space for unlinked masks.
Selection, tip/tilt, pressure, texture and symmetry use that same authoring frame.

In float documents, choosing Brush/Pencil on a masked layer through the rail,
existing shortcuts or command palette selects Mask Hide when the current paint
target is incompatible; an existing Mask Hide/Reveal choice stays selected.
Gesture admission still checks the actual target. These tools edit scalar mask
coverage while artwork color stays in the native float scene. Pen retains its
existing vector-mask target. Native float color painting and wet tools require
their separate integration.

Prepared `WetPaintStroke.placement` accepts the same mapped constructor input
and validated mapped DTO in addition to the prior perspective form. Its
`nativeTransform` maps prepared field pixels to captured authoring coordinates.
Getters reconstruct constructor values. Trusted browser `editor.applyWetPaint`
and pointer Smudge/Mixer use this mapping with `space:"placed"` on retained
ordinary/filter masks. Local space still authors raw geometry. Full replacement
RGB, replacement alpha and independent removal coverage travel together;
transparent pigment must clear coverage correctly. Private preparation remains
a host service. No pixel, worker, file, network or preparation grant is added to
isolated scripts/plugins. Native float wet tools still reject explicitly.

## Sampling and filter phase

The plane retains the original reference grid and native raw basis. Its current
owner placement and captured attachment steps compose before one scalar-field
transport. Exact inverse/forward pose pairs cancel before arithmetic. Input and
source origins remain separate from homogeneous coefficients. Arbitrary horizon
branches and all finite deviations/bilinear neighbors remain supported through
bounded reads; no image-quad clipping, source downsampling or megapixel cap is
introduced. Brush/Wet fields first reconstruct ordered edits in raw geometry,
then the original mask grid is sampled through current placement. A positive-opacity
mapped Brush/Wet entry starts native-grid replay. A preceding legacy wet prefix
retains its existing logical-grid composition; subsequent entries replay on the
retained grid. This avoids averaging finer prepared pigment/removal coverage
through an intermediate logical bitmap. Zero-opacity mapped entries retain
metadata without selecting a new reconstruction path.

Linked filter masks originally mix before image perspective; unlinked filter
masks mix afterward. These do not commute. Relinking retains the captured
`native`/`document` phase, including feather/settings ordering, so toggling the
checkbox preserves current pixels. Later image movement affects linked coverage;
unlinked coverage remains in the containing document plane.

For native filter mixing, independent masks compose their original document
frame before the inverse physical owner pose. Linked masks cancel their owner
placement in the native frame. Original root/document render frames stay captured
alongside the owner pose across intrinsic image rendering, and participate in
native composite cache signatures.

The Canvas renderer owns model poses; callers must not reconstruct them from
already projected rendering transforms. Retained scenes use the Canvas fallback
when the GPU path cannot represent the plane. Low-level affine mask coverage and
legacy perspective-mask capture reject retained planes without their model owner;
trusted document rendering or `captureMaskPlane` supplies that context. SVG and
Photoshop export plans bake unsupported retained mask coverage while native
project data keeps the original geometry. Export and nested-master acceptance
still require verification below.

## Transport and acceptance boundary

Document schema 56 gates retained planes and mapped Brush/Wet placements in
layers, filter masks, embedded documents and history. Falsely old labels reject;
valid old data remains readable. Central asset discovery/remapping retains
geometry-only originals in copy/project/recipe transport. REST uses the same
commands/validation/history in independent headless sessions; it does not render
or synchronize with a browser document. Plugin permissions and inert installation
are unchanged.

The final source passes all **3,216 unit/API/native tests across 312 files** with
the established two workers. A fresh production build passes. All **227 relevant
browser cases across 27 files** pass in one run with no skips, retries, flakes or
runner errors. The normal production UI separately passes relinking, Brush,
Mixer, shared Undo/Redo, PNG delivery and original-bearing project reopening,
without debug globals.

The wider probes found and corrected native wet detail loss: finer prepared
coverage previously averaged through a logical bitmap. The independent 96-sample
field now matches every native value, including after a legacy wet prefix. All
ten legacy wet kind/target relinking cases stay exact; zero-opacity mapped
metadata leaves following legacy edits unchanged. Expanded smart-master probes
found and corrected three native filter frame mismatches. All retained/legacy
root/document/current-scene cases in the full matrix now match their root controls.

Actual SVG and layered Photoshop export/import retain every tested RGBA byte for
ordinary, native-phase filter and document-phase filter planes, with explicit
baked-coverage disclosure. Geometry-only float originals survive byte wet editing
and reopening: the tested TIFF remains all 190,816 original bytes at 131x79 while
its separate display thumbnail is 96x58. A strengthened complete-byte-length
assertion also passes its focused rerun. The full matrix includes genuine 50 MP
sources, coupled native output/partitions, isolated scripts, source/lifetime /
cancellation checks and existing tools. Earlier failed reports and observations
are retained. [Fidelity findings and compact evidence](benchmarks/mask-plane-fidelity-2026-10-31.md).

### Native float and portable ownership follow-up

Actual float documents now have exact native-word acceptance for both initial
link states across all five mask kinds, including HDR RGB, fractional alpha,
Undo/Redo and project reopening. Four actual Brush/Pen pointer cases retain
preview/commit identity, cancellation, visible color words, rational cubic
controls and 17x11-window partition identity. These use the original 131x79
float TIFF; its 96x58 thumbnail remains display-only. Mask tool selection is
reachable through the rail, B/N and command palette while color painting rejects.

Copied retained artwork now has specific acceptance for geometry-only float
originals, colliding receiving IDs, source-tab closure, fresh stroke identities
and workspace reload while only redo history owns the copied sources. Recorded
recipes also retain and remap those geometry originals after source closure,
with exact artwork and original-bearing reopening. These are the tested copy
and recipe workflows, not every cross-document or source-swapping operation.

Normal production Brush/Pencil editing exports native float TIFFs without debug
globals. Independent libtiff checks verify actual linear-sRGB float samples,
reduced alpha, unchanged visible HDR RGB, fractional alpha and every reopened
output word. [Follow-up evidence](benchmarks/mask-plane-float-2026-10-31.md).

### Owner changes and completed native appearance

Ordinary masks now have specific source-replacement acceptance: shared smart
contents change from a 192x144 red source to a 384x288 blue source while linked
and independent retained masks preserve every alpha byte. A project deliberately
saved without history retains the former source solely as mask-grid geometry,
with exact original bytes and no remaining artwork reference to it.

Image Size matches an independent root/document-frame control for ordinary masks
and both filter phases, in both linkage states. Two nested smart conversions and
a doubled embedded-master Image Size preserve tested pixels, cache parity,
shared Undo and project reopening. These six nested cases use affine outer
instances, active child perspective, zero feather and full density; wider nested
projective/feather/resource behavior remains required.

The float appearance cache includes complete retained-plane data and actual
native grid dimensions. Previously a perspective reset could reuse the original
rectangle and produce stale coverage. Pose/basis/reference/grid edits rebuild
that appearance; unchanged repeats, unrelated metadata and eligible integer
moves retain native reuse. The former production build reproduces stale viewport
pixels after reset; the corrected production workflow matches PNG references
through reset, basis edits, Undo/Redo and reopening.
[Owner/cache findings, independent readers and compact evidence](benchmarks/mask-plane-owner-2026-10-31.md).

This increment does not complete the broader roadmap. Remaining acceptance
includes wider ordinary/filter/master source swapping and copied/nested/recipe/workspace ownership,
wider owner/master/pose changes, all-kind mapped tool edits,
broader float/horizon/cache/resource behavior and photographic/physical-device /
sustained process-memory quality. General warp and native float wet tools remain
separate required work. No speedup, 60 fps or performance-regression clearance is
claimed. The original <=33 ms live-input p95 / <50 ms routine-task targets and
all unfinished professional/AI/workflow/ChatGPT/live identity/commercial /
specialist/motion requirements remain active.
