# Clipping masks

Schema 48 adds editable sibling clipping through the shared Layer API. The dated roadmap records actual acceptance. Full F02 and advanced Photoshop fidelity remain open. The consecutive base/member workflow is informed by [Adobe’s clipping-mask documentation](https://helpx.adobe.com/photoshop/desktop/create-masks/layer-masks/create-and-manage-clipping-masks.html); this page defines Canoli’s actual contract.

## Authoring and stack order

Every layer constructor accepts `clipped?: boolean`. The omitted value and `layer.clipped` getter default to false. Assign `layer.clipped = true` or use `layer.update({clipped:true})`. Attached edits share existing command validation, locks, revision checks, transactions and Undo. Detached values use the same OO constructors/wrappers. Values must be booleans.

Sibling arrays run bottom to top. Each unclipped layer begins a base; consecutive clipped siblings above it share its intrinsic transparency. Hidden members retain membership. Relationships never cross a group boundary. Orphan clipped layers, and members following an adjustment-only base, have no intrinsic coverage and render transparently. Adjustments can themselves be clipped to a pixel-bearing base.

Moving, reordering, deleting a base or clearing a middle member changes the current sibling relationship. A released middle member becomes a new base for the still-clipped siblings immediately above it. Membership is not a stored layer-ID link. Original geometry, image/font bytes and content outside the base remain editable.

## Compositing and controls

Members retain their own transforms, masks, styles, opacity, fill and blending inside the clipping stack. Base intrinsic transparency applies once to the combined color plane, preserving soft edges across multiple members. Base fill affects the base color without erasing the clipping boundary or independently visible member content. The base mask and styles apply to the completed stack; its pre-fill intrinsic silhouette supplies its shadow. Base opacity/blending apply once against the external sibling backdrop.

A pass-through group used as a base supplies isolated intrinsic coverage. Pass-through member groups still see the clipping color plane. Optional advanced Photoshop clipping-style switches, knockout and independently blending the base against the external backdrop are not exposed by this contract.

Select an unlocked layer with an eligible preceding base, then enable **Clip to base layer** in Appearance. The palette exposes **Create clipping mask** and **Release clipping mask**. Clipped rows have an indented indicator; the Inspector names the current base or reports its absence. Release remains available for an orphan. No keyboard binding is added.

Default byte clipping uses Canvas fallback. Float32/linear-sRGB documents use original-derived float color planes and native float compositing, with the same sibling/fill/once-only shape rules for their supported raster/group/tone subset. See [the float contract and executed example](FLOAT_DOCUMENTS.md#sibling-clipping-in-float-documents). Canonical sampling, tiled export, source resolution and the shared cache budget remain unchanged. Raw base pixels can be reused; completed clipping results cannot use base-only signatures. Private source preparation for wet painting, smart rasterization and frequency workflows ignores only its outer clipping flag and retains that relationship on the public output. Current-layer retouch sampling isolates its selected branch from sibling clipping while retaining ancestor transforms/masks; current-and-below retains the real preceding bases. No sustained 60fps/device/process-memory claim is made.

## Executable isolated example

Existing document read/write permission suffices. No file, asset, network or account capability is added.

```javascript
document.transaction('Clip color to shape', () => {
  const shape = document.layers.add(new VectorLayer({name:'Clipping base'}));
  shape.paths.add(VectorPath.ellipse(
    {x:40,y:40,width:160,height:120},
    {fill:'#2468ac',stroke:null,strokeWidth:0}
  ));
  const color = document.layers.add(new PaintLayer({name:'Clipped color',clipped:true}));
  color.strokes.add(new PaintFill({bounds:{x:0,y:0,width:320,height:240},color:'#e94730'}));
  document.selectedLayer = color;
});
print('Clipping example complete');
```

## REST, replay and persistence

The independent command endpoint accepts the same strict update using the actual target ID and current revision:

```json
{"expectedRevision":3,"commands":[{"type":"layer.update","id":"target-layer-id","patch":{"clipped":true}}]}
```

Malformed values/locked edits return 400; stale revisions return 409. Transactions roll back atomically. REST sessions do not synchronize with browser artwork. Plugin commits still enforce their current grants. Recorded literal layer updates/replay preserve the flag on the receiving sibling stack, without binding an original base ID.

Native projects, workspace recovery, retained history, copies, components and appearance comps preserve membership. Legacy appearance comps restore an unclipped default. Declaring clipping on a pre-48 document is rejected; omitted legacy fields retain their behavior. Existing project/workspace containers and original binary source ownership do not change.

Flattened exports use the actual clipped composition. SVG still bakes affected sibling prefixes and discloses lost clipping editability. Synchronous `VectorLayer.toSvg()` rejects a clipped member because it cannot prepare the required sibling pixels; use awaited host `editor.export({format:'svg'})`.

## Editable Photoshop clipping subset

Trusted PSD/PSB layered export retains consecutive pixel clipping relationships when the base and members export as individual pixel records. This includes stacks inside ordinary retained folders, supported blend modes, visibility, opacity and separate pixel masks. Non-pixel artwork becomes rendered pixel layers, retaining clipping membership while losing its original type/vector/paint/smart authoring as reported. Member effects can bake into their own pixels. Base intrinsic transparency and its final mask combine into one enabled editable pixel mask, while the pixel plane retains binary intrinsic alpha; this preserves coverage applied once after blending. Original separate base-mask controls/enabled state are baked and reported. Export renders each private member without its outer clipping flag so the file retains complete member pixels; the public document remains unchanged. The base must have full Fill and no enabled styles or Blend If; clipped adjustments and groups on either side require the existing affected-prefix bake. Orphans also use that bake. Later independent artwork remains separate.

RGB8/Gray8 layered import maps valid consecutive pixel clipping to `Layer.clipped`. Each sibling scope requires a decoded pixel base; group bases/members, orphans, unknown clipping bytes, separate base Fill, soft intrinsic base alpha, higher precision and disabled grouped clipping blending require the actual merged fallback. The parser inspects `clbl` and nonzero `knko` rather than silently assuming Canoli semantics. Existing unsupported effects, Blend If, mask, precision and codec gates continue to apply. Explicit flattening remains available. Saved native projects preserve the imported editable membership and complete decoded pixel assets, but do not archive the original Photoshop container.

The file uses Adobe's [clipping byte and grouped clipping setting](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/). The browser contract introduces no new document schema, public mutation method, plugin grant or account. Low-level renderer-free `documentToPsd`/`buildPsd` reject clipped content with a rendered-export error; trusted `editor.export({format:'psd'|'psb'})` prepares the native pixels. Scripts still have no host file/download service. Independent reader coverage is recorded in the dated roadmap; it does not establish Photoshop desktop, arbitrary advanced switch, color-managed or device parity. Save a native project for complete authoring, originals and off-support data.
