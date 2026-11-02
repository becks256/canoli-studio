# Native float clone paint

Status: schema 58 prepared clone values, native replay and trusted interactive
authoring. Verified native/source-bearing increment; broader acceptance remains open. No full F03/F10,
photographic, device or sustained performance acceptance is claimed.

## Prepared values

`new CloneStroke({precision: 'float32', points, tiles, ...brushOptions})`
creates an immutable prepared clone value. Its read-only `.precision` is
`'float32'` or undefined for the existing byte constructor. Attach a PaintLayer
to a float32/linear-sRGB Document, then call `paint.strokes.add(stroke)`.
Detached paint mutations retain temporary byte-document validation. Existing
commands, ancestry locks, transactions and Undo/Redo apply. No simulation,
pixel-reading service, permission or alternative mutation API is introduced.

The flag applies only to clone values. Null, `'uint8'`, other flags, false schema
ages below 58, byte documents, masks and tonal footprints reject. Omission keeps
the byte source contract; unflagged clone values reject in float PaintLayers,
including inert/hidden values. Existing brush controls, point/tile budgets,
selection clipping and strict source reference metadata remain.

Each tile is `{x,y,width,height,assetId}` in the PaintLayer's local plane. All
geometry is safely representable native integer data; extents are positive and
must exactly match the original source's native dimensions. Each source is a
complete, single-page, orientation-1, chunky, straight RGBA32 TIFF with the exact
pinned linear-sRGB ICC. Finite signed/HDR RGB is retained; alpha is 0–1. There is
no wet removal plane and no requirement that source alpha match brush coverage.
The stored color is unmasked. Brush `color` remains metadata and does not tint it.

Every original sample validates before external host publication, project/
recovery admission or scene pixels, even when offscreen, hidden, zero-opacity or
zero-flow. Missing, stale, malformed, incorrectly profiled or mismatched sources
reject atomically. All tile identities pin before awaited validation. Only the
actual native clone tile references bypass byte-role checks; reusing their IDs
as brush textures or masks does not confer native color authority. Synchronous
trusted OO mutations require already validated prepared sources; original
streaming/decoding does not occur inside a transaction.

## Replay

Ordered overlapping source tiles first source-over on their native local grid.
Adjacent tiles share interpolation halos. Source color and alpha project through
the current owner/ancestor affine using premultiplied linear filtering. Existing
canonical scalar brush coverage includes flow, pressure, tip, texture, symmetry
and selection once; source alpha, coverage and unquantized stroke opacity enter
normal source-over once. Transparent source pixels leave prior paint intact;
this is not wet replacement/removal. No Canvas color or display thumbnail enters
the native color path. Existing transparent/signed-zero canonicalization applies
to composited pixels; original source files retain their words.

When an active wet operation is present, the PaintLayer's existing wet-native
rule replays all dry/clone/wet/erase/clear operations locally before its current
affine placement. Otherwise brush coverage retains document-lattice replay.
Zero-opacity wet records still do not choose local reconstruction. Current
masks, clipping, styles, Fill, layer opacity, blend and proof/export stages follow
intrinsic replay. Working-window limits and finite coordinate precision remain
separate from original image dimensions; no image megapixel/file-size cap is
added.

## Isolated example

Open a float document containing an unresized canonical prepared TIFF layer named
**Native clone source**. The example freezes that existing original reference;
it does not read pixels or invoke a host sampler.

<!-- example: float-clone-prepared -->

```js
const source = [...document.layers].find(
  (layer) => layer.name === "Native clone source",
);
if (!(source instanceof RasterLayer))
  throw new Error("Import the native clone source first");
const paint = document.layers.add(
  new PaintLayer({ name: "Native clone paint" }),
);
paint.strokes.add(
  new CloneStroke({
    precision: "float32",
    points: [{ x: 20.5, y: 20.5 }],
    size: 12,
    hardness: 1,
    pressureSize: false,
    opacity: 0.64123,
    tiles: [
      {
        x: 20,
        y: 20,
        width: source.width,
        height: source.height,
        assetId: source.assetId,
      },
    ],
  }),
);
document.selectedLayer = paint;
print("Native clone prepared");
```

Isolated scripts/plugins, source-bearing recipes and independent REST commands
share complete source validation and existing grants/revision/history. Plugin
installation remains inert. REST sessions do not synchronize with the browser
and gain no composed renderer. Source assets persist through project/history,
redo-only workspace and recipe remapping using existing references.

## Trusted tools and previews

The existing Clone brush (S) now accepts float documents. Alt/Option-click chooses
its source in document coordinates; Aligned retains the existing world offset.
It samples the frozen visible merged FloatScene at gesture start, including
source masks/styles/opacity and earlier edits, before display/proof conversion.
The artboard bounds clip the source, including under target reflection/shear.
Source coordinates map into the destination's native local grid; current layer
placement follows the captured values. No source or document is flattened.

A private asset view owns captured texture leases and prepared TIFFs; these
references enter the host store only at commit. Private float samples use a 16 MiB LRU of 256-square cells. Preview and completed
512-square TIFF capture regions share native interpolation halos and exact
geometry. TIFF encoding uses the existing 262,144-pixel working budget; the
existing 4096 tile-reference/brush-point metadata budgets remain distinct from
original image dimensions. Source alpha stays unmasked until clone replay.

Pointer movement publishes no document or host assets. Pointer release validates
all completed private TIFF sources and promotes them in one shared transaction.
Escape, source bytes/interpretation, texture, revision, ordered-selection or
session changes discard pending output. New-layer placement follows existing
commands; existing layer locks and parent transforms remain authoritative.
Isolated clients continue to provide prepared values and gain no sampler.

`CanvasRenderer.captureFloatScene(document, assets, control?, preview?)` accepts
an optional internal trusted `PaintPreview` for native preview verification, as
`render(...,{paintPreview})` does for viewport rendering. This adapter is not a
serialized command or an isolated service; its source owner must remain live.
No preview source is saved in projects, recipes or history.

Final photographic/device and sustained performance acceptance remains required.
All unfinished original roadmap gates remain active.

## Verification and remaining scope

Verified 2026-11-01: 3,310 unit/API/native tests across 323 files, 57 accepted
source-browser cases across 9 files and 11 production cases across 4 files.
Source acceptance combines 55 matrix passes with two successful frame-coalescing
rechecks; the initial fixture compared a one-point preview with a two-point
commit. Exact-word assertions remain. Independent native libtiff/NumPy checks
cover complete native, reflected/scaled and reopened TIFF output; an actual
50 MP original retains its full source and a completely checked 64x48 clone
window. This does not prove full-image cloning speed, photographic/device
quality or sustained F14 behavior.

[Findings, compact evidence and original roadmap scope](../docs/benchmarks/float-clone-2026-11-01.md).
