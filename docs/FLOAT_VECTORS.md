# Editable linear float vectors

Existing `VectorLayer` and `VectorPath` constructors also work in
`float32` / `linear-srgb` documents. Pen, shape factories, path handles,
compound contours, fill rules, gradients and dashed strokes remain editable.
Attached mutations use ordinary commands, ancestor locks, transactions and Undo.
No new document field, schema version, permission or constructor is introduced.
Text and smart-object layers still require their float integration.

## Paint and geometry

Solid six-digit sRGB colors decode into linear RGB. Linear and two-circle radial
gradients retain existing layer-local endpoints/circles, optional invertible
paint transform, ordered 2–32 stops, stop positions and optional stop opacity
(default 1). Geometry follows the complete layer/ancestor affine; the paint
transform changes paint coordinates only. Stop colors and alpha interpolate
separately, without premultiplication, as in the existing vector gradient
contract, with RGB interpolation in the document's linear space. Conversion
from byte editing therefore changes gradient appearance; precision Undo restores
the byte operator. Padding retains the first/last stop, duplicate positions
retain ordered hard transitions, and uncovered radial cone sectors are
transparent. Radial sampling uses the last nonnegative-radius intersection,
including the continuous zero-radius boundary. The two-circle geometry follows
the [HTML gradient model](https://html.spec.whatwg.org/multipage/canvas.html#dom-context-2d-createradialgradient-dev);
linear working color is an explicit editor precision choice.

Canvas renders neutral white fill and stroke coverage separately on fixed
256-square native document cells with two-pixel gutters. It supplies scalar
antialias coverage, never gradient/solid RGB. Curves, compound fill rules,
caps/joins/miter/dashes and zero-length caps reuse the existing geometry path.
Colors are evaluated at native pixel centers and stored in Float32; continuous
stop alpha multiplies geometry coverage once. Native WASM then composites each
fill followed by its stroke, in authored path order. Layer Fill, masks, clipping,
styles, blend modes and layer opacity run afterward through the existing float
scene. Gradient variation within a single covered pixel is sampled at its center;
this does not claim analytic area integration or independent vector tessellation.
Paint removes complete placement translation before adding each pixel-center
offset, using the fixed cell origin. Large placement therefore retains half-pixel
color positions and arbitrary read partitions use the same arithmetic.

Ordinary float mask coverage, including feather/density/inversion, also uses
fixed 256-square native cells. This prevents read-region origins from changing
floating-point selection geometry. Each captured scene keeps at most 16 scalar
cells (4 MiB); only registry-proven immutable mask values can reuse cells, with
pose and source/current checks. Disposing a scene clears its cached cells. Returned regions own their pixels. Retained
mask planes and perspective captures keep their existing native samplers.

Native reads keep the existing 262,144-pixel working-buffer budget. Large
original/document geometry is unchanged. Cancellation and owned source/revision
checks bracket asynchronous work; invalid coverage, output geometry or nonfinite
working coordinates reject before publishing a frame or export. Existing strict
path/stop/matrix/anchor validation and normalized artistic blend domains remain.
The canvas is an SDR preview; linear TIFF delivery reads native scene samples.

## Constructors and scripting

`new VectorLayer(options?)`, `new VectorPath(options)`,
`VectorPath.rectangle(rect, cornerRadius = 0, options = {})` and the existing
ellipse/polygon/SVG path factories retain their signatures and defaults.
`path.fillGradient` accepts a `VectorGradientData` descriptor or `null`, not a
separate gradient constructor. Returned descriptors remain defensive copies.
The following works in an existing float document, through Scripts or the
ordinary trusted OO API:

```js
const vectors = document.layers.add(
  new VectorLayer({
    name: "Linear vectors",
    opacity: 0.64123,
    fillOpacity: 0.75,
  }),
);
vectors.paths.add(
  VectorPath.rectangle(
    {
      x: 0,
      y: 0,
      width: document.width,
      height: document.height,
    },
    0,
    {
      stroke: null,
      fillGradient: {
        kind: "linear",
        start: { x: 0, y: 0 },
        end: { x: document.width, y: 0 },
        stops: [
          { position: 0, color: "#ff0000", opacity: 0.375 },
          { position: 1, color: "#0000ff", opacity: 0.75 },
        ],
      },
    },
  ),
);
document.selectedLayer = vectors;
```

Pen retains its existing shortcut, Layer paths/Mask paths target, private draft,
Escape cancellation and one Undo per committed gesture. Existing shape,
gradient and Boolean controls also operate on float vectors. Boolean operations
retain their geometry-only operand contract; masks/styles are not Boolean areas.

Scripts/plugins use existing document grants and isolated execution. Installation
stays inert; no pixels, worker, file, profile, network or host renderer capability
is added. REST uses the existing `layer.add`, `path.add`, `path.update` and
`path.remove` commands with strict validation and `expectedRevision`. REST
sessions remain independent and have no composed renderer or browser sync.
Projects, workspace/history and recipes retain editable geometry and values;
native high-precision source assets remain independently owned and unchanged.
Unsupported export formats retain their existing explicit errors/capability
reports; this does not add editable HDR SVG interchange.

## Recorded path appends

Recipe v1 adds action `{type:"path.add", path:VectorPathData}` with a semantic
step target. Every path field uses the existing strict path validator, defaults
and anchor/contour/stop limits. The action requires a vector layer, resolves the
semantic target before compilation and generates fresh path and contour IDs on
every run. It appends without replacing existing paths. `ignoreLocked` keeps its
existing explicit target policy; ordinary ancestor locks still reject. Invalid
paint, missing/wrong targets, source/current changes or a failed later step leave
the document/history unchanged. The recorder captures a `path.add` command,
including an append after a recorded layer creation, against the new layer's
semantic step result. Packages preserve the complete editable value; no image
asset is required by path geometry alone. Multiple steps still commit one Undo.
Recording `path.update`, `path.remove` and Boolean replacements remains outside
this append action; unsupported recording stops explicitly without saving a
partial recipe. Existing byte vector appends use the same action.

## Verification status

Build/typecheck and all 3,325 unit/API/native tests pass. The accepted browser set
contains 111 distinct source cases (70 affected rechecks and 41 unchanged matrix
passes) and 10 production cases without developer globals. Complete native
gradient words/profile are independently decoded with libtiff/NumPy; actual
50 MP original ownership and a complete edit window are verified. Raw failures,
repairs, frozen inputs and limits are recorded in
`docs/benchmarks/float-vectors-2026-11-01.md` and its compact receipt.
This advances editable vector support within F03/F07/F10; the complete original roadmap remains active.
Broader float text/smart/filter/tool/working-space/HDR/CMYK delivery, physical
quality and sustained all-tool/device performance acceptance remain required.
