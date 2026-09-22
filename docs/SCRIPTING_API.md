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
- [LayerCollection](#layercollection)
- [ToneAdjustment](#toneadjustment)
- [AdjustmentCollection](#adjustmentcollection)
- [PaintLayer and strokes](#paintlayer-and-strokes)
- [VectorLayer and paths](#vectorlayer-and-paths)
- [TextLayer](#textlayer)
- [LayerStyle, BlendIf, and MarqueeSelection](#layerstyle-blendif-and-marqueeselection)
- [Transactions, history and ownership](#transactions-history-and-ownership)
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

| Binding            | Meaning                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `document`         | A snapshot-backed `Document` representing the active composition at the start of the run. It is the editor document model, not the HTML document. |
| `Document`         | Constructor for a separate in-memory document. Creating one does not open or replace the active composition.                                      |
| `RasterLayer`      | Constructor for an image layer referring to an existing asset.                                                                                    |
| `LayerGroup`       | Constructor for an ordered group of layers.                                                                                                       |
| `PaintLayer`       | Constructor for a paint layer containing brush, pencil, clone, or fill strokes.                                                                   |
| `VectorLayer`      | Constructor for a vector layer containing Bézier vector paths.                                                                                    |
| `VectorPath`       | Constructor for editable vector paths with anchors, control handles, fill, and stroke.                                                            |
| `TextLayer`        | Constructor for text layers with font, size, color, alignment, and line height.                                                                   |
| `BrushStroke`      | Constructor for soft brush strokes with color, size, hardness, opacity, and pressure points.                                                      |
| `PencilStroke`     | Constructor for hard, precise pencil marks.                                                                                                       |
| `CloneStroke`      | Constructor for clone brush strokes referencing sampled image tiles.                                                                              |
| `PaintFill`        | Constructor for solid color canvas fills.                                                                                                         |
| `MarqueeSelection` | Constructor for rectangular or elliptical selections.                                                                                             |
| `LayerStyle`       | Style object managing Blend If, color overlays, and drop shadows.                                                                                 |
| `BlendIf`          | Constructor for luminance/channel tonal blend ranges.                                                                                             |
| `ToneAdjustment`   | Constructor for non-destructive exposure, contrast and saturation.                                                                                |
| `print(...values)` | Returns `undefined`; collects text for the panel's output. Pass `toJSON()` when logging DOM objects.                                              |

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

| Member                         | Access / return             | Behavior                                                                                                                                                                 |
| ------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                           | Read-only string            | Stable document identifier.                                                                                                                                              |
| `name`                         | Read/write string           | Rename through the shared command/history system.                                                                                                                        |
| `width`, `height`              | Read/write numbers          | Canvas dimensions in pixels. Setting either dimension resizes the canvas through the shared command/history system.                                                     |
| `resize(width, height)`        | `void`                      | Resizes canvas dimensions atomically as one undoable command. Validates positive safe integers.                                                                          |
| `layers`                       | Read-only `LayerCollection` | Root layers only, ordered back-to-front.                                                                                                                                 |
| `selectedLayer`                | Read/write layer or `null`  | Select a layer belonging to this document, or clear selection. Set after a transaction when selecting a newly added layer.                                               |
| `getLayer(id)`                 | Layer or `null`             | Search the entire tree by ID; accepts `null`, which returns `null`.                                                                                                      |
| `transaction(label, callback)` | `undefined`                 | Synchronous atomic batch. See transaction rules below.                                                                                                                   |
| `toJSON()`                     | `DocumentData` object       | Deep copy of document metadata, including nested layers and adjustments. Includes pixel selection; excludes asset bytes, active layer, history and script code.          |
| `Document.fromJSON(data)`      | New `Document`              | Validate a metadata object and create a separate document with empty history and no active layer; retains serialized pixel selection. Pass an object, not a JSON string. |
| `canUndo`, `canRedo`           | Read-only booleans          | History availability in this instance. In Scripts these describe the worker's history, not the host's existing history.                                                  |
| `undo()`, `redo()`             | `undefined`                 | Available on standalone instances and trusted application instances. **Disabled on the supplied script `document`**; use editor undo/redo after the run.                 |

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

`new BrushStroke({ points, size = 24, hardness = 0.7, opacity = 1, color = "#d5e79b", clip = null })`:

- `points`: 1–20,000 `{ x, y, pressure? }` values; pressure defaults to 1 and accepts 0…1 (rendered radius floors pressure at 0.05).
- `size`: diameter in document pixels, 0.1…2048; `hardness` and `opacity`: 0…1. Opacity applies once to the complete stroke. Overlapping strokes accumulate.
- `clip`: `MarqueeSelection`, selection DTO, or `null`. The script must pass a clip explicitly; adding a stroke does not implicitly consume `document.selection`. UI tools capture and translate the current selection when the gesture begins.
- Read-only members: `id`, `kind`, `points`, `size`, `hardness`, `opacity`, `color`; `toJSON()` returns a deep copy, including clip and tiles.

`new PencilStroke(options)` accepts the same options, defaults size to 1 and forces hardness to 1. It stamps pixel-aligned squares without soft edges at source scale. Reduced previews may resample the marks.

`new CloneStroke({ ...brushOptions, tiles })` requires 1–4096 `{ assetId, x, y, width, height }` source tiles. Tile placement is in destination layer coordinates. The asset must already exist in the browser session; the host rejects missing assets. Scripts cannot sample pixels or create image assets, but can reuse an imported raster's asset ID or persisted clone tile IDs. The UI clone tool captures the visible composition at full resolution in tiles before committing; later source edits do not change that stroke. Its live gesture shows a trail; sampled pixels appear on release.

`new PaintFill({ bounds, color = "#d5e79b", opacity = 1, clip = null, erase = false })` requires `bounds: { x, y, width, height }` with positive dimensions. `erase: true` clears earlier paint within that rectangle/clip in the same paint layer, without changing other layers or original assets. Read-only members: `id`, `kind`, `bounds`, `color`, `opacity`, `erase`; `toJSON()` exposes the full operation.

`new PaintLayer()` defaults its name to `"Paint"`. A paint layer stores at most 2048 operations. Its bounds are the union of operation bounds, including areas later cleared.

## VectorLayer and paths

Signature: `new VectorLayer(options = {})`; name defaults to `"Vector"`. Inherits common layer options. `vectorLayer.paths` is a `PathCollection` with `length`, `at(index)`, `get(id)`, `add(path)`, `remove(id)` and iteration. `at(-1)` returns the last path. `add` returns the same `VectorPath` instance and requires an unowned path. Each layer stores at most 2048 paths.

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
| `removePoint(index)`                      | Remove an anchor; throws for a missing index or an attempt to remove the last remaining anchor.                                     |
| `remove()`                                | Remove from its owner layer; ownership is retained. Requires an owner.                                                              |
| `toJSON()`                                | Deep metadata copy.                                                                                                                 |

Path handles remain attached to their owner and read the current revision across undo/redo. Access while absent throws. A path cannot be added to a second owner. Duplicating its layer gives each path a new ID.

## TextLayer

Signature: `new TextLayer(options = {})`.
Inherits common layer options (`name`, `opacity`, `fillOpacity`, `visible`, `locked`, `blendMode`, `x`, `y`).

| Option       | Type                            | Default        | Validation                                 |
| ------------ | ------------------------------- | -------------- | ------------------------------------------ |
| `name`       | string                          | `"Text"`       | Nonempty, at most 240 characters.          |
| `text`       | string                          | `"Text"`       | String up to 10,000 characters.            |
| `fontSize`   | number                          | `32`           | Finite positive number in pixels (>= 1).   |
| `fontFamily` | string                          | `"sans-serif"` | Nonempty string up to 100 characters.      |
| `color`      | string                          | `"#ffffff"`    | CSS color string (e.g. hex).               |
| `align`      | `"left" \| "center" \| "right"` | `"left"`       | Text alignment.                            |
| `lineHeight` | number                          | `1.2`          | Line height multiplier between 0.5 and 10. |

Members:

| Member       | Type                            | Behavior                                                                                 |
| ------------ | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `text`       | string                          | Read/write; updates intrinsic dimensions via text measurement.                           |
| `fontSize`   | number                          | Read/write; font size in document pixels.                                                |
| `fontFamily` | string                          | Read/write; font family name.                                                            |
| `color`      | string                          | Read/write; fill color for the glyphs.                                                   |
| `align`      | `"left" \| "center" \| "right"` | Read/write; horizontal text alignment relative to layer origin.                         |
| `lineHeight` | number                          | Read/write; line height scaling factor.                                                  |
| `width`      | number                          | Read-only measured intrinsic text width. Recalculated automatically on property updates. |
| `height`     | number                          | Read-only measured intrinsic text height.                                                |
| `update()`   | method                          | Update multiple text and layer properties in a single command.                           |

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

### MarqueeSelection

`new MarqueeSelection({ shape, x, y, width, height, operation = "add" })` creates one rectangle or ellipse. Dimensions must be positive. Alternatively pass `{ regions: [...] }`, with an explicit operation on each region; the default constructor creates an empty selection. At most 128 regions are accepted. Coordinates are in document space for `document.selection`, or layer space when used as a paint clip.

- `regions` is a deep copy; `toJSON()` returns the full selection DTO.
- `combine(singleRegionSelection, operation = "add")` returns a new selection with one appended add/subtract/intersect region; the argument must contain exactly one region.
- `translated(x, y)` returns a new selection offset by the supplied deltas.
- Operations are evaluated in order, starting with an empty mask. A subtract/intersect region alone therefore selects nothing.
- `document.selection` gets an immutable selection snapshot or `null`. Assign a `MarqueeSelection` or `null`; changes create history and persist in project files.
- `document.selectAll()` selects the full document rectangle; `document.deselect()` assigns `null`. Null means unrestricted painting; `{ regions: [] }` selects no pixels.

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

The document also exposes integration hooks: `subscribe(listener)` registers a state-change listener and returns an unsubscribe function; `onCommand(listener)` observes dispatched commands and returns an unsubscribe function; `getSnapshot()` returns the current editor state (`document`, `selectedId`, `past`, `future`, `revision`). Treat snapshots as read-only and listeners as non-throwing. Command listeners are not a complete history event stream: undo/redo and active-layer changes do not emit mutation commands; pixel selection does. These hooks are for application adapters; subscriptions created inside Scripts observe only that temporary worker instance and end with the run.

Underscore-prefixed members (`_dispatch`, `_read`, `_attach`, etc.), worker messaging, and store internals are not supported scripting API. JSON/command types are transport formats, not alternate live object setters. Public SDK packaging, general API stability guarantees and a script library remain future work. Versioned command plugin packages and document permissions are available through the separate Plugins panel.

## Maintaining this contract

Update this guide whenever a constructor, public member, default, validation rule, runtime binding, budget or history behavior changes. Keep the [API overview](API.md), [requirements](REQUIREMENTS.md) and [architecture](ARCHITECTURE.md) consistent. Keep examples runnable in the Scripts panel without invented assets or page globals.

The named `example` markers identify the complete JavaScript examples for verification. They can be extracted and run against the shared DOM/runtime with a fixture document; examples that edit an image need an unlocked selected raster and its registered asset. Browser behavior is covered by [editor.e2e.ts](../tests/editor.e2e.ts) and [tools.e2e.ts](../tests/tools.e2e.ts), including every named recipe, constructor-based scripting, rollback, timeout, isolation and revision conflicts. Plugin behavior is covered separately in [plugins.e2e.ts](../tests/plugins.e2e.ts).
