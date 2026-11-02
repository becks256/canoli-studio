# Editable linear float paint

Status: native PaintLayer replay in float32/linear-sRGB documents. Existing
BrushStroke, PencilStroke, EraserStroke and solid PaintFill values remain editable
commands; no prepared wet simulation substitutes for dry paint. Explicit native CloneStroke values now use [schema 58](FLOAT_CLONE.md); byte
clone values reject, including hidden/inert metadata. Explicit
HDR wet replacements use the existing schema 57 prepared-pair contract.

## Color and coverage

Six-digit brush/fill hex colors describe encoded sRGB. Convert RGB to linear
sRGB and store native Float32 source colors before ordered source-over. Flow,
spacing, pressure, tilt/tip, symmetry and texture use the existing canonical
brush rasterizer. Canvas supplies only scalar coverage; it never supplies color
or composited destination pixels. The coverage lattice is byte scalar data,
normalized to Float32. Stroke opacity remains a separate finite 0–1 value and
applies once in native composition, without byte opacity rounding. Selection
clips are included once in the shared coverage path.

Eraser and `PaintFill({erase:true})` use destination-out within their own paint
layer: preserve surviving linear RGB and round alpha once per operation.
Fill remains a solid color over its declared rectangle/clip. Operations replay
in order on the document's native pixel lattice with the full layer/ancestor
affine transform. Frame pan/zoom resamples the completed native document.
Canonical coverage cells preserve crop partitions; working buffers and finite
coordinate precision remain independent of original image resolution.

Completed paint layers enter existing group/clipping, mask, blend, Fill,
opacity, Color Overlay, Blend If and shadow composition. Existing blend-domain
and finite overflow checks remain; the SDR preview and integer exports can clip
extended colors. Original HDR raster values never pass through a byte canvas.

## Editing and persistence

Existing OO constructors and `paint.strokes.add/remove`, layer commands,
transactions, ancestry locks and Undo/Redo apply. No new serialized field,
document age, permission, network or pixel-reading API is introduced. Isolated
scripts/plugins and independent REST commands use the same validation. Install
remains inert. REST sessions remain independent and gain no composed renderer.
Native projects, source-bearing recipes and workspace/history retain editable
operations and source ownership through their existing transports.

Brush/Pencil Layer targeting paints an existing PaintLayer or creates one above
the selected artwork; it does not bake the raster original. Existing valid
ordinary Mask Hide/Reveal targets stay selected when switching tools. Choosing
Brush/Pencil no longer redirects the valid Layer target to a mask. Eraser accepts
a PaintLayer or original raster, and Fill keeps its existing solid paint-layer
workflow. The New layer button, shortcut and command create an empty PaintLayer.
Preview candidates stay private; Escape cancels and pointer release commits once.

The existing Color settings conversion now accepts blank and supported editable
paint documents as well as original-backed TIFF artwork. Raster sources still
require accepted original high-precision TIFFs. Unsupported layer/operation
content rejects before changing precision. Output/proof preferences remain
separate from document Undo.

## Isolated example

Open a float document first (or convert a blank document using Color settings):

<!-- example: float-dry-paint -->

```js
const paint = document.layers.add(new PaintLayer({ name: "Linear paint" }));
paint.strokes.add(
  new PencilStroke({
    points: [{ x: 20.5, y: 20.5 }],
    size: 4,
    pressureSize: false,
    color: "#208040",
    opacity: 0.64123,
  }),
);
document.selectedLayer = paint;
print("Editable linear paint ready");
```

This is a local document edit, with no decoding, host simulation, file, network
or additional plugin authority. Wider float tools/layers/working spaces,
projective/warp/master coverage, photographic/device quality, sustained F14
performance and every unfinished original roadmap requirement remain active.

## Recorded paint appends

The existing recipe recorder now retains `paint.add` as a literal action:
`{type:"paint.add",stroke:<complete PaintOperationData>}`. Its semantic target
must resolve to a PaintLayer. Replaying appends a fresh operation identity and
preserves existing strokes; it does not replace the destination's contents.
Created-layer step outputs retain their identity even with colliding names.
Brush metadata is literal and uses existing limits; this action does not add
parameter expressions inside the strict stroke DTO. Existing byte operations
remain supported; float PaintLayers require explicit native clone sources and reject byte wet values.

Portable packages collect/remap original brush textures and applicable clone/
prepared-wet pairs. Trusted asynchronous preparation pins prospective source
identities, including interpretation metadata, before awaited work and validates
complete wet pairs before host publication. Invalid pairs, missing/stale sources,
revision/selection conflicts and locks reject atomically. Synchronous trusted
OO/executor calls still require already validated prepared wet pairs; they do not
decode pixels inside a transaction. Existing permission and independent REST
boundaries remain. Stroke removal recording is still unsupported.

Recorded `layer.place` actions retain a semantic `reference` (or null for the
root), native before/after/inside placement and `preservePosition` boolean. The
existing shared command preserves affine geometry and destination ancestry locks.
This captures the real new-layer placement used by Brush/Pencil gestures,
including insertion into a selected group; subsequent appends target the created
step output. Placement and append still commit atomically in a replay.

[Verification and remaining roadmap scope](../docs/benchmarks/float-paint-2026-10-31.md).

## Native wet paint

`paint.strokes.add(new WetPaintStroke({precision: "float32", brush, tiles,
...options}))` appends validated prepared linear TIFF pigment/removal pairs.
Attach the PaintLayer to the float Document before appending HDR values;
detached paint mutations retain their temporary byte-document validation.
The existing schema 57 metadata, defaults, finite HDR values, complete native
pair validation, mapped/perspective placement and source ownership contracts
apply. Byte wet pairs reject in a float PaintLayer, even when inert; HDR masks
and byte documents still reject. No new serialized field or permission is added.
See [prepared HDR values](HDR_WET_DOCUMENTS.md).

An active wet record reconstructs the complete ordered PaintLayer content on
its local integer pixel lattice, as in the byte wet compositor: dry strokes,
prepared replacements, erasers, clear fills and subsequent dry strokes all
replay before the current layer/ancestor affine. This also rerasterizes dry
stroke edges on that local lattice; transformed dry-only paint uses the earlier
document-lattice path. Zero-opacity wet records validate their complete sources
but neither select local reconstruction nor enlarge support. Finite off-layer
prepared support remains visible. Bounded projection windows retain crop parity
and do not impose image-size limits.

Trusted `editor.applyWetPaint(brush, options?)` accepts a selected or explicit
PaintLayer, or creates one when no layer is selected. Its existing local/placed
controls, load/mix defaults, selection baking, source/revision/cancellation
guards, private prefix leases and one-Undo commit are unchanged. The Smudge and
Mixer tools expose these targets through the existing rail/registry; ordinary
mask targets keep their byte path. Isolated scripts, plugins and independent
REST sessions consume prepared pairs rather than running host simulation.

<!-- example: float-wet-paint -->

```js
const paint = document.layers.add(new PaintLayer({ name: "Wet linear paint" }));
paint.strokes.add(
  new PaintFill({
    bounds: { x: 10, y: 10, width: 24, height: 24 },
    color: "#208040",
  }),
);
document.selectedLayer = paint;
print("Wet paint target ready");
```

This isolated example creates editable dry content ready for the trusted
Smudge/Mixer tools; it does not expose simulation or pixel reads to scripts.
Full photographic/device quality, sustained performance, clone and the wider
original roadmap remain required.

[Native wet verification and remaining limits](../docs/benchmarks/float-wet-paint-2026-10-31.md).
