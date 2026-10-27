# Editable SVG clipping

Supported geometric SVG clipping imports as ordinary editable native vector masks. This extends F02/F11; arbitrary SVG/CSS, alpha-mask graphs and complete viewer parity remain open. See the dated implementation roadmap for observed verification.

## Import and ownership

Choose an SVG in the existing file picker, review **Import SVG**, then choose **Import editable**. Supported local `clipPath` definitions can contain paths, rectangles, rounded rectangles, circles, ellipses, lines, polylines, polygons and direct `use` references to geometric shapes. Child silhouettes combine by union; supported child/server clipping combines by intersection. Clip rules inherit from the definition tree, independently of the referring artwork. Fill/stroke colors, stroke width and paint opacity do not define a clipping silhouette. Visibility and display do.

The inert worker validates local references, resolves geometry and uses the existing bounded cubic Boolean kernel. Original XML is never inserted into the live document. Escaped CSS URL tokens follow the same external-resource checks as ordinary URLs. Missing, cyclic, indirect or unsupported references cannot publish a partial native document. Shared definitions expand into independent owned masks; original identifiers, Boolean operands and shared DOM identity are not retained.

Both `userSpaceOnUse` and `objectBoundingBox` are supported for resolvable geometric bounds, including groups and explicitly sized images. Bounds exclude stroke and existing clipping. Percentages retain the definition's SVG viewport; bbox mapping does not establish a new viewport. A clipPath transform sits outside its content's bbox mapping. Root clipping stays in the outer viewport plane while artwork uses its viewBox. `use` placement moves both its instance and its clipping. Degenerate bbox clipping produces an empty mask in the verified browser. No claim extends that edge behavior to every viewer.

Groups and `use` instances receive their masks directly. Other graphics use a native wrapper so clipping remains in its original coordinate plane while images or text finish host preparation. Image aspect-ratio cropping remains independent. Imported path geometry, complete embedded image/font sources, source text and ordinary transforms remain editable. Native projects preserve those values and original assets.

## Editing through the shared API

Select the masked layer/group to use the existing Mask controls or Pen workflow. Masks are immutable values: assign `mask.with(...)` through the layer to create one ordinary undoable edit. Locks, current plugin grants and strict layer validation still apply. This example operates on an already imported clipping document and moves only its first mask:

<!-- example: edit-imported-svg-clip -->
```js
function findMasked(layers) {
  for (const layer of layers) {
    if (layer.mask) return layer;
    if (layer instanceof LayerGroup) {
      const found = findMasked(layer.layers);
      if (found) return found;
    }
  }
  return null;
}
const clipped = findMasked(document.layers);
if (!clipped || !clipped.mask) throw new Error('Import a geometric SVG clip first');
document.selectedLayer = clipped;
clipped.mask = clipped.mask.with({ x: clipped.mask.x + 8 });
print('SVG clipping moved');
```

## Output and limits

Hard vector masks without inversion, reduced density, feathering or painted corrections serialize as standard SVG clipping paths. Their nonzero/even-odd rule and linked/unlinked affine placement remain explicit, including standalone `VectorLayer.toSvg()`. Generated smart-object viewport boundaries retain their existing alpha-mask sampling so transformed shadows and native adjustment prefixes preserve prior coverage. Supported graphs can reimport as editable masks. Other mask controls retain their existing alpha-mask or native-coverage output; those richer graphs can still require explicit flattened import. Sibling `Layer.clipped` relationships retain their separate backdrop-prefix export boundary.

Native Canvas and SVG curve/clip-edge sampling can differ, particularly at fractional coordinates. Arc geometry retains the existing disclosed cubic approximation. Save a native project for complete original authoring; SVG is not a redaction format and can retain artwork hidden by a clip. No arbitrary image-resolution limit is introduced. Existing 64-layer, eight-level hierarchy, 128-contour/20,000-anchor mask and bounded Boolean preparation limits remain distinct from source-image resolution.

Text used as a clipping silhouette, object-bounds text/unresolved image dimensions, nested SVG clipping viewports, CSS geometry/selectors, richer mask/filter graphs and unsupported reference content require explicit flattened import. The file service remains host-only: isolated scripts/plugins can edit the resulting masks through existing document permissions, but gain no file, DOM, network or font-source service. Independent REST documents retain their existing native mask commands without browser synchronization.

The [CSS Masking specification](https://www.w3.org/TR/css-masking-1/) informs the clipping model; this page defines Canoli's implemented contract and recorded limits.
