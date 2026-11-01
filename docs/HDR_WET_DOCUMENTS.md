# Prepared HDR wet document edits

Status: schema 57 prepared raster edits. Trusted interactive float Smudge/Mixer
authoring and preview/commit remain separate required work; those tools stay
disabled. This contract accepts completed native output rather than exposing a
simulation, pixel reader, file service or network capability to isolated code.

## Constructor and values

`new WetPaintStroke({precision:"float32",brush,tiles,nativeTransform?,placement?,
opacity?,load?,mix?})` creates an immutable prepared HDR value. Apply it using
`RasterLayer.applyWetPaint(stroke): void` on a float32/linear-sRGB document.
Attached edits use existing layer commands, ancestor locks, transactions,
revision checks and Undo/Redo. `precision` is a read-only member returning
`"float32"` for HDR and `undefined` for the existing byte value. DTOs retain the
same optional field. Explicit null, `"uint8"` and other flags reject; omitting
the flag keeps the existing byte PNG contract. Falsely old HDR records reject
even if hidden or zero-opacity, including retained history. Float smart-object
embedding and serialized float definitions remain unsupported.

`brush` is a BrushStroke/PencilStroke value or complete brush DTO without clone
tiles. `tiles` is a nonempty ordered array of
`{x,y,width,height,assetId,coverage:{assetId}}`. Coordinates/extents are safely
representable integers with positive extents. Each asset is a complete native
straight RGBA32 TIFF, orientation 1, chunky RGB, unassociated alpha and the exact
pinned linear-sRGB ICC. Finite signed/HDR RGB is valid and alpha is in [0,1].
Every original sample validates; replacement alpha cannot exceed removal alpha
anywhere, including offscreen/hidden/inert pairs. Coverage RGB is ignored.
Missing, stale, malformed, mismatched or incorrectly profiled sources reject.
Display thumbnails supply no color or alpha. No arbitrary original resolution,
file-size or tile-count tier is added; working allocation, numeric precision,
storage quota and available native-row memory remain real limits.

Synchronous OO mutations validate document metadata, source roles, locks and
history; trusted callers must supply already validated prepared pairs. They do
not asynchronously decode original pixels inside `RasterLayer.applyWetPaint`.
Isolated script/plugin and REST host commits, project/recovery admission and
scene capture validate complete native pairs before publishing state or pixels.

`load` accepts `{color?:[r,g,b,a],load?:number}`. HDR RGB must be finite and round
to finite Float32; alpha/load are 0–1. Defaults are `[0,0,0,1]` and 0. `mix`
retains `{flow?,wetness?,pickup?}` in 0–1, defaulting to 1/0/.5. Unknown keys and
invalid/null controls reject. These settings describe completed preparation;
the supplied pixels are authoritative. They do not rerun a simulation.

`nativeTransform` defaults to identity and maps tile coordinates into the
captured local plane. Existing perspective or mapped `placement` values retain
their documented pull-back semantics. `opacity` defaults to 1, is 0–1, and
envelopes the complete ordered replacement once. Brush opacity/selection are
already baked into supplied pixels; outer `clip` remains null. Explicit null
opacity/nativeTransform/placement/load/mix rejects.

## Native replay and geometry

Prepared output is sampled into the original raster's native grid, preserving
recorded wet/erase/clear order. Logical dimensions captured by each modifier
scale its placement after raster resizing. The current affine/perspective
projection follows the completed native content. Complete finite wet support,
including bilinear neighbors outside the original image, remains part of the
content; it is not clipped to the image quad. Invalid/unbounded artwork geometry
or unrepresentable samples reject rather than publish a partial result.

Overlapping tiles retain premultiplied RGB, replacement alpha and independent
removal coverage in Float64. Color is not masked twice. Native composition stores
straight Float32 once; signed/HDR RGB is not normalized or sent through byte
pixels. Existing final scene sampling retains its documented transparent/signed
zero canonicalization. Zero-opacity metadata still validates its sources but
does not select a different reconstruction path or enlarge visual bounds.

HDR prepared values are raster artwork only. Byte documents, PaintLayer color
strokes and ordinary/filter mask wet positions reject the HDR flag. Existing
byte wet masks and PNG preparation remain supported through their current paths.

## Isolated example

Start with a float document containing an original raster named **HDR target**
and two unresized, imported float TIFF layers named **HDR wet output** and
**HDR wet coverage**. Their native dimensions must match, their complete originals
must meet the prepared format above, and output must already be premasked.
Source layers are retained and hidden; the target's original remains unchanged.

<!-- example: hdr-wet-prepared -->

```js
const target = [...document.layers].find(layer => layer.name === 'HDR target');
const output = [...document.layers].find(layer => layer.name === 'HDR wet output');
const coverage = [...document.layers].find(layer => layer.name === 'HDR wet coverage');
if (!(target instanceof RasterLayer) || !(output instanceof RasterLayer) ||
    !(coverage instanceof RasterLayer)) {
  throw new Error('Import the HDR target and matching prepared float TIFF sources first.');
}
target.applyWetPaint(new WetPaintStroke({
  precision: 'float32',
  brush: new PencilStroke({points: [{x: 3.5, y: 4.5}], pressureSize: false}),
  opacity: 0.625,
  load: {color: [4, -2, 8, 0.375], load: 0.5},
  tiles: [{x: 3, y: 4, width: output.width, height: output.height,
    assetId: output.assetId, coverage: {assetId: coverage.assetId}}]
}));
output.visible = false;
coverage.visible = false;
document.selectedLayer = target;
print('Prepared HDR wet paint ready');
```

The example uses existing source references and shared commands. No pixels,
native worker, host preparation, file, network or new plugin permission is
exposed. Install remains inert; existing source/document grants still apply at
host commit. REST sessions remain independent of the browser; accepting the same
DTO does not add a composed server renderer or synchronize human edits.

## Persistence and acceptance

Native project/workspace/recovery/history/recipe transport retains ordinary
asset references and complete original TIFF bytes/interpretation. Container
versions remain unchanged; document schema 57 gates the new value. Source-bearing
history must retain redo-only HDR assets just as current byte wet assets do.
The ordinary project-save policy still omits the linear Undo timeline unless
retained branches/comparisons require it; explicit history projects and workspace
recovery keep their existing full-state contract. Loading checks every retained
HDR pair, including hidden/inert/redo-only values, before replacing a session.

Prepared-edit verification covers original-bearing transport and recorded native
windows; the dated implementation log records complete runs. Do not infer full
50 MP wet editing, sustained performance, photographic/device quality,
interactive tools or the remaining roadmap from numerical or bounded-window
checks. The broader professional-editor goal remains active.
