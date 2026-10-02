# Scripting API

Luma scripts use JavaScript and an object-oriented document model to control the open composition. This guide describes the current implementation in [src/dom/index.ts](../src/dom/index.ts) and [src/scripting](../src/scripting). It is a prototype API; Photoshop scripting compatibility and a published, stable SDK are not implemented.

For reusable installable commands, see [Plugins and extensions](PLUGINS.md). Plugin commands receive these same bindings and obey the same runtime limits, with additional host-enforced document permissions.

For HTTP automation, see the separate [REST API](API.md#rest-api). REST sessions currently contain their own document metadata and do not control the active browser tab.

The **Developer docs** link in the tool rail and Scripts panel opens this guide in a new tab. The same pages ship with development and production builds; rebuild with `npm run build:docs` after editing Markdown.

## Contents

- [Quick start](#quick-start)
- [Execution and available bindings](#execution-and-available-bindings)
- [Document](#document)
- [Layers and groups](#layers-and-groups)
- [SmartObjectLayer and shared masters](#smartobjectlayer-and-shared-masters)
- [LayerMask](#layermask)
- [LayerMetadata](#layermetadata)
- [LayerCollection](#layercollection)
- [ToneAdjustment](#toneadjustment)
- [AdjustmentCollection](#adjustmentcollection)
- [PaintLayer and strokes](#paintlayer-and-strokes)
- [VectorLayer and paths](#vectorlayer-and-paths)
- [TextLayer](#textlayer)
- [AdjustmentLayer](#adjustmentlayer)
- [LayerStyle, BlendIf, and MarqueeSelection](#layerstyle-blendif-and-marqueeselection)
- [Transactions, history and ownership](#transactions-history-and-ownership)
- [Host bridge and asynchronous jobs](#host-bridge-and-asynchronous-jobs)
- [Recipes](#recipes)
- [Errors and limits](#errors-and-limits)
- [Application integration](#application-integration)
- [Maintaining this contract](#maintaining-this-contract)

## Quick start

1. Import an image, or open the sample composition. Select an unlocked image layer; its ancestor groups must also be unlocked.
2. Open **Scripts** from the tool rail or press **Mod+Shift+K**.
3. Paste the example below and click **Run script**, or press **Mod+Enter** while editing the code.
4. Close Scripts to inspect the result. Use **Mod+Z** to undo the entire run.

`Mod` means Command on macOS or Control on Windows/Linux. The panel accepts JavaScript, not TypeScript annotations or module `import`/`export` declarations. Constructors are already available; no imports are needed.

<!-- example: quick-start -->

```js
const source = document.selectedLayer;
if (!(source instanceof RasterLayer)) {
  throw new Error("Select an unlocked image layer first.");
}

const variation = source.duplicate();
variation.name = "Soft light";
variation.adjustments.add(
  new ToneAdjustment({
    exposure: 0.25,
    saturation: -12,
  }),
);
document.selectedLayer = variation;
print("Created", variation.name);
```

This duplicates the selected layer in the same parent, including its existing adjustments, and adds another adjustment. The duplicate shares the original image asset; it does not overwrite the source. `duplicate()` initially offsets the copy by 24 pixels in both directions.

Script code and output are not saved in `.luma` project files. Copy useful scripts to your own files before closing the panel; reopening the panel restores its starter example. Save the project separately to keep the resulting edits.

## Execution and available bindings

| Binding                                                      | Meaning                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `document`                                                   | A snapshot-backed `Document` representing the active composition at the start of the run. It is the editor document model, not the HTML document.            |
| `Document`                                                   | Constructor for a separate in-memory document. Creating one does not open or replace the active composition.                                                 |
| `SmartObjectLayer`                                           | Constructor for a placed instance of an embedded shared master.                                                                                              |
| `GaussianBlurFilter`, `UnsharpMaskFilter`, `SmartToneFilter` | Immutable filter values for per-instance smart-filter stacks.                                                                                                |
| `RasterLayer`                                                | Constructor for an image layer referring to an existing asset.                                                                                               |
| `LayerGroup`                                                 | Constructor for an ordered group of layers.                                                                                                                  |
| `PaintLayer`                                                 | Constructor for a paint layer containing brush, pencil, clone, or fill strokes.                                                                              |
| `VectorLayer`                                                | Constructor for a vector layer containing Bézier vector paths.                                                                                               |
| `VectorPath`                                                 | Constructor for editable vector paths with anchors, control handles, fill, and stroke.                                                                       |
| `TextLayer`                                                  | Constructor for text layers with font, size, color, alignment, and line height.                                                                              |
| `AdjustmentLayer`                                            | Constructor for non-destructive adjustment layers (Curves, Levels, Tone, Tonal strokes) modifying preceding backdrop pixels.                                 |
| `PatchAdjustment`                                            | Immutable corrected-RGB asset descriptor for an alpha-preserving patch adjustment.                                                                           |
| `TonalStroke`                                                | Constructor capturing a brush/pencil path and dodge/burn settings for a tonal adjustment layer.                                                              |
| `BrushStroke`                                                | Constructor for soft brush strokes with color, size, hardness, opacity, and pressure points.                                                                 |
| `EraserStroke`                                               | Constructor for eraser strokes using destination-out compositing to erase paint content.                                                                     |
| `PencilStroke`                                               | Constructor for hard, precise pencil marks.                                                                                                                  |
| `CloneStroke`                                                | Constructor for clone brush strokes referencing sampled image tiles.                                                                                         |
| `PaintFill`                                                  | Constructor for solid color canvas fills.                                                                                                                    |
| `AffineTransform`                                            | Immutable affine matrix constructor and composition helpers for transformed selections.                                                                      |
| `MarqueeSelection`                                           | Constructor for rectangular or elliptical selections.                                                                                                        |
| `LayerMask`                                                  | Constructor for an immutable selection or Bézier layer mask.                                                                                                 |
| `LayerMetadata`                                              | Constructor for user-authored layer descriptions, attribution and keywords.                                                                                  |
| `LayerStyle`                                                 | Style object managing Blend If, color overlays, and drop shadows.                                                                                            |
| `BlendIf`                                                    | Constructor for luminance/channel tonal blend ranges.                                                                                                        |
| `ToneAdjustment`                                             | Constructor for non-destructive exposure, contrast and saturation.                                                                                           |
| `host`                                                       | Host bridge object exposing `version`, `capabilities`, `jobs`, and `assets` for asynchronous, long-running job dispatch without blocking the script sandbox. |
| `print(...values)`                                           | Returns `undefined`; collects text for the panel's output. Pass `toJSON()` when logging DOM objects.                                                         |

Each run gets a fresh isolated worker. Local variables, listeners and object references do not persist between runs. The worker receives document metadata and selection, not image bytes, the application's `editor` service, UI elements or credentials. External network/code loading is blocked; scripts cannot import files or call the REST service. Standard JavaScript data processing is available.

Changes are collected while the script runs. After successful completion, the application validates the commands and asset references and applies them together. An uncaught error, cancellation, timeout, invalid result or changed document revision applies none of the script's edits. **Stop script**, closing the panel, or Escape cancels a pending run. A successful run with actual document changes adds one history entry named **Run script**; inspection-only, layer-selection-only and no-op runs do not create document history.

The body executes as an async function, so top-level `await` is supported. Await all work needed by the run; detached timers/promises are not a persistent automation service. A `return` value is ignored. `print` output appears after successful completion, not as a live stream; the current panel shows the error instead of prior output when a run fails. Strings are printed directly and other values use `JSON.stringify`, so circular objects and BigInt values can cause serialization errors. `console.log` is not connected to the output panel.

The active layer (`selectedLayer`) is captured when a run begins and the script's final active layer is applied on success. Changing only the active layer in the host does not change its document revision. Pixel selection (`selection`) is document content: it is persisted, undoable and revision-checked. Scripts are not subscribed to later host edits.

## Document

Signature: `new Document(options = {})`.

| Option   | Type   | Default      | Validation                        |
| -------- | ------ | ------------ | --------------------------------- |
| `name`   | string | `"Untitled"` | Nonempty, at most 240 characters. |
| `width`  | number | `1600`       | Positive safe integer, in pixels. |
| `height` | number | `1200`       | Positive safe integer, in pixels. |

There is no fixed megapixel cap. All current documents use sRGB. Browser decoding and memory remain practical constraints; see [resolution and memory](ARCHITECTURE.md#resolution-and-memory).

| Member                           | Access / return             | Behavior                                                                                                                                                                 |
| -------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                             | Read-only string            | Stable document identifier.                                                                                                                                              |
| `name`                           | Read/write string           | Rename through the shared command/history system.                                                                                                                        |
| `width`, `height`                | Read/write numbers          | Canvas dimensions in pixels. Setting either dimension resizes the canvas through the shared command/history system.                                                      |
| `crop({ x, y, width, height })`  | `void`                      | Rebase the canvas to a rectangle, preserving off-canvas artwork and original assets. One undoable command. See Canvas cropping below.                                    |
| `resize(width, height)`          | `void`                      | Resizes canvas dimensions atomically as one undoable command. Validates positive safe integers.                                                                          |
| `layers`                         | Read-only `LayerCollection` | Root layers only, ordered back-to-front.                                                                                                                                 |
| `selectedLayer`                  | Read/write layer or `null`  | Select a layer belonging to this document, or clear selection. Set after a transaction when selecting a newly added layer.                                               |
| `getLayer(id)`                   | Layer or `null`             | Search the entire tree by ID; accepts `null`, which returns `null`.                                                                                                      |
| `selectSubject(options?)`        | `Promise<SelectionData>`    | Detects salient foreground subject across active layer or canvas and sets document marquee selection. One undoable step.                                                 |
| `removeBackground(targetLayer?)` | `Promise<RasterLayer>`      | Detects subject, solves alpha matte, creates a non-destructive bitmap mask, and attaches it. One undoable step.                                                          |
| `transaction(label, callback)`   | `undefined`                 | Synchronous atomic batch. See transaction rules below.                                                                                                                   |
| `toJSON()`                       | `DocumentData` object       | Deep copy of document metadata, including nested layers and adjustments. Includes pixel selection; excludes asset bytes, active layer, history and script code.          |
| `Document.fromJSON(data)`        | New `Document`              | Validate a metadata object and create a separate document with empty history and no active layer; retains serialized pixel selection. Pass an object, not a JSON string. |
| `canUndo`, `canRedo`             | Read-only booleans          | History availability in this instance. In Scripts these describe the worker's history, not the host's existing history.                                                  |
| `undo()`, `redo()`               | `undefined`                 | Available on standalone instances and trusted application instances. **Disabled on the supplied script `document`**; use editor undo/redo after the run.                 |

To inspect metadata as text, use `JSON.stringify(document.toJSON())`. Editing that returned object does not edit the document. `Document.fromJSON(document.toJSON())` creates an independent model with the same serialized IDs; it does not import source assets or establish shared ownership. Only operations against the supplied `document` are applied to the open composition.

## Layers and groups

`RasterLayer`, `PaintLayer`, `VectorLayer` and `LayerGroup` share the base Layer API. `Layer` is an abstract base class, not a constructor binding in the Scripts panel.

Signatures:

- `new RasterLayer({ assetId, width, height, ...options })`
- `new LayerGroup(options = {})`

Shared constructor options and writable properties:

| Property    | Type    | Default               | Meaning                                                                                                                                    |
| ----------- | ------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`      | string  | `"Image"` / `"Group"` | Nonempty, at most 240 characters.                                                                                                          |
| `x`, `y`    | number  | `0`                   | Offset relative to parent, in document pixels. Negative and fractional values are allowed; finite, within ±`Number.MAX_SAFE_INTEGER`.      |
| `opacity`   | number  | `1`                   | Inclusive range 0…1.                                                                                                                       |
| `visible`   | boolean | `true`                | Hidden groups also hide their descendants.                                                                                                 |
| `locked`    | boolean | `false`               | Prevent ordinary edits to this node and its descendants. Lock-state changes remain possible; unlocking a child does not unlock its parent. |
| `blendMode` | string  | `"normal"`            | See the supported blend modes below.                                                                                                       |

Raster-specific options/properties:

| Member               | Access                                              | Meaning                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assetId`            | Required constructor option; read-only property     | Nonempty source-asset ID, at most 240 characters. Use an existing raster layer's `assetId`; a filename or URL does not import an image. The host checks that referenced assets exist before applying the script.                   |
| `width`, `height`    | Required constructor options; read/write properties | Display dimensions in document pixels, each 1…`Number.MAX_SAFE_INTEGER`. Finite fractional sizes are allowed. Changes scale placement, not the source image. Set both proportionally to preserve aspect ratio.                     |
| `adjustments`        | Read-only `AdjustmentCollection`                    | Ordered, non-destructive effects.                                                                                                                                                                                                  |
| `setTone(values)`    | Method, returns `undefined`                         | Update the first tone adjustment, or add one when absent. Omitted values preserve existing settings; a new tone starts from defaults. Accepts `enabled`, `exposure`, `contrast`, `saturation`. Does not replace later adjustments. |
| `resetAdjustments()` | Method, returns `undefined`                         | Remove all adjustments from this layer; source image is retained.                                                                                                                                                                  |

A group exposes `layers: LayerCollection` and has no intrinsic width/height. Group opacity and blend mode apply to its combined children as an isolated composition. There is no group-resize method.

Shared read-only properties and methods:

| Member                         | Return / type                                  | Behavior                                                                                                                                                                                                                                      |
| ------------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                           | string                                         | Stable generated identifier. Not a constructor option.                                                                                                                                                                                        |
| `kind`                         | `"raster"`, `"paint"`, `"vector"` or `"group"` | Node type; `instanceof RasterLayer` / `LayerGroup` also works.                                                                                                                                                                                |
| `document`                     | `Document` or `null`                           | Owning document, including through a parent group. Ownership is retained after removal.                                                                                                                                                       |
| `isAttached`                   | boolean                                        | Whether the owning document currently contains this node.                                                                                                                                                                                     |
| `update(patch)`                | `undefined`                                    | Apply the supplied writable properties together; omitted properties retain their values. Raster width/height are also accepted. Unknown properties are rejected.                                                                              |
| `duplicate()`                  | New layer/group of the same kind               | Insert immediately above the source in the same parent. New IDs for copied nodes/effects/strokes/paths; shared source assets; root copy offset +24/+24 and name suffixed `" copy"`. Requires attachment.                                      |
| `remove()`                     | `undefined`                                    | Remove the node and, for a group, its subtree. Requires attachment.                                                                                                                                                                           |
| `moveUp()`, `moveDown()`       | `undefined`                                    | Move one sibling position toward the front/back. No-op at the boundary. Requires attachment.                                                                                                                                                  |
| `moveTo(parent, options = {})` | `undefined`                                    | Move to the front of the destination document/group's collection. Destination must belong to the same document. Local coordinates remain unchanged by default; `{ preservePosition: true }` preserves document position. Requires attachment. |
| `maskFromBitmap(assetId)`      | `undefined`                                    | Attaches a bitmap mask referencing an asset in `AssetStore`. Supported on all attached layers. One undoable command.                                                                                                                          |
| `refineEdge(options?)`         | `Promise<LayerMask>`                           | On `RasterLayer`: interactive local KNN alpha matting, edge feathering/contrast, and color decontamination. Returns and attaches bitmap `LayerMask`.                                                                                          |
| `toJSON()`                     | `LayerData` object                             | Deep metadata copy. A group includes its subtree; a raster includes effects and its asset reference.                                                                                                                                          |

`moveTo` defaults to preserving local coordinates; opt into `preservePosition` when reparenting between offset groups. `moveBefore(target)` and `moveAfter(target)` place below/above a sibling target, adopting its parent and preserving document position. Targets must belong to the same document. Layer-row dragging uses these placement methods. Groups cannot contain themselves or an ancestor. The API has no public `parent` property or multi-selection yet; traverse collections when you need ancestry.

## LayerCollection

Obtain collections from `document.layers` or `group.layers`; do not construct them yourself. They are iterable objects, not JavaScript arrays.

| Member       | Return                  | Behavior                                                                                                                                      |
| ------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `length`     | Read-only number        | Number of immediate children, not recursive count.                                                                                            |
| `at(index)`  | Layer or `null`         | Zero-based access. `at(0)` is backmost; `at(-1)` is frontmost. Out-of-range returns `null`.                                                   |
| `get(id)`    | Layer or `null`         | Find an immediate child by ID. Use `document.getLayer(id)` for recursive lookup.                                                              |
| `add(layer)` | The same layer instance | Append a constructor-created, unowned layer/group at the front of the stack and establish ownership. Use `moveTo` for an already owned layer. |
| Iteration    | Layers, back-to-front   | `for (const layer of collection)` or `[...collection]`. Snapshot with `[...collection]` before deleting/reordering while iterating.           |

Layers and groups count toward a shared document total of 64 nodes. The current tree permits 8 nested group levels. These structural limits are independent of image resolution.

## ToneAdjustment

Signature: `new ToneAdjustment(options = {})`.

| Option / property | Type    | Default | Range                          |
| ----------------- | ------- | ------- | ------------------------------ |
| `enabled`         | boolean | `true`  | Enable/bypass this adjustment. |
| `exposure`        | number  | `0`     | −3…3.                          |
| `contrast`        | number  | `0`     | −100…100.                      |
| `saturation`      | number  | `0`     | −100…100; −100 removes color.  |

All four properties are readable/writable. `id` is read-only. Values must be finite. Effects run in collection order; multiple tone adjustments accumulate. The initial operator works on encoded sRGB 8-bit channels, not a linear-light or color-managed photographic pipeline.

| Method           | Return                  | Behavior                                                         |
| ---------------- | ----------------------- | ---------------------------------------------------------------- |
| `update(values)` | `undefined`             | Set any subset of the four properties; retain omitted values.    |
| `remove()`       | `undefined`             | Remove from the owning raster; throws if never added to a layer. |
| `toJSON()`       | `ToneEffectData` object | Deep copy including `id`, `kind: "tone"` and settings.           |

Adding an adjustment to a locked raster or one with a locked ancestor fails. Removing/resetting an adjustment makes its retained handle's setting getters invalid until the same effect exists again, such as after undo in a trusted application context. There is no supported reattachment or effect-reordering method; create a fresh adjustment when needed.

## AdjustmentCollection

Obtain it from `raster.adjustments`. Each raster supports up to 8 effects.

| Member        | Return                             | Behavior                                                                        |
| ------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| `length`      | Read-only number                   | Number of effects.                                                              |
| `at(index)`   | `ToneAdjustment` or `null`         | Zero-based access; negative indexes count from the end.                         |
| `get(id)`     | `ToneAdjustment` or `null`         | Find an effect by ID on this raster.                                            |
| `add(effect)` | The same `ToneAdjustment` instance | Append an unowned adjustment. One adjustment cannot belong to multiple rasters. |
| Iteration     | Adjustments in processing order    | `for…of` and spread are supported.                                              |

## PaintLayer and strokes

Signature: `new PaintLayer(options = {})`.
Inherits all common layer options (`name`, `opacity`, `fillOpacity`, `visible`, `locked`, `blendMode`, `x`, `y`).

A `PaintLayer` contains paint marks (brush strokes, pencil strokes, clone strokes, or fills) that are kept separate from underlying image source assets.

Access strokes via `paintLayer.strokes` (`StrokeCollection`):

| Member        | Return                     | Behavior                                                               |
| ------------- | -------------------------- | ---------------------------------------------------------------------- |
| `length`      | Read-only number           | Number of paint operations.                                            |
| `at(index)`   | `PaintOperation` or `null` | Zero-based access.                                                     |
| `get(id)`     | `PaintOperation` or `null` | Find stroke by ID.                                                     |
| `add(stroke)` | The stroke instance        | Append a `BrushStroke`, `PencilStroke`, `CloneStroke`, or `PaintFill`. |
| `remove(id)`  | `void`                     | Remove a stroke by ID.                                                 |
| Iteration     | Strokes in paint order     | `for…of` and spread are supported.                                     |

### Stroke constructors

All colors use six-digit hex (`#rrggbb`), without an alpha suffix. All coordinates are in the paint layer's local space. Operations are immutable value objects; change an existing operation by removing its ID and adding a newly constructed replacement in a transaction. `at`/`get` return snapshots, not live stroke handles; use `kind` to discriminate them. Negative collection indexes count from the end.

`new BrushStroke({ points, size = 24, hardness = 0.7, opacity = 1, flow = 1, spacing = 0.12, color = "#d5e79b", clip = null })`:

- `points`: 1–20,000 `{ x, y, pressure? }` values; pressure defaults to 1 and accepts 0…1 (rendered radius floors pressure at 0.05).
- `size`: diameter in document pixels, 0.1…2048; `hardness` and `opacity`: 0…1. Opacity applies once to the complete stroke. Overlapping strokes accumulate.
- `flow`: per-stamp opacity modulation factor (0…1, default 1). Stamps build up toward stroke opacity.
- `spacing`: stamp spacing as a fraction of brush size (0.01…2, default 0.12).
- `clip`: `MarqueeSelection`, selection DTO, or `null`. The script must pass a clip explicitly; adding a stroke does not implicitly consume `document.selection`. UI tools capture and translate the current selection when the gesture begins.
- Read-only members: `id`, `kind` (`"brush"`), `points`, `size`, `hardness`, `opacity`, `flow`, `spacing`, `color`; `toJSON()` returns a deep copy, including clip and tiles.

`new EraserStroke({ points, size = 24, hardness = 0.7, opacity = 1, flow = 1, spacing = 0.12, clip = null })`:

- Eraser stroke composited with `destination-out` in the paint layer, non-destructively clearing prior strokes in the same layer.
- Accepts the same `points`, `size`, `hardness`, `opacity`, `flow`, `spacing`, and `clip` parameters as `BrushStroke`.
- Read-only members: `id`, `kind` (`"eraser"`), `points`, `size`, `hardness`, `opacity`, `flow`, `spacing`.

`new PencilStroke(options)` accepts the same options, defaults size to 1 and forces hardness to 1. It stamps pixel-aligned squares without soft edges at source scale. Reduced previews may resample the marks.

`new CloneStroke({ ...brushOptions, tiles })` requires 1–4096 `{ assetId, x, y, width, height }` source tiles. Tile placement is in destination layer coordinates. The asset must already exist in the browser session; the host rejects missing assets. Scripts cannot sample pixels or create image assets, but can reuse an imported raster's asset ID or persisted clone tile IDs. The UI clone tool captures the visible composition at full resolution in tiles before committing; later source edits do not change that stroke. Its live gesture shows a trail; sampled pixels appear on release.

`new PaintFill({ bounds, color = "#d5e79b", opacity = 1, clip = null, erase = false })` requires `bounds: { x, y, width, height }` with positive dimensions. `erase: true` clears earlier paint within that rectangle/clip in the same paint layer, without changing other layers or original assets. Read-only members: `id`, `kind`, `bounds`, `color`, `opacity`, `erase`; `toJSON()` exposes the full operation.

`new PaintLayer()` defaults its name to `"Paint"`. A paint layer stores at most 2048 operations. Its bounds are the union of operation bounds, including areas later cleared.

## VectorLayer and paths

Signature: `new VectorLayer(options = {})`; name defaults to `"Vector"`. Inherits common layer options. `vectorLayer.paths` is a `PathCollection` with `length`, `at(index)`, `get(id)`, `add(path)`, `remove(id)` and iteration. `at(-1)` returns the last path. `add` returns the same `VectorPath` instance and requires an unowned path. Each layer stores at most 2048 paths. Call `vectorLayer.toSvg()` to export all visible vector paths as an SVG `<path>` markup string.

### VectorPath

Signature: `new VectorPath({ points, closed = false, fill = null, stroke = "#d5e79b", strokeWidth = 2 })`.

`points` contains 1–20,000 `{ x, y, in?, out? }` anchors in layer-local coordinates. `in` and `out` are absolute local control-point coordinates, not offsets. Omitted handles coincide with the anchor. Curves connect the previous `out` to the next `in`. A closed path also connects the last anchor to the first. Only closed paths receive a fill. Fill/stroke use six-digit hex or `null`; stroke width accepts 0…1024.

| Member                                    | Behavior                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                      | Read-only stable path ID.                                                                                                           |
| `points`                                  | Read-only deep copy of anchors; editing the returned array does not mutate the path.                                                |
| `closed`, `fill`, `stroke`, `strokeWidth` | Read/write; changes on an owned path use shared commands/history.                                                                   |
| `update(patch)`                           | Set any path properties together. When replacing `points`, provide complete `in`/`out` coordinates.                                 |
| `addPoint({ x, y, in?, out? })`           | Append an anchor, defaulting omitted handles to that anchor.                                                                        |
| `setPoint(index, patch)`                  | Patch one anchor or its handles. Moving only x/y does not automatically translate handles; the UI gesture translates them together. |
| `splitSegment(index, t = 0.5)`            | Insert an anchor in the outgoing cubic segment without changing its curve; returns the new anchor index (`index + 1`).              |
| `removePoint(index)`                      | Remove an anchor; throws for a missing index or an attempt to remove the last remaining anchor.                                     |
| `remove()`                                | Remove from its owner layer; ownership is retained. Requires an owner.                                                              |
| `toSvgPath()`                             | Formats path anchors and cubic curves into an SVG `d` path attribute string.                                                        |
| `toJSON()`                                | Deep metadata copy.                                                                                                                 |

Static Factory Methods:

- `VectorPath.rectangle({ x, y, width, height }, cornerRadius = 0, options = {})`: Creates a closed rectangular path with 4 Bézier anchors. Supports corner radius with smooth cubic Béziers ($\kappa \approx 0.55228$).
- `VectorPath.ellipse({ x, y, width, height }, options = {})`: Creates a closed elliptical path with 4 cubic Bézier segments inscribed within the specified bounding rectangle.
- `VectorPath.polygon({ x, y }, radius, sides = 5, options = {})`: Creates a regular $N$-sided polygon path centered at `{x, y}` with given radius (sides $\ge 3$).
- `VectorPath.fromSvgPath(d, options = {})`: Parses an SVG path data string (`d` attribute) into a `VectorPath`, converting lines, cubic Béziers, and closing segments into smooth anchor points.
- `VectorPath.toSvgPath(path)`: Formats a `VectorPath` into an SVG `d` path attribute string.

Path handles remain attached to their owner and read the current revision across undo/redo. Access while absent throws. A path cannot be added to a second owner. Duplicating its layer gives each path a new ID.

## TextLayer

Signature: `new TextLayer(options = {})`.
Inherits common layer options (`name`, `opacity`, `fillOpacity`, `visible`, `locked`, `blendMode`, `x`, `y`).

| Option          | Type                            | Default        | Validation                                        |
| --------------- | ------------------------------- | -------------- | ------------------------------------------------- |
| `name`          | string                          | `"Text"`       | Nonempty, at most 240 characters.                 |
| `text`          | string                          | `"Text"`       | String up to 10,000 characters.                   |
| `fontSize`      | number                          | `32`           | Finite positive number in pixels (>= 1).          |
| `fontFamily`    | string                          | `"sans-serif"` | Nonempty string up to 100 characters.             |
| `color`         | string                          | `"#ffffff"`    | CSS color string (e.g. hex).                      |
| `align`         | `"left" \| "center" \| "right"` | `"left"`       | Text alignment.                                   |
| `lineHeight`    | number                          | `1.2`          | Line height multiplier between 0.5 and 10.        |
| `letterSpacing` | number                          | `0`            | Letter tracking in pixels between -50 and 500.    |
| `fontWeight`    | string                          | `"normal"`     | Font weight (e.g. `"normal"`, `"bold"`, `"700"`). |
| `fontStyle`     | `"normal" \| "italic"`          | `"normal"`     | Font style posture.                               |
| `direction`     | `"ltr" \| "rtl"`                | `"ltr"`        | Directionality for text laying out.               |

Members:

| Member          | Type                            | Behavior                                                                                 |
| --------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `text`          | string                          | Read/write; updates intrinsic dimensions via text measurement.                           |
| `fontSize`      | number                          | Read/write; font size in document pixels.                                                |
| `fontFamily`    | string                          | Read/write; font family name.                                                            |
| `color`         | string                          | Read/write; fill color for the glyphs.                                                   |
| `align`         | `"left" \| "center" \| "right"` | Read/write; horizontal text alignment relative to layer origin.                          |
| `lineHeight`    | number                          | Read/write; line height scaling factor.                                                  |
| `letterSpacing` | number                          | Read/write; letter tracking in pixels.                                                   |
| `fontWeight`    | string                          | Read/write; font weight descriptor.                                                      |
| `fontStyle`     | `"normal" \| "italic"`          | Read/write; font posture.                                                                |
| `direction`     | `"ltr" \| "rtl"`                | Read/write; text flow direction.                                                         |
| `width`         | number                          | Read-only measured intrinsic text width. Recalculated automatically on property updates. |
| `height`        | number                          | Read-only measured intrinsic text height.                                                |
| `update()`      | method                          | Update multiple text and layer properties in a single command.                           |

## AdjustmentLayer

Signature: `new AdjustmentLayer(options = {})`.
Inherits common layer options (`name`, `opacity`, `fillOpacity`, `visible`, `locked`, `blendMode`, `x`, `y`).
Adjustment layers modify the preceding backdrop layers non-destructively in encoded 8-bit sRGB space. They strictly preserve the backdrop's alpha channel (transparent areas remain transparent; semi-transparent areas retain their alpha).

| Option       | Type             | Default                                      | Validation                                       |
| ------------ | ---------------- | -------------------------------------------- | ------------------------------------------------ |
| `name`       | string           | `"Adjustment"`                               | Nonempty, at most 240 characters.                |
| `adjustment` | `AdjustmentData` | Default curves (`[{x:0,y:0},{x:255,y:255}]`) | Valid Curves, Levels, or Tone adjustment object. |

Members:

| Member           | Type                             | Behavior                                                                                                                                                                                                       |
| ---------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adjustment`     | `AdjustmentData`                 | Read/write; gets a structured clone of the adjustment DTO or sets a new valid adjustment.                                                                                                                      |
| `adjustmentKind` | `"curves" \| "levels" \| "tone"` | Read-only; current adjustment type.                                                                                                                                                                            |
| `setCurves()`    | method                           | Set monotone cubic spline control points for RGB master or per-channel (`red`, `green`, `blue`). Spline uses Fritsch-Carlson interpolation; X values must strictly increase in `[0, 255]`.                     |
| `setLevels()`    | method                           | Set input black/white, midtone gamma, and output black/white for RGB master or per-channel (`red`, `green`, `blue`). Requires `inputWhite > inputBlack`, `outputWhite >= outputBlack`, and finite `gamma > 0`. |
| `setTone()`      | method                           | Set exposure (`[-5, 5]`), contrast (`[-100, 100]`), and saturation (`[-100, 100]`).                                                                                                                            |

Example:

```js
const adj = document.layers.add(
  new AdjustmentLayer({ name: "High Contrast Curves" }),
);
adj.setCurves([
  { x: 0, y: 0 },
  { x: 64, y: 32 },
  { x: 192, y: 224 },
  { x: 255, y: 255 },
]);
```

## LayerStyle, BlendIf, and MarqueeSelection

All layer kinds support `fillOpacity` (0…1, default 1) and `styles`. Fill opacity affects content and its color overlay, while retaining the shadow. Layer `opacity` affects the entire styled result. Supported blend modes are `normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, and `luminosity`. These use browser Canvas 2D compositing; this is not a Photoshop fidelity guarantee.

### LayerStyle

`new LayerStyle(options = {})` creates a detached style value. Read `layer.styles` for a live wrapper, or assign `layer.styles = new LayerStyle(...)` to replace all styles. Shared Layer constructors accept `fillOpacity`; assign styles after construction. `layer.update({ styles: dto })` requires the complete style DTO, while `layer.styles.update(options)` merges partial nested settings atomically.

| Setting        | Defaults and bounds                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `blendIf`      | `BlendIf` instance or partial Blend If DTO; disabled by default. Reading returns an immutable `BlendIf` snapshot.                   |
| `colorOverlay` | `{ enabled: false, color: "#d5e79b", opacity: 1 }`; opacity 0…1.                                                                    |
| `dropShadow`   | `{ enabled: false, color: "#000000", opacity: 0.45, x: 8, y: 8, blur: 12 }`; opacity 0…1, x/y −256…256, blur 0…128 document pixels. |

`blendIf`, `colorOverlay` and `dropShadow` are read/write. Overlay and shadow reads return copies: assign a new value or use `update`, rather than mutating a returned object's fields. `reset()` restores defaults; `toJSON()` returns a deep copy. Removing the owning layer invalidates live style access until undo restores it.

Rendering order: isolated layer/group content → shadow from original alpha → color overlay → fill opacity on content → Blend If on the combined content/shadow → layer opacity and blend mode against the siblings already drawn. Children of a group blend against other children inside that group, not layers outside it.

### BlendIf

`new BlendIf({ enabled = false, channel = "luminance", source = [0, 0, 255, 255], underlying = [0, 0, 255, 255] })`.

`channel` accepts `luminance`, `red`, `green` or `blue`. Each ascending four-number range is `[lowStart, lowEnd, highStart, highEnd]` in 0…255. Values outside the outer cutoffs are transparent; the low pair ramps in and the high pair ramps out. Equal pairs give hard cutoffs. Invalid/nonascending ranges throw. Reset ranges preserve the full tonal range.

Luminance is computed from encoded 8-bit sRGB as `0.2126 R + 0.7152 G + 0.0722 B`. Source and underlying gates multiply source alpha; a transparent backdrop contributes no underlying occlusion. Semi-transparent backdrop gating is weighted by its alpha. The kernel changes alpha, never the input source asset. Members `enabled`, `channel`, `source`, `underlying` are read-only snapshots; use a new instance to change settings. `toJSON()` returns a copy.

### AffineTransform

`new AffineTransform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0)` creates an immutable matrix mapping `(x, y)` to `(a*x + c*y + e, b*x + d*y + f)`. Coefficients must be finite. Positive rotation is clockwise in the downward-positive canvas plane.

- `AffineTransform.translation(x, y)`, `.scale(x, y = x)`, and `.rotation(radians)` create matrices.
- `matrix.multiply(other)` applies `other` first, then `matrix`; `matrix.around({ x, y })` applies it around a pivot.
- `matrix.point({ x, y })` maps a point. `matrix.bounds({ x, y, width, height })` returns its axis-aligned enclosing rectangle.
- `matrix.inverse()` throws for singular matrices or an inverse that is not finite at working precision.
- `matrix.toJSON()` returns `{ a, b, c, d, e, f }`; `AffineTransform.fromJSON(data)` constructs from that representation.

These values currently transform selection regions. They do not yet add layer rotation, skew, or affine transform handles.

### MarqueeSelection

`new MarqueeSelection({ shape, x, y, width, height, operation = "add" })` creates one rectangle or ellipse. Dimensions must be positive. Alternatively pass `{ regions: [...] }`, with an explicit operation on each region; the default constructor creates an empty selection. At most 128 regions are accepted. Coordinates are in document space for `document.selection`, or layer space when used as a paint clip.

- `transformed(matrix)` returns a new selection, composing an `AffineTransform` with each region’s existing transform. Singular or nonfinite results throw. Each region retains its own coordinate basis when combined with other selections.
- `regions` is a deep copy; `toJSON()` returns the full selection DTO.
- `combine(singleRegionSelection, operation = "add")` returns a new selection with one appended add/subtract/intersect region; the argument must contain exactly one region.
- `translated(x, y)` returns a new selection offset by the supplied deltas.
- Operations are evaluated in order, starting with an empty mask. A subtract/intersect region alone therefore selects nothing.
- `document.selection` gets an immutable selection snapshot or `null`. Assign a `MarqueeSelection` or `null`; changes create history and persist in project files.
- `document.selectAll()` selects the full document rectangle; `document.deselect()` assigns `null`. Null means unrestricted painting; `{ regions: [] }` selects no pixels.

Example: rotate a rectangular selection about its center, preserving its editable region geometry:

```js
const rectangle = new MarqueeSelection({
  shape: "rectangle",
  x: 80,
  y: 60,
  width: 120,
  height: 80,
});
document.selection = rectangle.transformed(
  AffineTransform.rotation(Math.PI / 6).around({ x: 140, y: 100 }),
);
```

Selection DTO regions may contain `transform: { a, b, c, d, e, f }`, which maps region geometry into the selection's coordinate plane. Omitting it means identity. Schema v5 preserves these transforms in document selections, masks and paint clips; v1–v4 documents migrate without changing their geometry.

The viewport outlines the component regions (subtract regions use a different color); it does not trace the final Boolean contour. Brush, pencil, clone, fill and clear gestures use the actual combined mask. Pixel selection does not clip vector editing, layer movement, adjustments or exports globally.

## Transactions, history and ownership

A complete Scripts-panel run already commits as one host history entry. Use `document.transaction(label, callback)` within a script when you need a smaller all-or-nothing group that can be caught and recovered from inside that run. Internal transaction labels do not create separate host history entries.

Callbacks must be synchronous. Nested transactions and returning a Promise are rejected. Do asynchronous preparation **before** calling `transaction`; do not launch timers or promises that later mutate the document from a transaction callback. Each intermediate mutation is validated, so create parents before children and keep every step valid.

<!-- example: rollback -->

```js
const before = document.name;
try {
  document.transaction("Attempt rename", () => {
    document.name = "Temporary name";
    throw new Error("Cancel this batch");
  });
} catch (error) {
  print(error.message);
}
print("Name unchanged:", document.name === before);
```

Active-layer selection is session state, separate from the undoable pixel selection (`document.selection`). Set `document.selectedLayer` after a transaction commits, especially when selecting a new node: the selection setter looks in the committed tree. The active layer is not restored by transaction rollback or undo/redo; pixel selection is.

Constructor-created layers can be configured before adding them. Detached groups can own detached children; adding the group attaches its subtree. A layer already owned by a document or detached group cannot be added again. Use `moveTo` after attachment, or construct another object. `remove()` removes content from the current revision but does not release ownership for reuse.

In trusted application code, retained handles resolve by stable ID and reflect undo/redo. Reading mutable properties while their node is absent throws. Discard handles created in failed transactions. In Scripts, every run ends its worker, so retrieve objects by ID or current selection again on the next run. Source pixels are separate from document/history metadata.

## Host bridge and asynchronous jobs

The isolated script runtime provides a global `host` object (`HostBridgeClient`) allowing sandboxed scripts and plugins to safely interact with asynchronous background services without exposing host memory, API credentials, or raw native pointers.

Because scripts run inside a Web Worker with a strict CPU timeout (5000 ms), heavy operations such as generative AI synthesis or multi-file asset processing cannot and should not run synchronously within the script loop. The host bridge provides non-blocking job submission, polling, cancellation, and atomic candidate application.

### Host bridge properties and methods

- `host.version`: Returns the host bridge API version number (currently `1`).
- `host.capabilities`: Returns a read-only array of supported capabilities (e.g. `["jobs", "assets", "generation"]`).

### Asynchronous job operations (`host.jobs`)

- `await host.jobs.submit(request)`: Submits a new background job. Requires `jobs:run` permission. Returns a `JobDescriptor` containing `id`, `status` (`"queued"`, `"running"`, `"succeeded"`, `"failed"`, `"cancelled"`), `createdAt`, `progress` (0 to 1), and `candidate` (if completed). The job runs asynchronously on the host and is not bounded by the script's 5-second CPU limit.
- `await host.jobs.get(jobId)`: Polls the current status, progress, error, and staged candidate of a job by ID.
- `await host.jobs.cancel(jobId)`: Cancels a running or queued job.
- `await host.jobs.list()`: Returns an array of recent job descriptors.
- `await host.jobs.applyCandidate(jobId, options)`: Atomically applies the candidate from a succeeded job onto the active document. Requires `document:write` permission. Options include `name` (layer name), `blendMode`, `opacity`, `x`, `y`. The modification is applied within a single transaction with full undo/redo support.

### Asset store operations (`host.assets`)

- `await host.assets.list()`: Lists metadata for stored document assets (`id`, `byteSize`, `mimeType`, `width`, `height`). Requires `assets:read` permission.
- `await host.assets.get(assetId)`: Retrieves asset descriptor and metadata for a specific stored asset. Does not expose raw binary buffers to scripts without explicit permission.

### Permissions and security model

Host bridge calls are gated at the host boundary:

1. Scripts and plugins only have access to capabilities permitted by their manifest and granted by the user. If a plugin attempts to call `host.jobs.submit` without `jobs:run` granted, the host throws a descriptive permission error (`"Permission 'jobs:run' is required"`).
2. Applying candidates via `host.jobs.applyCandidate` requires `document:write`.
3. Accessing asset metadata requires `assets:read`.
4. Host bridge RPC requests pass across standard message-passing channels (`host:call`), preventing prototype pollution, memory sharing, or credential leakage.

<!-- example: host-job-bridge -->

```js
if (host.capabilities.includes("jobs")) {
  const jobs = await host.jobs.list();
  print("Active or completed jobs:", jobs.length);
}
```

## Document guides

`new Guide({ id?, orientation, position })` creates an immutable guide value. Orientation is `"vertical"` (x coordinate) or `"horizontal"` (y coordinate); position is measured in document pixels. IDs default to a generated unique string. Fractional and negative coordinates are allowed; nonfinite or out-of-safe-range positions and invalid orientations reject.

`document.guides` is a `GuideCollection`:

- `length: number` and `items: Guide[]` read immutable value snapshots, not live handles.
- `add(guide: Guide): Guide` attaches a constructor value; duplicate IDs reject atomically.
- `update(id, { orientation?, position? }): Guide` replaces a guide and returns the new value.
- `remove(id): void` removes a guide. Update/removal of missing IDs reject.
- `clear(): void` removes all guides; an empty collection is unchanged.
- `guide.toJSON()` returns detached serialization data.

Edits use shared commands, revision validation and undo. Wrap multiple edits in `document.transaction(...)` to group history in direct DOM use; isolated script commits already form one transaction. Guides survive project save/reopen. Crop rebases their positions with artwork; canvas resize preserves their coordinates. Guides inside the canvas are displayed as non-exported overlays. Move-tool “Snap to canvas and guides” includes their coordinates; Alt temporarily bypasses snapping. The Properties panel’s Guides section creates, edits, deletes and clears guides. Show guides is a session-only visibility toggle; hidden guides do not attract snapping. In the Move tool, drag existing guide lines or focus them and use arrow keys (Shift: 10 pixels). Escape cancels a drag. Drag from a viewport ruler into the document to create a guide, or focus the ruler and press Enter for a centered guide. Escape cancels creation. Show guides also controls ruler visibility.

```js
const margin = document.guides.add(
  new Guide({ orientation: "vertical", position: 24 }),
);
document.guides.update(margin.id, { position: 32.5 });
print(document.guides.items.map((guide) => guide.toJSON()));
```

## Recipes

Each block is a complete script for the Scripts panel. Image-editing recipes assume an unlocked selected raster and unlocked ancestor groups. They modify the open composition; use editor undo after trying one.

### Inspect the whole layer tree

<!-- example: inspect-tree -->

```js
function visit(layers, depth = 0) {
  for (const layer of layers) {
    print("  ".repeat(depth) + layer.kind + ": " + layer.name, layer.id);
    if (layer instanceof LayerGroup) visit(layer.layers, depth + 1);
  }
}
visit(document.layers);
```

### Build a group with a new constructor-created raster

The new copy is placed at the document origin. This deliberately reuses source pixels with fresh layer settings; unlike `duplicate()`, it does not copy the source layer's adjustments.

<!-- example: construct-group -->

```js
const source = document.selectedLayer;
if (!(source instanceof RasterLayer)) throw new Error("Select an image layer.");

const group = new LayerGroup({ name: "Source variations" });
const image = new RasterLayer({
  name: "New treatment",
  assetId: source.assetId,
  width: source.width,
  height: source.height,
});
image.adjustments.add(new ToneAdjustment({ contrast: 8 }));
group.layers.add(image);
document.layers.add(group);
document.selectedLayer = image;
print("Added", image.name, "without changing the original asset");
```

### Scale proportionally and change tone

This changes the layer's displayed dimensions while keeping its position and source resolution. It changes the first tone adjustment, leaving any later adjustments intact.

<!-- example: scale-and-tone -->

```js
const image = document.selectedLayer;
if (!(image instanceof RasterLayer)) throw new Error("Select an image layer.");

const factor = 0.5;
if (image.width * factor < 1 || image.height * factor < 1) {
  throw new Error("The resulting layer would be smaller than one pixel.");
}
document.transaction("Scale and tone", () => {
  image.update({ width: image.width * factor, height: image.height * factor });
  image.setTone({ exposure: 0.15, contrast: 5, enabled: true });
});
print("Display size:", image.width, image.height);
```

### Apply a treatment across unlocked images

This recursively visits groups and skips any locked node or subtree. It includes hidden layers and preserves original image assets.

<!-- example: batch-tone -->

```js
let changed = 0;
function applyTreatment(layers) {
  for (const layer of layers) {
    if (layer.locked) continue;
    if (layer instanceof LayerGroup) applyTreatment(layer.layers);
    else if (layer instanceof RasterLayer) {
      layer.setTone({ saturation: -20 });
      changed++;
    }
  }
}
applyTreatment(document.layers);
print("Applied treatment to", changed, "image layers");
```

### Use a separate document for metadata preparation

This example makes no change to the open composition. Creating a document is useful for constructing or inspecting metadata, not for switching the active editor tab.

<!-- example: separate-document -->

```js
const prepared = new Document({
  name: "50 MP layout",
  width: 10000,
  height: 5000,
});
prepared.layers.add(new LayerGroup({ name: "Artwork" }));
const restored = Document.fromJSON(prepared.toJSON());
print(restored.name, restored.width, restored.height, restored.layers.length);
```

### Paint, curves, selection and styles

This script works on an empty or existing document. It keeps all content editable and applies the selection explicitly to paint. Use one undo to remove the complete run.

<!-- example: drawing-and-styles -->

```js
const selection = new MarqueeSelection({
  shape: "ellipse",
  x: 20,
  y: 20,
  width: 220,
  height: 160,
});
document.selection = selection;
const paint = new PaintLayer({ name: "Scripted painting" });
paint.strokes.add(
  new PaintFill({
    bounds: { x: 20, y: 20, width: 220, height: 160 },
    color: "#364d42",
    clip: selection,
  }),
);
paint.strokes.add(
  new BrushStroke({
    points: [
      { x: 30, y: 80 },
      { x: 220, y: 100 },
    ],
    size: 36,
    hardness: 0.5,
    color: "#d5e79b",
    clip: selection,
  }),
);
paint.strokes.add(
  new PencilStroke({
    points: [
      { x: 60, y: 50 },
      { x: 180, y: 150 },
    ],
    size: 2,
    color: "#ffffff",
    clip: selection,
  }),
);
document.layers.add(paint);
const vector = document.layers.add(new VectorLayer({ name: "Editable curve" }));
const path = vector.paths.add(
  new VectorPath({
    points: [
      { x: 60, y: 100, out: { x: 80, y: 30 } },
      { x: 220, y: 120, in: { x: 180, y: 200 } },
    ],
    stroke: "#f5aea0",
    strokeWidth: 4,
  }),
);
path.setPoint(1, { x: 230 });
vector.styles = new LayerStyle({
  dropShadow: { enabled: true, x: 3, y: 5, blur: 4 },
  blendIf: new BlendIf({ enabled: true, source: [0, 20, 240, 255] }),
});
document.deselect();
document.selectedLayer = vector;
print(
  "Created",
  paint.strokes.length,
  "paint operations and",
  path.points.length,
  "anchors",
);
```

### Clone from an existing image asset

Unlike the UI clone tool's visible-composite sampling, this script reuses the selected raster's original asset. The tile places the full source at the layer's local origin, and the stroke reveals part of it. Adjustments on the selected raster are not baked into the asset.

<!-- example: clone-existing-asset -->

```js
const source = document.selectedLayer;
if (!(source instanceof RasterLayer)) throw new Error("Select an image layer.");
const clone = document.layers.add(new PaintLayer({ name: "Scripted clone" }));
clone.strokes.add(
  new CloneStroke({
    points: [
      { x: 60, y: 60 },
      { x: 160, y: 120 },
    ],
    size: 70,
    hardness: 0.5,
    tiles: [
      {
        assetId: source.assetId,
        x: 0,
        y: 0,
        width: source.width,
        height: source.height,
      },
    ],
  }),
);
document.selectedLayer = clone;
print("Clone source retained:", source.assetId);
```

### Add a styled text layer

<!-- example: add-text-layer -->

```js
const text = new TextLayer({
  name: "Title",
  text: "Luma Editor",
  fontSize: 48,
  fontFamily: "sans-serif",
  color: "#d5e79b",
  align: "left",
  x: 40,
  y: 40,
});
document.layers.add(text);
document.selectedLayer = text;
print("Created text layer with width", text.width, "and height", text.height);
```

### Add an adjustment layer with custom levels

<!-- example: add-adjustment-layer -->

```js
const adj = new AdjustmentLayer({
  name: "Warm Shadows",
  opacity: 0.9,
});
adj.setLevels({
  rgb: {
    inputBlack: 15,
    inputWhite: 245,
    gamma: 1.1,
    outputBlack: 0,
    outputWhite: 255,
  },
  red: {
    inputBlack: 0,
    inputWhite: 255,
    gamma: 1.05,
    outputBlack: 10,
    outputWhite: 255,
  },
});
document.layers.add(adj);
document.selectedLayer = adj;
print("Created adjustment layer:", adj.name, "with kind:", adj.adjustmentKind);
```

## Errors and limits

Methods throw `Error` for invalid ownership, missing objects, locks and invalid values. Catch errors only when the script can deliberately recover. An uncaught error discards the run's collected edits. Host validation errors can happen after the script finishes, so they cannot be caught inside the script.

| Error / symptom                                                            | Cause and action                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Layer belongs to another document.`                                       | Selection belongs to a different model. Retrieve from the supplied `document`.                                     |
| `This layer already has an owner. Use moveTo or duplicate.`                | Tried to add an owned layer. Move it after attachment or create a new object.                                      |
| `Unlock this layer and its parent groups first.`                           | A node or ancestor is locked. Unlock the intended nodes in the editor before rerunning.                            |
| `This layer is not in the current document revision.`                      | A removed or rolled-back handle is being read. Retrieve a currently existing node.                                 |
| `Missing image asset: …`                                                   | A raster references an asset absent from the host. Import an image through the editor and reuse its `assetId`.     |
| `Transactions must be synchronous.`                                        | Async transaction callback. Await preparation outside it.                                                          |
| `Use editor undo/redo after a script finishes.`                            | Called history methods on the supplied `document`. Use the UI after completion.                                    |
| `The document changed while the script ran. No script edits were applied.` | Host content/revision changed or the active document was replaced. Review the current document and rerun.          |
| `Script exceeded its 5-second time limit. No edits were applied.`          | The runtime deadline elapsed. Simplify the operation or split it into deliberate runs.                             |
| `The script returned invalid or unsupported document operations.`          | Returned commands failed schema or complexity checks. Use supported constructors/properties and reduce complexity. |
| `new Document()` appears to do nothing                                     | It created a separate model. Edit the provided `document` to change the current composition.                       |
| `document.querySelector` / `editor` / `window` is unavailable              | The script runs in a worker with the editor DOM and explicit bindings, not the application's page context.         |

Current execution budgets:

| Budget             | Current implementation                                                                                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Script source      | At most 50,000 JavaScript string code units (`code.length`).                                                                                                                                                                        |
| Runtime            | 5 seconds from runner setup, including worker startup and awaited work.                                                                                                                                                             |
| Captured commands  | At most 256 top-level emitted commands; each transaction command array also allows at most 256. Setting multiple properties normally emits multiple commands; `update(patch)` emits one. These are command counts, not line counts. |
| Payload complexity | At most 40,000 visited values and depth 40 in returned command data, in addition to structural/schema rules.                                                                                                                        |
| Output             | First 100 `print` calls, each truncated to 2,000 code units.                                                                                                                                                                        |
| Drawing structure  | 2048 operations per paint layer; 2048 paths per vector layer; 20,000 points per stroke/path; 128 selection regions; 4096 clone tiles per stroke. Automation payload budgets can be reached earlier.                                 |
| Document structure | 64 total layer/group nodes, 8 group nesting levels, 8 effects per raster; 60 host undo entries.                                                                                                                                     |

These are automation/structure budgets, not image megapixel or file-size limits. The isolated worker does not have a strict heap-memory quota; the prototype is not a security-reviewed public plugin runtime. Image import/export, saving files, network integrations, UI/tool control, persistent event automation, arbitrary layer masks, pixel reads, clone-source sampling and AI calls are not exposed in the Scripts panel yet.

## Application integration

This section is for trusted application code and development-console inspection, not code pasted into Scripts. The constructors are exported from [src/dom/index.ts](../src/dom/index.ts). During development only, `window.luma` exposes those constructors plus the application instance as `window.luma.editor`. No global `luma` API is exposed in production.

| Application method        | Return / behavior                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor.runScript(code)`  | `Promise<string[]>`; runs the isolated scripting workflow and resolves to output lines after validated host application. Rejects on script/host failure. |
| `editor.scripts.cancel()` | Cancel a pending run; its promise rejects and no script edits apply.                                                                                     |
| `editor.document`         | Current live host `Document`. Direct trusted mutations use shared validation and history.                                                                |

Directly accessing `editor.document` bypasses script isolation: ordinary setters create individual host history entries unless wrapped in a synchronous transaction. `editor.runScript` already handles snapshotting, validation, revision checking and a single host history entry; prefer it when executing user-authored script text. Never evaluate user scripts in the page context.

The document also exposes integration hooks: `subscribe(listener)` registers a state-change listener and returns an unsubscribe function; `onCommand(listener)` observes dispatched commands and returns an unsubscribe function; `getSnapshot()` returns the current editor state (`document`, `selectedId`, `past`, `future`, `revision`). Treat snapshots as read-only and listeners as non-throwing. `onHistoryNavigation(listener: (direction: "undo" | "redo") => void): () => void` observes completed undo/redo navigation and returns an unsubscribe function. Empty history navigation emits nothing; listener callbacks must not throw. This DOM hook does not create an additional undo entry; subscriptions inside Scripts observe only the temporary worker document, never host history. Command listeners are not a complete history event stream: undo/redo and active-layer changes do not emit mutation commands; pixel selection does. These hooks are for application adapters; subscriptions created inside Scripts observe only that temporary worker instance and end with the run.

Underscore-prefixed members (`_dispatch`, `_read`, `_attach`, etc.), worker messaging, and store internals are not supported scripting API. JSON/command types are transport formats, not alternate live object setters. Public SDK packaging, general API stability guarantees and a script library remain future work. Versioned command plugin packages and document permissions are available through the separate Plugins panel.

## Maintaining this contract

Update this guide whenever a constructor, public member, default, validation rule, runtime binding, budget or history behavior changes. Keep the [API overview](API.md), [requirements](REQUIREMENTS.md) and [architecture](ARCHITECTURE.md) consistent. Keep examples runnable in the Scripts panel without invented assets or page globals.

The named `example` markers identify the complete JavaScript examples for verification. They can be extracted and run against the shared DOM/runtime with a fixture document; examples that edit an image need an unlocked selected raster and its registered asset. Browser behavior is covered by [editor.e2e.ts](../tests/editor.e2e.ts) and [tools.e2e.ts](../tests/tools.e2e.ts), including every named recipe, constructor-based scripting, rollback, timeout, isolation and revision conflicts. Plugin behavior is covered separately in [plugins.e2e.ts](../tests/plugins.e2e.ts).

## LayerMetadata

Every layer kind, including groups, exposes `layer.metadata`, a live `LayerMetadata` handle. `new LayerMetadata(values = {})` creates a detached value. Assigning it to `layer.metadata` replaces that layer's authored record with a copy. Values are separate from embedded source-file declarations: they do not rewrite original bytes, establish rights, or change rendering.

| Property               | Default | Bound                                    |
| ---------------------- | ------- | ---------------------------------------- |
| `title`                | `""`    | 240 characters                           |
| `description`          | `""`    | 4,096 characters                         |
| `altText`              | `""`    | 2,048 characters                         |
| `creator`              | `""`    | 240 characters                           |
| `copyright`, `license` | `""`    | 1,024 characters each                    |
| `keywords`             | `[]`    | At most 64 strings, each 1–80 characters |

String bounds use JavaScript string length (UTF-16 code units). Unknown fields and invalid types/lengths throw; strings are not truncated. The API preserves supplied whitespace and keyword order/duplicates. The inspector's comma-separated keyword input trims and deduplicates its entries.

- Read/write the properties directly, or call `update(partialValues)` to merge several fields in one command.
- `reset()` clears authored values; attached layers store `metadata: null` and getters return defaults.
- `toJSON()` returns an independent complete DTO. Arrays returned by getters are copies; assign a new array to change keywords.
- Attached changes honor layer/ancestor locks, use shared commands and participate in transaction rollback and undo/redo. Retained handles reflect the current revision; removed layer handles throw. Detached changes do not create history.
- Duplicated layers copy the record independently. Metadata was introduced in schema v2 and persists in current schema v6; `Document.fromJSON` migrates valid v1–v5 data to v6. Older builds reject newer schemas. Embedded extraction results are not exposed through this scripting object.

<!-- example: authored-metadata -->

```js
const caption = document.layers.add(new TextLayer({ text: "Botanical study" }));
caption.metadata = new LayerMetadata({
  title: "Botanical study",
  creator: "Studio",
  altText: "The words Botanical study",
  keywords: ["botanical", "typography"],
});
caption.metadata.update({ description: "Working title for the collection" });
print(caption.metadata.toJSON());
```

Script and plugin runs commit these edits together under their existing single-undo boundary. Plugins need `document:write`. REST clients send the complete serialized record rather than a constructor; see [REST metadata commands](API.md#authored-layer-metadata).

## LayerMask

`new LayerMask({ selection, enabled = true, inverted = false, density = 1, feather = 0 })` creates an immutable selection-based mask. `selection` is a required `MarqueeSelection` in **layer-local document pixels**. It supports up to 128 ordered rectangle/ellipse add/subtract/intersect regions. `density` must be finite and between 0 and 1; booleans must be booleans. Invalid values throw. Empty selection hides all content; invert it to reveal all.

All layer kinds and groups expose `layer.mask: LayerMask | null`. Assign a mask or `null` to change/remove it through the normal locked-layer, validation, transaction and undo boundaries. Getter values and `toJSON()` snapshots are independent copies. `mask.with(partialOptions)` returns a new value; assign it back to commit. Read-only getters shared by all mask kinds: `kind`, `enabled`, `inverted`, `density`, `feather`, `x`, `y`, `linked`. `selection` is only valid for selection masks.

`layer.maskFromSelection(selection)` requires an attached layer. It captures a **document-space** `MarqueeSelection`, applies the inverse composed layer matrix, and assigns a local mask with default options. Rotation, scale, reflection and shear are retained in the selection-region basis. It leaves the document selection unchanged. Mask geometry then moves with the layer and remains aligned through position-preserving reparenting. Raster width/height changes do not scale mask geometry; independent mask translation/linking is described below; affine mask transforms remain planned.

The mask clips layer content before color overlay, fill opacity, drop shadow and Blend If. A group's mask clips its composed children. Density interpolates between fully revealed content at 0 and full mask coverage at 1. Disabled masks reveal the unmasked content. Original pixels remain unchanged; masks affect the viewport, clone sampling and exported pixels. Current document schema v3 stores masks and migrates valid v1/v2 documents; older schemas cannot contain non-null masks.

<!-- example: layer-mask -->

```js
const layer = document.layers.add(new PaintLayer());
layer.strokes.add(
  new PaintFill({
    bounds: { x: 0, y: 0, width: 300, height: 200 },
    color: "#ed9966",
  }),
);
layer.mask = new LayerMask({
  selection: new MarqueeSelection({
    shape: "ellipse",
    x: 20,
    y: 20,
    width: 240,
    height: 160,
  }),
});
layer.mask = layer.mask.with({ density: 0.85 });
print(layer.mask.toJSON());
```

Brush-based painted masks and asset-backed bitmap masks are described below. Bitmap masks reference image assets in the document's AssetStore and can be generated interactively via alpha matting (`layer.refineEdge()`) or attached directly with `layer.maskFromBitmap(assetId)`. Arbitrary clipping-mask stack relationships remain planned; unsupported DTO fields are rejected. REST accepts a full `mask` replacement or null in `layer.update`; see [REST masks](API.md#layer-masks).

### Bézier masks

`new LayerMask({ paths, fillRule = "evenodd", enabled = true, inverted = false, density = 1, feather = 0 })` accepts an array of **closed** `VectorPath` objects instead of a selection. Supply exactly one geometry source (`paths`, `selection`, or painted `base`). Open paths throw. Mask geometry is limited to 128 paths and 20,000 total anchors, with at least one anchor per path; curved closed paths can use fewer than three anchors. An empty path array hides all content before inversion/density.

Only anchors and their incoming/outgoing control handles are copied; path IDs, fill/stroke colors and widths are not mask data. All contours are filled as one compound path. `"evenodd"` alternates coverage at each nested contour, producing holes without reversing path direction. `"nonzero"` uses winding direction. Get `mask.fillRule` for vector masks (`null` for selection masks); change it with `mask.with({ fillRule })`. Invalid rules throw.

`mask.paths` returns independent detached `VectorPath` objects, always closed with no fill/stroke styling. Edit those paths and assign `layer.mask = layer.mask.with({ paths })` to commit. Reading `paths` on a selection mask or `selection` on a vector mask throws. `with({ paths })` or `with({ selection })` can replace the geometry kind while retaining enabled/inversion/density/feather/position/linking; switching to paths defaults to even-odd unless a rule is supplied. Detached edits do not affect the layer until assigned.

`layer.maskFromPaths(source: VectorLayer)` requires both layers to be attached to the same document and the source to contain closed paths. It copies **all** source paths into the target's local coordinate space, accounting for source/target ancestor translations. Empty/open sources fail without changing the target. The source layer is not changed or hidden. Later source edits do not update the copied mask. The target's locks/history apply; a locked source may still be read. The inspector offers eligible vector layers as **Mask path source**; create/replace from paths captures the same snapshot.

<!-- example: bezier-mask -->

```js
const artwork = document.layers.add(new PaintLayer());
artwork.strokes.add(
  new PaintFill({
    bounds: { x: 0, y: 0, width: 180, height: 140 },
    color: "#ed9966",
  }),
);
const outline = new VectorPath({
  closed: true,
  points: [
    { x: 20, y: 70, in: { x: 20, y: 10 }, out: { x: 20, y: 130 } },
    { x: 160, y: 70, in: { x: 160, y: 130 }, out: { x: 160, y: 10 } },
  ],
});
artwork.mask = new LayerMask({ paths: [outline], feather: 8 });
print(artwork.mask.kind, artwork.mask.fillRule);
```

The existing document schema v3 stores this additional mask kind; earlier readers that only support selection masks reject the new kind explicitly. Canvas rasterizes the curves for export and GPU coverage textures; GPU compositing/inversion/density remain accelerated. The Pen tool’s Mask paths target edits existing mask anchors/handles directly. Select a mask anchor and choose **Insert midpoint**, or click a nearby mask curve, to split a segment while preserving its shape. Scripts use `VectorPath.splitSegment(index, t)` with an explicit parameter; viewport hit testing is an internal UI operation and adds no scripting or REST endpoint. The **New contour** action draws additional closed mask paths directly, previewing until Enter or clicking the first anchor commits one undo entry. Properties → Add Bézier mask can start an empty mask without a source vector layer. Scripts create contours with `new VectorPath({closed: true, points})` and assign `mask.with({paths: [...mask.paths, newPath]})`. A live source-path link remains planned.

### Mask feathering

All mask kinds accept `feather`, a finite number from 0 to 128 in document pixels; default 0 preserves the original hard coverage. Read `mask.feather` or assign `layer.mask = layer.mask.with({ feather: 12.5 })`. The Properties panel pairs a **Mask feather** slider with an exact pixel input. Changes share locks, preview/commit, undo, scripts, REST and project persistence. Older mask DTOs that omit the optional field read as zero; older builds with a strict mask schema reject new DTOs containing it.

Feathering softens mask coverage before inversion, density, styles and blending. It uses three separable box-filter passes, with each pass's half-width equal to one third of the requested feather distance, scaled independently to the render grid. Fractional endpoint weights support fractional radii; floating-point intermediates are rounded to byte alpha after the final pass. This is Luma's defined smoothing kernel, not a claim of Photoshop/Gaussian-kernel equivalence.

Coverage tiles include the entire finite filter support, so nearby geometry outside a viewport/export tile still contributes. Existing source pixels are not blurred. Empty/reveal-all masks retain their meaning, and density zero or disabled masks bypass feathering. At extreme zoom/radius combinations a four-million-pixel working-tile budget can prevent rendering; the error asks users to reduce zoom or feather radius. This is a rendering allocation constraint, not an image import limit. Export computes the requested radius at source resolution.

### Mask position and linking

Both `LayerMask` constructor forms and `with()` accept `x = 0`, `y = 0`, and `linked = true`. The coordinate values are finite document-pixel numbers bounded by ±`Number.MAX_SAFE_INTEGER`; fractions are allowed. They position the mask's **coordinate origin**, not its shape's bounding-box corner. Region/path coordinates remain unchanged.

- With `linked: true`, mask origin = accumulated layer/ancestor translation + `{x, y}`. Moving a layer or its ancestors moves its mask.
- With `linked: false`, mask origin = `{x, y}` in document coordinates. Layer/ancestor moves and reparenting move the source content through the stationary mask.
- `layer.setMaskLinked(linked: boolean)` switches these coordinate planes and adjusts `x/y` to preserve the mask's visible position. It requires an attached layer with an existing mask; invalid arguments, missing masks, locks or out-of-range resulting coordinates throw. Repeating the current state is a no-op without a history entry.
- `mask.with({ linked })` changes the flag literally, without converting coordinates. Use `setMaskLinked` for a position-preserving toggle. REST clients perform equivalent coordinate conversion before submitting a complete replacement.
- Set `layer.mask = layer.mask.with({ x, y })` to move just the mask. The inspector's **Mask X/Y** inputs use this operation; **Link mask to layer** uses the position-preserving method. Inputs and toggle share undo, locks and persistence.

Old mask DTOs without these fields default to `{ x: 0, y: 0, linked: true }`. Duplicates copy mask coordinates and link state independently: an unlinked duplicate retains the same document-space mask even though the layer duplication operation offsets source content. Selection/path capture creates a new linked mask with default offsets and settings. Rotation, scaling and direct canvas dragging of masks remain planned; changing raster width/height does not scale mask geometry.

<!-- example: mask-position -->

```js
const layer = document.layers.add(new PaintLayer({ x: 20, y: 10 }));
layer.strokes.add(
  new PaintFill({
    bounds: { x: 0, y: 0, width: 200, height: 150 },
    color: "#ed9966",
  }),
);
layer.mask = new LayerMask({
  selection: new MarqueeSelection({
    shape: "ellipse",
    x: 30,
    y: 20,
    width: 100,
    height: 80,
  }),
  feather: 4,
});
layer.setMaskLinked(false);
layer.x += 10; // Content moves; the mask stays at its current canvas position.
layer.mask = layer.mask.with({ y: layer.mask.y + 5 }); // Move only the mask.
print(layer.mask.x, layer.mask.y, layer.mask.linked);
```

### Painted masks

`new LayerMask({ base, strokes = [], ...settings })` creates brush-based coverage. `base` is required and finite in 0–1: 1 initially reveals everything, 0 hides everything, and intermediate values give uniform coverage. Settings (`x`, `y`, `linked`, `enabled`, `inverted`, `density`, `feather`) have the same defaults and meaning as other masks. Supply exactly one geometry source: `base`, `selection`, or `paths`. Painted masks record brush operations and rasterize them at rendering time; they do not yet import grayscale bitmap masks. Selection and vector masks can also receive strokes directly, retaining their own geometry beneath the refinements.

`mask.paint(stroke, mode = "hide")` returns a new immutable mask with one operation appended. Assign the result to `layer.mask` to commit. Only `BrushStroke` and `PencilStroke` without source tiles are accepted; clone and fill operations are rejected. Mode is `"hide"` or `"reveal"`. The stroke's color is ignored: pressure, size, hardness and clipping determine coverage, and opacity applies once to the complete stroke. Hide multiplies existing coverage by `(1 - stroke coverage × opacity)`; Reveal composites opaque coverage over it. Inversion, density and feather are mask-wide settings applied after these operations, so inversion reverses the apparent hide/reveal result.

Stroke points and clip regions use the mask's coordinate plane. They do not automatically capture `document.selection` in scripts. UI brush painting converts the document selection and pointer positions into that plane at gesture start. The default linked plane moves with the layer; unlinked masks use document coordinates plus mask x/y.

Read `mask.base` (null for other kinds) and `mask.strokes` (an empty array when there are no refinements). Each stroke entry is `{ stroke: BrushStroke | PencilStroke, mode }`; returned objects are independent values. `mask.with({ strokes })` replaces the ordered operations, and `mask.with({ base })` changes the initial coverage without removing existing strokes. Passing `base` to another mask kind replaces its geometry with a uniform painted base and retains strokes. Changing geometry through `.with({ selection })` or `.with({ paths })` also preserves strokes unless `strokes: []` is supplied. Direct capture methods such as `layer.maskFromSelection` create a fresh mask instead. At most 2,048 operations, 20,000 points per stroke and 200,000 total points are accepted; script/REST payload budgets can be reached earlier. These are editing-data limits, not image resolution limits. Project schema v3 stores `kind: "paint"`; older strict readers reject it.

<!-- example: painted-mask -->

```js
const layer = document.layers.add(
  new PaintLayer({ name: "Painted mask example" }),
);
layer.strokes.add(
  new PaintFill({
    bounds: { x: 0, y: 0, width: 200, height: 150 },
    color: "#dc9457",
  }),
);
layer.mask = new LayerMask({ base: 1 })
  .paint(
    new BrushStroke({
      points: [
        { x: 40, y: 50 },
        { x: 140, y: 90 },
      ],
      size: 36,
      hardness: 0.6,
    }),
    "hide",
  )
  .paint(new PencilStroke({ points: [{ x: 80, y: 66 }], size: 12 }), "reveal");
document.selectedLayer = layer;
print(layer.mask.kind, layer.mask.strokes.length);
```

### Paint refinements on selection and vector masks

All mask kinds accept optional constructor `strokes: [{ stroke, mode }]` and support `mask.paint(stroke, mode)` and `mask.with({ strokes })`. Selection regions or Bézier paths form the initial coverage; strokes then hide/reveal that coverage before mask-wide feather, inversion and density. Reveal strokes may extend coverage outside the original shape. Base geometry and stroke points remain separately editable in the same mask coordinate plane. The kind stays `"selection"` or `"vector"`; no raster conversion or loss of path handles occurs. The same 2,048-stroke / 200,000-total-point limits apply. Old DTOs without strokes read as no refinements; older strict readers reject the new field.

<!-- example: refined-selection-mask -->

```js
const layer = document.layers.add(
  new PaintLayer({ name: "Refined geometric mask" }),
);
layer.strokes.add(
  new PaintFill({
    bounds: { x: 0, y: 0, width: 240, height: 180 },
    color: "#c99466",
  }),
);
layer.mask = new LayerMask({
  selection: new MarqueeSelection({
    shape: "ellipse",
    x: 20,
    y: 20,
    width: 160,
    height: 120,
  }),
}).paint(new BrushStroke({ points: [{ x: 70, y: 70 }], size: 30 }), "hide");
print(
  layer.mask.kind,
  layer.mask.selection.regions.length,
  layer.mask.strokes.length,
);
document.selectedLayer = layer;
```

### Bitmap masks and alpha matting

`LayerMask.fromBitmap(assetId, options = {})` creates an immutable bitmap-based mask referencing a PNG mask asset stored in the project's `AssetStore`.

Options and properties:

- `assetId` (string, required): Asset identifier in the document asset store.
- `enabled` (boolean, default: `true`): Enable or bypass the mask.
- `inverted` (boolean, default: `false`): Invert mask coverage (opaque becomes transparent).
- `density` (number, default: `1`): Mask density multiplier in 0...1.
- `feather` (number, default: `0`): Post-matting edge feathering radius in document pixels (0...128).
- `x`, `y` (number, default: `0`): Mask origin coordinates in layer-local pixels.
- `linked` (boolean, default: `true`): Link mask origin to layer translation.

All attached layers expose `layer.maskFromBitmap(assetId)`.

#### Alpha matting and background removal

Alpha matting (`rasterLayer.refineEdge(options)` and `document.removeBackground(targetLayer)`) isolates complex foreground objects (such as fine hair, fur, foliage, and translucent fabrics) by computing soft fractional alpha coverage:

- **Zero Destructive Mutation**: Original raster source image bytes in `AssetStore` are never altered byte-for-byte. The computed alpha channel is encoded as a separate bitmap mask asset and non-destructively attached to the layer.
- **Single-Transaction Undo**: Background removal and edge refinement are applied through the single command `mask.setFromMatting`, allowing `document.undo()` to revert the entire operation in exactly one history step.
- **Color Decontamination**: Unmixes background color bleeding from foreground semi-transparent edge pixels using local background radiance estimation: $\hat{F} = (I - (1 - \alpha) B) / \alpha$.
- **Project Persistence**: Bitmap mask assets are tracked via `referencedAssets(doc.toJSON())` and automatically persisted in `.luma` project files.

### Subdivide a Bézier segment

`path.splitSegment(index, t = 0.5)` uses De Casteljau subdivision and adjusts the neighboring handles to preserve the cubic curve. `index` must be an integer identifying the starting anchor: `0..points.length-2` for open paths or `0..points.length-1` for closed paths. The last closed segment returns to anchor zero; its inserted anchor is appended. `t` must be finite and strictly between zero and one. It describes the curve parameter, not arc-length distance. The method returns `index + 1`, retains path identity/style, and throws for invalid indices, positions, locks or resulting anchor limits (20,000 per path; masks also limit total anchors to 20,000). Failed attached changes leave history unchanged. Attached paths use one `path.update`; detached mask copies must be assigned back to commit. Mathematical curve preservation does not guarantee identical raster edge rounding across renderers.

<!-- example: subdivide-mask -->

```js
const layer = document.layers.add(new PaintLayer({ name: "Editable contour" }));
layer.mask = new LayerMask({
  paths: [
    new VectorPath({
      closed: true,
      points: [
        { x: 20, y: 20, out: { x: 100, y: 0 } },
        { x: 160, y: 100 },
        { x: 20, y: 140 },
      ],
    }),
  ],
});
const mask = layer.mask;
const paths = mask.paths;
const index = paths[0].splitSegment(0, 0.5);
layer.mask = mask.with({ paths });
print("Inserted anchor", index);
```

### Canvas cropping

`document.crop({ x, y, width, height })` changes the canvas to the supplied rectangle in current document coordinates. All four fields are required. Origins must be signed safe integers; width/height must be positive safe integers, and right/bottom edges must also be safely representable. Negative origins and bounds beyond the current canvas are allowed, so content can be reframed or padding added. Invalid fields, fractional values, unsafe edges or resulting out-of-range layer/mask/selection coordinates throw without changing the document or history. There is no megapixel cap.

The command subtracts x/y from root-layer positions, from every unlinked mask origin (including nested masks), and from pixel selection coordinates. Child-local geometry and linked-mask offsets remain intact. It preserves every layer, source asset, stroke, path, effect and off-canvas pixel. This is a document coordinate change, so locked layers participate and retain their lock flags. It does not bypass locks for subsequent per-layer edits. Active-layer selection is retained; a matching zero-origin crop is a no-op. Crop, undo and redo discard transient tool coordinates such as clone sources. Completed content is saved using the existing project format; history is session-only as before.

Undo restores the previous canvas. To reframe after saving/reopening, call crop again with a negative origin and larger dimensions; resizing alone expands only from the current origin. The Crop tool supports drawn frames, eight resize handles, keyboard nudges and a precise-bounds dialog. A single rectangular marquee can supply the initial frame (fractional edges round outward to whole pixels). Draft frames stay in UI state until Apply invokes the same `document.crop` command. Rotation and straightening remain planned.

<!-- example: crop-canvas -->

```js
document.crop({ x: 32, y: 24, width: 640, height: 480 });
print("Canvas", document.width, document.height);
```

### Multiple selected layers

`document.selectedLayers` returns an ordered array of attached layer handles; the last selected layer is `document.selectedLayer` / `activeLayer`. Assigning `selectedLayer` replaces the set with that one layer (or clears it for `null`). Pixel marquee `document.selection` is unchanged and independent.

`document.selectLayers(layers, mode = "replace")` accepts attached layers from this document. Modes are `"replace"`, `"add"`, and `"remove"`; foreign/detached handles and unknown modes throw before changing selection. Adding an existing member makes it active. Selection itself creates no undo entry or document revision and is not stored in portable project files. Set selection after transactions that create layers. Removed layers are pruned from the set; undoing deletion restores artwork but does not automatically reselect it.

`document.layerSelection` is the document-owned `LayerSelection` object:

- `layers`, `activeLayer`: selected handles and active handle.
- `rootLayers`: selected handles excluding descendants of another selected layer.
- `bounds`: union of selected-root document-space geometry, or `undefined` when no bounds exist.
- `select(layers, mode = "replace")`, `clear()`: update layer selection.
- `translate(x, y)`: move selected roots by a finite document-space delta; one transaction. A selected group and child move only once.
- `align("left" | "center" | "right" | "top" | "middle" | "bottom")`: align selected-root geometric bounds to their union; one transaction. Layers without geometric bounds fail explicitly.
- `scale(x, y = x)`: scale selected roots in canvas space around their shared geometric center; positive finite factors only. Preserves editable source geometry; one undo transaction. Empty selection and unit scale are no-ops.
- `rotate(degrees)`: rotate selected roots clockwise in canvas space around their shared geometric center, preserving scale/shear through parent transforms; one transaction. Requires finite degrees and geometric bounds for every root. Empty selection and full turns are no-ops.
- `remove()`: remove selected roots in one transaction.

Mutations reject any locked selected root (including ancestor locks) without partial edits. Persisted affine transforms support multi-layer rotation and scaling. Bounds describe layer geometry, not shadow/effect extents. The inspector and individual tool settings still target the active layer.

```js
const first = document.layers.at(0);
const second = document.layers.at(1);
if (first && second) {
  document.selectLayers([first, second]);
  document.layerSelection.translate(12, 0);
  document.layerSelection.align("top");
}
```

The isolated script starts with the full host selection and returns its full final selection on successful commit. Script failure, cancellation or revision conflict commits none of it. Plugins with only `document:read` cannot change any member of the selection, even if the active layer stays the same. Existing script/host transaction limits still apply; a successful script's document edits remain one host undo entry.

### Layer matrix foundation (schema v6)

`layer.transform: AffineTransform` reads or assigns the complete local-to-parent matrix. Assignment requires finite invertible coefficients and creates one shared command/undo entry. `x` and `y` remain translation aliases; serialization stores translation in those fields and the remaining basis in optional `transform` data with `e=f=0`. Legacy v1–v5 documents migrate with identity bases; legacy schemas cannot carry transform data.

```javascript
const layer = document.selectedLayer;
if (layer) {
  layer.transform = AffineTransform.translation(200, 100).multiply(
    AffineTransform.rotation(Math.PI / 2),
  );
}
```

Rendering, export, geometric bounds and hit testing compose parent matrices. This is an incremental API foundation: interactive brush/pen/resize coordinates and mask-link toggles still require the remaining T07 matrix migration. Do not treat those editing operations on rotated/sheared/scaled layers as complete yet. Constructor options do not yet accept `AffineTransform` values; assign `transform` after construction.

`layer.moveTo(parent, { preservePosition: true })` now preserves the complete world matrix, including rotation, reflection, scale and shear, by multiplying it by the inverse destination-parent matrix. The default remains `preservePosition: false`, retaining the layer's local coordinates/basis. Moving to `document` uses the identity parent matrix. The same behavior applies to `layer.place` with `preservePosition: true` (including Layers-panel drops). Interactive brush/pen/resize coordinates and mask-link migration remain unfinished.

`document.layerSelection.translate(x, y)` and `.align(...)` convert canvas-space displacements through each selected root's inverse parent basis. Rotated, scaled, reflected, or sheared parents therefore preserve the requested canvas direction and alignment. Move-tool dragging and layer keyboard nudges use the same convention. Linked-mask dragging and nudges use the inverse complete layer basis; unlinked-mask offsets remain canvas-space. Mask link/unlink conversion and brush/pen/resize input still require further affine migration.

Brush/pencil/eraser input on existing paint layers now converts canvas points and selection clips through the inverse world matrix. Mask painting uses the inverse linked layer plus mask offset, or the independent canvas offset for unlinked masks. Stroke size stays in local layer/mask units and scales with the layer. This does not complete clone sampling, pen input, fill geometry, new-layer placement or mask link/unlink conversion on transformed artwork.

Fill-tool and fill/clear-selection operations on existing paint layers now inverse-transform canvas geometry and intersect the current selection with the canvas boundary. Their local bounding rectangle is only an allocation bound; an affine clip preserves the intended shape under rotation, scale and shear. New-layer placement under transformed groups remains separate unfinished work.

Vector-layer pen gestures now convert pointer input through the layer world matrix and measure anchor/handle hit distances in canvas space. New painting layers inside transformed groups preserve canvas placement through matrix-preserving insertion. Mask-pen/contour editing and transformed pen overlays remain separate unfinished work.

Pen overlays now follow full layer matrices (including linked vector-mask geometry), with anchor and handle controls kept at fixed screen size. This closes the earlier overlay limitation; affine mask-pen input and mask link/unlink conversion remain unfinished.

Mask-pen dragging, keyboard anchor nudges, contour creation and curve hit testing now use composed mask matrices. Linked masks include the layer world transform and mask offset; unlinked masks use their independent canvas offset. Hit tolerance stays in screen space. This closes the earlier mask-pen input limitation; link/unlink conversion, clone sampling and resize still require further affine work.

Interactive raster/text corner resizing now maps pointer deltas through the inverse world basis and positions handles at transformed corners. Origin compensation preserves the opposite corner. The selection outline remains axis-aligned; this does not add rotation/skew handles or complete clone sampling and mask link/unlink conversion.

Clone sampling now supports transformed paint destinations: source composition pixels are mapped into destination-local retained tiles while preserving canvas-relative source offsets. Stroke widths remain local units. Accepted clone tiles remain available for offline undo/redo and portable save/reopen. This closes the earlier affine clone-sampling limitation; mask link/unlink conversion and broader transform controls remain unfinished.

### Affine mask bases

`new LayerMask({ ...geometry, basis?: AffineTransform })` and `mask.with({ basis })` accept an invertible linear basis. Omission means identity; `mask.basis` returns an immutable `AffineTransform`. Translation remains in `x`/`y`, so basis `e` and `f` must both be zero. Singular, nonfinite or translated bases reject. Mask edits retain the basis unless explicitly replaced.

`layer.setMaskLinked(linked)` now preserves the complete world matrix for every mask kind, including retained paint refinements, by converting between layer-local and document coordinate planes. Linked masks compose `layerWorld × translation(x,y) × basis`; unlinked masks compose `translation(x,y) × basis`. This closes the earlier affine link/unlink limitation. The operation remains one undoable shared layer update; save/reopen retains the basis. Serialized mask bases require inner document schema 6 or later.

```js
const mask = new LayerMask({
  base: 1,
  basis: new AffineTransform(1, 0.2, 0, 1, 0, 0),
});
document.selectedLayer.mask = mask;
document.selectedLayer.setMaskLinked(false);
```

To rotate the current layer selection by 30° clockwise around its shared canvas-space center:

```js
document.layerSelection.rotate(30);
```

This preserves each root's world scale/shear through transformed parents and produces one undo transaction. It does not rasterize artwork or include effect/shadow extents in the rotation pivot. Selecting both a group and its descendant transforms only the group. Nonfinite angles, inherited locks, or a selected root without geometry reject without partial edits.

To scale the selected roots uniformly, preserving their shared center and editable contents:

```js
document.layerSelection.scale(0.5);
```

For independent canvas-axis factors, use `document.layerSelection.scale(2, 0.75)`. Zero, negative, nonfinite or unrepresentable transforms reject; locked roots and missing geometry reject without partial edits. Scaling changes affine transforms, not raster pixel dimensions or text font-size properties. Descendants of selected groups are not transformed twice.

### Editable dodge/burn strokes

`new TonalStroke({ brush, mode, range, exposure, protectTones = true })` captures a detached `BrushStroke` or `PencilStroke`. `mode` is `"dodge"` or `"burn"`; `range` is `"shadows"`, `"midtones"` or `"highlights"`; `exposure` is a finite value in [0,1]. Brush flow, pressure, hardness, opacity and clipping determine coverage. Flow is applied once during brush accumulation. `toJSON()` returns detached stroke data; changing it or the original brush does not mutate the captured value. Invalid options throw.

`AdjustmentLayer.addTonalStroke(stroke: TonalStroke): void` appends one stroke through shared validation/history and requires adjustment kind `"tonal"`; another adjustment kind, a locked layer or a plain object instead of a constructor value throws. Scripts commit their complete successful run as one undo entry. Tonal layers modify their live preceding backdrop, preserve alpha, support ordinary layer masks/opacity, and save in document schema v8. They use the Canvas/CPU-worker fallback. The Dodge (`O`) and Burn (`Shift+O`) tools create these strokes interactively, creating a tonal layer or reusing the selected tonal layer. Alternate sampling modes are not yet implemented.

```js
const retouch = document.layers.add(
  new AdjustmentLayer({
    name: "Dodge highlights",
    adjustment: { kind: "tonal", strokes: [] },
  }),
);
retouch.addTonalStroke(
  new TonalStroke({
    brush: new BrushStroke({
      points: [{ x: 16, y: 16, pressure: 1 }],
      size: 12,
      hardness: 1,
    }),
    mode: "dodge",
    range: "midtones",
    exposure: 1,
  }),
);
```

## Persistent patch adjustments

`new PatchAdjustment({ assetId, width, height })` captures a registered image asset ID and positive safe-integer local dimensions. All three fields are required. Read-only `assetId`, `width`, and `height` getters expose the captured values; `toJSON()` returns detached data. Invalid geometry or an empty ID throws. The image contains corrected RGB with alpha representing coverage. Patch blending preserves the preceding backdrop alpha, including transparent pixels; ordinary layer opacity, masks, positioning and blend modes remain available. Saved corrected RGB is a snapshot and is not recomputed when underlying artwork changes.

Pass the value as `new AdjustmentLayer({ adjustment: patch })`, or call `layer.setPatch(patch: PatchAdjustment): void` to replace an existing adjustment through shared commands. A plain object passed to `setPatch`, a locked layer, or a missing asset at script commit throws. The complete successful script creates one undo entry. Projects store these layers in document schema v9 and retain original image assets. Rendering uses the Canvas/WASM fallback with bounded working tiles.

```js
// Use an existing registered asset containing corrected RGB and coverage alpha.
const source = document.selectedLayer;
if (!(source instanceof RasterLayer))
  throw new Error("Select the prepared patch image first.");
const patch = new PatchAdjustment({
  assetId: source.assetId,
  width: source.width,
  height: source.height,
});
const layer = document.layers.add(
  new AdjustmentLayer({
    name: "Retouch patch",
    x: source.x,
    y: source.y,
    adjustment: patch,
  }),
);
```

This constructor stores an already prepared result. It does not run healing, choose a donor, or expose the internal Poisson preparation service. A trusted application host operation can solve and commit patches, but it is not exposed in isolated scripts or REST. The interactive Patch tool (`J`) uses an existing selection and a donor-offset drag. Its controls expose current-layer/current-and-below/all-layer sampling and source/mixed gradients; these UI controls do not add a solver binding to isolated scripts.

The interactive Spot Healing tool (`Shift+J`) now commits local donor-search/Poisson repairs as patch adjustments. `EditorApplication.healStroke` is host-only; planned `healSpot`/`patchRegion` sandbox APIs are not yet available. Scripts can inspect or replace the resulting patch descriptor through `AdjustmentLayer` and `PatchAdjustment`.

### Document tonal sculpt operation

`document.applyTonalSculpt(path, mode, range, exposure, options = {}): AdjustmentLayer` creates and returns an attached tonal adjustment layer above all root layers. Points use document coordinates, independent of the selected layer or its transforms. Each call creates a new layer; it does not change layer selection. The adjustment operates on the live composite below it and preserves source assets and backdrop alpha.

`path` contains 1–20,000 `{ x, y, pressure? }` points; coordinates must be finite and within safe-integer magnitude. Pressure defaults to 1 and must be in [0,1]. Mode is `"dodge"` or `"burn"`, range is `"shadows"`, `"midtones"` or `"highlights"`, and exposure is in [0,1].

Optional settings:

| Option             | Default           | Accepted values                                                                     |
| ------------------ | ----------------- | ----------------------------------------------------------------------------------- |
| `name`             | `Dodge` or `Burn` | Nonempty string, at most 240 characters                                             |
| `size`             | 24                | 0.1–2048 document pixels                                                            |
| `hardness`         | 0.7               | 0–1                                                                                 |
| `opacity` / `flow` | 1                 | 0–1                                                                                 |
| `spacing`          | 0.25              | 0.01–10 brush diameters                                                             |
| `pressureSize`     | true              | Boolean                                                                             |
| `pressureOpacity`  | false             | Boolean                                                                             |
| `protectTones`     | true              | Boolean; limits common RGB gain to avoid channel clipping                           |
| `clipSelection`    | true              | Boolean; capture the current pixel selection as stroke clipping, or use no clipping |

Inputs and clipping are copied. Invalid settings, empty paths or unknown option keys throw before any document mutation. The operation uses one shared `layer.add` command, supports an enclosing `document.transaction`, and undoes in one step when called by itself. As with other scripting edits, the entire successful isolated script commits as one undo entry. Brush/path limits are operation budgets, not document import-size limits.

```js
const retouch = document.applyTonalSculpt(
  [{ x: 16, y: 16, pressure: 1 }],
  "dodge",
  "midtones",
  1,
  { size: 12, hardness: 1 },
);
retouch.opacity = 0.8;
```

Patch placement now supports both Source and Destination in the tool options. In Source mode, select the repair region and drag toward its donor; in Destination mode, select donor artwork and drag to the repair region. Both leave selection geometry and source artwork intact. The separate Patch detail control selects source or mixed gradient guidance. Trusted host `EditorApplication.applyPatch(offset, sampling?, options?, signal?)` accepts `options.direction: "source" | "destination"` (default `"source"`) alongside the existing solver options. Offset is the integer drag displacement in document coordinates. Destination mode translates captured selection coverage by that displacement and samples donor pixels with the inverse displacement. Invalid directions reject before commit. This host method remains unavailable in isolated scripts and REST.

### Asynchronous patch regions

`await document.patchRegion(targetRegion, sourceOffset, options = {}): Promise<AdjustmentLayer>` prepares a repair through the application host and returns its attached adjustment layer in the script's private document. `targetRegion` is a `MarqueeSelection` constructor value or serialized `SelectionData`; `sourceOffset` is `{ x, y }` in safe integer document pixels. The operation does not change the document's pixel selection. In default Source direction, the region identifies pixels to repair and the offset identifies donor pixels relative to them. Destination direction translates the supplied donor selection by the offset and repairs that destination.

Options are `direction` (`"source"` default or `"destination"`), `mode` (`"source"` gradient guidance by default or `"mixed"`), `tolerance` (positive finite residual tolerance, default 0.001), `maxIterations` (positive safe integer per channel, default 500), `sampling` (`"all-layers"` default, `"current-layer"`, or `"current-and-below"`), and optional `layerId` (defaults to the script's selected layer). Sampling modes other than all-layers require a valid layer. Coordinates retain original resolution; device allocation/encoding limits still apply.

```js
const patch = await document.patchRegion(
  new MarqueeSelection({ shape: "rectangle", x: 2, y: 2, width: 5, height: 5 }),
  { x: 10, y: 0 },
  { sampling: "all-layers", mode: "source" },
);
patch.name = "Texture repair";
```

The example requires artwork covering the donor and repair regions in a document at least 17 × 7 pixels. Preparation renders preceding commands from this same script. Source bytes stay in the host, while the sandbox receives only the prepared layer description and asset reference. Prepared assets remain private until the entire script passes validation and commits. A later script error, cancellation, timeout, changed document session or revoked plugin permission discards them and commits no patch edits. A successful script keeps one undo entry; repaired pixels survive offline redo and project save/reopen.

Await each repair sequentially. At most 32 patches may be prepared per script, alongside the existing 256-command and five-second script budgets. Preparation inside a synchronous `document.transaction` rejects; ordinary awaited operations in the script still commit together automatically. Empty/outside selections, invalid options, unavailable assets/layers, donor pixels outside the canvas and nonconvergent solves reject. Standalone `new Document()` instances have no configured preparation host and reject this operation. Plugins require granted `document:write`, `assets:read` and `assets:write` permissions in addition to their required `document:read`; permissions are rechecked during preparation and before final asset transfer.

This implements the script patch-region operation. `Layer.healSpot` is described below; a headless REST patch solver remains planned. The trusted `EditorApplication.applyPatch` method continues to operate independently for interactive tools.

### Asynchronous spot healing

`await layer.healSpot(center, radius, options = {}): Promise<AdjustmentLayer>` prepares a circular healing stamp using the same host-owned donor search and Poisson solver as the interactive Healing tool. `layer` must be attached to the host-configured scripting document and unlocked, including its ancestors. `center` is `{ x, y }` in document coordinates, including when the target layer is translated or transformed. `radius` is in document pixels, from 0.05 to 1024 (the shared brush diameter range is 0.1–2048).

The result is an editable patch adjustment above all root layers. It retains repaired pixels as a new asset and leaves the original layer/source bytes and pixel selection unchanged. By default the sampler includes the target layer with its ancestor placement, masks and opacity. `sampling: "all-layers"` samples the rendered composition; `"current-and-below"` includes the target and underlying artwork.

```js
const repair = await document.activeLayer.healSpot({ x: 16, y: 16 }, 4, {
  hardness: 1,
  sampling: "current-layer",
  searchRadius: 64,
});
repair.name = "Blemish repair";
```

Options are `sampling` (default `"current-layer"`), `searchRadius` (positive safe integer pixels, default 64), `hardness` (0–1, default 0.7), `opacity` and `flow` (0–1, default 1), `clipSelection` (default true), and the same `mode`, `tolerance` and `maxIterations` solver options as `patchRegion`. A spot uses constant pressure. Current selection clipping is captured when called. Search uses visible boundary texture and available intact donor coverage; it is a deterministic local heuristic, not a semantic model or guarantee of photo-quality repairs.

Missing/detached/locked targets, invalid arguments, an empty or fully clipped stamp, insufficient intact donor area and nonconvergent solves reject without committing a repair. Standalone documents without a preparation host reject. Await calls sequentially, outside synchronous transactions; patch and healing calls share the 32-repair budget, existing five-second script limit and 256-command limit. Prior commands and prepared repairs from the same script are available to later repairs. All successful edits commit together with one undo entry; a later script error rolls them back and releases private assets. Plugin permissions and cancellation/session checks are identical to patchRegion. REST healing remains unimplemented.

## SmartObjectLayer and shared masters

Smart objects retain an embedded master and place independently transformed instances of it. Changing the master updates every instance, including instances nested inside other masters. This API is available in isolated scripts and write-capable plugins. It does not open a separate editor tab.

| Member                                                             | Contract                                                                                                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document.defineComponent(source, options?)`                       | Registers a detached snapshot of a `Document` and returns its component ID. `options.id` defaults to a new ID; supplying an existing ID replaces that master. `options.name` defaults to `source.name`. |
| `document.getComponent(componentId)`                               | Returns a detached, editable `Document` snapshot. An asset-backed master becomes a document containing its source raster. Unknown IDs throw.                                                            |
| `document.placeSmartObject(componentId, options?)`                 | Constructs and attaches a `SmartObjectLayer` at the document root. Width and height default to the master dimensions. Other options are ordinary layer options.                                         |
| `document.removeComponent(componentId)`                            | Removes an unused definition. Throws for unknown IDs, placed instances, or references from another master.                                                                                              |
| `new SmartObjectLayer({ componentId, width, height, ...options })` | Creates a detached instance. All three named fields are required. Add it to a document or group whose owning document defines that component.                                                           |
| `instance.componentId`                                             | Read-only master ID.                                                                                                                                                                                    |
| `instance.width`, `instance.height`                                | Editable instance dimensions. Scaling retains original source pixels.                                                                                                                                   |
| `instance.editContents()`                                          | Returns the same detached snapshot as `document.getComponent(instance.componentId)`. Requires an attached instance.                                                                                     |
| `instance.replaceContents(source)`                                 | Replaces the instance's shared master from a `Document`. Requires an attached instance and updates all instances of that master.                                                                        |

Ordinary layer position, transform, opacity, blend, mask, visibility, locking and collection ownership apply. Detached edits do not change the master until `replaceContents` or `defineComponent` commits them. A master replacement is one command and one undo entry; all mutations in a successful isolated script share its final atomic history entry. Updates reject if an affected placed instance or its ancestor is locked. Missing references, cycles and invalid geometry reject without committing changes.

<!-- example: shared-smart-objects -->

```js
const master = new Document({ name: "Label master", width: 160, height: 80 });
master.layers.add(new TextLayer({ text: "Edition", fontSize: 24, x: 8, y: 8 }));
const componentId = document.defineComponent(master);
const first = document.placeSmartObject(componentId, {
  name: "First label",
  x: 20,
  y: 20,
});
document.layers.add(
  new SmartObjectLayer({
    name: "Second label",
    componentId,
    width: 160,
    height: 80,
    x: 220,
    y: 20,
  }),
);
const contents = first.editContents();
contents.layers.at(0).text = "Updated edition";
first.replaceContents(contents);
```

Definitions store existing source asset IDs; `defineComponent` does not transfer image bytes from another document's asset store. Required assets must already be available in the destination. The host validates references before committing a script. A source document's own definition registry is not imported: register nested masters in the destination first, in dependency order. `getComponent` supplies detached copies of the current registry for resolving nested instances and, in trusted host code, borrows the destination asset store. Do not dispose that shared store.

Document schema 14 persists definitions, placements, per-instance filter stacks, filter masks and linked-image snapshot metadata. Project saves include original sources from every registered master, including unused masters. Visible smart objects use the Canvas compositor fallback. Raster conversion is described below. Explicit local-file relinking, selection conversion, rasterization and filter masks are described below. Interactive contents tabs are described below. Rendering bounds component expansion independently of source resolution; graphs exceeding that working budget fail explicitly.

### Convert a raster layer to a smart object

`raster.convertToSmartObject(): SmartObjectLayer` converts one attached `RasterLayer` and selects the returned instance. It replaces the raster at the same parent and stack index, retaining placement dimensions, affine transform, mask, opacity, blend mode, styles and metadata. Tone effects move into the embedded master; immutable source image bytes are reused. The operation uses one shared command and one undo entry (or the enclosing script's transaction). A fresh instance ID prevents old RasterLayer handles from pretending to have a different class: the old handle is detached after conversion and becomes attached again on undo. Unknown/detached targets, locks on the raster or ancestors, and invalid geometry reject atomically.

```js
if (!(document.selectedLayer instanceof RasterLayer)) {
  throw new Error("Select an image layer first.");
}
const instance = document.selectedLayer.convertToSmartObject();
print(instance.componentId);
```

The Layers panel exposes **Convert to smart object** for the current selection. `document.createSmartObject(layers: Layer[]): SmartObjectLayer` accepts one or more distinct, attached, contiguous sibling layers belonging to this document. Input order does not change stack order. Empty, duplicate, noncontiguous, mixed-parent, detached and locked selections reject without document changes. A single raster uses the specialized conversion above; other selections move editable layer data into an embedded document and replace the selected span with one instance, in one undo entry. Original image bytes are reused.

```js
const instance = document.createSmartObject(document.selectedLayers);
print(instance.componentId);
```

The master includes the source artboard and conservative off-canvas content/style bounds. Document-space masks are captured into linked local coordinates to preserve their position in the new master. Contents blend against one another inside an isolated component: backdrop-dependent blends and adjustments may change when their previous backdrop is outside the selection. Include that backdrop in the selection when it should become part of the master. Source layers remain editable through `editContents()` until rasterized.

### Independent smart-object copies

`smartObject.duplicateIndependent(): SmartObjectLayer` creates and selects a new instance directly above the source in the same parent, offset by 24 pixels on each axis in parent coordinates. It copies the root master and every transitively referenced master with fresh component IDs. Repeated references inside the copied graph still share one copied definition; unrelated definitions are not copied. Image assets remain immutable shared sources, so copying does not resample or duplicate their bytes. Instance geometry, masks, styles and metadata are retained. Unlinked masks retain their document coordinates, matching ordinary layer duplication.

Use ordinary `layer.duplicate()` when instances should continue sharing the original master. Use `duplicateIndependent()` when editing the copy's master or nested masters must leave the original unchanged. Both are one undoable command, or part of the enclosing isolated script's atomic transaction. Detached/non-smart targets, locked ancestry, missing definitions and invalid copied geometry reject without committing. Undo removes the copied instance and its definitions; redo restores their original IDs.

```js
if (!(document.selectedLayer instanceof SmartObjectLayer)) {
  throw new Error("Select a smart object first.");
}
const copy = document.selectedLayer.duplicateIndependent();
const contents = copy.editContents();
contents.name = "Independent artwork";
copy.replaceContents(contents);
```

For a nested master, obtain its component ID from the copied contents and commit its edited snapshot with the owning `document.defineComponent(snapshot, { id: nestedComponentId })`. Editing a detached contents document's registry alone does not commit those nested definitions to the owning document. The Layers panel's **New smart object via copy** action uses this same API.

### Interactive contents tabs (trusted application integration)

The Layers panel's **Edit contents** action opens an independent document tab with the master's artwork and original source bytes. Use normal tools to edit it, then **Apply to source** to commit its contents and nested component definitions to the owning composition in one undo entry. Until apply, the original composition is unchanged. **Keep as document** drops the apply link while preserving all contents for independent editing or saving.

Trusted browser application methods (not isolated-script bindings):

- `editor.editSmartObject(instance): Promise<Document>` opens the tab or activates an existing contents tab for that owner/master. Loading rejects if the source changes or the active workspace changes during preparation.
- `editor.applySmartObjectContents(document = editor.document): Promise<void>` applies the contents and changed nested definitions. It validates the graph, source revision, open-session lifetimes, locks and image identities before committing. Newly imported image assets are privately decoded and transferred only on success. Changes made to either document during preparation reject the apply. A source revision changed since open/last apply requires keeping this tab as a separate document and reopening the current master; no implicit overwrite occurs.
- `editor.detachSmartObjectContents(document = editor.document): void` retains the tab as an ordinary document and removes its apply link.

`SmartObjectLayer.editContents()` in scripts still returns a detached model snapshot; it does not open tabs. Contents tabs own independent asset stores, so closing one cannot dispose the composition's images. Closing the source leaves the contents tab available but prevents apply. A downloaded contents project is a separate backup, not an apply operation; pending edits still require confirmation on close.

Workspace checkpoints preserve the apply link when both owner and contents tabs are present. Manual, automatic and named workspace recovery restores the relationship, unapplied state and stale-source conflicts, including nested editing sessions. Restored links target only the owners restored from the same checkpoint, not similarly named existing tabs. Ordinary project files and standalone document recovery remain independent documents. If the owner was already closed before saving the workspace, its contents recover independently. Download or keep a separate contents document before replacing a conflicted session. Local linked-image snapshots and explicit file relinking are described below; automatic file watching remains future work.

### Copy smart objects between open documents

The trusted host operation `editor.copySelectedLayersTo(targetDocument)` and the Layers panel's **Copy selected layers to document** picker now include smart objects and groups containing them. The operation captures the selected root layers, maps their placement to document coordinates, and transfers only their reachable component definitions and image assets. Copied definitions and asset references receive new IDs. Repeated references across the selected instances remain shared within the destination, while edits to those masters do not affect the source.

Images decode in a private store before a single destination transaction installs the graph and layers. Destination revision changes or closure during preparation reject without publishing copied assets or definitions. The source is a captured snapshot: closing it after capture does not revoke the immutable bytes being copied. Source and destination retain separate asset ownership. Undo/redo removes/restores the copied graph and layers together. Unselected/unreferenced masters and their images are not transferred. This is a browser host operation, not a cross-session REST command or an isolated-script binding.

### Per-instance smart-filter stacks

`smartObject.addFilter(filter): void` appends a constructor value. `smartObject.setFilters(filters: readonly SmartFilter[]): void` replaces the entire ordered stack; pass `[]` to remove all filters. Use a reordered array or replacement values with the same IDs to reorder, change settings or disable entries. `smartObject.smartFilters` returns detached serialized snapshots; editing a snapshot does not edit the document. Constructors expose read-only `id`, `kind`, `enabled` and detached `toJSON()` data.

| Constructor                        | Options and defaults                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `new GaussianBlurFilter(options?)` | `sigma: 1`, `enabled: true`, generated `id`. Sigma is finite, 0–4096/3 master pixels.                        |
| `new UnsharpMaskFilter(options?)`  | `sigma: 1`, `amount: 1` (0–5), `threshold: 0` (0–255), `enabled: true`, generated `id`.                      |
| `new SmartToneFilter(options?)`    | `exposure: 0` (−3–3), `contrast: 0` (−100–100), `saturation: 0` (−100–100), `enabled: true`, generated `id`. |

Sigma describes Gaussian standard deviation. Filters execute first-to-last in the master pixel plane, before instance resizing/affine placement, layer masks and styles. A 2× instance scales the visible blur radius by 2× without changing its master or source image. Blur uses transparent padding and may extend beyond the master artboard; unsharp preserves alpha. The parent composition may still clip the resulting instance. Disabled filters remain serialized but do not render. Filter masks are described below. The Inspector exposes the same stacks through paired slider/number controls, enabling, reordering and removal.

```js
const layer = document.selectedLayer;
if (!(layer instanceof SmartObjectLayer))
  throw new Error("Select a smart object.");
layer.setFilters([
  new GaussianBlurFilter({ sigma: 2 }),
  new UnsharpMaskFilter({ sigma: 1, amount: 0.5, threshold: 4 }),
  new SmartToneFilter({ saturation: -20 }),
]);
```

Stacks support up to 32 entries with unique IDs within each instance. Invalid values, duplicate IDs, wrong constructor values, removed attached handles and locked instances/ancestors reject without committing history. Each attached replacement/appending call uses the shared `smartObject.filters` command and one undo entry, or the enclosing transaction/script's single entry. Detached instances can be configured before attachment. Ordinary duplicates copy settings while retaining shared master references; editing one instance's stack leaves other instances unchanged. Schema versions below 11 reject serialized smart-filter fields. Saving/reopening preserves order and settings. Large radii, extreme minification and deeply nested stacks can exceed working-memory/render budgets and fail explicitly; these limits do not restrict image import dimensions.

### Trusted host recording and job snapshots

The trusted application integration (outside the isolated Scripts panel) exposes generation jobs with detached `request` and `options` snapshots. Mutations to those snapshots have no effect on dispatch. Wrong-sized provider outputs fail validation; provider-reported charges remain in accounting.

Saved automation recipes now record name selectors as `{ by: "name", pattern: "Art*", literal: true }`. `literal` defaults to false for hand-authored selectors; true means exact, case-sensitive matching without wildcard or `${parameter}` expansion. This applies to single- and multiple-target resolution. Literal targets survive recipe export/import. Existing wildcard selectors retain their behavior. These recipe DTOs are distinct from the constructor-based scripts illustrated above.

### Smart-object filter masks

`SmartObjectLayer.filterMask` gets an immutable `LayerMask` value or `null`. Set it with a `LayerMask` constructor (or `null` to remove). It masks the entire ordered filter stack, independently of the ordinary layer mask. White coverage reveals the filtered result; black reveals the retained original. Density, inversion, feather, selection/vector/bitmap sources and painted refinements use existing LayerMask values. Disabled masks or zero density reveal the complete filtered result. Filtering and masked mixing happen before instance resampling and the ordinary layer mask/styles.

Linked filter-mask geometry is measured in native master pixels. With `linked: false`, geometry is measured in the containing document (the master document for a nested instance); moving/resizing the instance does not move that geometry. Feather is measured in native master pixels. Changing `linked` through `.with()` changes coordinate interpretation; `instance.setFilterMaskLinked(linked)` preserves the current coverage position while changing that interpretation. Brush, Pencil and Eraser support Filter mask targets as described below.

```js
const instance = document.selectedLayer;
if (!(instance instanceof SmartObjectLayer))
  throw new Error("Select a smart object.");
instance.filterMask = new LayerMask({
  selection: new MarqueeSelection({
    shape: "rectangle",
    x: 0,
    y: 0,
    width: 200,
    height: 200,
  }),
  feather: 12,
});
instance.filterMask = instance.filterMask.with({ density: 0.7 });
```

Assignments use shared `smartObject.filterMask` commands, validate constructor values and ancestry locks, and participate in a single enclosing script/transaction undo entry. Detached instances can be configured before attachment. Bitmap asset references must exist at host commit. Schema 12 preserves masks and their referenced assets on project save/reopen; versions below 12 reject non-null filter masks. The separate Filter mask Inspector section creates reveal-all/hide-all or selection-based masks, enables/inverts them, adjusts density/feather with paired slider/number controls, and removes them. Selection-based masks are unlinked in containing-document coordinates. The Follow artwork checkbox calls `setFilterMaskLinked` to preserve placement. Brush, Pencil and Eraser support Filter mask targets as described below.

`SmartObjectLayer.setFilterMaskLinked(linked: boolean): void` requires an attached instance with a filter mask. It includes parent/instance affine transforms and native-master scaling when converting offset and basis. Invalid flags, absent masks and locked changes reject; requesting the existing link state is a no-op. A successful change uses one shared mask replacement and one undo entry (or its enclosing transaction). Feather remains in native pixels. Nested component instances use their containing master document when edited through its Document.

### Painting filter masks

With a filter mask attached, Brush/Pencil/Eraser offer **Filter mask · Hide** and **Filter mask · Reveal** in Paint target. Brush and pencil append refinements; eraser hides filter coverage regardless of the selected mode. Selection clipping and pressure/size/hardness/opacity/flow/spacing/smoothing use existing stroke controls. Linked input maps into native master/mask coordinates; unlinked input maps into the containing document/mask basis. Brush size is measured in mask coordinates. Escape or target switches cancel the unfinished stroke; external document edits reject stale commits. Each finished stroke creates one undo entry. Ordinary masks are untouched.

Scripts append immutable values with `instance.filterMask = instance.filterMask.paint(new BrushStroke({ points: [{ x: 20, y: 20 }], size: 12 }), "hide")` (or `PencilStroke` / `"reveal"`). Stroke points are authored in mask coordinates. Existing limits of 2,048 mask strokes and 200,000 combined points apply; interactive strokes also enforce the existing 20,000-point limit.

Recipe parameter binding uses explicitly supplied own properties only. Prototype-related names such as `constructor`, `toString`, and `__proto__` remain valid parameter names: omitted values use their declared defaults or fail required-parameter validation. Inherited JavaScript properties never supply parameter values. This applies to recipe DTO execution; the constructor-based document API is unchanged.

### Rasterize a smart-object instance

`await smartLayer.rasterize(): Promise<RasterLayer>` renders the instance contents and smart filters through its current affine placement into a new PNG at document-pixel resolution. It replaces the instance at the same parent/stack index with a fresh RasterLayer, selects it, and creates one undo entry (or joins the enclosing isolated script commit). Opacity, fill opacity, blend mode, metadata, styles and the ordinary layer mask remain editable; a linked outer mask is rebased to the raster plane. Smart filters and filter masks are baked into the pixels. Original source assets and master definitions remain unchanged. Undo restores the instance; redo reuses prepared pixels offline.

```js
if (!(document.selectedLayer instanceof SmartObjectLayer)) {
  throw new Error("Select a smart object first.");
}
const raster = await document.selectedLayer.rasterize();
print(raster.name, raster.width, raster.height);
```

This asynchronous operation requires the browser application host or isolated scripting host. It rejects detached/locked/non-smart targets, synchronous `document.transaction` use, document edits or closure during preparation, and rendering/encoding/decoding failures. Independent detached Documents have no rendering host. Scripts must await the call; a later script error discards private generated assets and all script edits. Plugin execution requires `document:write`, `assets:read` and `assets:write`, checked again at commit. Tiled PNG output avoids a full-size output canvas, but final PNG decoding remains subject to browser image/memory capabilities and existing render-tile limits. The operation intentionally fixes resolution; subsequent enlargement resamples raster pixels. Pixel equivalence has focused affine/filter/mask coverage, not a universal color/effect guarantee.

### Linked image snapshots

`smartLayer.linkedSource` returns a detached `{ kind: "local-file", name, sha256, byteLength, lastModified }` record or `null`. It describes the last accepted local PNG/JPEG/WebP source, not proof that the file still exists or remains current. Reading requires an attached instance. `smartLayer.embedSource(): void` removes the link declaration while preserving cached pixels and all shared placements; it is one undoable shared-master edit and rejects locked dependent instances. It is a no-op for embedded masters.

```js
const layer = document.selectedLayer;
if (layer instanceof SmartObjectLayer && layer.linkedSource) {
  print(layer.linkedSource.name);
  layer.embedSource();
}
```

Trusted browser hosts use `await editor.relinkSmartObject(instance, file: File)` to accept or refresh a local file. The method hashes and privately decodes the file, checks the captured document revision/lifetime, and replaces the selected component's source through the shared command. Every instance of that component updates; independent copied masters do not. Placement geometry, masks, styles and filters remain intact, so changed source dimensions fit the existing placements. Failures or locked dependent instances publish no new source asset. File selection is a browser-host operation, unavailable to isolated scripts or headless REST; scripts can inspect or embed an existing snapshot.

Layers offers Link image file, Relink image file and Embed source snapshot. Projects embed cached source bytes and verify the link fingerprint against them during save/load, so reopening does not read a file or require external access. Embed before opening a linked master in an editable contents tab; explicit `replaceContents` also replaces the source declaration. No filesystem path, file handle, automatic polling, background file watching or remote URL fetching is implemented. Refresh requires choosing the file explicitly, including after reopening a project.

## Layer comps

`document.layerComps.add(new LayerComp({ name: "Layout", visibility: true, position: true, appearance: true }))` captures current presentation. All three categories default to true; at least one must be enabled. The constructor creates a detached configuration, and `add` captures the document and attaches it. Adding an already attached instance rejects.

```js
const comp = document.layerComps.add(
  new LayerComp({ name: "Original layout" }),
);
document.layers.at(0).x += 100;
comp.apply();
```

`document.layerComps` exposes `length`, detached-array `items`, iteration, `at(index)`, `getById(id)` and `add(comp)`. Returned comps are attached handles. A comp exposes `id`, writable `name`, detached read-only `options`, `toJSON()`, `apply()`, `recapture()` and `remove()`. `apply()` returns `{ missingLayerIds: string[] }`; deleted targets are skipped, new layers remain untouched. Position restoration rejects changed parents rather than applying stale local coordinates. Changed locked layers reject the whole operation; unchanged locked layers are allowed. Removed or detached handles reject captured-data operations. Undoing removal restores the handle's target. Recapture replaces the saved state using the original categories. Names must contain 1–240 characters.

Visibility records the layer flag. Position records local translation, affine transform and available dimensions. Appearance records opacity, fill opacity, blend mode and layer styles. Text, pixels, filters, masks, hierarchy and locks are not restored. Saving, renaming, recapturing, removing and applying use ordinary commands/history; scripts retain their existing atomic commit boundary. Comps persist in schema-14 projects. The Properties inspector includes a Layer comps panel using these same constructors.

Canvas cropping rebases saved layer-comp root positions by the crop origin, including targets currently missing from the layer tree. Nested positions stay in their captured parent coordinates. Shared validation rejects overflowing saved coordinates atomically; crop undo/redo retains both artwork and comp state.

Independent smart-master copies and editable contents tabs rebind their saved comps to the copied document identity. Cross-document master transfer additionally remaps saved target and parent IDs to copied layers, preserving presentation values and missing-target records. Top-level source-document comps are not implicitly copied when transferring selected artwork.

`document.layerSelection.distribute(axis, mode = "gaps")` spaces at least three independent selected roots. `axis` is `"horizontal"` or `"vertical"`; `mode` is `"gaps"` or `"centers"`. It uses document-space geometric bounds, keeps outer anchors and stacking order fixed, and converts intermediate movements into each parent's coordinates. Gap mode sorts by leading edge; center mode sorts by center. Overlapping layouts can produce negative equal gaps. Descendants of selected groups are not moved twice. Locked roots/ancestors, missing geometry, invalid modes or fewer than three roots reject without edits. One shared command supports undo/redo; no-op distribution adds no history. Raster sources, masks and styles retain their existing movement semantics.

Saved automation recipe `layerExists` conditions consider every output bound to a `stepResult` selector, including output aliases and `childPath` descendants. The condition succeeds if any bound layer survives; it skips the step if none survive. This existence check does not relax mutation target validation when a bound output is missing. Constructor-based scripting signatures are unchanged.

`document.layerSelection.flip(axis)` reflects one or more selected roots around their combined canvas-space geometric center. `axis` is `"horizontal"` or `"vertical"`. For example, `document.layerSelection.flip("horizontal");` mirrors the selection left to right. Parent transforms are accounted for; selected group descendants are not flipped twice. Raster dimensions and original source bytes remain unchanged. Linked masks follow layer transforms; unlinked masks retain document-space placement. Empty selections, invalid axes, missing geometry and locked roots/ancestors reject atomically. Each flip is one undoable shared command.

HSL adjustment layers use `new AdjustmentLayer({ name: "HSL", adjustment: { kind: "hsl", hue: 0, saturation: 0, lightness: 0 } })`. Hue accepts degrees from -180 to 180; saturation and lightness accept -100 to 100, with all defaults supplied explicitly by the DTO (the trusted DOM module also exports `defaultHslAdjustment()`). Replace `.adjustment` to update an attached layer through shared validation/history. Normal layer masks, opacity, visibility and ordering apply. Invalid/nonfinite values reject atomically. Project schema 15 stores HSL; older documents migrate when opened.

HSL operates on encoded sRGB RGB values, preserves alpha and keeps neutral pixels neutral. Negative saturation/lightness scales toward zero; positive values interpolate toward one. Hue wraps cyclically. It is distinct from the existing luminance-based tone saturation. Current rendering uses bounded Canvas tiles with a WASM kernel executed in the pixel worker; supported WebGPU compositions use an HSL shader, with Canvas/WASM fallback for unsupported compositions or unavailable GPU. GPU/reference rounding differences can reach three premultiplied RGB byte levels in the tested cases; alpha matches exactly. No hardware performance claim is made.

The built-in automation recipe `preset-hsl-recolor` (“Recolor with HSL”) accepts numeric `hue` (-180…180), `saturation` and `lightness` (-100…100), all defaulting to zero. It adds an editable HSL adjustment at the top of the root composition; it does not isolate the selected layer. It can be used by deterministic batch delivery, with the existing global/per-item parameter rules. Recorder-created HSL layers and subsequent adjustment replacements retain their values through recipe JSON serialization and one-step replay undo. These are local operations with no provider invocation.

Built-in recipe `preset-high-contrast-bw` version 2 fixes tone units: saturation is -100, contrast accepts 0…100 with default 45, and exposure remains EV with default 0.1. Version 1 incorrectly used -1 for desaturation and fractional contrast. Existing saved recipe or batch snapshots retain their original definition; create a new run from the updated preset to use the correction. Positive exposure brightens and may clip highlights.

Product Drop Shadow recipe version 2 creates an offset black silhouette, retaining the duplicate's source asset, geometry and mask. The duplicate uses full fill opacity, a fully opaque black color overlay, normal default styles otherwise, multiply blending and the requested layer opacity. The original subject is unchanged. Edges follow the source alpha; the recipe does not add blur. Saved version-1 recipe/batch snapshots retain their prior colored-duplicate behavior.

The legacy ID `preset-vignette-warm` now identifies version 2, displayed as “Warm Tone & Contrast”. It adjusts exposure on the selected raster (EV), contrast and saturation (-100…100, defaults 30 and 25), then adds a 75%-opacity normal-blend RGB curve above the root composition. Its red midtone rises from 128 to 148 and blue midtone falls to 108, with black/white endpoints retained. It does not create a vignette. Existing version-1 snapshots retain their definitions and values.

Trusted recipe-service reads (`getPresets`, `getAllRecipes`, `getRecipe`) return detached recipe definitions. Editing a returned object does not change the built-in catalog or another editor session. To execute a customized variant, pass that variant explicitly; to retain it, save a custom recipe through the service.

`TextLayer.reflow(): void` explicitly recalculates stored text bounds using fonts available in the current execution environment. It uses the ordinary text update command, preserving text, styles and placement; changed bounds create one undo entry, unchanged bounds create none, and locks reject the action. In the inspector, **Reflow text** performs this operation with browser-loaded fonts. Isolated workers and headless REST sessions may have different font availability; reflow there is not a guarantee of browser-identical metrics. REST callers can request the equivalent ordinary `layer.update` with the layer's unchanged `text` value.

Automation recipe steps accept optional `literalValues: boolean` (default `false`). When true, action values retain strings verbatim, including `${parameter}` expressions; semantic targets and conditions still resolve normally. The recorder marks captured action values literal, except tone actions deliberately parameterized by `autoParameterizeTone`. This flag survives JSON and portable-package serialization and applies equally to batch replay. Existing recipes without the flag retain interpolation behavior; older saved recordings cannot have their original intent inferred automatically. Constructor scripting signatures are unchanged.
