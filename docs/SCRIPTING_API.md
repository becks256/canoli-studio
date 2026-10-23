# Scripting API

## Based-on paragraph styles (schema 41)

`new ParagraphStyle({name?, format?:Partial<ParagraphFormat>, basedOn?:ParagraphStyle|null})` may inherit an attached style. Supplied format fields become explicit style overrides; omitted fields inherit the parent. Add the child to the parent's document. Null/omission creates an independent style with the existing defaults. Foreign/detached/missing parents reject. A detached child captures initial values and refreshes inherited values from its still-attached base when added. Scopes stop at embedded documents; copying imports the complete required ancestor chain before its children and preserves inheritance while remapping conflicts.

Style `basedOn:ParagraphStyle|null` is readable/writable. `setBase(base|null, {keepOverrides?:boolean}?)` defaults to inheriting the new parent's full format with no style overrides. `keepOverrides:true` retains existing child overrides; on an independent style it preserves all fourteen current fields as explicit overrides. Null detaches while retaining resolved values. `overrides` returns a detached partial snapshot. `resetOverrides(keys?:ParagraphFormatKey[])` restores selected unique known keys, or all keys when omitted; an empty list clears none. Reset requires a based-on style. `update` sets explicit style overrides even when equal to the parent; undefined update fields remain omitted, so use resetOverrides to restore inheritance. `captureFrom(text)` on a child captures all fourteen fields as overrides, without changing text-local overrides.

Parent updates recompute every transitive descendant style and affected text frame in one shared command/undo entry. Style-level and text-level overrides remain separate. Changed effective locked followers or locked ancestors reject the entire edit; name-only/fully shielded updates remain valid. Cycles, self-parenting, missing bases, duplicate names and inconsistent serialized resolved formats reject without partial edits. Deleting a parent detaches its direct text followers and immediate child styles, retaining all resolved typography; deeper style relationships remain intact. Direct text detachment obeys locks. Child-style detachment with unchanged appearance need not mutate its text followers.

Schema 41 stores `basedOn?:{id:string,overrides:Partial<ParagraphFormat>}|null` beside each style's complete resolved format. These references must form an acyclic graph inside the same library (existing 128-style limit). Schemas 1–40 remain readable; nonnull inheritance under old labels rejects, including embedded masters. Projects/workspaces remain 3/2. REST uses the existing strict paragraphStyle.set/remove DTOs in separate headless sessions, with existing font limitations. Plugins use the same isolated OO boundary and current grants, without installation-time execution or new permissions. Portable recipes capture ancestors and overrides with style-step references; SVG reports lost native relationships while retaining resolved text. Mixed runs, variable fonts/path text, font embedding, wider shaping and full F08 remain open.

<!-- example: paragraph-style-inheritance -->
```js
const body = document.paragraphStyles.add(new ParagraphStyle({
  name: "Body", format: {fontSize:24, color:"#315b2a", lineHeight:1.4}
}));
const heading = document.paragraphStyles.add(new ParagraphStyle({
  name: "Heading", basedOn: body, format: {fontSize:34}
}));
const accent = document.paragraphStyles.add(new ParagraphStyle({
  name: "Accent", basedOn: heading, format: {color:"#a43e29"}
}));
const first = document.layers.add(new TextLayer({
  name:"Inherited first", text:"Base changes reach inherited typography.",
  wrapWidth:240, x:24, y:24
}));
const second = document.layers.add(new TextLayer({
  name:"Inherited second", text:"Style and text overrides remain independent.",
  wrapWidth:240, x:300, y:24
}));
first.paragraphStyle = heading;
second.paragraphStyle = accent;
second.fontSize = 30;
body.update({fontSize:28, color:"#336699", lineHeight:1.5, paragraphSpacing:12});
heading.resetOverrides(["fontSize"]);
document.selectedLayer = first;
print("Based-on styles ready");
```

The first frame inherits Body's size 28 and blue color through Heading. Accent retains its red style override; the second frame independently retains its size-30 text override. A successful script commits once. `body.update({fontSize:40})` then enlarges the first frame while keeping the second at 30.

## Linked paragraph styles (schema 40)

`new ParagraphStyle(options?: {name?:string; format?:Partial<ParagraphFormat>})` creates a detached reusable style with a generated ID and default name "Paragraph style". Add it with `document.paragraphStyles.add(style)` before applying it. Names are trimmed, nonblank, at most 80 characters and case-insensitively unique in a document; IDs are unique. A library holds at most 128 definitions. Unknown/null/nonfinite/out-of-range values reject. Constructor/update fields with undefined are omitted. Serialized definitions require a complete format; snapshots with missing definitions or inconsistent resolved fields reject.

ParagraphFormat contains fontSize (default 32, >=1), fontFamily ("sans-serif"), color ("#ffffff"), align ("left"), lineHeight (1.2, 0.5–10), letterSpacing/wordSpacing (0, -50–500 px), fontKerning ("auto"), fontWeight ("normal"), fontStyle ("normal"), direction ("ltr"), paragraphJustify ("none"), paragraphSpacing (0, 0–10000 px), and firstLineIndent (0, -10000–10000 px). Existing font/string/enum validation and native shaping limits apply. Text content, authored wrapWidth, position and transforms are not style fields.

The collection exposes length, items, iteration, at(index), getById(id) and add(ParagraphStyle). Style handles expose id, name (read/write), format (detached snapshot), toJSON(), update(formatPatch), captureFrom(TextLayer), remove() and read-only document. Detached style values can be updated before attachment; attached name/update/capture/remove operations use shared commands. captureFrom uses that document's text and retains existing explicit local overrides, including on the source frame. Removing a style detaches every linked root text frame, preserving its current formatting; a removed handle rejects until undo restores its ID.

TextLayer exposes paragraphFormat (canonical detached resolved values), paragraphStyle (ParagraphStyle|null, read/write), paragraphOverrides (detached partial values), applyParagraphStyle(style|null, {keepOverrides?:boolean}?) and resetParagraphOverrides(keys?:ParagraphFormatKey[]). Only a style attached to the same document can be applied. Applying/switching clears overrides by default; keepOverrides preserves them. A normal typography setter on bound text records an override even if it equals the current base. Setting an optional controlled property to undefined removes its override and restores inheritance. Reset all or selected unique/known keys to inherit the current base. Detach with null to keep current formatting while ending the link. Changing ordinary frame width/content does not become a style override.

A base update reflows all affected followers in its document with existing font measurement, and preserves their overrides. Native fonts may reject unsupported settings. Any invalid/stale/locked affected target or layout failure rejects the whole transaction without partial styles/text/history. Name-only changes and unchanged effective followers need no text mutation; removing/detaching/changing bindings still obeys locks. Each attached operation is one undo entry, or part of its enclosing synchronous transaction/successful isolated script. Frame widths and content remain independent. REST uses the same strict commands in a separate headless session, with its existing font-environment limitations.

Style scopes stop at embedded-document boundaries. Conversion copies a library into the new master as an independent scope. Cross-document root copies import needed styles, reuse identical definitions, and remap conflicting IDs/names while preserving overrides; embedded masters retain their own scopes. Project/workspace history preserves these links. SVG preserves resolved text formatting but reports loss of native style/override relationships; save a project for full style editing. Schema 40 admits libraries and bindings; older roots/history migrate without added styles. Existing project 3/workspace 2 and recipe/plugin versions stay unchanged. Based-on hierarchies use schema 41 as described above. Mixed character/paragraph runs, font embedding, variable axes and path text remain separate work.

<!-- example: paragraph-styles -->
```js
const body = document.paragraphStyles.add(new ParagraphStyle({
  name: "Body", format: {
    fontFamily: "sans-serif", fontSize: 24, color: "#315b2a",
    lineHeight: 1.4, paragraphSpacing: 8
  }
}));
const first = document.layers.add(new TextLayer({
  name: "Body first", text: "Linked typography wraps naturally across frames.",
  wrapWidth: 240, x: 24, y: 24
}));
const second = document.layers.add(new TextLayer({
  name: "Body second", text: "Local color stays independent of the shared size.",
  wrapWidth: 240, x: 300, y: 24
}));
first.paragraphStyle = body;
second.paragraphStyle = body;
second.color = "#a43e29";
body.update({ fontSize: 28, paragraphSpacing: 10 });
document.selectedLayer = first;
print("Paragraph styles ready");
```

The successful script commits once. Both frames follow the new base size and gap; the second retains its authored color override. Call second.resetParagraphOverrides(["color"]) to inherit the current base color, or set second.paragraphStyle=null to detach while retaining its current appearance.

## Bilateral denoise (schema 39)

`new BilateralDenoiseFilter(options?: {radius?:number; colorSigma?:number; amount?:number; enabled?:boolean; id?:string})` creates an immutable smart-filter value. Defaults: integer radius 2 (0–16 native master pixels), colorSigma 25 (finite 0–255 encoded byte levels), amount 0.5 (finite 0–1), enabled true and generated nonblank ID. Null, nonfinite/out-of-range values, fractional radius and unknown fields reject. Serialized data is `{kind:"bilateral-denoise",id,enabled,radius,colorSigma,amount}`; root/embedded-master records require schema 39. Older documents remain readable without added defaults/filters. Project 3/workspace 2 and recipe/plugin transport versions are unchanged.

The full 2D square neighborhood uses spatial sigma radius/2 and RGB root-mean-square range sigma colorSigma. Neighbor weight is alpha * exp(-2*(dx²+dy²)/radius²) * exp(-(dr²+dg²+db²)/(6*colorSigma²)). Normalize weighted RGB, blend that mean with the original center by amount, then round once to bytes. Center alpha and zero-alpha hidden RGB stay intact. Transparent/outside-artboard samples have no influence. Radius 0, colorSigma 0, amount 0 or disabled entries bypass processing and resampling/SVG baking. Larger settings can soften fine detail. This is local encoded RGB8 smoothing, not RAW/scene-linear development, a learned noise model or a camera-quality claim.

Use existing SmartObjectLayer.addFilter/setFilters and detached smartFilters snapshots. Ordered execution is in master pixels before placement; existing filter masks blend original/filtered native pixels. Locks, duplicate IDs, stale host revisions, synchronous transactions and one-undo isolated commits retain their existing contracts. Internal worker tiles/tables are budgeted independently of original-image dimensions. Isolated scripts author filter values, not worker pixel jobs; REST retains its separate session and does not render/synchronize browser output.

<!-- example: bilateral-denoise -->
```js
const selected = document.selectedLayer;
const target = selected instanceof RasterLayer
  ? selected.convertToSmartObject()
  : selected;
if (!(target instanceof SmartObjectLayer))
  throw new Error("Select a raster image or smart object.");
target.addFilter(new BilateralDenoiseFilter({
  radius: 3, colorSigma: 20, amount: 0.75
}));
document.selectedLayer = target;
print("Bilateral denoise ready");
```

A successful script commits one undo entry, including conversion if needed; failure discards both. Original source bytes stay in the project. Smart filters exposes the same controls, ordering, disabling and removal with transient preview/Escape.

## Median denoise (schema 38)

`new MedianFilter(options?: {radius?:number; enabled?:boolean; id?:string})` creates an immutable smart-filter value. Defaults: radius 1, enabled true, generated nonblank ID. Radius accepts integers 0–32 in native master pixels; 0 is a byte-exact no-op. Null, nonfinite, fractional, out-of-range and unknown options reject. Serialized data is `{kind:"median",id,enabled,radius}` and requires schema 38, including inside component masters. Existing documents remain readable and acquire no new filters automatically.

The filter independently selects each encoded RGB8 channel's lower alpha-weighted median in a `(2*radius+1)` square. It preserves the center alpha and zero-alpha hidden RGB; transparent neighbors and outside-artboard padding have no influence. It runs in stack order before instance placement and ordinary layer masks/styles, with the existing filter mask blending original/filtered pixels. A larger radius removes more fine detail. This is useful for isolated bright/dark speckles, not a claim of RAW or general noise-model support.

Use the existing addFilter/setFilters methods; settings from smartFilters are detached snapshots. Locks, duplicate IDs, shared masters, transactions, stale host revisions and script rollback retain their existing contracts. Worker tiles have allocation/work budgets independent of original-image dimensions. Isolated scripts author filter values, not direct worker/pixel jobs. Headless REST retains its separate session and does not render browser output.

<!-- example: median-denoise -->
```js
const selected = document.selectedLayer;
const target = selected instanceof RasterLayer
  ? selected.convertToSmartObject()
  : selected;
if (!(target instanceof SmartObjectLayer))
  throw new Error("Select a raster image or smart object.");
target.addFilter(new MedianFilter({ radius: 1 }));
document.selectedLayer = target;
print("Denoise ready");
```

The successful script commits one undo entry. A failure discards conversion and filter changes together. Original raster bytes remain in the project. The Smart filters Inspector exposes the same radius, enable, ordering and removal operations with transient preview and Escape cancellation.

## Shared frequency radius and native preview (schema 37)

`new LayerGroup({frequencyRadius?:number|null, ...options})` and writable `group.frequencyRadius` provide one radius for every descendant FrequencyBandFilter in that document plane. Values are finite 0–4096/3 original-master pixels. Omission/null means inherit the nearest enclosing group; if none exists, each filter uses its own serialized sigma. Nested explicit group values override outer values. Entering a component master starts a separate scope. The current frequency factory creates one controlling Frequencies group, so low, high and precision planes stay consistent when the radius changes. Valid legacy schema-36 groups have no controller and keep their independent settings.

Read-only `layer.frequencyGroup:LayerGroup|null` returns the nearest controlling group for an attached layer, including a group itself; removed/detached/uncontrolled layers return null. The getter locates a controller in the same document, never inside an unrelated component source. Assign the controller's radius through its OO setter for one shared layer.update command, validation, preview and undo. The protected correction child stays locked and its serialized filter fallback/strokes remain unchanged; parent parameter changes affect its derived rendering just as parent transforms do. The controller's own/ancestor locks apply. Raw smartFilters snapshots retain per-filter fallback sigma; those values apply when no group controls them. Use the group property to change an active shared radius.

<!-- example: frequency-shared-radius -->
```js
const selected = document.selectedLayer;
const controller = selected && selected.frequencyGroup;
if (!controller) throw new Error("Select a band or retouch layer inside a frequency group.");
controller.frequencyRadius = 6;
print("Shared native radius", controller.frequencyRadius);
```

Conversion, rasterization, isolated Photoshop planes and cross-document copies capture the effective inherited radius when crossing a document/component boundary, preserving the rendered setting. Whole groups retain their editable controller. Schema 37 rejects old labels for this field, including embedded masters; project 3/workspace 2 and original assets retain their formats/bytes. Unknown/invalid values and group-only fields on other layer kinds reject atomically through existing commands. A null value also belongs to schema 37.

Trusted application preview uses `await editor.prepareFrequencySeparation(layerId,{signal?}?)`. It captures the full neutral native source once in a private asset store and returns a prepared object with readonly `bounds:{x,y,width,height}` in original-image coordinates, including expanded wet ink. It publishes no document/history/output assets until commit:

- `await prepared.preview({sigma,center?:{x,y}},{signal?}?)` returns an owned frame with `original`, `low`, `high` canvases, `region` and idempotent `dispose()`. The native sample is at most 256×192 pixels, with a real full-resolution Gaussian halo; originals are not downsampled. Center defaults to the captured source center and clamps to its bounds. Finite centers are required. Color/detail panes retain original sample alpha; masks, ordinary post-placement erasures and layer tone/styles remain on final artwork, rather than being baked into these neutral bands.
- `await prepared.commit({sigma?,name?},{signal?}?)` uses the same full native capture to create the regular editable workflow in one host undo. It is a once-only operation after success. Failed preflight on an otherwise current source can retry with other settings, using a fresh private model. No failed attempt consumes the retained base snapshot or publishes output assets.
- `prepared.dispose()` aborts future use and releases private image ownership. Previously returned preview frames remain independently owned until disposed. Dispose on close/cancel and after commit. Source/document/selection/revision/bitmap/blob/native-dimension changes reject before publication; closing a session invalidates its preparation. No duplicate in-flight commit or preview after commit/disposal is accepted.

The dialog uses two native panes, original comparison, pointer/keyboard panning and a single preview queue that drops obsolete requests. Sliders remain editable while a worker finishes; only the latest complete frame is displayed. Create waits for the chosen preview, and cancel/Escape leaves the document untouched. Capture/commit status and errors are real asynchronous state. Preview halos retain the existing 4 MP/8192-edge working budget; an expensive radius can reject without imposing an image-resolution limit. These trusted canvas APIs are not isolated script/plugin bindings or REST render services; existing prepared-data scripting remains available.

The shared group radius can be recorded/replayed as an ordinary `layer.update` recipe step against existing frequency contents. This does not make the asynchronous native capture operation a new recipe action. Workspace contents links and original source assets retain their existing ownership and explicit Apply to source boundary.

## Frequency separation and native composition (schema 36)

`document.createFrequencySeparation(source: RasterLayer, snapshot: RasterLayer, options?: {sigma?: number, name?: string}): LayerGroup` assembles an editable workflow from **prepared native pixels**. Both layers must be distinct, attached to this document, and have unlocked ancestry. The snapshot must have positive integer dimensions, normal blending, full opacity/fill, no effects, erasures, enabled styles or mask. Its `transform` maps native snapshot pixels into the original raster's local coordinates, including any offset for expanded wet ink. It is not automatically resized to the source's displayed dimensions. The factory validates structure; callers remain responsible for supplying an authentic neutral source capture.

Options default to `{sigma:4, name:"Frequency separation"}`. Sigma is finite 0–4096/3 original-image pixels; name contains 1–240 characters. Unknown fields, null values, invalid snapshots, foreign layers and locked ancestry throw before mutation. The operation runs one synchronous transaction: preserve the original raster's ID/assets, hide it, consume the temporary snapshot, and insert a group carrying the source's transform, opacity/fill, blending, mask, styles and metadata. The source remains available for comparison and recovery. The current factory adds a schema 37 shared-radius controller to the native band group and selects the outer group. The trusted browser command selects its nested **Frequency layers — edit contents** instance instead, for direct access to Edit contents.

The nested native composition contains **Low frequency — color and tone**, **High frequency — detail**, and a locked **Precision correction — keep above bands** layer. Each band contains a captured-source smart instance and a separate empty PaintLayer for retouching. Low uses normal blending; high uses `linear-light`; correction uses `linear-burn`. Captured source alpha is retained as an editable bitmap group mask. Original ordinary erasures remain ordered in a separate coverage mask after placement/tone. When active wet replacements exist, the neutral native capture includes their entire ordered sequence and expanded bounds. Edit the retouch layers through existing Edit contents, then Apply to source. Source assets remain unchanged.

New immutable smart-filter constructors share generated IDs and `enabled:true` defaults. Constructors accept only their listed options; null and unknown fields reject. Each supports `id?:string` and `enabled?:boolean`:

| Constructor | Other options and semantics |
| --- | --- |
| `new FrequencyBandFilter(options?)` | `band:"low"\|"high"\|"correction"` (default `"high"`), `sigma:4`, finite 0–4096/3 master pixels. Produces an opaque RGB8 plane using finite 3-sigma, premultiplied encoded-RGB Gaussian sampling. |
| `new NativeCompositionFilter(options?)` | No numeric options. Composes the native master's RGBA image before instance resampling, with the native image-frame edge boundary. |
| `new DocumentToneFilter(options?)` | `exposure:0` (−3–3), `contrast:0` and `saturation:0` (−100–100). Executes after instance placement in document pixels, before the ordinary layer mask. Uses the existing tone rule. |

DocumentToneFilter entries must follow every native-phase entry, including disabled entries; invalid ordering rejects the full filter command. Existing per-instance filter masks still apply: native filters mix before placement, document-tone filters mix with projected native mask coverage after placement. Feathering remains in the native mask plane; density/inversion remain separate settings. NativeCompositionFilter fixes native sampling/edge behavior and has no independently tunable pixel effect.

For channel bytes O (original) and L (rounded low), detail H is `round(127.5+(O-L)/2)`. Linear Light computes `clamp(L+2*H-255,0,255)`. Its unavoidable RGB8 rounding bit is removed by correction C: 254 when O<255 and O−L is even, otherwise 255. Linear Burn computes `max(0,B+C-255)`, yielding O exactly on the native grid. This is encoded RGB processing, not scene-linear or HDR frequency separation. Preserve the correction layer above both bands and keep their radii consistent when editing the initial decomposition. General blend modes use the same source-over alpha/opacity behavior as the other blend modes.

`new LayerMask({rasterErasures:{width,height,operations}, ...settings})` represents ordinary raster eraser/clear coverage without baking it into source RGB. Width/height are finite positive original local dimensions. Each ordered operation is `{width,height,stroke:EraserStroke|PaintFill}` with positive dimensions captured when authored; a PaintFill must have `erase:true`. Wet paint and non-clear fills reject. At most 2048 operations are accepted, using the existing stroke validation/budgets. Geometry starts with opaque coverage and replays operations in their captured coordinate planes. Choose exactly one geometry source; fillRule is invalid. Common mask defaults remain enabled=true, inverted=false, density=1, feather=0, x=y=0, linked=true, identity basis, no refinement strokes. `mask.rasterErasures` returns an independent source value or null; `mask.with(...)` retains it unless replacing geometry. Original texture references in erasures participate in ordinary asset validation/persistence.

The trusted application method is `await editor.separateFrequencies(layerId, options?, {signal?:AbortSignal}?)`. It privately captures full native source pixels, assembles bands, probes rendering, then commits once. Abort, source-asset replacement, session/document/revision/selection changes, locks or rendering errors reject without publishing prepared layers/assets. Native tile/halo budgets may reject an expensive radius with a useful message; there is no image-resolution/file-size cutoff or viewport downsampling of originals. This application method is not exposed inside isolated scripts or as a headless REST rendering endpoint.

The following isolated recipe uses existing asset inspection and smart-object rasterization services to prepare a selected raster. Those asynchronous calls must run outside a synchronous transaction; the whole successful script still commits one host undo entry. Existing five-second/host-repair execution limits apply, so use the browser command for large captures.

<!-- example: frequency-separation -->
```js
const source = document.selectedLayer;
if (!(source instanceof RasterLayer)) throw new Error("Select a raster image first.");
const native = await host.assets.get(source.assetId);
const working = source.duplicate();
const capture = document.layers.add(new LayerGroup({name:"Native capture"}));
working.moveTo(capture);
working.transform = new AffineTransform();
working.width = native.width;
working.height = native.height;
working.opacity = 1;
working.fillOpacity = 1;
working.blendMode = "normal";
working.visible = true;
working.mask = null;
working.styles = new LayerStyle();
working.resetAdjustments();
const erasures = source.toJSON().erasures || [];
if (!erasures.some(entry => entry.stroke.kind === "wet" && entry.stroke.opacity > 0)) {
  working.update({erasures:[]});
}
const temporary = document.createSmartObject([capture]);
const componentId = temporary.componentId;
const snapshot = await temporary.rasterize();
document.removeComponent(componentId);
snapshot.transform = AffineTransform.scale(source.width/native.width, source.height/native.height)
  .multiply(snapshot.transform);
const result = document.createFrequencySeparation(source, snapshot, {sigma:2});
print("Frequency layers ready: " + result.name);
```

## RedEyeAdjustment (schema 35)

`new RedEyeAdjustment({threshold?: number, strength?: number} = {})` creates an immutable value with read-only `threshold` and `strength` getters and a detached `toJSON()`. Defaults are 32 encoded RGB8 levels and 100 percent. Threshold accepts finite 0–255; strength accepts finite 0–100, including fractions. Missing/undefined fields use defaults; null, unknown fields, nonfinite or out-of-range values reject. The DTO is `{kind:"red-eye", threshold, strength}` with both numeric fields required. `new AdjustmentLayer({adjustment: new RedEyeAdjustment(...)})` accepts the constructor value. `layer.setRedEye(value)` requires a `RedEyeAdjustment`, replaces the adjustment through one validated command, and obeys attached layer/ancestor locks. `.adjustment` still returns/accepts detached DTOs.

This is manual red-dominance correction, not automatic eye detection. Isolate pupils with `layer.maskFromSelection(selection)` after attaching the layer, so transformed parents are handled correctly. The UI's New Red Eye adjustment requires an active selection and captures its mask in the creation transaction. Script/REST authors may create an unmasked adjustment deliberately; it can affect any red-dominant area. Existing mask controls, opacity, blending and stack order remain editable. Reset restores threshold 32 and strength 100 without replacing the mask.

For straight encoded RGB8, let `d = R - max(G,B)`. If alpha is nonzero, `d > 0` and `d >= threshold`, replace red with `round(R + ((G+B)/2 - R) * strength/100)`. Other channels and alpha are unchanged; zero strength is identity. Integer channel differences make fractional thresholds equivalent to rounding the threshold upward. No linear-light, calibrated portrait quality or semantic eye-detection claim is made. The worker uses actual WASM in bounded tiles; the supported GPU viewport uses WGSL. Native exports use the reference compositor; SVG/Photoshop adjustment prefixes may bake with the existing warnings. Original assets are retained unchanged. Schema 35 records reject under older labels, including embedded masters; valid older roots still migrate. Project/workspace remain v3/v2. No new host/network service, permission or REST/browser synchronization is added.

This runnable synthetic study demonstrates the constructor and selection workflow without requiring a portrait:

<!-- example: red-eye-correction -->
```js
document.resize(96, 48);
const study = document.layers.add(new PaintLayer({name: "Synthetic red-eye study"}));
study.strokes.add(new PaintFill({bounds: {x:0,y:0,width:96,height:48}, color:"#d8b098"}));
const left = new MarqueeSelection({shape:"ellipse",x:14,y:10,width:16,height:16});
const right = new MarqueeSelection({shape:"ellipse",x:62,y:10,width:16,height:16});
const pupils = left.combine(right);
study.strokes.add(new PaintFill({bounds:{x:0,y:0,width:96,height:48},color:"#f01828",clip:pupils}));
const correction = document.layers.add(new AdjustmentLayer({
  name: "Pupil correction", adjustment: new RedEyeAdjustment({threshold:32,strength:100})
}));
correction.maskFromSelection(pupils);
document.selectedLayer = correction;
print("Red-eye study ready; threshold " + correction.adjustment.threshold);
```

Canoli Studio scripts use JavaScript and an object-oriented document model to control the open composition. This guide describes the current implementation in [src/dom/index.ts](../src/dom/index.ts) and [src/scripting](../src/scripting). It is a prototype API; Photoshop scripting compatibility and a published, stable SDK are not implemented.

The current document schema is **37**. Earlier schema numbers in adjustment-family sections identify the version that introduced those records; current constructors and restoration upgrade valid older documents to schema 37. Portable project container v3 and workspace v2 are separate versions.

For reusable installable commands, see [Plugins and extensions](PLUGINS.md). Plugin commands receive these same bindings and obey the same runtime limits, with additional host-enforced document permissions.

For HTTP automation, see the separate [REST API](API.md#rest-api). REST sessions currently contain their own document metadata and do not control the active browser tab.

The **Developer docs** link in the tool rail and Scripts panel opens this guide in a new tab. The same pages ship with development and production builds; rebuild with `npm run build:docs` after editing Markdown.

## Contents

- [Quick start](#quick-start)
- [Execution and available bindings](#execution-and-available-bindings)
- [Document](#document)
- [Design checks](#design-checks)
- [Alpha channels](#alpha-channels)
- [Quick Selection brush](#quick-selection-brush)
- [Select Subject](#select-subject)
- [Layers and groups](#layers-and-groups)
- [SmartObjectLayer and shared masters](#smartobjectlayer-and-shared-masters)
- [LayerMask](#layermask)
- [LayerMetadata](#layermetadata)
- [LayerCollection](#layercollection)
- [ToneAdjustment](#toneadjustment)
- [AdjustmentCollection](#adjustmentcollection)
- [PaintLayer and strokes](#paintlayer-and-strokes)
- [Prepared wet paint](#prepared-wet-paint-schema-33)
- [Image-backed brush textures](#image-backed-brush-textures-schema-32)
- [VectorLayer and paths](#vectorlayer-and-paths)
- [TextLayer](#textlayer)
- [Shared radius and native preview](#shared-frequency-radius-and-native-preview-schema-37)
- [Frequency separation](#frequency-separation-and-native-composition-schema-36)
- [Red-eye correction](#redeyeadjustment-schema-35)
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
| `GaussianBlurFilter`, `MedianFilter`, `BilateralDenoiseFilter`, `UnsharpMaskFilter`, `SmartToneFilter`, `FrequencyBandFilter`, `NativeCompositionFilter`, `DocumentToneFilter` | Immutable filter values for per-instance smart-filter stacks.                                                                                                |
| `RasterLayer`                                                | Constructor for an image layer referring to an existing asset.                                                                                               |
| `LayerGroup`                                                 | Constructor for an ordered group of layers.                                                                                                                  |
| `PaintLayer`                                                 | Constructor for ordered brush/pencil/clone/fill strokes and prepared wet replacements.                                                                              |
| `VectorLayer`                                                | Constructor for a vector layer containing Bézier vector paths.                                                                                               |
| `VectorPath`                                                 | Constructor for editable vector paths with anchors, control handles, fill, and stroke.                                                                       |
| `TextLayer`                                                  | Constructor for text layers with font, size, color, alignment, and line height.                                                                              |
| `ParagraphStyle` | Named reusable typography, linked frames and per-field overrides through Document.paragraphStyles. |
| `AdjustmentLayer`                                            | Constructor for non-destructive adjustment layers modifying preceding backdrop pixels; see AdjustmentLayer for current families.                                 |
| `RedEyeAdjustment` | Immutable threshold/strength correction value; isolate pupils with an editable mask. See [Red-eye correction](#redeyeadjustment-schema-35). |
| `PatchAdjustment`                                            | Immutable corrected-RGB asset descriptor for an alpha-preserving patch adjustment.                                                                           |
| `TonalStroke`                                                | Constructor capturing a brush/pencil path and dodge/burn settings for a tonal adjustment layer.                                                              |
| `BrushSymmetry` | Immutable mirror/radial or explicit affine stroke copies; original ink remains implicit. |
| `BrushTexture` | Immutable reference to an existing image asset used as brush coverage; see image-backed brush textures below. |
| `BrushTip` | Immutable authored tip angle/roundness and optional spherical pen-tilt response. |
| `PressureCurve` | Immutable normalized brush pressure response with editable knots and Linear/Soft/Firm presets. |
| `BrushStroke`                                                | Constructor for soft brush strokes with color, size, hardness, opacity, and pressure points.                                                                 |
| `EraserStroke`                                               | Constructor for eraser strokes using destination-out compositing to erase paint content.                                                                     |
| `PencilStroke`                                               | Constructor for hard, precise pencil marks.                                                                                                                  |
| `CloneStroke`                                                | Constructor for clone brush strokes referencing sampled image tiles.                                                                                         |
| `WetPaintStroke` | Prepared native color/alpha replacement; pixels are authoritative, with brush metadata retained. |
| `PaintFill`                                                  | Constructor for solid color canvas fills.                                                                                                                    |
| `AffineTransform`                                            | Immutable affine matrix constructor and composition helpers for transformed selections.                                                                      |
| `AlphaChannel` | Constructor for a saved independent selection channel. |
| `MarqueeSelection`                                           | Constructor for geometric or pixel-coverage selections.                                                                                                        |
| `LayerMask`                                                  | Constructor for immutable selection, vector, paint, bitmap or raster-erasure coverage with ordered operations.                                                                                                 |
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
| `createFrequencySeparation(source, snapshot, options?)` | `LayerGroup` | Assemble prepared native frequency bands in one transaction; preserve hidden original. See [schema-36 contract](#frequency-separation-and-native-composition-schema-36). |
| `crop({ x, y, width, height })`  | `void`                      | Rebase the canvas to a rectangle, preserving off-canvas artwork and original assets. One undoable command. See Canvas cropping below.                                    |
| `resizeImage(width, height)` | `void` | Scales canvas and artwork together; positive safe-integer dimensions. See Resize the image and artwork below. |
| `resize(width, height)`          | `void`                      | Resizes canvas dimensions atomically as one undoable command. Validates positive safe integers.                                                                          |
| `layers`                         | Read-only `LayerCollection` | Root layers only, ordered back-to-front.                                                                                                                                 |
| `alphaChannels` | Read-only `AlphaChannelCollection` | Saved fractional selection channels, independent of layers. See Alpha channels below. |
| `selectedLayer`                  | Read/write layer or `null`  | Select a layer belonging to this document, or clear selection. Set after a transaction when selecting a newly added layer.                                               |
| `getLayer(id)`                   | Layer or `null`             | Search the entire tree by ID; accepts `null`, which returns `null`.                                                                                                      |
| `selectSubject(options?, control?)` | `Promise<SelectionData>` | Native source-derived pixel coverage from a raster, with complete placement transforms and one undo step; see Select Subject for heuristic limits. |
| `removeBackground(targetLayer?, options?, control?)` | `Promise<RasterLayer>`      | Prepares a native matte on an unlocked raster. Returns the output raster (a new layer when requested); one undo entry. See the matting contract below.                                                          |
| `transaction(label, callback)`   | `undefined`                 | Synchronous atomic batch. See transaction rules below.                                                                                                                   |
| `toJSON()`                       | `DocumentData` object       | Deep copy of document metadata, including nested layers and adjustments. Includes pixel selection; excludes asset bytes, active layer, history and script code.          |
| `Document.fromJSON(data)`        | New `Document`              | Validate a metadata object and create a separate document with empty history and no active layer; retains serialized pixel selection. Pass an object, not a JSON string. |
| `canUndo`, `canRedo`             | Read-only booleans          | History availability in this instance. In Scripts these describe the worker's history, not the host's existing history.                                                  |
| `undo()`, `redo()`               | `undefined`                 | Available on standalone instances and trusted application instances. **Disabled on the supplied script `document`**; use editor undo/redo after the run.                 |

To inspect metadata as text, use `JSON.stringify(document.toJSON())`. Editing that returned object does not edit the document. `Document.fromJSON(document.toJSON())` creates an independent model with the same serialized IDs; it does not import source assets or establish shared ownership. Construction does not freeze or modify the supplied metadata, including its schema version. Validation checks the supplied schema before upgrading the owned copy; labeling newer fields with an older schema remains an error. Only operations against the supplied `document` are applied to the open composition.

## Layers and groups

`RasterLayer`, `PaintLayer`, `VectorLayer` and `LayerGroup` share the base Layer API. `Layer` is an abstract base class, not a constructor binding in the Scripts panel.

Signatures:

- `new RasterLayer({ assetId, width, height, ...options })`
- `new LayerGroup({frequencyRadius?: number | null, ...options} = {})`

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
| `frequencyGroup` | `LayerGroup \| null` (read-only) | Nearest shared frequency-radius controller in this document plane; null when detached or uncontrolled. |
| `update(patch)`                | `undefined`                                    | Apply the supplied writable properties together; omitted properties retain their values. Raster width/height are also accepted. Unknown properties are rejected.                                                                              |
| `duplicate()`                  | New layer/group of the same kind               | Insert immediately above the source in the same parent. New IDs for copied nodes/effects/strokes/paths; shared source assets; root copy offset +24/+24 and name suffixed `" copy"`. Requires attachment.                                      |
| `remove()`                     | `undefined`                                    | Remove the node and, for a group, its subtree. Requires attachment.                                                                                                                                                                           |
| `moveUp()`, `moveDown()`       | `undefined`                                    | Move one sibling position toward the front/back. No-op at the boundary. Requires attachment.                                                                                                                                                  |
| `moveTo(parent, options = {})` | `undefined`                                    | Move to the front of the destination document/group's collection. Destination must belong to the same document. Local coordinates remain unchanged by default; `{ preservePosition: true }` preserves document position. Requires attachment. |
| `maskFromBitmap(assetId)`      | `undefined`                                    | Attaches a bitmap mask referencing an asset in `AssetStore`. Supported on all attached layers. One undoable command.                                                                                                                          |
| `refineEdge(options?, control?)`         | `Promise<LayerMask>`                           | On attached unlocked `RasterLayer`: prepares a native matte and returns its attached `LayerMask`; corrected RGB requires new-layer output. See below.                                                                                          |
| `toJSON()`                     | `LayerData` object                             | Deep metadata copy. A group includes its subtree; a raster includes effects and its asset reference.                                                                                                                                          |

`moveTo` defaults to preserving local coordinates; opt into `preservePosition` when reparenting between offset groups. `moveBefore(target)` and `moveAfter(target)` place below/above a sibling target, adopting its parent and preserving document position. Targets must belong to the same document. Layer-row dragging uses these placement methods. Groups cannot contain themselves or an ancestor. The API has no public `parent` property or multi-selection yet; traverse collections when you need ancestry.

`LayerGroup.frequencyRadius: number | null` is writable through ordinary shared commands. Null inherits; a finite value from 0 through 4096/3 controls descendant frequency filters. See [shared radius](#shared-frequency-radius-and-native-preview-schema-37) for locks, scope, legacy behavior and native capture.

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
| `add(stroke)` | The stroke instance        | Append a `BrushStroke`, `PencilStroke`, `EraserStroke`, `CloneStroke`, `WetPaintStroke`, or `PaintFill`. |
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

Signature: `new VectorLayer(options = {})`; name defaults to `"Vector"`. Inherits common layer options. `vectorLayer.paths` is a `PathCollection` with `length`, `at(index)`, `get(id)`, `add(path)`, `remove(id)` and iteration. `at(-1)` returns the last path. `add` returns the same `VectorPath` instance and requires an unowned path. Each layer stores at most 2048 paths. `vectorLayer.toSvg(docWidth = 1920, docHeight = 1080): string` returns a complete UTF-8-compatible SVG document string, not a `<path>` fragment. Dimensions must be positive safe integers; invalid values throw. It extracts this layer in its own parent coordinate plane, including its local translation/full affine basis, visibility, opacity, fill opacity and CSS blend mode. It does not include ancestors or siblings, even when attached; a blend mode therefore has no external backdrop in this standalone output. Hidden or zero-opacity layers produce an empty SVG canvas. Use host `editor.export({format: "svg"})` for document-wide placement and a capability report.

Path anchors/handles retain JavaScript round-trip numeric precision, including scientific notation; `toSvgPath()` uses the same formatter. Path fills/strokes remain literal six-digit hex colors, with round stroke joins/caps. Generated SVG group IDs are XML-safe; `data-layer-id` retains the exact authored identifier with XML escaping, including whitespace character references. XML 1.0-unrepresentable identifiers (such as control characters or unpaired surrogates) throw at export without modifying the model.

SVG extraction preserves unfeathered vector masks without painted corrections as editable compound paths, including even-odd/nonzero holes, density, inversion and linked/unlinked full affine placement. Attached `VectorLayer.toSvg` rebases an unlinked mask from document coordinates into the immediate parent plane when excluding ancestors; detached layers interpret unlinked coordinates in the standalone export canvas plane. Disabled/zero-density masks have no effect. Masks on hidden/zero-opacity subtrees or groups without extracted artwork are not prepared.

Painted, sampled-selection, bitmap and feathered masks require host `editor.export({format: "svg"})`. Outside native backdrop prefixes, host output keeps artwork paths as vectors and embeds native document-resolution mask coverage in PNG tiles of at most 1024×1024, using the same raw coverage/finite-support feather/inversion/density rules as native PNG rendering. Native mask tiles contain white RGB plus coverage alpha, not original bitmap RGB or source files. Raster mask geometry/scalability is lost and the capability report states this before export. Missing/changed bitmap sources or disposed asset repositories reject rather than expose unmasked artwork. Host execution yields/checks cancellation between coverage tiles and path fragments; mask work or browser encoding already in progress cannot be preempted mid-call. Output retains compressed tile data and browser decoding has real memory costs; no image-resolution import cap is introduced.

Synchronous standalone `toSvg` cannot prepare these native masks and throws an error directing the caller to host export. It never silently removes an active mask. Pure vector masks remain available inside isolated scripts without a host asset or download service. `toSvg` still returns only a string, without a capability report. Color overlays and drop shadows are retained as editable SVG filter graphs, in both host export and synchronous standalone output. Masks apply before effects. Shadow color is applied to the masked silhouette before document-pixel blur/offset, while overlay and fill opacity affect content only; layer opacity and blend mode apply to the combined result. Thus fill opacity zero can still leave a shadow. Full affine coordinate compensation keeps offsets/blur in document pixels under rotated, reflected or sheared ancestors. Synchronous standalone output rejects enabled Blend If with a native-backdrop-preparation error directing callers to host export. Trusted host export retains adjustment/Blend If appearance through reported native sibling-prefix rendering and also supports paint, raster, text and smart-object contents as described under Application integration. CSS blending and SVG filters require a supporting viewer; native prefixes retain their internal backdrop in pixels. SVG/native intermediate rounding and edge sampling can differ. Native mask preparation extends into the conservative shadow support region so off-canvas masked content can cast visible shadows. Transparent support rectangles prevent parent filters from clipping child effects; they can enlarge SVG group selection bounds. Viewers may allocate effect surfaces internally, so large SVG decoding still has device/working-memory limits. SVG and native Canvas edge antialiasing can differ; no pixel-exact interchange or general SVG import round-trip is claimed. Save a project for complete editability or export PNG for rendered appearance.

<!-- example: standalone-svg -->
```js
const icon = new VectorLayer({ x: 10, y: 20 });
icon.paths.add(VectorPath.rectangle(
  { x: 0, y: 0, width: 40, height: 30 }, 0,
  { fill: "#d5e79b", stroke: null }
));
const svg = icon.toSvg(200, 120);
if (!svg.includes('matrix(1 0 0 1 10 20)')) throw new Error('Placement missing');
print('Standalone SVG ready', svg.includes('<svg '));
```

<!-- example: standalone-svg-mask -->
```js
const masked = new VectorLayer();
masked.paths.add(VectorPath.rectangle(
  { x: 0, y: 0, width: 80, height: 60 }, 0,
  { fill: "#d5e79b", stroke: null }
));
masked.mask = new LayerMask({
  paths: [VectorPath.rectangle({ x: 10, y: 10, width: 40, height: 30 })],
  density: 0.7,
  inverted: true
});
const maskedSvg = masked.toSvg(100, 80);
if (!maskedSvg.includes('<mask')) throw new Error('Vector mask missing');
print('Standalone masked SVG ready');
```

<!-- example: standalone-svg-style -->
```js
const styled = new VectorLayer({ fillOpacity: 0 });
styled.paths.add(VectorPath.rectangle(
  { x: 10, y: 10, width: 40, height: 30 }, 0,
  { fill: "#804020", stroke: null }
));
styled.styles = new LayerStyle({
  colorOverlay: { enabled: true, color: "#2040e0", opacity: 0.5 },
  dropShadow: { enabled: true, color: "#0020ff", opacity: 1, x: 20, y: 12, blur: 4 }
});
const styledSvg = styled.toSvg(100, 80);
if (!styledSvg.includes('<filter')) throw new Error('Effect graph missing');
print('Styled SVG ready');
```

The example constructs a detached layer and returns text in the isolated worker; it does not download files or change the active document. `toSvg` is synchronous and subject to the existing script deadline/output limits. Host SVG export yields between bounded path fragments and can receive cancellation within a large path; it does not expose a download API to scripts.

### VectorPath

Signature: `new VectorPath({ points, closed = false, fill = null, stroke = "#d5e79b", strokeWidth = 2, strokeCap = "round", strokeJoin = "round", strokeMiterLimit = 4, strokeDashArray = [], strokeDashOffset = 0, fillGradient = null, fillRule = "nonzero", subpaths = [] })`.

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

Stroke members are also read/write and accepted by `update(patch)`, every shape factory's `options`, and trusted `editor.tools.importSvgPath(d, options)`. The exported `VectorStrokeOptions` TypeScript type describes the five optional stored fields.

| Member | Default | Accepted values |
| --- | --- | --- |
| `strokeCap` | `"round"` | `"butt"`, `"round"`, `"square"` |
| `strokeJoin` | `"round"` | `"miter"`, `"round"`, `"bevel"` |
| `strokeMiterLimit` | `4` | Finite ratio from 1 through `Number.MAX_SAFE_INTEGER` |
| `strokeDashArray` | `[]` | At most 256 finite, nonnegative lengths through `Number.MAX_SAFE_INTEGER`, in local user units |
| `strokeDashOffset` | `0` | Finite signed local-user-unit offset, within ±`Number.MAX_SAFE_INTEGER` |

Dash arrays are defensive copies on input/output. Empty/all-zero arrays paint a solid stroke; odd-length patterns repeat, and signed offsets shift the repeating pattern according to [SVG stroke semantics](https://www.w3.org/TR/SVG2/painting.html#StrokeDashing). Explicit zero-length segments and solid closed contours keep round/square cap artwork; move-only contours and butt caps do not paint a point. Point dash phases use half-open intervals, with zero-size on-dashes retained. Closed zero-length contours with non-solid patterns stay empty, matching the verified browser behavior. Degenerate dash boundaries and faint edge coverage can differ in other viewers. Width, dashes and caps follow the complete layer affine transform; non-scaling strokes, markers and path-length calibration are not part of this model. Miter support and diagonal square/dash caps contribute conservative bounds for caching/culling/effects. Very large geometry/style values still encounter actual browser precision/allocation limits; this is not a source-image resolution cap. Vector drawing uses native line commands for geometrically straight segments to retain Canvas/SVG dash measurement; mask curve coverage retains its existing rasterization. Pixel antialiasing can differ between line/curve forms and SVG viewers; mathematical geometry remains unchanged.

Invalid enums, nonfinite/out-of-range values, negative dash lengths and too many entries reject before mutation. Unknown update/command fields also reject. Ancestor locks, ownership, command validation, transactions and undo apply as usual. New fields require document schema 22. Valid v1–v21 documents migrate without injecting these fields; absent values keep legacy round caps/joins, solid strokes, limit 4 and offset 0. Project container 3, workspace 2 and source bytes are unchanged. Isolated Scripts and permissioned plugin commands receive the same setters without new file/network privileges. REST `path.add`/`path.update` use the same fields and validation in their separate sessions. Existing recipe recording still reports standalone path-update steps as unsupported; creating a layer that already contains styled paths retains those fields.

<!-- example: vector-stroke-styles -->
```js
document.resize(160, 128);
const layer = document.layers.add(new VectorLayer({ name: "Styled stroke" }));
const path = layer.paths.add(VectorPath.fromSvgPath("M24 40H128", {
  fill: null, stroke: "#804020", strokeWidth: 16,
  strokeCap: "square", strokeJoin: "miter", strokeMiterLimit: 12,
  strokeDashArray: [16, 24], strokeDashOffset: 0
}));
path.strokeCap = "square";
path.strokeDashOffset = -2;
path.strokeDashOffset = 0;
const detachedDashes = path.strokeDashArray;
detachedDashes[0] = 999;
if (path.strokeDashArray[0] !== 16) throw new Error("Dash ownership failed");
document.selectedLayer = layer;
print("Stroke settings ready");
```

#### Boolean path operations

`await document.combinePaths(operation, paths, control = {}): Promise<VectorPath | null>` combines an ordered array of attached `VectorPath` handles from this document. `await vectorLayer.combinePaths(operation, paths = [...vectorLayer.paths], control = {}): Promise<VectorPath | null>` is the same-layer convenience form; passing paths from other layers to it rejects. Operations are `"union"`, `"subtract"` (first minus every later area), `"intersect"` and `"exclude"` (sequential symmetric difference). Every primary contour must be closed. Fill visibility, stroke outlines, masks, effects and later operands' appearances do not define the operand areas; the path's fill rule and all native boundaries do.

Operands are mapped through their complete ancestor/world affine transforms into the first operand's local layer plane. Results retain cubic handles without polygon/raster flattening, preserve the first path ID, paint/gradient/stroke settings, first layer placement and appearance, and occupy the first path's list position. Contour orientation and starting anchors are regenerated; dash placement follows the resulting contour while its stored stroke settings are retained. Other operand paths are removed. Empty operand vector layers are removed; parent groups and other content remain. An empty result removes all operand paths and returns `null`. Otherwise the returned owner-backed path shares the first handle's identity, with canonical nonzero winding and newly identified additional contours. Retained handles for removed operands fail until undo restores them. Shared `paths.replace` performs the validated atomic replacement in one named history entry; cancellation or failure adds no Boolean edits.

Inputs require 2–128 distinct paths, at most 128 total input contours and 20,000 total input anchors. Each intermediate pair result and the final result support at most 128 contours/20,000 anchors; an oversized intermediate result rejects even if later operands would simplify it. These are operation-geometry budgets independent of image resolution. Invalid operations, open/foreign/missing/duplicate operands, locked operands/ancestors, invalid or over-budget geometry/results and malformed worker data reject before commit. Earlier edits in an isolated script are staged and are also discarded if the script fails. Source image bytes do not enter the geometry worker. Existing schema 25/project 3/workspace 2 store the final geometry; no new schema or live library dependency is needed to render/reopen/undo a completed result.

A dedicated terminable browser or Node worker uses pinned Paper.js 0.12.18 cubic Boolean algorithms. Geometry is centered and uniformly normalized to a 1024-unit control-hull extent before calculation and restored afterwards, avoiding common large-offset/scale problems. Floating point tolerances, near-coincident/tiny geometry and existing browser precision limits still apply; exact symbolic algebra and universal SVG pixel identity are not promised. Calculation has a 30-second wall-clock deadline. Trusted `control` accepts `signal?: AbortSignal` and `onProgress?({completed,total})`, reporting completed pair operations rather than estimated time. Callback errors, aborts, stale revisions/session changes, worker failures and deadline expiry reject and terminate preparation without a replacement. Use the method outside synchronous transactions and on a configured application host; those unsupported contexts reject.

Scripts/plugins await the same method through their isolated host boundary. They use panel cancellation rather than AbortSignal/progress callbacks. Plugin document-read/write permissions are rechecked during preparation and final commit; no new manifest/asset/file/network permission or installation behavior is added. Native asynchronous preparations share the existing sequential 32-operation script budget. The existing five-second script wall-clock limit includes host preparation, so a longer trusted native Boolean call can exceed the script budget before the 30-second worker deadline. A script timeout cancels its pending geometry worker and discards all staged edits. Existing full layer-add recipe templates can retain final compound geometry; standalone Boolean/path replacement recording remains unsupported.

<!-- example: vector-boolean -->
```js
document.resize(160, 128);
const layer = document.layers.add(new VectorLayer({ name: "Boolean cutout" }));
const frame = layer.paths.add(VectorPath.rectangle(
  { x: 8, y: 8, width: 144, height: 112 }, 0,
  { fill: "#ed9966", stroke: null }
));
const hole = layer.paths.add(VectorPath.ellipse(
  { x: 40, y: 32, width: 80, height: 64 }, { stroke: null }
));
const result = await layer.combinePaths("subtract", [frame, hole]);
if (!result || result.subpaths.length !== 1) throw new Error("Expected a cutout");
document.selectedLayer = layer;
print("Boolean cutout ready");
```

The **Combine vector paths…** Properties action or command palette opens the local operation dialog. Choose paths, operation and first operand. Candidate checkboxes are searchable and paginated in groups of 32; open/locked paths cannot be chosen. Cancel/Escape terminates in-flight calculation. Reopen a stale dialog after other document edits. This adds no keyboard binding. The trusted `editor.tools.selectVectorPath(path: VectorPath | null): void` helper selects a validated active-document path and its owner layer (or clears only path selection), cancels pending gestures and selects the Pen layer target for a nonempty result. It changes UI state without document edits/history. The Boolean dialog uses it so a removed Pen target cannot make Properties select an unchecked later path.

#### Compound paths and VectorContour

A closed `VectorPath` can contain holes, nested boundaries and disconnected islands sharing one fill/gradient, stroke and fill rule. `path.points` edits the primary contour. `path.subpaths` is a read-only `SubpathCollection` of additional closed `VectorContour` objects. The complete path supports at most 128 contours and 20,000 total anchors; every contour must have at least one anchor. These are geometry budgets, not image-resolution limits. An open primary path cannot have additional contours.

`fillRule` defaults to `"nonzero"` and is read/write; `"evenodd"` is also accepted. Nonzero uses contour winding; even-odd alternates coverage at crossings. Changing paint or fill rule affects every contour. The fill rule is also accepted by shape factory options and `VectorFillOptions`. Omitted fields preserve legacy records without adding defaults. Schema 24 introduces optional `fillRule` and `subpaths`; valid older roots/history upgrade without changing geometry/assets, and older schema labels containing either field reject. Project/workspace versions remain 3/2.

`new VectorContour({points})` accepts the same anchor/absolute-handle constructor values as `VectorPath`. Additional contours are always closed and do not have independent paint. Its read-only `id`, `closed`, defensive `points`/`toJSON()`, `addPoint`, `setPoint`, `splitSegment(index, t = 0.5)`, `removePoint`, and `remove()` follow the parent path's ownership, locks and undo. Removing the final anchor rejects. `remove()` requires an owner. A retained handle throws when its contour or parent is absent from the current revision and becomes readable again after undo.

`path.subpaths` provides `length`, `at(index)` (including negative indices), `get(id)`, `add(contour)`, `remove(id)` and iteration. `add` returns the same unowned contour instance. A contour cannot belong to two paths, even after removal. Constructor `subpaths` accepts unowned `VectorContour` instances; duplicate IDs/objects, an open primary with extra contours, invalid coordinates and over-budget geometry reject before mutation. Unknown serialized contour/update fields also reject. Getter arrays and constructor input arrays are independent copies. `path.update({subpaths, fillRule, ...})` and REST patches accept complete serialized contour values `{id, points, closed:true}` as replacement metadata; attached edits still enter shared commands/history. Full merged-path validation applies even when a partial patch is syntactically valid.

The Pen tool edits anchors/handles on every boundary using one preview/commit and normal Escape cancellation. Properties shows a fill-rule selector and additional-contour removal; the Closed path toggle is disabled while additional contours exist. SVG export writes one compound `d` and explicit authored fill rule; editable SVG import retains native contour geometry, including implicitly closed fills. Opaque closed fill/stroke artwork retains one shared editable contour graph. Open geometry or translucent paints use separate fill/stroke layers to preserve paint composition before element opacity; the import report discloses that later geometry edits are independent. `VectorPath.fromSvgPath` continues to require a single contour; use trusted whole-file SVG import for compound source documents. Existing layer-add recipe templates retain compounds; standalone path-update recording remains unsupported. Boolean operations use the asynchronous methods documented above.

<!-- example: vector-compound-paths -->
```js
document.resize(160, 128);
const layer = document.layers.add(new VectorLayer({ name: "Editable compound" }));
const path = layer.paths.add(VectorPath.rectangle(
  { x: 8, y: 8, width: 144, height: 112 }, 0,
  { fill: "#ed9966", stroke: null, fillRule: "evenodd" }
));
const hole = path.subpaths.add(new VectorContour({
  points: VectorPath.rectangle({ x: 40, y: 40, width: 80, height: 48 }).points
}));
hole.setPoint(0, { x: 44, in: { x: 44, y: 40 }, out: { x: 44, y: 40 } });
const detached = hole.points;
detached[0].x = 999;
if (hole.points[0].x !== 44) throw new Error("Contour ownership failed");
document.selectedLayer = layer;
print(`Compound ready: ${path.subpaths.length + 1} contours`);
```

#### Gradient fills

`new VectorPath({points, closed, fillGradient, ...})`, all shape factories' `options`, trusted `editor.tools.importSvgPath(d, options)` and attached `path.fillGradient = value` accept a `VectorGradientData` value. The getter returns a complete defensive copy or `null`. Omitting the constructor option stores no gradient field. `path.update({fillGradient})` uses the same shared validation/locks/history as other path edits. Plain gradient descriptors are value parameters on the OO path; modifying a returned descriptor never mutates the document. `VectorGradientData`, `VectorGradientStop` and `VectorFillOptions` are exported TypeScript types.

- Linear: `{kind:"linear", start:{x,y}, end:{x,y}, stops, transform?}`. Endpoints must differ.
- Radial: `{kind:"radial", start:{x,y,radius}, end:{x,y,radius}, stops, transform?}`. Radii are nonnegative, the end radius is positive, and the two circles must differ. The start circle may be focal/off-center or have a nonzero radius. Regions not reached by the expanding radial circles remain transparent.
- Stops: 2–32 `{position, color, opacity?}` values. Positions are finite 0–1 in nondecreasing order; duplicate positions retain hard transitions in their authored order. Colors are six-digit hex; optional opacity defaults to 1 and accepts finite 0–1. Stops need not include 0/1: colors pad before/after the first/last stop.
- Geometry uses path-local coordinates, finite within ±`Number.MAX_SAFE_INTEGER`; radii use 0…`Number.MAX_SAFE_INTEGER`. Optional `transform:{a,b,c,d,e,f}` is a finite invertible affine paint transform, applied before complete layer/parent placement. Gradients remain continuous across native export tiles and source-preserving image resize/crop.

A non-null gradient overrides the retained solid `fill`; setting `fillGradient=null` restores that solid color. Clearing both values removes the fill. Like solid paint, gradients only fill closed native paths. Missing/undefined gradient fields remain absent on legacy records. Colors and alpha interpolate in encoded sRGB without premultiplying stop colors, using native Canvas; alpha is composed normally afterward. Gradients do not embed source images or sample asset pixels. Coincident linear endpoints, identical radial circles, nonpositive end radii, unordered/invalid stops, singular transforms, unknown fields or invalid values reject before mutation. Actual browser precision/allocation limits remain; these metadata bounds are not image-resolution limits.

Document schema **23** stores optional nullable `fillGradient`. Valid v1–v22 roots and retained workspace history migrate without injecting gradients; an older label containing this field rejects, including frozen validation-cache reuse. Project container 3/workspace 2 and source bytes are unchanged. Isolated scripts/plugins share the existing constructor/setter/commit boundary with no new permission or file/network privilege. Separate REST sessions accept the same records via `path.add`/`path.update`; they do not render/synchronize the browser. Existing layer-add recipe templates retain gradients; standalone path-update recording remains unsupported.

SVG exports editable `linearGradient`/`radialGradient` paint servers with local user-space coordinates, full paint transforms, ordered opacity stops, encoded-sRGB interpolation and document-scoped IDs. Editable import supports local gradient templates, numeric/object-bounding-box coordinates, absolute user-space lengths and supported viewport percentages, solid stop colors, definition-tree currentColor and explicit stop-color/opacity inheritance. Object-bounding-box conversion uses actual cubic extrema, excluding stroke. Empty gradients remain unpainted geometry; one-stop gradients become equivalent repeated-color stops. Stop color/opacity are non-inherited by default; geometry templating and the referencing gradient's own interpolation property are separate. Definition-tree template colors match the tested browser; SVG2 shadow-style inheritance may differ in other viewers. SVG offset clamping/nondecreasing order follows rendered source semantics; original XML/template identity is not archived. Repeated/reflected spread, linearRGB interpolation, gradient strokes, degenerate geometry the native model rejects, unsupported CSS/paint-server graphs, absolute-unit object-box lengths and viewport percentages with an offset viewBox require explicit flattening. Gradient CSS colors convert to native 8-bit encoded-sRGB while retaining unpremultiplied RGB even at zero stop alpha. Native relative-color conversion is used when available, with a canonical RGB/sRGB fallback; colors that cannot be represented (including out-of-sRGB stops or unavailable required CSS conversion) require explicit flattening. This is not wide-gamut gradient support. Two-circle and outside-focal radial gradients require appropriate SVG2 viewer support. SVG viewers may differ at curve/mask/transformed edges; use PNG for the native rendered output.

<!-- example: vector-gradient-fills -->
```js
document.resize(160, 128);
const layer = document.layers.add(new VectorLayer({name: "Gradient fill"}));
const path = layer.paths.add(VectorPath.rectangle(
  {x:16, y:16, width:128, height:96}, 0,
  {stroke:null, fillGradient:{
    kind:"linear", start:{x:16,y:64}, end:{x:144,y:64},
    stops:[{position:0,color:"#ff0000"},{position:1,color:"#0000ff"}]
  }}
));
const copy = path.fillGradient;
copy.stops[0].color = "#ffffff";
if (path.fillGradient.stops[0].color !== "#ff0000") throw new Error("Paint ownership failed");
document.selectedLayer = layer;
print("Gradient fill ready");
```

#### Shape factories

Static Factory Methods:

- `VectorPath.rectangle({ x, y, width, height }, cornerRadius = 0, options = {})`: Creates a closed rectangular path with 4 Bézier anchors. Supports corner radius with smooth cubic Béziers ($\kappa \approx 0.55228$).
- `VectorPath.ellipse({ x, y, width, height }, options = {})`: Creates a closed elliptical path with 4 cubic Bézier segments inscribed within the specified bounding rectangle.
- `VectorPath.polygon({ x, y }, radius, sides = 5, options = {})`: Creates a regular $N$-sided polygon path centered at `{x, y}` with given radius (sides $\ge 3$).
- `VectorPath.fromSvgPath(d, options = {})`: Converts one SVG contour into an editable `VectorPath`. Supports absolute/relative M/L/H/V/C/S/Q/T/A/Z, implicit repeated arguments and scientific notation. Quadratic curves convert exactly to cubics; elliptical arcs become cubic approximations. `options` keeps the ordinary shape paint and stroke-style defaults. Disjoint moveto contours reject explicitly; use trusted SVG document import for compound artwork. Malformed/unknown commands, missing numbers, invalid arc flags, nonfinite/unrepresentable coordinates and the 20,000-anchor native budget reject rather than skipping or substituting data. Empty data cannot construct a native path. `parseSvgPath(d)` uses this same strict single-contour grammar and returns an empty anchor array for empty data. Closepath only merges an exactly repeated endpoint, preserving near-but-distinct geometry.
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
| `fontFamily`    | string                          | `"sans-serif"` | Nonempty string up to 240 characters.             |
| `color`         | string                          | `"#ffffff"`    | CSS color string (e.g. hex).                      |
| `align`         | `"left" \| "center" \| "right"` | `"left"`       | Text alignment.                                   |
| `lineHeight`    | number                          | `1.2`          | Line height multiplier between 0.5 and 10.        |
| `letterSpacing` | number                          | `0`            | Letter tracking in pixels between -50 and 500.    |
| `wordSpacing`   | number                          | absent, effective `0` | Extra native separator spacing, finite pixels between -50 and 500. |
| `fontKerning`   | `"auto" \| "normal" \| "none"` | absent, effective `"auto"` | Native font pair kerning: browser choice, enabled, or disabled. |
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
| `wordSpacing`   | `number \| undefined`            | Read/write; extra native word spacing. Undefined restores the effective zero default. |
| `fontKerning`   | `"auto" \| "normal" \| "none" \| undefined` | Read/write; native pair kerning. Undefined restores Auto. |
| `fontWeight`    | string                          | Read/write; font weight descriptor.                                                      |
| `fontStyle`     | `"normal" \| "italic"`          | Read/write; font posture.                                                                |
| `direction`     | `"ltr" \| "rtl"`                | Read/write; text flow direction.                                                         |
| `width`         | number                          | Read-only measured intrinsic text width. Recalculated automatically on property updates. |
| `height`        | number                          | Read-only measured intrinsic text height.                                                |
| `update()`      | method                          | Update multiple text and layer properties in a single command.                           |
| `reflow(): void` | method                         | Explicitly refresh stored bounds with fonts available in this execution environment. |
| `resetSpacing(): void` | method                   | Reset tracking and word spacing to `0`, kerning to `"auto"`, in one validated command. |

Kerning and word spacing retain whole-line browser shaping, including direction, ligatures and script joining; the editor does not split glyphs or words to fake these controls. They are independent of tracking. Measurement, reference rendering, native GPU textures and SVG baseline preparation use the same complete text state, resetting absent defaults on reused contexts. Valid zero/negative advances retain native measurements instead of invoking estimates; stored intrinsic advance width has a minimum of one pixel and is not the glyph ink rectangle. Corner resizing measures the resized font with its current weight/style/tracking/word spacing/kerning/direction; stored spacing stays in document pixels rather than scaling with font size. Point text keeps authored newline-separated lines; optional paragraph wrapping, gaps and first-line indent are described below. Full paragraph styles, pair-specific manual kerning, variable-font axes and font embedding remain unsupported.

Attached changes obey ancestor locks, validate finite values and enum members, recalculate bounds and share UI/REST/script history. Typography patches on other layer kinds reject atomically. Invalid constructors, unsupported native settings or malformed commands leave no partial edit. If the current native Canvas lacks word-spacing or kerning control, requesting a nonzero/non-Auto value rejects measurement/rendering rather than silently substituting segmented text. The inspector disables unavailable controls and retains **Reset spacing**, which can reset both unsupported settings together in one command. Existing projects with unsupported authored values require reset or a supporting browser. This is feature detection, not a cross-browser acceptance claim.

When Canvas/font measurement is unavailable (including the headless REST service), bounds remain explicitly approximate: the existing fallback estimates character advances and adds separator spacing, but cannot reproduce real font kerning or shaping. Isolated-worker/page fonts can differ; use **Reflow text** in the browser for its current metrics. Fonts and their availability are not embedded or synchronized by these properties. New fields require document schema **25**; valid v1–v24 roots/history migrate without inserting spacing fields, while new fields under old labels reject. Project container 3/workspace 2 and source assets are unchanged.

Run this in **Scripts**; the complete example applies as one undo step. Export PNG through the UI to preserve the local glyph appearance, or SVG for editable line text with font references and literal spacing settings.

<!-- example: text-spacing -->
```js
document.resize(480, 160);
const caption = document.layers.add(new TextLayer({
  name: "Spaced headline",
  text: "AVATAR WA\nWide words",
  fontFamily: "serif",
  fontSize: 40,
  lineHeight: 1.3,
  letterSpacing: 1,
  wordSpacing: 12,
  fontKerning: "normal",
  color: "#2050a0",
  x: 16,
  y: 16,
}));
document.selectedLayer = caption;
print("Typography spacing ready");
```

### Paragraph layout

`new TextLayer(options)` also accepts the following optional paragraph settings. Attached setters, `layer.update(...)`, isolated scripts/plugins and REST `layer.update` share validation and undo:

| Option/member | Type and default | Bounds/behavior |
| --- | --- | --- |
| `wrapWidth` | number, null or undefined; effective point text | Finite 1…Number.MAX_SAFE_INTEGER document pixels when enabled. Null/undefined selects point text; the getter returns undefined for either. REST uses null to clear it. |
| `paragraphSpacing` | number or undefined; effective 0 | 0…10000 document pixels between hard paragraphs. |
| `firstLineIndent` | number or undefined; effective 0 | -10000…10000 document pixels at the logical start of each paragraph's first visual line. Negative values create a hanging first line. |
| `resetParagraph()` | no arguments, returns void | Sets wrapWidth to null, spacing/indent to 0 and paragraphJustify to none together in one undo entry, retaining text/font/paint. |

Paragraph mode keeps its exact authored width, including fractions, and calculates height from visual lines. Point mode retains intrinsic width and existing LF line behavior; paragraph spacing/indent also apply to its hard lines. In paragraph mode LF and U+2029 start paragraphs; U+2028 makes a mandatory line break inside a paragraph. Empty/trailing paragraphs and trailing U+2028 retain a blank line. Paragraph spacing applies only between paragraphs. Physical left/center/right alignment and logical LTR/RTL indentation are independent.

Wrapping uses the pinned MIT [linebreak 1.1.0 engine](https://github.com/foliojs/linebreak), whose break classes target Unicode 13, filtered through the execution environment's native Intl.Segmenter grapheme boundaries. This prevents cutting combining/emoji clusters supported by that environment; it is not a claim of current-Unicode conformance, dictionary segmentation for every language, or locale-specific paragraph composition. Nonempty paragraph wrapping rejects without Intl.Segmenter. Whole visual lines stay in native shaping; no individual-glyph drawing or maxWidth condensation is used. Unbreakable runs overflow the frame and remain rendered. Soft-wrap separator spaces at the line end are consumed visually; authored leading spaces and explicit hard-line trailing spaces remain. A soft hyphen is shown as a hyphen only at its chosen soft break. Original text is never rewritten by layout.

The inspector's Text layout selector enables a Paragraph width control and shows spacing/indent pairs. Paragraph corner drags change width while preserving font size, grow height automatically and hold the opposite corner; point-text corners retain font-size scaling. Preview/Escape, locks, editable-field shortcuts and a single final undo entry use the ordinary shared controls. Reset paragraph remains available to recover unsupported wrapping settings.

Canvas measurement uses current local fonts. Headless REST/unsupported native measurement keeps explicitly approximate advances; isolated-worker/page fonts can differ. Authored width remains exact but line count/height can change between font environments. Use Reflow text after local fonts are ready. These settings do not embed or enumerate fonts. Layout/native pixel caches invalidate normally, and export checks font lifetime. SVG retains editable positioned visual lines with literal typography, but paragraph reflow/source separators are not portable SVG layout. Canvas/SVG whitespace-boundary glyph spacing and affine antialiasing can differ even with local fonts; export reports this limitation. Choose PNG for the editor's rendered glyph appearance and native projects for complete text/style editability.

New fields require document schema **26**, even when null/zero. Valid v1–v25 roots and retained history upgrade without injecting paragraph fields; fields mislabeled under older roots reject. Paragraph bounds must agree with their authored wrapWidth. Invalid widths/spacing/indent, non-text targets or locked owners reject atomically. Project container 3/workspace 2 and original image bytes remain unchanged.

#### Inter-word justification

`TextLayerOptions.paragraphJustify` and the attached `TextLayer.paragraphJustify` getter/setter accept `"none" | "inter-word" | undefined`; absent/none keeps existing spacing. In Paragraph text mode, inter-word expands native word spacing on soft-wrapped lines to their available width after logical first-line indentation. It keeps physical alignment and whole-line native shaping, including RTL/script joining. Final paragraph lines, forced breaks, unbreakable overflow and lines without native expandable separators retain their authored spacing. Point text has no soft lines and is visually unchanged.

The engine measures each complete line's response to native word spacing, verifies its derived advance, and applies that derived spacing only for drawing/ink/SVG. Authored wordSpacing/tracking/text stay unchanged. Native expandable Unicode space separators participate; fixed-width Unicode spaces without a native spacing response remain fixed. Lines with only one word and boundary spaces stay unexpanded. On multiword lines, explicit leading spaces and NBSP participate in the native response; this is inter-word justification, not inter-character CJK distribution, kashida insertion or dictionary composition. Canvas metrics impose finite precision (base fit tolerance max(1/64 px, available width × 2^-20), with cumulative spacing tolerance of 1/64 px per measured native word-spacing response unit). The engine prefers a fitting native advance; very wide lines can retain a small rounding remainder while their authored frame width stays exact. Derived spacing may exceed the authored wordSpacing input range; it is private layout data, never an alternative public mutation API.

Native word-spacing response also depends on the current font/shaping state. In the tested Chromium, combining-mark text with Kerning Auto or None can ignore native word spacing even in fresh Canvas/OffscreenCanvas contexts; changing font state or rendering hints does not repair the None case. Native measured constructors/setters reject such justification atomically with guidance to choose Kerning Normal or Reset paragraph; it never silently changes authored kerning or substitutes disconnected glyphs. Normal kerning preserves whole-line shaping and supplies native spacing in that fixture. Imported snapshots preserve their declared typography without silently reflowing it; an unsupported host can require Normal/reset before rendering. Supporting that browser/font-state combination remains an open F08 requirement. Reset spacing retains paragraph formatting; if its Auto-kerning reset would make active justification unsupported, it rejects atomically. Clear paragraph justification with Reset paragraph first in that case. Native Canvas word-spacing support is required for nondefault justification; unsupported rendering rejects explicitly. The inspector disables Justification there and Reset paragraph clears it. `resetParagraph()` now sets paragraphJustify to `"none"` along with width null and zero paragraph spacing/indent, in one shared undo entry. Invalid enum/type, non-text targets and locked owners reject atomically. Explicit paragraphJustify (including none) requires schema **27**. Earlier valid roots/history migrate without injecting it. Project/workspace versions and plugin permissions remain unchanged. SVG exports editable visual lines with their individual derived word-spacing. Native/SVG fractional origins, tracking, boundary spaces and NBSP can change glyph placement even with the same local font; export reports these appearance limits. Preserve the native project for complete text/layout settings and PNG for rendered appearance.

<!-- example: justified-paragraph -->
```js
document.resize(640, 360);
const paragraph = document.layers.add(new TextLayer({
  name: "Justified paragraph",
  text: "Whole shaped lines expand their word spacing to this width. Final lines keep their spacing.",
  fontFamily: "monospace", fontSize: 24, wrapWidth: 280, fontKerning: "normal",
  paragraphJustify: "inter-word", firstLineIndent: 12,
  color: "#2050a0", x: 24, y: 24,
}));
document.selectedLayer = paragraph;
print("Justification ready", paragraph.paragraphJustify);
```

<!-- example: paragraph-text -->
```js
document.resize(640, 360);
const caption = document.layers.add(new TextLayer({
  name: "Paragraph caption",
  text: "Editable paragraphs wrap to this width.\nThis is a second paragraph.",
  fontFamily: "monospace",
  fontSize: 24,
  lineHeight: 1.4,
  wrapWidth: 280,
  paragraphSpacing: 18,
  firstLineIndent: 20,
  color: "#2050a0",
  x: 24,
  y: 24,
}));
document.selectedLayer = caption;
print("Paragraph ready", caption.wrapWidth, caption.paragraphSpacing, caption.firstLineIndent);
```

## AdjustmentLayer

Signature: `new AdjustmentLayer(options = {})`.
Inherits common layer options (`name`, `opacity`, `fillOpacity`, `visible`, `locked`, `blendMode`, `x`, `y`).
Adjustment layers modify the preceding backdrop layers non-destructively in encoded 8-bit sRGB space. They strictly preserve the backdrop's alpha channel (transparent areas remain transparent; semi-transparent areas retain their alpha).

| Option       | Type             | Default                                      | Validation                                       |
| ------------ | ---------------- | -------------------------------------------- | ------------------------------------------------ |
| `name`       | string           | `"Adjustment"`                               | Nonempty, at most 240 characters.                |
| `adjustment` | `AdjustmentData` or `PatchAdjustment` or `RedEyeAdjustment` | Default curves (`[{x:0,y:0},{x:255,y:255}]`) | Valid adjustment DTO or one of these constructor values. |

Current adjustment kinds are `"curves"`, `"levels"`, `"tone"`, `"hsl"`, `"color-balance"`, `"vibrance"`, `"gradient-map"`, `"white-balance"`, `"lut"`, `"tonal"`, `"patch"` and `"red-eye"`. The family sections specify their DTOs. Gradient maps use the same `adjustment` getter/setter; there is no `setGradientMap()` convenience method.

Members:

| Member           | Type                             | Behavior                                                                                                                                                                                                       |
| ---------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adjustment`     | `AdjustmentData`                 | Read/write; gets a structured clone of the adjustment DTO or sets a new valid adjustment.                                                                                                                      |
| `adjustmentKind` | `AdjustmentData["kind"]` | Read-only; current adjustment type.                                                                                                                                                                            |
| `setCurves()`    | method                           | Set monotone cubic spline control points for RGB master or per-channel (`red`, `green`, `blue`). Spline uses Fritsch-Carlson interpolation; X values must strictly increase in `[0, 255]`.                     |
| `setLevels()`    | method                           | Set input black/white, midtone gamma, and output black/white for RGB master or per-channel (`red`, `green`, `blue`). Requires finite input black in [0,254], input white in [1,255] with `inputWhite > inputBlack`, gamma in [0.05,10], and output endpoints in [0,255] (reversed output is allowed). |
| `setTone()`      | method                           | Set exposure (`[-3, 3]`), contrast (`[-100, 100]`), and saturation (`[-100, 100]`).                                                                                                                            |
| `setRedEye(value)` | method | Require an immutable `RedEyeAdjustment` and replace the effect through one normal command. Invalid values or locked ancestry reject without edits. See [Red-eye correction](#redeyeadjustment-schema-35). |
| `setLut(source, options?)` | method | Parse Cube text and replace the effect. Options: amount 0–100 (default 100), interpolation tetrahedral (default) or trilinear. See [Color Lookup](#color-lookup-lut-adjustment-layers) for formats, domains, errors and limits. |

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

`new MarqueeSelection({ shape, x, y, width, height, operation = "add" })` creates one rectangle, ellipse, or pixel-coverage region (see schema 16 below). Dimensions must be positive. Alternatively pass `{ regions: [...] }`, with an explicit operation on each region; the default constructor creates an empty selection. At most 128 regions are accepted. Coordinates are in document space for `document.selection`, or layer space when used as a paint clip.

- `transformed(matrix)` returns a new selection, composing an `AffineTransform` with each region’s existing transform. Singular or nonfinite results throw. Each region retains its own coordinate basis when combined with other selections.
- `regions` is a deep copy; `toJSON()` returns the full selection DTO.
- `combine(singleRegionSelection, operation = "add")` returns a new selection with one appended add/subtract/intersect region; the argument must contain exactly one region.
- `translated(x, y)` returns a new selection offset by the supplied deltas.
- Operations are evaluated in order, starting with an empty mask. A subtract/intersect region alone therefore selects nothing.
- `document.selection` gets an immutable selection snapshot or `null`. Assign a `MarqueeSelection` or `null`; changes create history and persist in project files.
- `document.selectAll()` selects the full document rectangle; `document.deselect()` assigns `null`. Null means unrestricted painting; `{ regions: [] }` selects no pixels.

`document.selectPolygon(points: { x: number; y: number }[], operation: "replace" | "add" | "subtract" | "intersect" = "replace"): void` closes a document-space polygon and commits its pixel coverage through the shared command/history boundary. It accepts 3–20,000 vertices with finite coordinates within JavaScript's safe-integer range; fractional coordinates are supported. Even-odd filling handles concave/self-intersecting contours. Coverage uses 4×4 subpixel samples and is clipped to the canvas at its original resolution. Boolean modes append to the existing selection; a subtract/intersect polygon without a prior selection therefore selects nothing. The combined selection may contain at most 128 regions. Invalid inputs or a polygon covering no canvas pixels throw without changing the document/history. Layer locks do not prevent a document-level selection. The resulting selection works with paint clips, masks and project persistence; this method does not create a live vector path.

```js
// example: polygon-selection
document.selectPolygon([
  { x: 10, y: 10 },
  { x: 80, y: 10 },
  { x: 10, y: 80 },
]);
print("Polygon selection regions:", document.selection.regions.length);
```

Successful script/plugin runs retain the existing atomic host undo boundary. Plugins need granted `document:write`; no new permission is introduced. Polygon preparation is synchronous scan conversion by horizontal spans, so very large or complex contours can still take time. There is no document-megapixel cutoff or full-size bitmap allocation for solid interiors.

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
  text: "Canoli Studio Editor",
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

## Workspace layout preferences

The **Workspace layout** rail action and command search configure Layers/history and Properties on either side of the canvas, their order, visibility and responsive/preferred widths. Named layouts can be saved, updated, renamed and deleted locally. Save/update also applies; Apply layout commits the detached draft, while Cancel leaves the arrangement unchanged. Restore default arrangement in the dialog is a draft; the command-search action restores directly. Both actions are unassigned by default and can be rebound through Keyboard shortcuts. The tool rail remains available with both panels hidden.

These are browser UI preferences, not document edits or a new DOM constructor/member. They add no isolated Scripts/plugin API, REST route or native project/workspace schema. Original assets, layer selection, history and scene pixels remain under the existing contracts. The strict local envelope uses `luma.workspace-layout.v1`; missing envelopes import existing `luma.panel-widths.v1` values without modifying the old key. Explicit new responsive defaults override legacy widths. Invalid storage, failed writes and detected newer-tab changes are disclosed; reload/recovery is explicit. Layouts are local to this browser, are not embedded in downloaded projects, and are not atomic cross-tab synchronization or floating/tabbed docks.

## Recent files (trusted browser host)

The top-bar **Recent files** control and command search open saved local copies of successfully opened/imported files and explicit project-download requests. These are exact original bytes stored on this browser, not live links to disk. Open the original again for external disk changes. The list retains twenty saved entries and the newest twenty pending preparations; identical bytes share storage. Equal names with different bytes remain separate copies. Removing/clearing the list leaves open documents and original disk files alone. Browser storage can be unavailable/full/cleared, so retain downloaded projects as backups; this does not replace recovery or named workspace content versions.

`await editor.openImage(file: File, control?: {signal?: AbortSignal}): Promise<RasterLayer>` is trusted host code only. It opens one original-resolution raster as a new constructor-validated document, with selected raster, empty undo history and revision zero. Existing edited documents remain open. The filename without its extension supplies the document name (up to the existing 240-character model limit); raw file metadata and original bytes stay with the asset. `control` defaults to absent; cancellation, unsupported/invalid input, native decode/allocation failure or a changed/disposed target rejects without publishing private pixels. A native image decode already executing remains cooperative; its result is released if stale. No arbitrary megapixel/file-size import cap or source downsampling is introduced. `importImage(file)` retains its existing placement-in-current-composition behavior.

Trusted `editor.recentFiles` is a browser service, unavailable to isolated Scripts/plugins and headless REST:

| Method/member | Behavior |
| --- | --- |
| `getSnapshot()` / `subscribe(listener)` | Observable `{entries,pending,loading,error,available}`. Entries include opaque ID, name, kind, byte size, saved time and original lastModified; invalid entries are disclosed with an error and cannot open. |
| `remember(file, kind): void` | Queue an optional exact local copy. Kind is `project`, `image`, `svg`, `tiff` or `photoshop`. Invalid/copy/storage failure appears in status; it does not throw from already accepted document I/O. Pending older preparations may be superseded by the twenty-entry retention policy. |
| `flush(): Promise<void>` | Wait for currently queued background work. Inspect snapshot.error and the entries to confirm durability; resolution alone does not certify a successful optional copy. |
| `refresh(): Promise<void>` | Reload saved summaries; storage failure rejects and retains the previous displayed list with an error. |
| `read(id, signal?): Promise<{file:File,kind}>` | Validate entry/extent and independently rehash stored bytes in a private worker. Reject missing/corrupt/stale data, cancellation or closure before returning an independent immutable File. Preserve name, MIME and lastModified. |
| `remove(id)` / `clear()` | Atomically remove local recent data and unreferenced payloads; cancel owned reads/preparations and advance a durable generation, invalidating older cross-tab preparations before commit. Already delivered files remain valid. Storage failure rejects without a partial delete. |

Successful File-backed openProject/openImage/importImage/openSvg/openTiff/openPsd calls notify the service after commit. Byte-array/unnamed Photoshop inputs do not manufacture a filename. saveProject() itself returns a Blob and does not claim a completed OS write or choose a filename; the normal download UI records the exact named Blob it requested. A host with its own save UI can explicitly remember its named output:

```ts
const blob = await editor.saveProject();
editor.recentFiles.remember(new File([blob], "Artwork.luma", {
  type: blob.type,
}), "project");
await editor.recentFiles.flush();
const status = editor.recentFiles.getSnapshot();
// status.error and status.entries report whether the optional copy was saved.
```

Capture and verification clone only an immutable Blob handle into a private worker, then read slices of at most 1 MiB. They do not allocate a source-sized host ArrayBuffer or transfer original data buffers. Source decoding, Blob/IndexedDB/native storage and actual process memory retain browser/device limits. There is no authenticity/signature or operating-system file-location claim. A separate version-2 `luma-recent-files` IndexedDB database stores schema-1 entries, shared payloads and a durable removal generation; upgrading an initial version-1 store adds the generation store without rewriting entries. Invalid metadata remains visible beside healthy files and blocks new capture until removed/recovered; unknown references are preserved conservatively. Remove/clear use one transaction for metadata, payload references and generation. Cross-tab messages contain only change notifications; the generation check remains authoritative without them.

Denied access to the storage capability itself makes optional recent files unavailable without preventing editor startup. Notification-channel construction/sending failures remain advisory: local copies still persist, and a committed copy is not reported as a storage failure. Durable generation checks remain authoritative; without notifications, another tab may need **Reload recent files** to refresh its displayed list.

Recent-file opening in the UI reuses existing project/format validation and conversion preflight. Raster copies use openImage; SVG/TIFF/Photoshop show their current conversion choices and consent again. File checking can be cancelled before handoff; once handed to an opener its normal lifecycle applies. The palette also lists current open document sessions, using session identities so equal document names/IDs do not collide. Async updates preserve selected result identity; a removed selection requires explicit navigation before Enter. The static Recent files action is unassigned by default and rebindable. No new document/project/workspace schema, editable-field interception or isolated file/storage/network permission is introduced.

## Application integration

This section is for trusted application code and development-console inspection, not code pasted into Scripts. The constructors are exported from [src/dom/index.ts](../src/dom/index.ts). During development only, `window.luma` exposes those constructors plus the application instance as `window.luma.editor`. No global `luma` API is exposed in production.

| Application method        | Return / behavior                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor.runScript(code)`  | `Promise<string[]>`; runs the isolated scripting workflow and resolves to output lines after validated host application. Rejects on script/host failure. |
| `editor.scripts.cancel()` | Cancel a pending run; its promise rejects and no script edits apply.                                                                                     |
| `editor.document`         | Current live host `Document`. Direct trusted mutations use shared validation and history.                                                                |
| `editor.export(options, control?)` | `Promise<ExportResult>` for trusted host code. `control` accepts an `AbortSignal` and non-throwing `onProgress({ phase, fraction })` callback. |
| `editor.exportPng(control?)` | `Promise<Blob>`; PNG convenience method with the same optional execution controls. |


`ExportOptions.format` accepts `"png" | "jpeg" | "webp" | "avif" | "svg" | "psd" | "psb" | "tiff" | "pdf"`. Other options are `quality?: number` (JPEG default 0.92, WebP default 0.9, AVIF default 0.8), `avifLossless?: boolean` (default false), `avifSpeed?: number` (integer 0–10, default 8), `backgroundColor?: string` (JPEG, default white), `psdMode?: "layers" | "flatten"` (PSD/PSB, default layers), `tiffVariant?: "auto" | "classic" | "big"` (default auto) and `pdfDpi?: number` (PDF physical sizing, default 72). Results contain `blob`, `mimeType`, `extension` and `report`; review the report's preserved/degraded features and warnings before delivery.

Export controls default to absent. `phase` is `"rendering"` or `"encoding"`; `fraction` is a value from 0 to 1 for known rendering progress, or `null` for indeterminate work. An aborted signal rejects with its reason (normally `AbortError`). PNG/JPEG/WebP/PSD/TIFF check cancellation between rendered tiles/strips and before returning encoded output. Host SVG serialization yields between bounded path fragments and reports indeterminate encoding progress. Browser encoding, synchronous constructor `toSvg` calls and an individual PSD strip cannot be preempted mid-call; the final host check suppresses a result after cancellation is received. These controls are host-only, are not serialized into REST options, and are unavailable inside isolated Scripts. They do not edit the document or create history entries. A throwing progress callback rejects export without returning partial output.

Host `editor.export({format: "svg"}, control?)` also exports visible raster layers outside native backdrop prefixes alongside editable vector paths. Rasters without enabled nonzero tone effects or erasures embed source-resolution PNG pixels; repeated instances share one definition with independent authored size/full affine placement. PNG re-encoding excludes original source-file metadata, including EXIF orientation tags (decoded orientation is already applied). It preserves original source Blob bytes in the project. Embedded images retain all decoded pixels, including those hidden by masks/canvas clipping; SVG is not a redaction format. Choose flattened PNG when hidden content must not be delivered.

Enabled nonzero raster tone effects or any erasure operations instead bake raw raster content at document resolution over the expanded shadow support region. This preserves native sample/effect/erase ordering and clips off-support pixels. Masks, layer/group opacity, blend modes and overlay/shadow filters remain in the SVG hierarchy, with surrounding paths still editable. Reports distinguish source-resolution images from these rendered images and identify lost tone/erasure editability. Save a project to retain original sources and editable operations. Adjustments and Blend If retain native appearance through reported backdrop-prefix rendering, described below. Host SVG also retains editable text and supported smart-object contents as described below.

Images use the native streamed PNG exporter, retaining compressed/base64 output without a document-sized host canvas/RGBA plane. Real source decoding, viewer working memory and PNG format geometry still limit output; there is no arbitrary import cap. Raster and bitmap-mask sources are captured together before the first progress callback, and checked across preparation and final encoding. Missing sources reject (`Missing image asset`); replacement/in-place bitmap changes or repository disposal reject with a retry/disposal error. Cancellation rejects with the signal reason and releases current render surfaces. Known `rendering` fractions combine image/native-mask preparation, followed by indeterminate `encoding`. Individual native rendering/encoding calls remain cooperative, not preemptible. These are trusted host services: `VectorLayer.toSvg` stays synchronous, and isolated scripts/plugins gain no image bytes, export/download API or new permissions.

Directly accessing `editor.document` bypasses script isolation: ordinary setters create individual host history entries unless wrapped in a synchronous transaction. `editor.runScript` already handles snapshotting, validation, revision checking and a single host history entry; prefer it when executing user-authored script text. Never evaluate user scripts in the page context.

### Local SVG import

These are **trusted application services**, unavailable inside isolated Scripts/plugins or headless REST sessions:

| Method | Current behavior |
| --- | --- |
| `editor.inspectSvg(file, control = {})` | `Promise<SvgImportReport>`; inert XML inspection in a dedicated terminable worker. No document mutation or image-decoding guarantee. |
| `editor.openSvg(file, options = {}, control = {})` | `Promise<SvgImportReport>`; prepares and opens a complete new native document. `options.mode` defaults to `"editable"`; the other value is `"flatten"`. Unknown options/modes reject. |

The file picker and canvas drop show **Import SVG** preflight. **Import editable**, **Import flattened**, and **Cancel** are explicit choices; unsupported editable features disable that choice. A host call with the default mode rejects unsupported artwork; it never silently falls back. Reports include version 1, resolved integer `width`/`height`, `canImportEditable`, `featuresPreserved`, `featuresDegraded`, `unsupportedFeatures`, `additionalIssues`, XML `elements`, native `layers` and unique embedded `images`. At most 256 unsupported findings are displayed; additional findings are counted. Inspection does not decode or certify every embedded image. Errors during decoding still reject the complete import.

Supported editable artwork includes path commands listed above, rectangles/rounded rectangles, circles/ellipses, lines/polylines/polygons, nested groups, literal solid CSS colors resolved to 8-bit sRGB, inherited paint/currentColor/visibility, per-paint and group opacity, full affine transforms, root viewBox alignment and independent local `use` references. Compound/even-odd/open fills become editable vector masks over a solid cover path; their original Bézier contours stay editable in the mask. Open stroke contours remain open. Native stroke caps/joins, miter limits, inherited dash arrays and signed offsets remain editable. SVG defaults are butt caps, miter joins and limit 4, independently of legacy native round defaults. Absolute numeric/CSS-unit dash lengths are converted to local user units; percentage lengths, pathLength calibration, non-scaling strokes, markers and SVG2 arcs/miter-clip joins require explicit flattened import, as do gradients/paint servers, text, CSS selectors/geometry/transforms, clipping/filter/mask graphs, nested viewports and other unrepresented features. SVG `use` master/DOM identity is not retained.

Embedded static PNG/JPEG/WebP data URLs retain their original compressed bytes, native decoded dimensions and editable placement. Image `preserveAspectRatio` supports meet/slice/none; slice adds an editable vector crop mask. Missing image dimensions use intrinsic aspect/dimensions. Root dimensions support pixels and absolute 96-dpi CSS units. Missing/relative root dimensions resolve from the viewBox, or 300×150 when absent; fractional viewport pixels round up. These conversions are reported. Native Canvas and SVG curve/clip/image sampling differ, so editable import is not pixel-exact. Arc approximations have no universal error guarantee. Original SVG XML, IDs, CSS rules, and editor metadata are not archived or round-tripped. Save a native project for subsequent edits.

Flattened import decodes a normalized self-contained SVG as a browser image, then streams native PNG tiles/strips into one raster layer. It retains the inspected viewport and rendered pixels, discarding source vector/text/effect editing, original XML and off-canvas content. It does not insert markup into the live page. Scripts, event handlers, foreign HTML, SMIL/CSS animations, detected animated embedded PNG/WebP, DOCTYPE/entities, processing instructions and external resources are rejected before either mode; no external image, font or stylesheet fetching is added. [SVG image processing modes](https://www.w3.org/TR/SVG2/conform.html) supply a second browser boundary; image mode alone can allow animation, so static admission is separate. XML parsing uses pinned [xmldom](https://github.com/xmldom/xmldom) in the worker; endpoint-to-center arc conversion follows [SVG implementation notes](https://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes).

`control.signal` supports cancellation; `onProgress({phase,fraction})` uses `reading`, `inspecting`, `decoding` or `rendering`, with a fraction in [0,1] or `null`. Callback errors reject. The XML worker terminates on completion/error/cancellation. Native image decode and individual render calls cannot be preempted mid-call; final checks suppress cancelled/stale publication and release provisional bitmaps, asset stores, workers and tile surfaces. Starting a later open, changing/closing the starting document, switching tabs, disposing the target asset store or modifying its revision rejects the pending import. Existing edited tabs remain open. Preparation creates no active-document history entry; the imported document starts at revision zero and subsequent edits use normal commands/undo. There is no arbitrary source-byte/megapixel cutoff. Existing native layer/depth/path/mask budgets can reject editable reconstruction; browser decode, numeric precision and memory still impose real limits in either mode.

The strict path helper is also available in isolated Scripts without file privileges:

<!-- example: svg-import-path -->
```js
const curve = VectorPath.fromSvgPath("M0 0q10 20 20 0t20 0");
print(curve.points.length); // 3
try {
  VectorPath.fromSvgPath("M0 0M10 10");
} catch (error) {
  print(error.message); // one SVG contour is required
}
document.name = "Edited import";
```

### Native backdrop composition in SVG export

Trusted host `editor.export({format: "svg"}, control?)` retains adjustment layers and enabled Blend If through the native compositor. Within each visible isolated sibling stack, it renders from the first sibling through the last visible, nonzero-opacity adjustment or enabled Blend If layer into a document-resolution PNG. This preserves the real backdrop, adjustment ordering, all eleven current adjustment kinds, masks, styles, blend modes, opacity and alpha rules. A hidden or zero-opacity dependency does not trigger rendering. Separate groups retain their own isolated backdrops. Later artwork and outer parent masks/styles/opacity remain separate in SVG; an affected parent Blend If instead requires its own preceding siblings to be included.

The export report lists affected stack endings by group/layer name and explains the loss of editable internal artwork, text, paint, adjustment/Blend If settings, masks/styles/blending and off-support pixels. This is native rendered appearance, not editable SVG adjustment filters or a general SVG round-trip. Save a project for the complete model. Source files and command history remain unchanged. PNG re-encoding excludes original file metadata; unmodified raster/clone images outside these prefixes can still contain hidden pixels, and SVG is not a redaction format.

Native prefix images cover the original conservative shadow-chain support at native document resolution. Their pixels are placed in the document plane under the retained affine parent hierarchy; unlinked masks/filter masks rebase with the output origin, while masks inside retained smart-master definitions keep their master plane. Bounded native tiles/strips avoid a document-sized host canvas/RGBA plane. Compressed/base64 output, resident source decoding and viewer/filter allocations still consume memory and obey actual format/device limits; no arbitrary import-resolution cap is added.

Reachable raster/clone/patch/bitmap-mask sources are captured before the first progress callback, including dependencies inside a rendered prefix. Referenced fonts are pinned at the start of font preparation, before native measurement/rendering, and checked through final encoding. Existing rendering progress/Cancel and source/font lifetime guards span preparation and final encoding. Missing/replaced/disposed sources, pending/changed fonts, numeric/native-render failures and cancellation reject without partial output or source/history changes. Later host edits cannot rewrite the captured export. Signatures/options, schemas, separate REST sessions and isolated script/plugin grants remain unchanged.

`VectorLayer.toSvg(width = 1920, height = 1080)` remains synchronous in the layer's immediate parent plane. Enabled Blend If now rejects with a native-backdrop-preparation error directing callers to host export, rather than silently ignoring its semantics. Hidden/zero-opacity layers still yield an empty canvas. Raw private SVG helpers likewise reject unprepared visible adjustments/Blend If. Isolated scripts may create validated layers, but cannot obtain this native preparation or download files themselves.

Run this in **Scripts** as one undo step, then choose **Export… → SVG**. The tone adjustment and conditional overlay become one native prefix; the later green path stays editable.

<!-- example: svg-native-backdrop -->
```js
document.resize(160, 112);
const base = document.layers.add(new PaintLayer({ name: "Base" }));
base.strokes.add(new PaintFill({
  bounds: { x: 8, y: 8, width: 88, height: 56 },
  color: "#804020",
}));
document.layers.add(new AdjustmentLayer({
  name: "Exposure",
  adjustment: { kind: "tone", exposure: 1, contrast: 0, saturation: 0 },
}));
const conditional = document.layers.add(new VectorLayer({
  name: "Conditional overlay",
}));
conditional.paths.add(VectorPath.rectangle(
  { x: 16, y: 16, width: 64, height: 32 }, 0,
  { fill: "#20a0e0", stroke: null },
));
conditional.styles = new LayerStyle({
  blendIf: { enabled: true, underlying: [0, 0, 100, 120] },
});
const after = document.layers.add(new VectorLayer({ name: "Editable after" }));
after.paths.add(VectorPath.rectangle(
  { x: 112, y: 16, width: 16, height: 16 }, 0,
  { fill: "#00ff00", stroke: null },
));
print("Native SVG backdrop ready");
```

### Editable text in SVG export

Host `editor.export({format: "svg"}, control?)` retains visible nonempty text layers outside native backdrop prefixes as editable SVG `text` elements, one per visual line from the shared point/paragraph layout. It preserves family references, font size/weight/style, color/alpha, supported native letter/word spacing and kerning, physical left/center/right alignment, LTR/RTL direction, full affine hierarchy and separate masks/styles/opacity/blending. Native `fillText` normalizes tab, carriage return and form feed to individual spaces; exported line text does the same. Empty lines retain their explicit baseline positions. Complete line content remains available in XML, including masked/off-canvas text; use flattened PNG when that content must not be delivered. Paragraph lines retain their measured positions, but SVG does not retain native paragraph reflow settings or consumed soft-break source spacing. Font embedding, glyph outlining and script download methods remain unsupported.

The browser measures each line's top-to-alphabetic baseline offset using the same font settings as native rendering. For nonzero word spacing, two reusable hidden SVG text nodes compare native and SVG full-line responses against zero spacing. When advances differ, the host tries whitespace-only `tspan word-spacing="0"` runs for ASCII spaces, NBSP and boundary spaces. It accepts a correction only when both full-line advance and outer non-whitespace character-position responses agree with native ink responses within `max(1/32 px, abs(native spacing response)/64)`. This rejects advance-only matches that move serif/RTL glyphs incorrectly. The original root word-spacing, line text and one shaped text chunk per visual line remain intact; spans have no independent x/y/dx/dy positions. Whole graphemes are mandatory after native ASCII normalization. Without native segmentation, or when a proposed span would split a space-plus-mark/ZWJ cluster, this optional styling is declined. Boundary-trimmed ink/character comparisons remain the fallback for signed advances and other unsupported corrections, but must also respect complete boundary graphemes. These local measurements improve the verified NBSP/boundary cases; they do not prove universal Canvas/SVG glyph parity. Combining-mark, some font/kerning/tracking and fractional affine cases still differ, as the export report warns. Preparation releases its hidden host and 1×1 measurement canvas on success/failure/cancel, caches repeated lines by derived spacing, yields between batches/candidates and within long-line character-position reads using the shared 8 ms scheduling target. Every 16 character-position pairs check cancellation; deadline yields recheck captured fonts and sources. This retains every measured edge rather than sampling long lines. One native measurement/layout read cannot be preempted. A registered font needed by the text must already be loaded. Missing family names can resolve to browser fallback and are not proof of font availability. Font files are never copied: another viewer, including an SVG image decoder without the page's web fonts, can substitute fonts and shape/hint text differently. The export report states this; use PNG for rendered text appearance and a project for the complete original text model. Affine glyph edges can differ from Canvas even with the same system font.

Preparation captures registered faces in referenced font families, including family lists, and rechecks face identity, status and descriptors through image/mask work and final encoding. A relevant change rejects with a retry-after-fonts-ready error; unrelated font families do not invalidate output. Pending fonts, invalid browser font/color assignments, unavailable baseline metrics, nonfinite prepared positions and XML 1.0-invalid text fail explicitly without editing the document or returning partial output. Later host document edits retain their own history and cannot rewrite the captured export snapshot. Source-resolution raster/mask preparation and existing script/plugin isolation remain unchanged.

The following runs in **Scripts** as one ordinary document transaction. Then choose **Export… → SVG** in the editor; exporting is still a separate UI/host operation.

<!-- example: svg-live-text -->
```js
document.resize(240, 120);
document.layers.add(new TextLayer({
  text: "Canoli\nStudio",
  fontFamily: "monospace",
  fontSize: 24,
  lineHeight: 1.4,
  letterSpacing: 1,
  color: "#2050a0",
  x: 16,
  y: 18,
}));
print("Editable SVG text ready");
```

The following whitespace example preserves its leading spaces and NBSP in both the native project and SVG text. The exporter may add whitespace-only inline spacing to match the current native renderer; it never rewrites the authored text or typography. Other fonts/viewers remain subject to the limits above.

<!-- example: svg-whitespace -->
```js
document.resize(400, 160);
document.layers.add(new TextLayer({
  name: "Whitespace caption",
  text: "  alpha\u00a0beta gamma",
  fontFamily: "monospace",
  fontSize: 24,
  wordSpacing: 8,
  fontKerning: "normal",
  color: "#2050a0",
  x: 24,
  y: 24,
}));
print("Whitespace SVG ready");
```

### Smart-object contents in SVG export

Host `editor.export({format: "svg"}, control?)` expands visible unfiltered smart-object instances through the shared component resolver. Supported vector, raster, text and paint master contents outside native backdrop prefixes retain their existing SVG editability, full instance/master scale and affine placement, nested/scoped masks and styles. Generated master-canvas boundaries remain editable rectangular vector masks. Instance opacity, fill opacity, blend modes, outer masks and styles remain separate. Disabled filter entries do not force rasterization. Full-frame raster masters retain their erasures; conversion no longer drops those operations.

An instance with any enabled smart filter instead renders its native filtered content and filter mask into a document-resolution PNG over expanded shadow support. This preserves native master-plane filtering before resampling; the SVG still applies the instance's outer mask/styles/opacity separately. Filtered master contents, filters, filter-mask geometry and off-support pixels lose editability and are reported as baked. Inside that rendered instance, native paint, text, adjustments and nested smart objects contribute pixels. Adjustments and Blend If in expanded masters use the native sibling-prefix composition described below; paint outside those prefixes retains editable dab/fill geometry. Font references for editable text and raster-image pixel/metadata disclosures still apply.

SVG instances are independently expanded; shared component/master identity is not retained in the file. Save a project to preserve shared editing, filters, original sources and full off-canvas data. Linked local-image masters use the existing embedded snapshot; SVG export neither follows local paths nor refreshes external files. Complete unmodified raster pixels and editable line text can include masked/off-canvas content; SVG is not redaction.

The same logical component render budget (4,096 nodes / 64 expansion levels) applies, including descendants of filtered instances. Missing/cyclic definitions, budget overflow, missing/replaced native image/filter-mask dependencies, pending/changed referenced fonts, unavailable native rendering and cancellation fail explicitly without partial output or changes to document/history/source bytes. Filtered text fonts are checked even though their glyphs become pixels. Unused masters' image/font data is not prepared, although registry validation still checks the complete graph. PNG preparation uses bounded tiles/strips; resident sources, compressed/base64 output and viewer/filter allocations still consume memory. No arbitrary image-resolution cap, general SVG import or new REST/script/plugin export/font/file privilege is added.

This example runs in **Scripts** as one undo step; use **Export… → SVG** afterward. The first instance retains its vector shape and canvas clip; the second includes an enabled native filter and is rendered to pixels, with the losses shown in the dialog.

<!-- example: svg-smart-objects -->
```js
document.resize(240, 140);
const master = new Document({ width: 64, height: 48 });
const shape = master.layers.add(new VectorLayer());
shape.paths.add(VectorPath.rectangle(
  { x: -8, y: -4, width: 40, height: 28 }, 0,
  { fill: "#804020", stroke: null },
));
const key = document.defineComponent(master);
document.placeSmartObject(key, { x: 16, y: 16 });
const filtered = document.placeSmartObject(key, { x: 120, y: 16 });
filtered.setFilters([new SmartToneFilter({ exposure: 1 })]);
print("Smart SVG ready");
```

### Paint in SVG export

Trusted host `editor.export({format: "svg"}, control?)` exports visible nonempty paint layers outside native backdrop prefixes as editable vector dabs and fill rectangles, including paint inside unfiltered smart masters. Brush softness uses radial gradients; pencil stamps remain pixel-aligned rectangles. Native segment spacing, interpolated pressure, per-dab flow/pressure alpha and whole-stroke opacity are retained. Eraser strokes and `PaintFill({erase: true})` mask only earlier paint; later strokes remain visible. Layer/group placement, affine transforms, masks, overlay/shadow filters, fill/layer opacity and CSS blend modes remain separate.

Existing constructors/defaults are unchanged: `BrushStroke` defaults to size 24, hardness 0.7, opacity/flow 1, spacing 0.25, pressure sizing enabled and pressure opacity disabled; points without pressure use 1. `PencilStroke` defaults to size 1 and hardness 1. Pressure sizing uses at least 0.05 of nominal size. Flow below 1 and enabled pressure opacity each use a minimum factor of 0.01, matching native replay even at an authored value of zero. Brush spacing is at least 0.5 local pixels, using the segment's minimum pressure (at least 0.05); pencil spacing uses the native Chebyshev grid. Legacy stored brush strokes lacking spacing retain the native 0.12 fallback. These describe existing native rules, not new mutation options.

Stroke selection clips use native fractional coverage embedded as PNG tiles. Preparation covers the conservative union of transformed selection bounds plus two native pixels, clipped to output support; empty selections use no tiles. Ordinary layer/group masks retain their complete density/inversion/feather support. Clone operations embed their sanitized decoded source snapshots at native source resolution, with separate editable brush masks and placement. Image/mask progress, cancellation, source lifetime and cleanup use the existing host export boundary. Complete clone snapshots can retain pixels hidden outside the painted area; metadata exclusion does not make SVG redaction. Use flattened PNG when hidden content must not be delivered.

The SVG contains rendered primitives, not the original brush commands, control-point sequence or editable brush settings. Dabs outside conservative output/shadow support are excluded; projects retain all original data. Dense strokes/deep eraser groups can exceed viewer XML/filter complexity or working memory. Edge/gradient quantization and affine antialiasing can differ from native PNG even when geometry is correct. Raster clips and clone images retain finite native resolution; the complete SVG is not infinitely scalable.

Missing/replaced/disposed clone sources, missing native coverage support, invalid literal paint colors and cancellation reject without partial output or history/source changes. Native and SVG rendering reject visible stamp indices beyond safe integer precision with `Stroke stamp indices exceed numeric precision`; move extremely distant geometry closer before rendering. This avoids a non-advancing replay loop without imposing an image-resolution cap or altering stored geometry. Export signatures, document/project schemas, isolated script/plugin privileges and separate REST sessions are unchanged. There is no `PaintLayer.toSvg` or isolated-script file-download method; adjustments and Blend If use the reported native backdrop-prefix composition described above.

Run this in **Scripts** as one undo step, then use **Export… → SVG**. Paint remains editable as dab/fill/eraser geometry; save a project for the complete brush model.

<!-- example: svg-paint -->
```js
document.resize(160, 112);
const paint = document.layers.add(new PaintLayer({ x: 12, y: 12 }));
paint.strokes.add(new PaintFill({
  bounds: { x: 8, y: 8, width: 96, height: 64 },
  color: "#804020",
}));
paint.strokes.add(new BrushStroke({
  points: [{ x: 16, y: 32, pressure: 0.4 }, { x: 96, y: 32 }],
  size: 18,
  hardness: 0.6,
  color: "#20c080",
  flow: 0.5,
  opacity: 0.7,
  pressureOpacity: true,
  clip: new MarqueeSelection({
    shape: "ellipse", x: 24, y: 16, width: 48, height: 32,
  }),
}));
paint.strokes.add(new EraserStroke({
  points: [{ x: 32, y: 32 }, { x: 64, y: 32 }],
  size: 24,
  hardness: 0.5,
  opacity: 0.75,
}));
paint.strokes.add(new PaintFill({
  bounds: { x: 40, y: 24, width: 16, height: 16 },
  color: "#0000ff",
}));
print("Editable SVG paint ready");
```

The document also exposes integration hooks: `subscribe(listener)` registers a state-change listener and returns an unsubscribe function; `onCommand(listener)` observes dispatched commands and returns an unsubscribe function; `getSnapshot()` returns the current editor state (`document`, `selectedId`, `past`, `future`, `revision`). Treat snapshots as read-only and listeners as non-throwing. `onHistoryNavigation(listener: (direction: "undo" | "redo") => void): () => void` observes completed undo/redo navigation and returns an unsubscribe function. Empty history navigation emits nothing; listener callbacks must not throw. This DOM hook does not create an additional undo entry; subscriptions inside Scripts observe only the temporary worker document, never host history. Command listeners are not a complete history event stream: undo/redo and active-layer changes do not emit mutation commands; pixel selection does. These hooks are for application adapters; subscriptions created inside Scripts observe only that temporary worker instance and end with the run.

Underscore-prefixed members (`_dispatch`, `_read`, `_attach`, etc.), worker messaging, and store internals are not supported scripting API. JSON/command types are transport formats, not alternate live object setters. Public SDK packaging, general API stability guarantees and a script library remain future work. Versioned command plugin packages and document permissions are available through the separate Plugins panel.

## Prepared wet paint (schema 33)

`new WetPaintStroke({brush, tiles, nativeTransform?, opacity?, load?, mix?})` creates an immutable prepared replacement value. Add it to `PaintLayer.strokes`, or call `RasterLayer.applyWetPaint(stroke): void`. Raster replacements retain their order relative to erase/clear, capture the current logical width/height, and preserve the original image asset. Attached mutations use ordinary commands, ancestor locks, transactions and undo. DTOs use `kind: "wet"` and require schema 33, including retained history and embedded masters. Older valid documents migrate; falsely old wet records reject. Project v3/workspace v2 are unchanged.

`brush` is a `BrushStroke`/`PencilStroke` value or its complete DTO, without clone tiles. It records the footprint, path, captured selection, opacity, flow, pressure, tilt, symmetry and optional texture. These settings describe preparation: **the supplied pixels are authoritative**, and editing metadata does not rerun the simulation. Eraser/clone/fill footprints reject. `tiles` is a nonempty array of `{x,y,width,height,assetId,coverage:{assetId}}`. Geometry is integral native pixels with positive extents and safe numeric addressing. `nativeTransform` maps native tile coordinates into layer-local coordinates and defaults to identity. Explicit null opacity/nativeTransform rejects; only omitted/undefined values use defaults. Zero operation opacity keeps metadata and asset references but does not select native reconstruction, GPU fallback, expanded visual bounds or SVG prefix baking. Independent operation `opacity` defaults to 1 and blends the complete replacement once, including overlapping tiles. The brush's opacity/selection must already be baked into supplied pixels; outer DTO `clip` is always null.

Both image references must resolve to decoded, noninterlaced RGB8/RGBA8 PNG assets whose actual dimensions match their tile. Output alpha must be at most coverage alpha at every native pixel: output is already masked, coverage removes destination pixels, and output is added once. This permits reducing alpha. Coverage RGB is ignored. Browser/script commits and REST decode/check native alpha before publishing; invalid/missing/replaced sources reject the entire transaction. This derived-output contract does not restrict original-image or brush-texture import formats/resolution. Native tile coordinates, count and original dimensions have no arbitrary image-tier cap; working buffers, storage quota and numeric/format precision can still fail explicitly.

`load` accepts `{color?: [r,g,b,a], load?: number}`; channels are integral 0–255 and load is 0–1, defaulting to opaque black and 0. `mix` accepts `{flow?,wetness?,pickup?}`, each 0–1, defaulting to 1/0/0.5. Unknown keys/nonfinite or out-of-range values reject. These normalized settings are retained metadata on prepared values. Read-only members are `id`, `kind`, `opacity`, `brush`, `tiles`, `nativeTransform`, `load`, `mix`, and `toJSON()`; returned arrays/DTOs are owned copies.

This isolated example requires two already imported PNG image layers named **Wet output** and **Wet coverage**, with matching original pixel dimensions and valid premasked output. Source layers are kept as imported; use hidden source layers if their images should appear only in the replacement. No files, pixels, native simulation or export service is exposed to the sandbox.

<!-- example: wet-prepared -->

```js
const output = [...document.layers].find(layer => layer.name === 'Wet output');
const coverage = [...document.layers].find(layer => layer.name === 'Wet coverage');
if (!(output instanceof RasterLayer) || !(coverage instanceof RasterLayer)) {
  throw new Error('Import Wet output and Wet coverage PNG images first.');
}
const paint = new PaintLayer({name: 'Prepared wet paint'});
paint.strokes.add(new WetPaintStroke({
  brush: new PencilStroke({points: [{x: 3.5, y: 4.5}], pressureSize: false}),
  tiles: [{x: 3, y: 4, width: output.width, height: output.height,
    assetId: output.assetId, coverage: {assetId: coverage.assetId}}]
}));
document.layers.add(paint);
print('Prepared wet paint ready');
```

Use original dimensions without resizing the two source layers. The host validates actual decoded dimensions and alpha, rather than trusting their display geometry. Plugins need their existing `document:write` grant; installation remains inert, and no new permission/file/network boundary is added. Browser rendering composes replacements on a native content plane before layer transforms/appearance. Unsupported GPU compositions use complete Canvas fallback. SVG bakes affected paint-layer sibling prefixes and discloses lost editability; save a project for complete sources and operations.

### Prepared mask coverage (schema 34)

`mask.applyWetPaint(stroke: WetPaintStroke): LayerMask` returns a new immutable mask with one prepared replacement appended. Assign it to `layer.mask` or `instance.filterMask` to commit through the shared commands, locks, transaction and undo path. Ordinary `mask.paint` still accepts only BrushStroke/PencilStroke and Hide/Reveal; it does not accept WetPaintStroke. Constructors, `with({strokes})`, `strokes` getters and `toJSON()` preserve the ordered union `{mode:"hide"|"reveal", stroke:BrushStroke|PencilStroke}` or `{mode:"wet", stroke:WetPaintStroke}`. Clone/fill or a mode/value mismatch rejects. Ordinary and wet operations share the existing 2,048-operation / 200,000-total-point mask budget (20,000 points per brush); wet point counts use the retained brush metadata, not native tile count. There is no arbitrary image/native-tile count tier.

Raw coverage is reconstructed in the mask's native coordinate plane before its linked/unlinked/master transform, then mask-wide feather, inversion and density apply once. Bitmap originals and vector/selection/base geometry remain unchanged and editable. Prepared output alpha is authoritative coverage; RGB is ignored. Prepared alpha must already be bounded by its native coverage PNG, just as for layer replacements. Independent operation opacity applies once; zero-opacity records retain validated references and metadata while bypassing native reconstruction and preserving pure-vector SVG masks. Both ordinary and filter masks require schema 34 for this new operation, including retained history and embedded masters; normal layer wet values still date from schema 33. Project3/workspace2 containers stay unchanged. Old readers may reject new document schemas.

Import valid one-pixel PNG layers named **Wet output** and **Wet coverage** before running the example. Output alpha must not exceed coverage alpha. The script references those existing originals; it does not read files, fetch pixels or run a simulation.

<!-- example: wet-mask-prepared -->

```js
const output = [...document.layers].find(layer => layer.name === "Wet output");
const coverage = [...document.layers].find(layer => layer.name === "Wet coverage");
if (!(output instanceof RasterLayer) || !(coverage instanceof RasterLayer)) {
  throw new Error("Import Wet output and Wet coverage PNG layers first.");
}
const layer = new PaintLayer({name: "Prepared mask demo"});
layer.strokes.add(new PaintFill({bounds: {x: 0, y: 0, width: 16, height: 16}, color: "#2a5968"}));
layer.mask = new LayerMask({base: 1}).applyWetPaint(new WetPaintStroke({
  brush: new PencilStroke({points: [{x: 4.5, y: 4.5}], size: 1, pressureSize: false}),
  tiles: [{x: 4, y: 4, width: 1, height: 1, assetId: output.assetId, coverage: {assetId: coverage.assetId}}],
}));
document.layers.add(layer);
output.visible = false;
coverage.visible = false;
document.selectedLayer = layer;
print("Prepared mask ready");
```

### Wet preparation (trusted application code)

`await editor.applyWetPaint(brush, options?): Promise<WetPaintStroke|null>` runs actual native spatial preparation and atomically commits the result. `brush` is a BrushStroke/PencilStroke whose coordinates are **target-local**, while captured document selection is transformed into that plane. `options` accepts only `mode?: "smudge"|"mixer"` (default smudge), `target?: "layer"|"mask"|"filter-mask"` (default layer), `targetId?: string` (default selected layer), `respectSelection?: boolean` (default true), `load?`, `mix?`, `signal?: AbortSignal`, and `onProgress?: ({dabs,workingTiles}) => void`. An explicit brush clip takes precedence over document selection; false respectSelection clears both. For layer pixels, no selected target creates a paint layer; an existing target must be a paint/image layer. Mask targets require an existing mask; filter-mask targets require a smart object with an existing filter mask. All layer kinds/groups may receive ordinary mask coverage. Locked ancestry rejects. Targets are never silently redirected.

For mask/filter-mask targets, brush coordinates are **mask-local native pixels**, before its x/y/basis/linking transform. Filter-mask coordinates are in the smart master plane, independently of instance size. Selection is captured through that complete mapping. Preparation samples raw mask coverage, ignoring enabled/inverted/density/feather and artwork/filter appearance; these settings remain stored and apply afterward. Mask load RGB normalizes to white, with alpha retained from a valid `load.color` tuple (default alpha255). Mixer alpha255 loads revealed coverage; alpha0 loads hidden coverage. Smudge defaults load0 and transports existing coverage. The UI Hide/Reveal target supplies that initial alpha; current load/wetness/pickup and brush opacity/flow still apply. Foreground RGB is not a mask control. Source identities, revision/cancellation, private previews, no-op and atomic publication contracts are the same as layer pixels.

Preparation samples the target's neutral content, including preceding ordered operations, before its opacity/mask/styles/tone effects or parent appearance. Raster sampling uses original pixels independently of current logical size; source blobs remain unchanged. Foreground defaults to the brush's opaque RGB. Smudge defaults load to 0 and wetness to 0; mixer defaults load to 1 and wetness to 0.25. Partial load/mix options override those mode defaults; remaining mix flow/pickup defaults are 1/0.5. This is finite encoded-sRGB pigment transport, not a physical/spectral model.

```js
const stroke = new PencilStroke({
  points: [{x: 10.5, y: 20.5}, {x: 30.5, y: 20.5}],
  size: 3, pressureSize: false, color: '#ff0000'
});
const result = await editor.applyWetPaint(stroke, {
  mode: 'mixer', mix: {wetness: 0, pickup: 0}, signal: controller.signal
});
```

Import constructors from the host DOM module and provide an AbortController as `controller`. No changed pixels returns null without history/assets. Abort, callback errors, quota/source-lifetime failures or changed document/revision/active selection/session reject without late publication. Private storage is disposed before commit; staged assets publish only after validation and remain for undo/redo. Original-first symmetry order, separate spatial pigment per copy, once-only selection/brush opacity, native replacement and complete path replay are preserved. Numerical work uses at most 4 million pixels/request and native composition at most 4 million pixels/4096 pixels per side per working surface; these are working budgets, not source limits. This adapter does not implement incremental live gestures, mixer/smudge tool controls, mask/filter-mask painting or preset integration. Those roadmap gates remain open.

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

`new LayerMask({ selection, enabled = true, inverted = false, density = 1, feather = 0 })` creates an immutable selection-based mask. `selection` is a required `MarqueeSelection` in **layer-local document pixels**. It supports up to 128 ordered rectangle/ellipse/pixel add/subtract/intersect regions. `density` must be finite and between 0 and 1; booleans must be booleans. Invalid values throw. Empty selection hides all content; invert it to reveal all.

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

All primary and additional contours are copied. Only anchors and their incoming/outgoing control handles are copied; path IDs, fill/stroke colors and widths are not mask data. All contours are filled as one compound path. `"evenodd"` alternates coverage at each nested contour, producing holes without reversing path direction. `"nonzero"` uses winding direction. Get `mask.fillRule` for vector masks (`null` for selection masks); change it with `mask.with({ fillRule })`. Invalid rules throw.

`mask.paths` returns independent detached `VectorPath` objects, always closed with no fill/stroke styling. Edit those paths and assign `layer.mask = layer.mask.with({ paths })` to commit. Reading `paths` on a selection mask or `selection` on a vector mask throws. `with({ paths })` or `with({ selection })` can replace the geometry kind while retaining enabled/inversion/density/feather/position/linking; switching to paths defaults to even-odd unless a rule is supplied. Detached edits do not affect the layer until assigned.

`layer.maskFromPaths(source: VectorLayer)` requires both layers to be attached to the same document and the source to contain closed paths. It copies **all** source paths into the target's local coordinate space, accounting for source/target ancestor translations. Empty/open sources fail without changing the target. The source layer is not changed or hidden. Later source edits do not update the copied mask. Capture uses the common source fill rule when any source path has additional contours or an explicit rule; mixed rules reject without mutation. Legacy single-contour sources with no explicit rule retain the previous even-odd capture default. Direct `new LayerMask({paths})` continues to use its explicitly documented even-odd default; supply `fillRule` when copying nonzero artwork. The target's locks/history apply; a locked source may still be read. The inspector offers eligible vector layers as **Mask path source**; create/replace from paths captures the same snapshot.

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

Feathering softens mask coverage before inversion, density, styles and blending. It uses three separable box-filter passes, with each pass's half-width equal to one third of the requested feather distance, scaled independently to the render grid. Fractional endpoint weights support fractional radii; floating-point intermediates are rounded to byte alpha after the final pass. This is Canoli Studio's defined smoothing kernel, not a claim of Photoshop/Gaussian-kernel equivalence.

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

`new LayerMask({ base, strokes = [], ...settings })` creates brush-based coverage. `base` is required and finite in 0–1: 1 initially reveals everything, 0 hides everything, and intermediate values give uniform coverage. Settings (`x`, `y`, `linked`, `enabled`, `inverted`, `density`, `feather`) have the same defaults and meaning as other masks. Supply exactly one geometry source: `base`, `selection`, or `paths`. Painted masks record brush operations and rasterize them at rendering time; bitmap coverage is available through the separate assetId geometry source. Selection and vector masks can also receive strokes directly, retaining their own geometry beneath the refinements.

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

`await raster.refineEdge(options = {}, control = {})` returns the output raster's attached `LayerMask`. `await document.removeBackground(targetLayer = document.selectedLayer, options = {}, control = {})` returns the output `RasterLayer`. The trusted editor facades forward these arguments. An attached, unlocked raster owned by this document and a configured application host are required. Other layer kinds, detached/foreign layers, locked ancestors and synchronous `document.transaction` callbacks reject. Hidden rasters can be sampled.

Both methods start with the target's enabled, nonzero-density mask, otherwise the current document selection, otherwise the local Select Subject heuristic described below. An explicit trimap skips automatic Subject preparation when no mask/selection exists. Foreground/background/refine marks override the generated labels in stroke order. Input pixels are the original raster before its effects, opacity and ancestor compositing, with native source dimensions separate from placed dimensions. Full ancestor/layer transforms and placed scaling map document coverage to source coordinates.

| Option | Default | Contract |
| --- | --- | --- |
| `solver` | `"closed-form"` | Global sparse matting Laplacian; `"color-line"` explicitly selects the former local estimator. |
| `radius` | `10` | Finite 0–50 original-source pixels; unknown-band radius (and local estimation support for Color line). |
| `smoothness` (`smooth` alias) | `10` | Finite 0–100; blends color-guided bilateral smoothing at `smoothness/100` on unknown pixels (10 means 10% strength). |
| `edgeFeather` (`feather` alias) | `0` | Finite 0–50 original-source pixels; fractional three-box feather on unknown pixels through the native WASM kernel. |
| `contrast` | `0` | Finite −100–100; unknown alpha is scaled around 0.5 by `2^(contrast/50)` and clipped. Positive values sharpen. |
| `shiftEdge` | `0` | Finite −100–100; square erosion/dilation by `round(radius*shiftEdge/100)` before automatic trimap generation. Explicit trimaps bypass this step. |
| `decontaminate` | `false` | Correct transition RGB in a separate foreground asset; requires new-layer output. |
| `decontaminateAmount` | `1` | Finite 0–1 mix of original and estimated corrected RGB. |
| `outputTo` | `"mask"`, or `"new-layer"` when decontaminating | Mask output retains the source raster asset. New-layer output places a refined raster immediately above the source in the same parent and hides the original; it returns/selects that raster. |
| `trimap` | absent | Owned copy of `Uint8Array`, exactly native width × height; labels 0 background, 128 unknown, 255 foreground. |
| `trimapAssetId` | absent | Alternative native-sized image asset whose decoded alpha bytes are exactly 0/128/255. RGB is ignored. Cannot be combined with `trimap`. |
| `trimapStrokes` | `[]` | At most 256 strokes/20,000 total points. Each has `mode: "foreground"|"background"|"refine"`, finite diameter `size` 0.5–512 and nonempty `{x,y}` points in original-source coordinates. Circular dabs follow existing Quick Selection seed rasterization. |
| `viewMode`, `previewMode` | absent | UI-only choice: `marching-ants`, `overlay`, `on-black`, `on-white`, `on-transparency`; does not alter native output. |

Unknown keys, nonfinite/out-of-range values, conflicting aliases, wrong trimap geometry/labels and `decontaminate:true, outputTo:"mask"` reject without committing. With radius zero, existing fractional coverage is retained before smoothing/contrast/feather adjustments, except unknown cells painted with refine marks are re-estimated. Existing enabled masks are sampled on the document pixel grid at native source centers, baking density/inversion/world-space feather into a new relative matte. Output retains the input mask's linked/unlinked behavior (linked by default), with a source-to-layer or source-to-world bitmap basis. This resampling can flatten mask detail finer than the source grid; it is not universal appearance parity for arbitrary vector/painted masks or transforms.

The default **closed-form** solver assembles the color matting Laplacian from [Levin, Lischinski and Weiss, equations 12–13](https://www.cs.jhu.edu/~misha/ReadingSeminar/Papers/Levin06.pdf). Each native pixel centers an overlapping 3×3 window clipped at image edges; zero-alpha source pixels are omitted from its color statistics. RGB is encoded sRGB divided by 255, with covariance regularization epsilon `1e-7`. Known foreground/background are exact hard constraints, not soft penalties. Unknown rows retain all 5×5-stencil connections across capture/PNG tile seams; one global system is solved before output, without substituting independent tile solutions. Radius zero freezes existing fractional priors except painted unknown marks; zero-alpha pixels retain their prior/zero coverage. A connected unknown component without any hard constraint retains its genuine prior and is reported unresolved; without a prior it rejects. A component with only foreground or only background constraints can converge to that constant coverage; this does not establish subject identity.

The float64 solver uses incomplete-Cholesky IC(0)-preconditioned conjugate gradients, at most 2,000 iterations, and requires actual `||Ax-b|| / max(1,||b||) <= 1e-7` before success. A budgeted RGB-aware coarse correction may augment it for at least 4,096 unknowns; that path tightens the actual residual to **1e-9**, retaining the same iteration ceiling. Nonconvergence, lost precision, incomplete capture and graph allocation failure reject without approximate/late commit. Alpha is then clipped/rounded to bytes and the requested smoothing/contrast/feather is applied to unknown labels. These post-adjustments need not minimize the original quadratic. Assembly stores only unknown rows, with a 192 MiB estimated graph/work-vector/lookup budget. IC(0) uses the existing stencil, sorted by actual capture insertion order, and may shift its own factorization diagonal to obtain a positive factor; the matte Laplacian remains unchanged. The extra factor is budgeted separately. If it cannot fit or factor safely, global CG uses Jacobi preconditioning and reports that choice in private diagnostics. This preserves the former graph capacity. Map overhead and whole-process memory are not measured by that estimate. More known marks reduce unknown work. An operation failure does not cap imports or reduce source resolution; users may explicitly choose Color line. Capture, solve iterations/residual and encoding are reported as real phases, with termination on cancellation.

The global worker packs sparse rows in place after component classification/factorization, reusing finished union metadata for iteration bounds. This avoids repeatedly scanning absent/opposite-triangle entries without adding graph buffers or changing the existing capacity. Floating-point reduction order can change last-bit roundoff and iteration counts; the same actual residual/known-label requirements still govern success. A physical allocation failure in the optional factor also retains the global Jacobi route. No new option, script deadline, permission or approximate-success path is introduced.

The optional coarse correction uses local `[1,R,G,B]` columns on native 16×16 cells and a globally coupled `PᵀAP` band solve, with a small ridge on that coarse matrix only. It supplies a starting correction and augments the base preconditioner; every successful final matte is still solved on all native unknown rows. Unconstrained components retain their genuine priors and do not enter this correction. Additional band/bookkeeping memory must fit after reserving the existing base/eligible IC(0) capacity; a bounded band-factor work estimate also applies. Missing optional capacity, allocation or positive coarse factorization retains the base global solver. These are operation budgets, not image/file limits or downsampling. RGB and prior alpha share existing exact-integer sample storage. Coarse setup is part of the actual solve phase and can precede iteration one. Isolated scripts still have the same five-second wall deadline, including that work.

Explicit **color-line** uses Gaussian-weighted nearby visible known foreground/background colors and projects unknown pixels onto that local line, with search radius `clamp(round(radius),3,25)`. Nearly equal colors use relative spatial weights. Missing local foreground/background retains a genuine prior; no prior and no local evidence rejects. This optional legacy estimator is not a KNN/Laplacian solver. The exported synchronous `solveAlphaMatte` helper remains this local reference; the awaited methods own global preparation. Its legacy Gaussian feather differs from the native job's fractional three-box feather.

Both modes exclude hidden RGB from color evidence and keep known labels fixed. Smoothing uses a color-guided radius `clamp(round(smoothness/20),1,5)` and a proportional strength `smoothness/100`; zero bypasses smoothing. Color correction samples background within eight source pixels, unmixes `(I-(1-alpha)*B)/max(alpha,0.12)`, clips to bytes, and blends by amount only for relative alpha strictly between 0.05 and 0.98. With no background evidence it retains original RGB. Confidence zero means unscored. Independent SciPy direct-solve and synthetic mixture/strand/translucency fixtures verify numerical behavior; held-out natural hair, glass, fur, foliage and translucent-fabric quality and semantic selection remain T19 gates. No evaluated natural-image accuracy follows from solver convergence.

<!-- example: closed-form-matting -->

```js
// Select a raster and make an initial selection/mask, or use automatic Subject evidence.
const raster = document.selectedLayer;
if (!(raster instanceof RasterLayer)) throw new Error("Select a raster layer first.");
const matte = await raster.refineEdge({
  solver: "closed-form",
  radius: 10,
  smoothness: 0,
});
print("Refined mask", matte.kind);
```

Original compressed image bytes remain unchanged. Corrected PNGs retain intrinsic source alpha, while the separate white-RGB PNG mask stores relative coverage; compositing multiplies them once. Automatically derived source-alpha priors are normalized to relative coverage so partial source alpha is not squared. New-layer output retains outer source placement/appearance settings and hides the source; mask-only output changes no RGB. The complete asset/command change is one undo entry. Current and redo-only workspace history, project saving and reopening retain referenced assets. Document schema 25/project 3/workspace 2 remain unchanged.

Trusted controls accept `AbortSignal` and `onProgress({completed,total,phase?,iteration?,relativeResidual?})`. Global jobs count capture tiles, one complete solve, and encoding tiles; solve callbacks report actual iterations/residual while that solve item remains pending. Color-line or radius-zero jobs needing no estimation can encode directly. The dialog keeps actual progress, Cancel and Escape available; display-only previews fit within 512 × 512, scale their controls/marks separately and never become native output. Final work captures up to 512 × 64 core pixels plus support padding, assembles the global unknown graph in a private worker, then recaptures native tiles for postprocessing/encoding. Local Color line uses one pass. Mask tiles and row strips target about 4 MB. Dual streaming PNG encoders retain compressed output rather than a full output RGBA plane/canvas. An extreme-width scanline can exceed the strip target. Browser image decoding/output bitmaps remain resident; automatic Subject preparation still needs its full native RGBA plane under the existing 256 MiB WASM maximum. Actual allocation, decoder, source/capture, compressed output, RLE/history and process limits can fail. No arbitrary image-size import cap or downsampling is added. Cancellation, source/session ownership or revision changes discard private assets and prevent late commit.

Isolated scripts await the same host from their validated staged snapshot; pixels, workers and asset stores stay outside script globals. Use panel cancellation instead of callbacks/signals (sandbox controls reject). Preparation is sequential and shares the retouch host's 32-owned-asset budget: a corrected job uses two slots, mask-only one. Existing runtime/command/result limits still apply. A later script failure discards the complete operation. apiVersion-2 plugins require current `document:read`, `document:write`, `assets:read` and `assets:write` grants during preparation and final staged commit; installation remains inert.

This example keeps the current mask/selection exactly at radius zero, or starts with automatic Subject coverage if neither exists, and places a separately masked raster above the hidden original. Select a raster and optionally make a selection first:

<!-- example: native-background-removal -->

```js
const source = document.selectedLayer;
if (!(source instanceof RasterLayer)) throw new Error("Select a raster layer first.");
const isolated = await document.removeBackground(source, {
  radius: 0,
  smoothness: 0,
  outputTo: "new-layer",
});
print("Foreground", isolated.name, isolated.mask.kind);
```

Headless sessions use the separate PNG-source `POST /api/v1/documents/:id/refine-edge` contract in [API.md](API.md#native-refine-edge-and-background-removal). It does not render browser scenes or synchronize with the editor.

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
| `new BilateralDenoiseFilter(options?)` | Integer radius 2 (0–16), colorSigma 25 (0–255), amount 0.5 (0–1), enabled true, generated ID. |
| `new MedianFilter(options?)` | Integer `radius:1` (0–32), enabled true, generated ID; alpha-preserving median denoise. |
| `new GaussianBlurFilter(options?)` | `sigma: 1`, `enabled: true`, generated `id`. Sigma is finite, 0–4096/3 master pixels.                        |
| `new UnsharpMaskFilter(options?)`  | `sigma: 1`, `amount: 1` (0–5), `threshold: 0` (0–255), `enabled: true`, generated `id`.                      |
| `new FrequencyBandFilter(options?)` | `sigma:4`, `band:"high"`; low/high/correction, native encoded RGB8. See the schema-36 contract above. |
| `new NativeCompositionFilter(options?)` | Native RGBA composition before resampling; generated ID, enabled=true. |
| `new DocumentToneFilter(options?)` | Tone defaults/ranges as SmartToneFilter, but after placement; must trail all native entries. |
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

`SmartObjectLayer.filterMask` gets an immutable `LayerMask` value or `null`. Set it with a `LayerMask` constructor (or `null` to remove). It masks the entire ordered filter stack, independently of the ordinary layer mask. White coverage reveals the filtered result; black reveals the retained original. Density, inversion, feather, selection/vector/bitmap sources and painted refinements use existing LayerMask values. Disabled masks or zero density reveal the complete filtered result. Native filtering and its masked mixing happen before instance resampling. Trailing DocumentToneFilter entries mix with projected native coverage after placement and before the ordinary layer mask/styles.

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

### Raster erasure and pixel selections (schema 16)

`RasterLayer.erase(stroke: EraserStroke): void` appends an undoable erasure. `RasterLayer.clear(selection: MarqueeSelection | null = null): void` clears the supplied selection, or the entire image when omitted. Coordinates and clips are layer-local. These methods do not implicitly read `document.selection`; UI tools translate the document selection for you. They preserve original asset bytes and respect layer locks. Invalid constructors throw. Each layer accepts at most 2,048 erasure records. Captured layer dimensions make erasures scale with subsequent image resizing.

```js
const image = document.selectedLayer;
if (!(image instanceof RasterLayer)) throw new Error("Select an image layer.");
image.clear(new MarqueeSelection({
  shape: "rectangle", x: 10, y: 10, width: 40, height: 40,
}));
```

`MarqueeSelection` also accepts `shape: "pixels"` with `coverage: { width, height, runs }`. Coverage dimensions are positive integer sample dimensions; region geometry controls placement and scaling. `runs` contains pairs of exclusive linear end offsets and alpha bytes (0–255), in row-major order. End offsets must strictly increase and the last must equal width × height. For example, `{ shape: "pixels", x: 0, y: 0, width: 2, height: 1, coverage: { width: 2, height: 1, runs: [1, 128, 2, 255] } }` selects two pixels at half and full coverage. Fractional coverage survives rendering, masks, clipping and project persistence. Existing add/subtract/intersect operations and the 128-region limit apply. Pixel coverage is required only for pixel regions and prohibited for geometric regions.

The browser's pixel clipboard, magic-wand sampling and thumbnail action are host UI services, not additional isolated-script globals or REST clipboard endpoints. Scripts can construct pixel selections and erase/clear using the constructors above.

### Resize the image and artwork

`document.resizeImage(width: number, height: number): void` scales the canvas and all artwork together as one undoable operation. Dimensions must be positive safe integers; invalid dimensions or unrepresentable resulting geometry reject without partial changes. There are no optional arguments or implicit aspect-ratio constraints in the API. Pass proportional dimensions to preserve aspect ratio.

```js
// Double output dimensions while retaining editable layers and original assets.
document.resizeImage(document.width * 2, document.height * 2);
```

This differs from `document.resize(width, height)`, which changes only canvas bounds. Image resizing transforms root placement once, including hidden and locked artwork, and preserves lock/visibility flags. Document-space masks, selections, guides and captured root layer-comp positions follow the scale. Nested local geometry remains editable. Pixel-based effect settings (shadow offsets/blur, mask feather, smart-filter radii) keep their existing values. Raster sources are not destructively resampled; rendering/export uses the existing interpolation at the new output dimensions. Direct calls, isolated scripts and REST `document.resizeImage` share validation and history.

### Expand, contract and feather the pixel selection

`await document.modifySelection(options: { operation: "expand" | "contract" | "feather"; radius: number }, control = {}): Promise<void>` modifies the current combined pixel selection. `radius` is required and must be an integer from 1 through 128 document pixels; unknown option fields fail validation. Expand takes the maximum and Contract the minimum of 8-bit coverage within a circular disk of the given radius. Fractional alpha is retained. Feather applies the existing three-pass box blur, with each pass's half-width equal to `radius / 3` and fractional endpoint weights. It is an approximate softening kernel, not a claim of a Gaussian standard deviation.

All operations combine the selection's ordered add/subtract/intersect regions first, sample at native document resolution, treat pixels outside the canvas as unselected, clip the result to the canvas, and return one pixel-coverage region (or `{ regions: [] }` when no selected pixels remain). They do not modify artwork/source bytes or impose an image import limit. Locked layers do not block document selection edits. The resulting selection works with paint clips, copy/clear, non-destructive layer masks, undo/redo and portable projects.

Preparation runs in a dedicated image worker, using padded 512-pixel output tiles and sparse RLE retention. Do not call it inside a synchronous `document.transaction`; await each modification before continuing. A plain `new Document` needs a configured application host for this operation. The browser editor and isolated script runtime configure it. Missing selection/host, invalid options/results, cancellation, or document/session changes reject without committing prepared coverage. An empty explicit selection stays empty. Each trusted-host call makes one undo entry; an entire successful Scripts/plugin run retains its usual single atomic undo entry. Scripts may prepare at most 32 selection modifications/Color Range preparations/alpha-channel loads/Quick Selection preparations in total per run, within the existing script time/result budgets.

```js
// example: modify-selection
document.selection = new MarqueeSelection({
  shape: "rectangle", x: 20, y: 20, width: 20, height: 20,
});
await document.modifySelection({ operation: "expand", radius: 2 });
await document.modifySelection({ operation: "contract", radius: 1 });
await document.modifySelection({ operation: "feather", radius: 3 });
print("Modified selection", document.selection.regions.length);
```

Trusted application code may pass `control: { signal?: AbortSignal; onProgress?: ({ completed, total }) => void }`. Progress counts completed native output tiles; cancellation terminates active pixel work. Isolated scripts use the Scripts panel's Stop action and do not accept host progress callbacks or AbortSignal controls. Plugins require currently granted `document:write`; no image-asset permission is needed because the operation reads selection geometry only. Large or fragmented selections can still take time and retain substantial serialized coverage; tiling is a working-buffer bound, not an infinite-size guarantee.

### Color Balance and Vibrance adjustment layers

`new AdjustmentLayer({ adjustment: { kind: "color-balance", shadows, midtones, highlights, preserveLuminosity } })` creates an editable Color Balance layer. Each range is `{ red, green, blue }`, with all nine values required, finite and between -100 and 100. Positive red/green/blue values move toward Red/Green/Blue; negative values move toward Cyan/Magenta/Yellow. `preserveLuminosity` is a required boolean. The trusted DOM module exports `defaultColorBalanceAdjustment()` with zeroed channels and luminosity preservation enabled. These helper exports are not Scripts-panel globals.

`new AdjustmentLayer({ adjustment: { kind: "vibrance", vibrance, saturation } })` creates Vibrance. Both values are required finite numbers from -100 to 100; the trusted `defaultVibranceAdjustment()` returns zeros. Vibrance weights the saturation change toward less chromatic pixels. Neutral pixels stay neutral; the effect does not detect skin, faces or objects. The separate saturation control applies a uniform chroma multiplier.

Replace an attached layer's `.adjustment` through its constructor handle to commit validated, undoable edits. Normal masks, opacity, fill opacity, blending, visibility and stack order apply; locked targets/ancestors reject changes. Invalid, missing or unknown fields and nonfinite/out-of-range numbers reject atomically. Ordinary successful Scripts/plugin runs remain a single history entry. Installation remains inert and plugins need currently granted `document:write` for these edits. Model schema 17 persists both types; valid schemas 1–16 migrate on opening, and schema 16 or earlier data containing either new type is rejected. The project container and workspace snapshot versions are unchanged.

```js
// example: chromatic-adjustments
const balance = document.layers.add(new AdjustmentLayer({
  name: "Warm midtones",
  adjustment: {
    kind: "color-balance",
    shadows: { red: 0, green: 0, blue: 0 },
    midtones: { red: 15, green: 0, blue: -8 },
    highlights: { red: 0, green: 0, blue: 0 },
    preserveLuminosity: true,
  },
}));
const vibrance = document.layers.add(new AdjustmentLayer({
  name: "Gentle vibrance",
  adjustment: { kind: "vibrance", vibrance: 25, saturation: 0 },
}));
print("Chromatic adjustments", balance.adjustmentKind, vibrance.adjustmentKind);
```

The processing contract is encoded-sRGB straight RGB with alpha copied unchanged. Let `l = .3*r + .59*g + .11*b` on normalized channels. Color Balance uses weights `shadows=max(0,1-2*l)`, `highlights=max(0,2*l-1)`, `midtones=1-shadows-highlights`; each channel receives its weighted range value divided by 100. Without luminosity preservation, output clamps to [0,1]. With preservation, it uses the [W3C SetLum/ClipColor helper](https://www.w3.org/TR/compositing-1/#blendingnonseparable) to restore the original encoded luma and fit the gamut. This is not a linear-light or physical luminance guarantee, nor a Photoshop formula/parity claim.

For Vibrance, `chroma=max(r,g,b)-min(r,g,b)` and `scale=max(0,1+(saturation+vibrance*(1-chroma))/100)`. RGB scales away from its original luma by this factor, then uses SetLum/ClipColor. All RGB output rounds to 8-bit bytes; alpha is unchanged. Production pixels run in the existing WASM image worker or supported WGSL viewport, with the normal Canvas/WASM fallback for unsupported frames. Hardware GPU performance/presentation and wider color-fidelity gates require separate evidence.

Chromatic GPU conformance fixtures compare premultiplied 8-bit output with the WASM/Canvas reference: alpha must match exactly, maximum RGB difference is three byte levels, and mean difference is below one byte across the sampled transparent/partial-alpha, masked and opacity-adjusted compositions. These are software-adapter correctness checks; they do not establish hardware performance or every possible composition's fidelity.


## Gradient map adjustment layers

Create an editable gradient map with `new AdjustmentLayer({ name?, adjustment: { kind: "gradient-map", stops, reverse } })`; add it through `document.layers.add(...)`. Replace `layer.adjustment` to edit it through shared validation, commands and history. `stops` and `reverse` are required. Each stop is exactly `{ position: number, color: string }`: 2–32 stops in strictly increasing order, positions finite in [0,1], colors six-digit `#RRGGBB` (case-insensitive). Duplicate/unsorted positions, unknown fields, CSS color names, shorthand/alpha hex, missing fields and out-of-range/nonfinite numbers throw without committing. Colors are opaque mapping colors; source alpha is preserved. Stops need not reach 0 and 1: brightness outside the stop range uses the nearest endpoint color.

The processing space is **encoded sRGB**, at the existing 8-bit pixel boundary. For straight RGB bytes, brightness is `(.2126*r + .7152*g + .0722*b)/255`. This weighted encoded brightness is not physical linear-light luminance or an ICC conversion. If `reverse` is true, sample `1 - brightness`. Interpolate adjacent stop RGB channels linearly in encoded space, clamp outside endpoints, then round to byte values. Alpha is copied unchanged. Mask, density, opacity/fill, blend mode, ordering, group placement and Blend If use the existing adjustment-layer compositor. Original image assets are unchanged. Export uses bounded 1024-pixel WASM worker tiles; the supported WebGPU viewport uses the same stop mapping in WGSL. The neutral black-to-white default produces grayscale, rather than an identity color transform.

Trusted application code can import `defaultGradientMapAdjustment()` from `src/dom`; each call returns independent black/white endpoint stops with `reverse: false`. This helper is not a sandbox global. In Scripts/plugins use explicit settings:

```js
// example: gradient-map
const gradient = document.layers.add(new AdjustmentLayer({
  name: "Indigo to gold",
  adjustment: {
    kind: "gradient-map",
    stops: [
      { position: 0, color: "#171b46" },
      { position: 0.45, color: "#b65a74" },
      { position: 1, color: "#ffe4a0" }
    ],
    reverse: false
  }
}));
gradient.opacity = 0.75;
document.selectedLayer = gradient;
print("Gradient stops", gradient.adjustment.stops.length);
```

Document schema **18** stores gradient maps. Valid schemas 1–17 migrate on opening; a gradient map mislabeled as an older schema rejects explicitly. Project container v3 and workspace snapshot v2 are unchanged. Projects, recovery, workspace undo/redo history and recorded recipes retain the full stop list, with no external LUT/asset dependency. Plugin installation remains inert; execution requires currently granted `document:write` at commit. REST accepts the same DTO through existing `layer.add`/`layer.update` commands in its separate headless session.

WGSL uses float32 stop coordinates and premultiplied RGBA8 surfaces; the WASM reference uses float64 arithmetic on straight byte pixels. Coordinates that collapse to a single float32 value use the Canvas/WASM fallback. Extremely tight transitions can differ at float32 sampling precision. Conformance tests measure representative multi-stop/masked/partial-alpha fixtures with maximum premultiplied RGB error 3 bytes, mean under 1 byte and unchanged alpha. These fixture tolerances do not establish all-image/hardware/color-fidelity parity.


## PSB export and large Photoshop input (trusted application code)

`await editor.export({format:"psb", psdMode?:"layers"|"flatten"}, control?): Promise<ExportResult>` returns `image/vnd.adobe.photoshop` with extension `psb`, using PSB version 2. Mode defaults to `layers`, sharing PSD's supported folder, child pixel-record and user-mask plan, ordinary/pass-through modes, locks and scoped dependency merges. Group fill folds into opacity; only unstyled Normal pixel fill remains separate. Text/vector/paint/smart editability, non-Normal pixel fill/masks, effects and original mask controls/linkage/off-canvas coverage bake with preflight losses. `flatten` emits one visible-canvas layer. See [the normative hierarchy contract](#native-photoshop-folder-and-user-mask-export). PSB output remains RGB8, lossless PackBits, merged transparency, output sRGB ICC and explicit 72 DPI; higher precision, CMYK, full native Photoshop type/effect/adjustment serialization and desktop certification are unfinished.

PSB supports dimensions 1–300,000 per side, compared with PSD's 1–30,000, and retains at most 32,767 layer records. Channel lengths and layer-info/layer-mask section lengths use eight bytes; RLE scanline counts use four bytes for layers and merged data. Resource/extra-data lengths remain four bytes. Browser addressing must remain exact safe integers. The writer retains compressed Blob planes and bounded strips, not document-sized canvases/full uncompressed layer buffers. Original bitmaps, row width, output, parser/reader planes and device memory remain real constraints. These format/addressing rules are separate from document/import geometry; no arbitrary megapixel/file-size import cap is introduced. Synthetic large-length tests are not actual multi-GiB output proof.

PSD/PSB source/font capture now covers the actual planned output planes before any progress callback, including independent hidden or opacity-zero top-level layers. Flattening ignores hidden sources it does not render. Referenced removal/replacement/closed bitmaps, disposal, pending/changed referenced fonts, aborted signals and throwing callbacks reject without a file; unrelated resources and later document edits remain valid. Native surfaces release on every path. Progress/cancel use the existing host `ExportControl`; rendering starts at fraction 0, then advances by native rows, followed by encoding with fraction null. Native calls remain non-preemptible within a frame. Font files, source EXIF/GPS, original project data and saved channels are not embedded.

`editor.openPsd(buffer, options?)` still handles both PSD/PSB through its existing signature/result. Import now correctly reads four-byte PSB RLE row counts in layer and merged channels, rejects invalid header/address fields, and encodes decoded layer pixels into PNG strips before native image decoding. It no longer creates a source-sized canvas. Publication rechecks I/O generation, owner document/revision/session and asset lifetime; late edits, replacement or disposal discard private assets. Existing edited tabs stay open. The parser still synchronously materializes input/decoded planes; this is not a worker/streamed-file parser or complete low-memory import. Original decoded layer pixels persist as PNG sources; the complete original Photoshop container/private metadata is not archived. Non-RGB8/unsupported Photoshop constructs retain the separately documented prototype limits. Public import buffers are not detached or rewritten.

This adds no isolated export/file/download/font capability, REST rendering endpoint, batch PSB format or document/project/workspace schema. The low-level `buildPsd`/`documentToPsd` prototype remains PSD v1; use trusted browser export for rendered PSB. After creating artwork in Scripts, export PSB through the UI:

<!-- example: psb-composition -->

```js
document.resize(38417, 160);
const paint = document.layers.add(new PaintLayer({ name: "PSB artwork" }));
paint.strokes.add(new PaintFill({
  bounds: { x: 38000, y: 20, width: 400, height: 120 },
  color: "#804020", opacity: 0.5,
}));
document.layers.add(new TextLayer({
  name: "PSB caption", text: "Canoli Studio",
  fontFamily: "monospace", fontSize: 28, x: 38010, y: 60,
}));
print("PSB composition ready");
```

### PSD/PSB private encoding and cancellation

Trusted Photoshop export keeps the same signatures/defaults, native grid, RGB8/white-matte fidelity and errors described above. Captured native pixel strips now encode in a private module worker; only export-owned copies transfer, never original source buffers/bitmaps. Host checks source/font lifetimes before and after each reply and validates row-table/Blob extents. Abort terminates pending encoding; a native canvas call already executing remains non-preemptible. Worker load/runtime/message errors or invalid results reject without a file, and every success/failure terminates the private worker. Reused packet buffers and one Blob per channel/strip reduce allocations without changing file bytes. No worker/file/pixel capability is exposed to isolated scripts/plugins or REST, and no public option/schema changes. Source/output/reader memory and residual native-frame delays remain real limits; this is not a universal responsiveness guarantee.

## RAW input and development (trusted browser application code)

`await editor.inspectRaw(file: File, image: number = 0, control: RawImportControl = {}): Promise<RawImportReport>` inspects one native sensor image without changing document/assets/selection/history. Image is a nonnegative uint32 index; invalid indices, out-of-file image selection, malformed/unsupported native input, missing worker/codec, abort and throwing progress callbacks reject. Control accepts `signal?: AbortSignal` and `onProgress?: ({phase: "inspecting" | "developing" | "encoding", fraction: number | null}) => void`. Native inspection progress is indeterminate. RAW inspection also owns a full-input native buffer, so queued inspection/development holds only the original Blob and starts no worker/native heap until admitted. Cancellation remains live through asynchronous result validation.

The strict version-1 report contains `nativeVersion`, `make`, `model`, `decoder`, `cfaDescription`; `rawWidth/rawHeight`, visible `width/height`, oriented `displayWidth/displayHeight`, native `flip` (0–7); `imageCount/image`; sensor `channels` (1–4), `filters`, `dngVersion`, `foveon`, `bitDepth` (1–64 or null when unknown), `blackLevel/whiteLevel`; `hasCameraWhiteBalance`, `hasColorMatrix`, `hasExtraSamples`, `nativeWarnings`, `canDevelop`, `unsupported` and `warnings`. `canDevelop` describes available metadata/calibration/representation, not proof of a valid payload, all camera instructions or sufficient memory. Unsupported extra-sample coverage and missing camera calibration reject development instead of becoming opaque/untagged output. Missing camera WB requires an explicit alternative for color data.

```ts
// Trusted browser embedding code with a user-selected File, not a Scripts recipe.
const report = await editor.inspectRaw(file, 0, {signal: abortController.signal});
console.log(report.make, report.model, report.displayWidth, report.displayHeight);
if (!report.canDevelop) console.log(report.unsupported);
```

`await editor.openRaw(file: File, options: RawDecodeOptions = {}, control: RawImportControl = {}): Promise<Readonly<RawImportReport>>` develops the selected sensor image at native resolution and opens a clean document (revision/history zero) containing a shared smart-object master. Existing edited tabs stay open. `options` is strict: `allowPrecisionLoss` defaults false and must be true; `development` defaults to `{image:0, whiteBalance:"camera", demosaic:"ahd", exposure:0, highlightPreservation:0, highlights:0, multipliers:{red:1,green:1,blue:1}}`. White balance accepts camera/auto/daylight/custom; demosaicing accepts linear/vng/ppg/ahd/dcb/dht/aahd; exposure is finite -2…3 EV, preservation 0…1, highlight mode integer 0…9, custom multipliers each 0.01…64. Missing color-camera WB requires an explicit alternative. Inspection alone does not consent to working-output conversion.

`new RawDevelopment(options: RawDevelopOptions = {})` is an immutable value with those development defaults and strict ranges; `toJSON()` returns an independent normalized settings copy. For an attached smart object, `await layer.getRawDevelopment(): Promise<RawDevelopment | null>` reads its accepted settings (null for ordinary sources). Trusted hosts with an asset store also have the synchronous `layer.rawDevelopment` convenience getter; isolated scripts must use the awaited method, and that getter rejects there with an explanation. `await layer.developRaw(value: RawDevelopment, control: RawDevelopmentControl = {}): Promise<Readonly<RawImportReport>>` requires a configured native host or isolated preparation bridge, explicit `control.allowPrecisionLoss: true`, and optionally the same AbortSignal/progress callback. It rejects plain objects, detached layers, missing originals, synchronous transactions, unavailable native codecs, stale/disposed/superseded document sessions, removed/replaced/closed source assets and any locked dependent instance/ancestor. It validates the retained original and output hashes before native work, stages a new accepted PNG privately, then replaces the master through one `Develop RAW` transaction. All instances update; layer placement, normalized instance extent, masks and effects remain. Undo/redo use accepted pixel assets without re-development. A different selected sensor image may change master dimensions while preserving instance extent.

<!-- example: raw-browser-development -->
```ts
// Trusted browser module code; these file services are not isolated Script globals.
import {RawDevelopment, SmartObjectLayer} from "../src/dom";
await editor.openRaw(file, {allowPrecisionLoss: true});
const image = editor.document.layers.at(0);
if (image instanceof SmartObjectLayer) {
  await image.developRaw(new RawDevelopment({exposure: 0.75}), {
    allowPrecisionLoss: true, signal: abortController.signal,
  });
}
```

The image asset retains accepted PNG bytes plus a frozen `raw` record: complete original Blob/name/MIME/byte length/SHA-256, normalized consent/settings, accepted native report, decoder WASM SHA-256 and accepted-output SHA-256. Hashes validate content relationships/corruption, not photographic fidelity or authorship. Native project container v4 deduplicates original blobs across current/history outputs; non-RAW projects still use v3. Readers retain v1–3 compatibility; older readers reject v4 rather than silently flattening it. Workspace encoding, recovery digests, asset sharing/cross-document transfer and source-bearing recipe package v2 and brush preset/pack v6 retain both byte streams and settings. Opening a saved RAW project decodes its accepted PNG without the RAW codec. Broader photographic/quality gates remain outstanding. Direct RAW batches are described below. Semantic RAW development recipes are described below. The isolated and separate REST development contracts follow below. Internal development retains linear RGB16, checks native error/geometry/copy/corruption results and uses explicit consent before producing the current RGBA8 sRGB working PNG. It does not use the embedded JPEG preview. Full-input/full-plane native memory, WASM address space and native format geometry remain limits, separate from original source resolution; no arbitrary MP/file-size cap is introduced. Physical camera/color/quality, broad DNG/codec coverage, F10 high-precision/HDR composition and broader F12/F14 acceptance remain open. No isolated file/worker/pixel/network/plugin privilege or REST renderer/session synchronization is added.

## Recorded RAW lens and shooting metadata

Native inspection and development reports now include optional `shooting: RawShootingMetadata`. This immutable version-1 DTO contains `lensMake` and `lensModel` (bounded native strings; empty means unknown), and nullable positive finite `focalLength` (mm), `focalLength35mm` (recorded 35 mm-equivalent mm), `aperture` (f-number), `exposureTime` (seconds), and `iso`. Values retain the native float32 precision. Missing, nonpositive or non-finite native declarations become null; a missing lens maker is not inferred from the camera maker. Unsupported private wire versions and malformed reply values reject before publication. The native wire protocol is now 2; the public report stays version 1 and older saved reports remain readable without injected fields.

These values are extracted declarations, not verified measurements, calibrated sensor geometry or automatic lens-profile selection. Do not infer a calibrated crop factor from a rounded 35 mm-equivalent focal length. Lens/camera database matching, calibration interpolation and correction models still require their own acceptance. The review dialog's Recorded lens and exposure disclosure formats values for reading; unknowns stay explicit. The DTO adds no serial number, location or timestamp fields; complete retained originals still contain their original metadata.

Trusted `inspectRaw`, independent REST inspection/development, isolated `developRaw` results and native batch review/prepared projects carry the same report. Reports stay read-only and inspection changes no document/assets/history. Accepted metadata remains with original/working assets through project/workspace/recovery/recipe/brush/copy/batch transport and decoder-independent reopening/undo. No new isolated file/network/decoder privilege or browser/REST synchronization is added. Original pixels, geometry and development settings are unchanged by reading these declarations. See the [pinned native fields](https://www.libraw.org/docs/API-datastruct-eng.html) and checked build manifest for the source of each value.

<!-- example: raw-shooting-metadata -->
```js
const image = document.selectedLayer;
if (!(image instanceof SmartObjectLayer)) throw new Error("Select a RAW smart object.");
const current = await image.getRawDevelopment();
if (!current) throw new Error("This image has no retained RAW original.");
const report = await image.developRaw(current, {allowPrecisionLoss:true});
print("Recorded lens:", report.shooting?.lensModel || "Unknown");
print("Recorded focal length (mm):", report.shooting?.focalLength ?? "Unknown");
```

This example performs native development and commits one ordinary RAW master update. For read-only inspection, trusted hosts use `editor.inspectRaw(file)` and REST clients use `raw-inspect`. Isolated scripts retain the existing document/assets grants, five-second deadline and atomic commit.

## RAW lens correction

`new LensCorrection(options: LensCorrectionOptions = {})` constructs an immutable version-1 manual calibration value. It reads no files/pixels. `toJSON()` returns an independent copy. `new RawDevelopment({...settings, lens: new LensCorrection(options)})` accepts that value or its strict DTO; omission preserves the previous no-correction behavior without injecting a lens field into legacy settings. `enabled` defaults true; false retains parameters while bypassing processing. Other defaults/ranges are: `center:{x:.5,y:.5}` (each 0–1), `scale:1` (.1–10), `distortion:{k1:0,k2:0,k3:0}` (each -1–1), `chromatic:{red:1,blue:1}` (each .5–2), `vignette:{k1:0,k2:0,k3:0}` (each -1–1). All numbers must be finite; unknown keys and unsupported versions reject. Settings use oriented native image coordinates, not canvas placement or viewport pixels.

The radial mapping samples the distorted source for each undistorted output: with `u=(x+.5-width*center.x)/(min(width,height)/2*scale)` and analogous `v`, `r2=u*u+v*v`, multiply `(u,v)` by `1+k1*r2+k2*r2²+k3*r2³`, then by the half-side normalization. Red/blue scales multiply those source offsets; green remains the reference. Vignette attenuation `1+k1*t+k2*t²+k3*t³` uses source pixel squared radius divided by one quarter of `width²+height²`. Divide native linear RGB16 by attenuation before bilinear sampling, normalize valid neighbor weights, round/clamp once to UInt16, then apply the existing sRGB transfer. Coverage is the minimum valid bilinear weight across channels; fully transparent output has zero RGB. Native dimensions are retained. Scale >1 crops the field of view without resizing the source. These normalized manual coefficients are not interchangeable with arbitrary camera/Lensfun profile coefficients without calibration conversion. The underlying [radial model](https://docs.opencv.org/4.6.0/d9/d0c/group__calib3d.html) and [vignette/coordinate conventions](https://lensfun.github.io/manual/latest/group__Lens.html) guide the supported model; automatic profile lookup/import, tangential/fisheye models and camera matching remain unfinished.

Exact cubic extrema checks reject a folded radial mapping or nonpositive attenuation anywhere across the image footprint. The review dialog reports those errors before enabling Preview/Apply/Queue; workers validate native geometry before demosaicing. Private worker sampling copies native RGB16 regions through an 8 MB tile cache, plus bounded output rows; the native decoder still owns its full input/processing plane and actual memory/format limits. Border coverage is generated by correction; this does not add support for original RAW extra-sample channels. Existing node/worker, abort/callback, source/selection/revision/session, lock, grant and final asset/command checks remain. Invalid work publishes no partial pixels or history.

The same optional `development.lens` DTO works with trusted import/development, isolated Scripts/plugins, independent REST RAW options, `raw.develop` recipes and reviewed RAW batch sources. Source/accepted settings and bytes persist through existing project/workspace/recovery/recipe/brush transports; old no-lens files remain readable and unchanged. Older strict readers reject unsupported lens settings instead of flattening them. Undo/redo and prepared-scene retry reuse accepted pixels without the decoder. Working composition remains sRGB8; partial-alpha canvas readback retains browser premultiplication rounding limits. This is not camera-specific physical fidelity, a high-precision compositor or full F12 acceptance.

<!-- example: raw-lens-development -->
```js
const image = document.selectedLayer;
if (!(image instanceof SmartObjectLayer)) throw new Error("Select a RAW smart object.");
const current = await image.getRawDevelopment();
if (!current) throw new Error("This image has no RAW original.");
await image.developRaw(new RawDevelopment({
  ...current.toJSON(),
  lens: new LensCorrection({center:{x:0.48,y:0.52},scale:1.1,
    distortion:{k1:-0.06,k2:0.008,k3:0.001},
    chromatic:{red:0.998,blue:1.002},vignette:{k1:-0.15,k2:0.03}})
}), {allowPrecisionLoss:true});
```

### Calibrated LensProfile values — workflow in implementation

Trusted `editor.openProject(file)` also restores a native file's optional validated retained history, using the same history admission as workspace restoration. Normal `saveProject()` still emits the current snapshot without history. Trusted `serializeProject(document, assets, history)` and the separate REST `project?history=true` can explicitly include it. Reopening those files retains accepted old/new pixels for ordinary undo/redo without loading a sensor or lens decoder; malformed retained history rejects before changing artwork.

`new LensProfile(options: LensProfileOptions)` is a pure immutable calibration value, available from the public DOM and in isolated Scripts/plugins. `toJSON(): LensProfileData` returns an owned normalized copy. `profile.correction(options: LensProfileCorrectionOptions): LensCorrection` requires positive finite float32-representable `focalLength` (mm) and camera `cropFactor`; neither is inferred. `distortion` and `chromatic` default to whether a non-`none` calibration exists; `vignette` defaults false. Explicit false disables a family. `aperture` defaults null (unknown); vignetting requires a supplied positive aperture. `focusDistance` defaults null, explicitly selecting infinity; positive values use meters. `scale` defaults 1 (.1–10) and `enabled` defaults true. The complete definition and selected parameters serialize under optional `development.lens.profile`. Mixing a profile with non-neutral manual coefficients or a manually overridden center rejects, including disabled settings. Construction performs no parsing, file access or native work.

The strict definition has `version:1`, `model` (required nonempty label), `maker:""`, `type:"rectilinear"`, `mounts:[]`, `aliases:[]`, `center:{x:0,y:0}` (each -1–1, Lensfun optical-center coordinates), `focalRange:{min:0,max:0}` (zero means unknown), and 1–128 `calibrations`. Each calibration has positive `cropFactor`, `aspectRatio` >=1 (default 1.5, landscape ratio), and optional `distortion:[]`, `chromatic:[]`, `vignette:[]`. There must be 1–50,000 total calibration metadata points. Duplicate float32 frame/family/focal/exposure coordinates and mixed non-neutral models within one frame/family reject. These are metadata/job budgets, independent of original image dimensions.

| Family | Supported point records; all numerical terms must be finite float32-representable |
| --- | --- |
| Distortion | `{model:"poly3",focalLength,terms:[k1]}`, `poly5` with `[k1,k2]`, or `ptlens` with `[a,b,c]`; optional positive `realFocalLength` follows Lensfun. |
| Chromatic | `{model:"linear",focalLength,terms:[kr,kb]}` or `poly3` with `[vr,vb,cr,cb,br,bb]`; the first two terms must be positive. |
| Vignette | `{model:"pa",focalLength,aperture,focusDistance,terms:[k1,k2,k3]}`; all point coordinates are positive. |

Distortion/chromatic may also retain `{model:"none",focalLength,terms:[]}` declarations, which do not supply an active calibration. Optional source provenance is `{name,sha256,index,notices?}` with a lowercase SHA-256 and a nonnegative integer profile index. Unsupported versions, fields, projection/fisheye/ACM models, non-finite/underflowed/overflowed native parameters and missing requested families reject. This is a self-contained calibration DTO, not an arbitrary XML or code execution interface.

Private browser/Node workers use pinned Lensfun `b98997f7f1c020d0fac3136c2abbf06126385971` correction and interpolation through checked WASM. Actual library cohort selection, Hermite interpolation, native model rescaling and real-focal preservation apply; these coefficients must not be copied into the manual radial fields. Original orientation flips transform the optical center. Geometry/admission is checked before sensor demosaicing; unsupported crop/coverage, folded mappings and nonpositive attenuation reject without publishing assets/history. Monochrome RAW rejects requested chromatic correction. Native float32 coordinates and source-position vignette gains feed float32 corrected source samples, then float64 bilinear interpolation, one UInt16 clamp/round and the existing sRGB8 transfer. Absolute pixel evaluation makes region partitioning invariant; coordinate blocks and the 8 MB source/gain tile cache are separate from the decoder's full input/processing plane. Native dimensions remain unchanged; transparent coverage and browser partial-alpha rounding follow the manual contract above.

Active profiles require a validated `raw.lensWasmSha256` alongside the independent `nativeWasmSha256`; disabled profiles retain their tables without loading the lens native module or adding that identity. Original/accepted hashes, permissions, revisions, locks and atomic commits remain authoritative. Project/history/workspace/source transports retain the complete definition so accepted pixels reopen without a database or native re-development. The existing RAW dialog exposes accepted profile parameters/family toggles and an explicit switch to manual correction; invalid drafts disable actions. It does not yet offer XML/database import, a persistent profile catalog or automatic camera/lens matching. Recipe preflight is provisional for native profile geometry; actual asynchronous preparation validates before commit. Separate REST `raw-develop` accepts up to 16,000,000 bytes of JSON metadata for complete profile tables. For tables larger than an HTTP header, first import the original normally, then send profile settings in that JSON request. This metadata budget does not limit the binary original. Scripts keep the existing five-second deadline/command/asset budgets, with no file/native handle/network privilege.

The following synthetic calibration exercises the API; it is not a physical lens recommendation. Replace the definition and explicit geometry with measured calibration for real photographs. Vignetting is intentionally disabled by default.

<!-- example: raw-profile-development -->
```js
const image = document.selectedLayer;
if (!(image instanceof SmartObjectLayer)) throw new Error("Select a RAW smart object.");
const current = await image.getRawDevelopment();
if (!current) throw new Error("This image has no RAW original.");
const profile = new LensProfile({
  model: "Calibration example 35 mm",
  calibrations: [{cropFactor:1.5, aspectRatio:1.5,
    distortion:[{model:"poly3",focalLength:35,terms:[-0.02]}]}]
});
await image.developRaw(new RawDevelopment({
  ...current.toJSON(),
  lens: profile.correction({focalLength:43,cropFactor:1.5,scale:1.05})
}), {allowPrecisionLoss:true});
print("Calibrated correction accepted");
```

Physical lens/camera quality, broader models, XML/catalog/matching workflows, precision/merge/performance/device acceptance and the full roadmap remain open. See the dated implementation record for checks actually run. [Upstream model contracts](https://lensfun.github.io/manual/latest/group__Lens.html) and [pinned source](https://github.com/lensfun/lensfun/tree/b98997f7f1c020d0fac3136c2abbf06126385971) describe the native coordinate/interpolation implementation.

## RAW development recipes (trusted browser host)

`editor.recipes.compilePlan(recipe, params = {})` validates a `raw.develop` action against the selected target's retained original and normalized native options without decoding or changing assets/history. Its `development` fields accept the RAW settings above and parameter expressions. Omitted fields use `RawDevelopment` defaults; this replaces settings rather than patching the previous accepted values. The action requires literal `allowPrecisionLoss: true`. Targets must resolve to attached RAW smart objects. Shared instances are developed once per master per step, with every dependent instance/ancestor lock checked. Dry-run geometry for another sensor image is provisional until native decoding validates that image.

`await editor.recipes.executeAsync(recipe, params = {}, control: RawImportControl = {}): Promise<ExecuteRecipeResult>` prepares native output privately, validates the actual geometry and complete ordinary command sequence, then commits the whole recipe once. Control supports AbortSignal and native progress callbacks. Invalid preflight returns `{success:false,plan,error}` before native work; native failure, abort/throwing callbacks, changed selection/revision/session, disposed assets or removed/replaced/closed source records likewise return failure without publishing private outputs or other staged edits. Accepted pixels/originals persist and undo/redo need no decoder. Existing synchronous `execute(recipe, params)` remains available for ordinary recipes and explicitly refuses RAW actions before making changes.

The recorder translates supported RAW master replacements into target-relative settings, retaining no source asset/component IDs or sensor bytes in that semantic step. Display labels may retain the recorded layer name; they do not resolve the replay target. Thus replay develops the receiving document's original. Other artwork-bearing steps still require portable source packages. Portable package execution also prepares imports/native results privately before one final commit; `editor.recipes.executeRecipePackage(file, params = {}, control: RawImportControl = {})` accepts the same optional controls and rejects on failure. The recipe dialog reports native progress, offers Cancel preparation and aborts preparation on close/Escape. Source-free RAW recipes can be saved/imported as JSON or a package. Installation/import never executes them. These are trusted host services; isolated Scripts/plugins retain the narrower methods and grants below, and REST sessions remain separate.

<!-- example: raw-development-recipe -->
```js
const recipe = {
  schemaVersion: 1, id: "raw-exposure", name: "Develop target original",
  description: "Develop the selected RAW source", version: 1,
  parameters: [{name: "ev", label: "Exposure", type: "number", default: 1.25, min: -2, max: 3}],
  steps: [{id: "develop", name: "Develop RAW", target: {role: "selected"},
    action: {type: "raw.develop", allowPrecisionLoss: true,
      development: {exposure: "${ev}", highlightPreservation: 0.5}}}]
};
const result = await editor.recipes.executeAsync(recipe, {ev: 1.25});
if (!result.success) throw new Error(result.error);
```

## Direct RAW batches (trusted browser host)

`await editor.batch.prepareRawSource(file: File, options: RawDecodeOptions = {}, control: RawImportControl = {}): Promise<BatchSourceInput>` requires explicit `allowPrecisionLoss: true`, inspects the selected sensor image with the actual native worker and hashes the complete original. It returns original Blob/name/MIME/extent/hash and native-size geometry with a strict `raw: {version:1, originalName, options, report}` review record. That record describes source preflight, not accepted pixels. Unsupported settings, missing camera WB, native/codec failures, abort and throwing progress callbacks reject. It does not install document assets or develop a preview. Queue review offers the same exact settings/preview controls as host import; Preview develops real sensor data privately.

`await editor.batch.createBatch(config, sources)` clones source/settings/recipe inputs, verifies RAW inspection and original hashes before atomically persisting the run plus complete original files. Recognized RAW files without review/consent reject. `config` retains the existing required `name` and `budgetId` strings and optional variants/recipe/parameters/concurrency settings. Local deterministic processing estimates zero provider cost and requires no spending approval or account; positive-cost work still requires the existing human-approved budget. Invalid recipes, negative/non-finite costs and unsupported AI actions reject before workers start.

`await editor.batch.start(runId)` starts asynchronously; `await editor.batch.waitForRun(runId)` waits for a terminal state. Native RAW output becomes an asset-backed OO smart object in an independent staging document. Normal semantic recipes and portable recipe packages run against that original; the visible editor/model/history/assets stay unchanged. The runner atomically persists a checksummed editable project and its input fingerprint before publishing the first variant. Projects retain complete sensor originals, native accepted pixels/settings and the pre-recipe state when changed. `item.preparation` contains version 1, SHA-256, byte length and input SHA-256; the Blob is private durable storage, not JSON/base64.

Retry/reload verifies original bytes, the prepared project, source/options/recipe/parameter identity and existing delivery hashes. Accepted scenes reopen without the RAW decoder, skip previously completed variants and preserve their identities. Missing/corrupt or mismatched prepared scenes reject without silently re-developing accepted work. Cancellation terminates private native preparation; a cancelled item accepts no late scene/output. Pause retains the existing behavior of finishing active items before stopping further admissions. Native progress arrives through `item_progress` events without per-progress storage writes. Old interrupted work without a prepared scene can develop only when it has no accepted variants.

`await editor.batch.getPreparedProject(runId, itemId): Promise<Blob>` verifies and returns that editable `.luma` file, or rejects if missing/corrupt/mismatched. Review exposes Download editable RAW project. Existing `exportDeliveryPackageZip(runId, options?)` also includes each prepared RAW project in `projects/` and `raw-preparation.json`: format `canoli-raw-batch`, version 1, batch ID and source/settings/project identities, plus SHA-256 over the compact index before its integrity field. The existing delivery manifest stays version 2; ordinary packages keep their existing contents. These are local downloads containing full sensor originals, not cloud uploads. Batch storage database version 2 protects prepared-project references during cleanup/deletion; an older open tab blocking upgrade gives an actionable error, and legacy sources/results are preserved. Actual browser/native/Blob/IndexedDB quota, full-input/full-plane memory and ZIP-format limits remain; no arbitrary original MP/file-size cap is added.

<!-- example: raw-native-batch -->
```js
// Trusted host code supplies a selected camera File as `file`.
const source = await editor.batch.prepareRawSource(file, {allowPrecisionLoss: true});
const run = await editor.batch.createBatch({
  name: "Native RAW delivery", budgetId: "local-processing",
  variants: [{id: "native", name: "Native PNG", format: "png",
    targetWidth: source.width, targetHeight: source.height, fit: "fill"}]
}, [source]);
await editor.batch.start(run.id);
const finished = await editor.batch.waitForRun(run.id);
if (finished.status !== "completed") throw new Error(finished.items[0].error);
const project = await editor.batch.getPreparedProject(run.id, finished.items[0].id);
```

These are trusted browser services. Isolated Scripts/plugins gain no file, Blob, batch, export or worker capability; REST documents remain independent. This connected native workflow does not establish photographic camera/profile/color fidelity, broader codecs/merges or complete F10/F12/F14/roadmap acceptance.

## RAW development in isolated Scripts and plugins

`RawDevelopment` is available as a pure constructor in the Scripts runtime. `await image.getRawDevelopment()` reads normalized settings through the host and returns a new immutable value or null. `await image.developRaw(new RawDevelopment(options), {allowPrecisionLoss:true})` stages native output privately. Pass an attached asset-backed `SmartObjectLayer`; no File, Blob, bitmap, worker, decoder or host application object is exposed. Signal/progress callbacks are trusted-host controls; isolated callers use Scripts-panel Stop and must not pass them. The current 5-second script deadline, 256-command and 32-private-repair-asset budgets remain, including mixed RAW/patch/heal/matting/rasterization work. Await each native preparation. Native allocation/format/precision/WB failures reject; high-resolution development may exceed the script deadline on a device without changing its source resolution.

<!-- example: raw-isolated-development -->
```js
const image = document.selectedLayer;
if (!(image instanceof SmartObjectLayer)) throw new Error("Select a RAW smart object.");
const current = await image.getRawDevelopment();
if (!current) throw new Error("This image has no retained RAW original.");
await image.developRaw(new RawDevelopment({
  ...current.toJSON(), exposure: 1.25, highlightPreservation: 0.5,
}), {allowPrecisionLoss: true});
print("RAW exposure developed");
```

Plugin metadata reading requires currently granted `document:read` and `assets:read`. Development additionally requires `document:write` and `assets:write`. These are existing v2 permissions, not new file/network capabilities. Installation remains inert. The host replays preceding staged commands against the script snapshot, checks every dependent lock, validates native output/geometry, retains private original/pixel ownership, and rechecks current grants, document/revision/session and original source identity/bytes/geometry/bitmap before final commit. Native replies contain validated master definitions/reports, not source bytes. Staged RAW edits and other script commands publish in one outer undo transaction only after successful script completion; exceptions, Stop/timeouts, revocation, source changes or human edits discard preparation. Undo/redo and saved projects use accepted pixels. This does not synchronize separate headless REST sessions with the browser.

## AVIF input preflight (trusted application code)

`await editor.inspectAvif(file: File, control?: AvifImportControl): Promise<AvifImportReport>` inspects an immutable local AVIF without changing the document, assets, selection or history. `control` defaults to `{}` and accepts `signal?: AbortSignal` and `onProgress?: ({phase: "inspecting" | "decoding", fraction: number | null}) => void`; inspection emits `inspecting` with indeterminate progress. An aborted signal, worker/load/message failure, malformed container or throwing callback rejects and releases the private worker. Valid unsupported formats return `canDecode: false` and explicit `unsupported` reasons; a missing primary item or invalid table is a malformed-input rejection.

The report has `version: 1`, `primaryItem`, native `width`/`height`, cropped/oriented `displayWidth`/`displayHeight`, `bitDepth` (8/10/12, or `null` for an unsupported derived type whose precision is unknown), `alpha`, `grid`, `crop: {x,y,width,height}`, anticlockwise quarter-turn `rotation` (0–3), HEIF `mirror` (`null`, 0 top/bottom exchange, 1 left/right exchange), `color: {kind,primaries,transfer,matrix,fullRange}`, `requiresPrecisionLoss`, `requiresColorAssumption`, `canDecode`, `unsupported` and `warnings`. Color kind is `srgb`, `display-p3`, `linear-srgb`, `icc`, `unspecified` or `unsupported`; unidentified CICP fields are `null`. A true `canDecode` describes supported metadata, not proof of a valid AV1 payload or available codec/device memory. HDR transfer functions are not silently tone-mapped. A report is not a grant of file/script/plugin permissions.

```ts
// Trusted embedding code with a user-selected File; this is not a Scripts recipe.
const report = await editor.inspectAvif(file, {signal: abortController.signal});
console.log(report.displayWidth, report.displayHeight, report.warnings);
if (!report.canDecode) console.log(report.unsupported);
```

`await editor.openAvif(file: File, options: AvifDecodeOptions = {}, control: AvifImportControl = {}): Promise<Readonly<AvifImportReport>>` opens the supported primary image as a new native-resolution raster document. Options are strict `{allowPrecisionLoss?: boolean, assumeSrgb?: boolean}`, both default false; unknown fields and non-boolean values reject. 10/12-bit input requires `allowPrecisionLoss: true` for conversion to RGBA8 editing. Unidentified container RGB requires `assumeSrgb: true` before decoding. These choices are never inferred from prior imports. Picker/drop/recent-file and brush-texture dialogs offer the same explicit review.

Preparation owns a private AssetStore and decoder. Success installs an OO Document/RasterLayer at revision zero with empty undo history, retaining existing edited documents. Supported integer crop, rotation and mirror are applied without resampling to the derived bitmap. Asset/layer/document dimensions describe this presentation; report `width`/`height` retain the encoded extent. The complete original AVIF Blob is kept separately from the derived PNG/ImageBitmap. Its normalized frozen `avif: {allowPrecisionLoss, assumeSrgb}` choices survive project/workspace/history/recovery/recipe/brush-pack persistence and cross-document copies. Derived frozen `asset.avifReport` is reconstructed on decode, rather than persisted. Recovery hashes cover choices; missing AVIF settings or settings on another source format reject.

The read-only report describes container properties and cannot prove the AV1 payload's color before decoding. When those properties are unidentified, opening requires fallback consent first, then checks actual native color. Identified sRGB/Display P3/linear-sRGB takes precedence over an assumption, updates the returned report and receives appropriate PNG identification for browser color conversion. Still-unidentified RGB uses the explicit sRGB fallback. PQ/HLG found in either container or AV1 stream rejects, including ICC-bearing cases; fallback consent cannot relabel known HDR. This does not provide HDR tone mapping or a wider high-precision editing pipeline.

```ts
// Trusted embedding code with a user-selected File and explicit user choices.
const opened = await editor.openAvif(file, {
  allowPrecisionLoss: userAccepted8BitConversion,
  assumeSrgb: userAllowedUnidentifiedColorFallback,
}, {
  signal: abortController.signal,
  onProgress: progress => console.log(progress.phase, progress.fraction),
});
console.log(opened.displayWidth, opened.displayHeight, opened.color.kind);
```

Malformed/unsupported input, absent consent, worker/codec load or native decode/allocation errors, invalid result geometry, browser bitmap failure and throwing progress callbacks reject without publishing a prepared document or asset. The original owner/session/revision/source lifetime and I/O generation must still match. A human edit, new active document, superseding AVIF open or disposed editor cancels pending preparation, including queued decoding. `signal` cancellation stops private workers and discards late results; callbacks' own authored edits are not rolled back. Progress uses `inspecting` (indeterminate) and `decoding` (fraction or null); close/Cancel/Escape remain available in the UI.

Full-frame native input decoding is serial per application context. Queued requests retain original immutable Blobs without a decoder worker or full decoded plane; abort removes a waiting request. This is separate from the AVIF export admission queue and does not impose a megapixel/file-size cap or establish a total process-memory bound. Native codec address space, compressed input/full decoded planes, browser ImageBitmap/canvas allocation and device memory remain real limits. Sequence/timeline content, unsupported derived items/properties, unresolved color and unsupported fractional crop/sample transforms reject with explicit reasons.

These are trusted file services, not isolated Scripts/plugin methods or document commands. `editor.importImage(file)` retains its existing single-argument API: default-compatible AVIF can be placed as a layer; sources needing consent must be prepared through the explicit host import workflow. Isolated commands can reference already installed ordinary assets under existing validation. REST sessions remain separate headless documents and gain no AVIF decoder/upload/renderer route, file privilege or browser synchronization.

Before generic browser decoding, a bounded top-level box/brand scan rejects AVIF bytes declared as PNG/JPEG/WebP/TIFF. This prevents MIME relabeling from bypassing precision/color review; it is routing protection, not proof of a valid AV1 payload. The scan reads box headers and at most the 4 KiB file-type table, skipping compressed image payloads, with the same 16,384-box metadata budget as inspection.

## AVIF export (trusted application code)

`await editor.export({format: "avif", quality?: number, avifLossless?: boolean, avifSpeed?: number}, control?): Promise<ExportResult>` returns one flattened native-resolution still image with `mimeType: "image/avif"`, `extension: "avif"` and a capability report. Quality is finite 0.01–1, default 0.8; `avifLossless` is boolean, default false; speed is an integer 0–10, default 8 (0 takes longest, 10 is fastest). Lossless mode or quality 1 preserves the captured RGBA8 samples exactly. Other qualities compress colour lossily; alpha is always lossless. The Export dialog offers quality 1–100%, Lossless AVIF, and Fast/Balanced/Smaller file compression choices (speeds 8/6/4).

The native compositor captures the same bounded grid as PNG, including affine layers/groups, masks, paint, text, effects, smart filters and adjustment/backdrop order. A private single-thread worker encodes with the locally served, pinned jSquash AVIF/libavif WASM codec. Output uses 8-bit YUV444 colour and an explicit nclx sRGB identifier (primaries 1, transfer 13); lossless colour uses the identity matrix. This does not embed source ICC profiles or provide wide-gamut/HDR/CMYK/high-precision conversion. The report discloses flattened editability, compressed colour in lossy mode, omitted source/authored metadata, font files, saved channels and animation. Save a native project for original files and editable layers.

Host controls use `{signal?: AbortSignal, onProgress?: callback}`. Rendering fractions count completed native regions; encoding is indeterminate. One full capture/codec job runs per application context; waiting jobs allocate no full RGBA plane. Capture pins an immutable document snapshot and visible raster/clone/patch/bitmap-mask/master sources plus relevant registered fonts before the first callback. Later ordinary document edits do not change output. Removed/replaced/closed referenced sources, a disposed store, pending/changed referenced fonts, invalid settings, worker/load/encoding/malformed-result failures, cancellation and throwing callbacks reject without publishing a file. Relevant source/font lifetime is checked while the codec runs. Abort terminates the private worker; native rendering already executing remains cooperative. All outcomes release native tiles, the worker and the capture lease; a later retry starts a fresh encoder.

AVIF requires a full native RGBA frame plus codec working memory, unlike streamed PNG/TIFF. No original is downsampled and no megapixel/file-size import cap is added. Native signed-integer codec geometry, browser allocation, WASM memory and viewer support remain actual limits; allocation/codec failures reject explicitly. Large-source functional evidence is not a whole-process memory or sustained responsiveness guarantee. The host validates the returned still-AVIF container, dimensions, 8-bit planes, required alpha and colour identifier; it does not decode every exported AV1 bitstream. Independent browser tests decode actual output with Pillow/libavif. Browser viewers may apply colour conversion and premultiplied-alpha rounding; native canvas appearance is measured separately from exact stored RGBA samples.

Trusted integration example (not runnable in isolated Scripts):

```ts
const result = await editor.export({
  format: "avif", avifLossless: true, avifSpeed: 8,
}, { signal: controller.signal });
// The trusted host chooses how to deliver result.blob after reviewing result.report.
```

Scripts/plugins retain their existing isolation: no encoder, pixel/file/download/network privilege or REST renderer is added. The following maintained Scripts example creates ordinary editable artwork; close Scripts and choose **Export… → AVIF → Lossless AVIF** to download it:

<!-- example: avif-composition -->

```js
document.resize(2081, 160);
const paint = document.layers.add(new PaintLayer({ name: "AVIF artwork" }));
paint.strokes.add(new PaintFill({
  bounds: { x: 1900, y: 20, width: 180, height: 120 },
  color: "#804020", opacity: 0.5,
}));
document.layers.add(new TextLayer({
  name: "AVIF caption", text: "Canoli Studio",
  fontFamily: "monospace", fontSize: 28, x: 1910, y: 60,
}));
print("AVIF composition ready");
```

Trusted `editor.batch.createBatch(config, sources)` delivery variants also accept `format: "avif"`, optional `quality`, `avifLossless` and `avifSpeed` with the same defaults/validation. AVIF-only settings on other formats reject. `quality` is also accepted for JPEG/WebP (their batch default remains 0.92); PNG quality rejects. Existing target geometry and cover/contain/fill rules apply. The fitted renderer pins the real source document while capturing target-sized pixels; originals and editor history remain untouched. The Batch dialog exposes AVIF in custom variants with quality/lossless/compression controls. Configuration snapshots, output hashes, persisted blobs, review, resume/retry and integrity-checked delivery ZIPs retain the existing batch contract. Cancelling a run aborts in-flight AVIF encoding and publishes no partial deliverable; the full frame/codec lease is shared with ordinary export. These are trusted local batch methods, not isolated script methods or live browser REST synchronization.

## PDF export (trusted application code)

`await editor.export({format: "pdf", pdfDpi?: number}, control?): Promise<ExportResult>` returns `application/pdf`, extension `pdf`, as one PDF 1.7 raster page. `pdfDpi` defaults to 72 and must be a positive finite number. DPI changes physical page size (`document pixels / DPI` inches) without resampling or changing document geometry/history. The dialog provides 1–1,000,000 DPI entry and a physical-size preview. Invalid settings, nonrepresentable physical pages, native allocation/encoding failures and cancellation reject without a file. The capability report explains physical-page errors so users can change DPI while retaining the document. Large physical pages use UserUnit scaling (MediaBox dimensions at most 14,400, UserUnit at most 75,000); viewer compatibility remains a real constraint, not an import-size cap.

The native compositor renders the same bounded grid as PNG, including masks, text, affine groups, paint, smart filters and adjustment/backdrop ordering. Row buffers feed lossless RGB/alpha Deflate streams; one image matrix avoids independent tile-placement rounding at non-72 DPI. Output contains a native 8-bit RGB image, a soft mask when nonopaque, the output sRGB ICC and Canoli Studio producer/creator. It has no searchable/selectable text, editable vectors/layers/filters, original files, source/authored metadata, font files, hidden/off-canvas artwork or saved channels. This is not PDF/X, PDF/A, CMYK/spot-color, bleed/trim marks or print-readiness certification. Save a native project for editability and source retention. Other readers may apply different color conversion, scaling and transparency rounding.

`control` uses the existing host-only `{signal?, onProgress?}` contract: rendering fractions count native grid regions, then encoding reports `fraction:null`. Capture pins the immutable model, visible referenced raster/clone/patch/bitmap-mask/master dependencies and relevant registered fonts before the first callback. Document edits after capture do not change output; removed/replaced/closed referenced sources, a disposed store, pending/changed referenced fonts, cancellation or throwing callbacks reject. Unrelated resources may change. Row compression observes cancellation; native rendering/color conversion already in progress cannot be interrupted mid-call. Native tile canvases release on every exit. Compressed output and source bitmaps remain resident; readers may decode full image planes. Row streaming is not a whole-process/reader peak-memory guarantee or disk-backed export.

PDF uses an eight-byte cross-reference offset field and exact safe-integer browser addressing. Synthetic large-offset tests do not establish actual multi-GiB output or universal reader acceptance. This trusted method adds no REST rendering route, isolated script/plugin export/download/file/font privilege or document/project/workspace schema. Scripts can create ordinary artwork for user-initiated export:

<!-- example: pdf-composition -->

```js
document.resize(2081, 160);
const paint = document.layers.add(new PaintLayer({ name: "PDF artwork" }));
paint.strokes.add(new PaintFill({
  bounds: { x: 1900, y: 20, width: 180, height: 120 },
  color: "#804020", opacity: 0.5,
}));
document.layers.add(new TextLayer({
  name: "PDF caption", text: "Canoli Studio",
  fontFamily: "monospace", fontSize: 28, x: 1910, y: 60,
}));
print("PDF composition ready");
```

## TIFF import (trusted application code)

`await editor.inspectTiff(file: File, control?: TiffImportControl): Promise<TiffImportReport>` inspects classic TIFF/BigTIFF in a terminable local worker without opening a document. The report contains `version: 1`, `bigTiff`, `littleEndian` and `pages`. Each page reports its zero-based `index`, raw `width`/`height`, `orientation`, sample `bits`/`samples`, numeric `compression`/`photometric`/`planar`, `hasIcc`, `canDecode`, `requiresPrecisionLoss`, `unsupported` and `warnings`.

`await editor.openTiff(file: File, options?: {page?: number, allowPrecisionLoss?: boolean}, control?: TiffImportControl): Promise<TiffImportReport>` opens one selected page as a new raster document. `page` defaults to 0 and must be a nonnegative safe integer naming an existing page; `allowPrecisionLoss` defaults to false. Unknown option fields reject. The file's TIFF signature is validated independently of its filename/MIME label. The picker/drop workflow shows the report, page choice and explicit 16-bit-to-8-bit checkbox before decoding. Existing edited tabs remain open. The imported document starts at revision zero; subsequent edits use ordinary constructors/commands/history.

Both methods accept `control: {signal?: AbortSignal, onProgress?: (progress: {phase: "inspecting" | "decoding", fraction: number | null}) => void}`. Inspection reports indeterminate progress; decoding reports row completion from 0 to 1. An aborted signal terminates the worker; throwing progress callbacks reject. Missing/unsupported pages, malformed offsets/tables/streams, unsupported profiles, worker failures, browser decoding/allocation failures and a changed/disposed target session reject without publishing a partial document or its assets. Page changes, document edits, replacement imports and tab closure during `openTiff` invalidate the result. Native image decoding already in progress cannot be interrupted mid-call; its result is discarded if cancellation wins.

Supported input: classic/BigTIFF, either byte order, unsigned RGB/grayscale/palette/bilevel samples, raw/LZW/Deflate/PackBits, strips/tiles, chunky/separate planes, horizontal integer prediction, supported associated/unassociated alpha and orientations 1–8. RGB/grayscale 16-bit samples require explicit precision-loss consent and are rounded to 8-bit editing values. Signed/float samples, JPEG/fax codecs, CMYK/Lab/YCbCr and unsupported extra channels reject with the report's reasons. Embedded RGB ICC declarations are passed through the intermediate PNG to browser color management; unprofiled samples are interpreted as sRGB. Broader color/device fidelity is unverified.

`AssetStore` retains the complete original TIFF Blob and immutable `{page, allowPrecisionLoss}` settings separately from the decoded editing bitmap. Original dimensions stay in source coordinates; orientation is a non-destructive affine layer transform, with document dimensions swapped for orientations 5–8. Native projects, workspace/history, recovery checkpoints, cross-document copies and portable recipe assets retain the bytes and decode settings. Only the selected page is editable; TIFF layers/private editing metadata are not reconstructed. Project container 3/workspace 2/document schema 27 are unchanged. Recovery includes decode settings in its source integrity key; older recovery sources without those settings invalidate the checkpoint. Recovery tries an intact prior revision or reports the missing settings without replacing current work or deleting the records; it cannot reconstruct an unrecorded choice.

The parser budgets 256 pages, 4,096 tags per directory and 16 MiB per ICC profile, and rejects addresses beyond exact JavaScript integer addressing. These are parser/metadata budgets, not megapixel/file-size import cutoffs. Pixel decompression streams source rows instead of allocating a complete uncompressed strip; PNG output, decoded bitmaps, active tile/plane codec state, browser color conversion and saving/reopening still consume source-dependent memory. Large files can fail on the actual device. This is local host functionality, not an isolated script/plugin file service or a new REST endpoint.

After importing through the UI, this example runs in Scripts and undoes as one ordinary edit:

<!-- example: tiff-import-edit -->

```js
const source = document.layers.at(0);
if (!(source instanceof RasterLayer)) {
  throw new Error("Import a TIFF page first.");
}
source.adjustments.add(new ToneAdjustment({ exposure: 0.5 }));
document.selectedLayer = source;
print("TIFF source remains editable");
```

## Native TIFF export (trusted application code)

`await editor.export({format: "tiff", tiffVariant?: "auto" | "classic" | "big"}, control?): Promise<ExportResult>` exports one flattened native-resolution RGBA8 image, with lossless Deflate tiles, unassociated alpha and the output sRGB ICC profile. The result uses `mimeType: "image/tiff"` and `extension: "tif"`. It preserves the visible native composition, including masks, adjustment/backdrop ordering, affine groups, paint, text and reachable smart masters. Editable layers, hidden/off-canvas content, saved alpha channels and original sources remain in the native project. Source EXIF/GPS, authored metadata and source font files are not included. Resolution metadata is explicitly 72 DPI without changing pixel dimensions; this is not CMYK, HDR or print-grade color management.

The default `"auto"` chooses classic TIFF when the actual compressed payload plus directory fit its unsigned 32-bit address range; otherwise it chooses BigTIFF. `"classic"` rejects overflow with an instruction to choose Automatic or BigTIFF. `"big"` always writes BigTIFF, even for small images. Unknown variants reject. BigTIFF requires a compatible reader. Image dimensions must be positive safe integers no greater than 0xffffffff per TIFF geometry; those file-format boundaries do not limit document/import resolution. Browser allocation, Blob and exact safe-integer file-address limits can still reject. Real files exceeding 4 GiB have not been validated; automatic boundary tests use synthetic sizes without huge allocations. [LibTIFF's format specification](https://libtiff.gitlab.io/libtiff/specification/bigtiff.html) documents the container distinction.

Export captures the immutable document and referenced asset/font lifetimes before the first progress callback. Source removal/replacement/closure, asset-store disposal, referenced family changes or pending referenced fonts reject instead of returning mixed-generation pixels. Unrelated asset/font changes and later undoable host document edits do not change the captured output. Unreferenced assets, unused masters and hidden-layer sources/fonts do not become dependencies. Referenced registered font descriptors are pinned through encoding; platform fonts unavailable to FontFaceSet cannot be monitored as OS resources.

Rendering yields between tiles and reports `rendering` fractions from 0 to 1, then indeterminate `encoding`. Cancellation is checked around rendering, compression, every callback and final assembly; native rendering/readback calls remain non-preemptible. Storage uses at-most-2048×64 padded tiles and compressed Blob parts. Native sampling uses PNG's same bounded grid and crops only after rendering, preserving seam rounding even for widths that require shorter native strips. There is no document-sized export canvas or full RGBA array. Original decoded sources remain resident, and output Blob data, tile tables and directory memory grow with output size; this is not disk-backed output or a whole-process peak-memory guarantee.

Example for a trusted host adapter, outside Scripts:

```js
const result = await editor.export({ format: "tiff", tiffVariant: "auto" }, {
  signal: controller.signal,
  onProgress: progress => updateExportStatus(progress),
});
// Review result.report, then offer result.blob as a .tif download.
```

This constructor example runs in Scripts. It creates editable artwork for user-initiated TIFF export; it does not give scripts filesystem access.

<!-- example: tiff-composition -->
```js
document.resize(2081, 160);
const artwork = document.layers.add(new PaintLayer({ name: "TIFF artwork" }));
artwork.strokes.add(new PaintFill({
  bounds: { x: 2020, y: 50, width: 60, height: 90 },
  color: "#ff8040", opacity: 0.5,
}));
document.layers.add(new TextLayer({
  name: "TIFF caption", text: "Canoli Studio",
  fontFamily: "monospace", fontSize: 28,
  x: 1820, y: 58, color: "#3060a0",
}));
print("TIFF composition ready");
```

Multipage output, higher precision, editable TIFF layers and general independent-reader/device acceptance remain open F11 work. This host method adds no REST export endpoint or isolated script/plugin export capability. TIFF input has the separately bounded contract above.

## Rendered PSD export (trusted application code)

`await editor.export({format: "psd", psdMode?: "layers" | "flatten"}, control?)` returns the existing `{blob, mimeType, extension, report}` result. `psdMode` defaults to `"layers"`; invalid modes throw. The Export dialog exposes both choices plus Cancel. These are trusted browser-host methods, not sandbox globals or REST routes. Scripts/plugins create editable content through the existing constructors; user-initiated export renders it without granting scripts download/filesystem access.

`"layers"` retains supported nested folders and child pixel records with names, visibility, 8-bit opacity, blend mode and locks. Normal and pass-through group modes remain distinct. User masks are separate editable pixel coverage with enabled state; mask geometry/linkage/density/inversion/feather controls and off-canvas coverage bake. Unstyled group fill folds into exported group opacity; unstyled Normal pixel fill remains separate, while non-Normal pixel fill and its mask bake into pixels. Styled groups retain an outer folder with one rendered child. Plain integer-positioned, untransformed rasters without shadows retain their placed pixel rectangle, including off-canvas artwork. Other text/vector/paint/smart objects/transforms/effects render in document space and clip to the document canvas. They do not become native editable Photoshop text/vector/effect constructs. See [the exact hierarchy/mask contract](#native-photoshop-folder-and-user-mask-export).

An adjustment or enabled Blend If depends on its preceding backdrop. Export merges through the last dependent child in the nearest isolated group scope. Pass-through carries that dependency outward until isolation or the document root. Later independent siblings retain their records. Hidden content inside a merged portion is omitted; independent hidden layers retain pixel content and visibility. Styled groups likewise bake their visible contents, omitting hidden descendants. `"flatten"` renders the current visible composition into one pixel layer; hidden content and separate layer settings are not retained. The capability report states these losses before export. Save `.luma` for full editability.

The merged image is separately rendered through the same native reference compositor used by PNG. Encoding uses bounded native tiles/strips and compressed Blob parts, without allocating a document-sized canvas or RGBA array. The writer emits 8-bit RGB/RLE, sRGB ICC, 72 DPI resolution metadata, Unicode names and merged transparency. Per-layer channels store straight RGBA losslessly; the merged preview stores RGB matted over white, with negative layer count indicating transparency. Recovering straight RGB from this 8-bit preview can amplify rounding at low alpha; layer channels retain their original byte precision. The current fixture gates measure premultiplied error, not universal exact straight-RGB equality. Positive-count files from the earlier Canoli writer are recognized by their `LUMA` ICC CMM identifier together with the earlier container layout and retain legacy straight-alpha decoding. Standard positive-count files treat any extra alpha channel as separate data, not merged transparency. General extra-alpha/advanced Photoshop constructs and wider color fidelity are not established by that compatibility path.

PSD v1 is limited to 30,000 pixels per dimension, 32,767 layer records (including folder headers/dividers), 32-bit section lengths and a 2 GB output file. These are format boundaries, not image-import or document limits. Unsupported dimensions/modes, missing assets, native-size mismatch, device allocation failures and cancellation reject without exposing a partial file. Choose the separately documented PSB export for larger Photoshop documents. Cancellation checks between tiles/strips and before returning; encoding within one strip remains synchronous. Progress counts rendered pixel and mask rows, reports `"rendering"` with a fraction, then `"encoding"` with `fraction: null`. Document/history/source assets are not edited by export.

Example for an application adapter (not the Scripts panel):

```js
const result = await editor.export({ format: "psd", psdMode: "layers" }, {
  signal: controller.signal,
  onProgress: progress => updateExportStatus(progress)
});
// Review result.report; expose result.blob through the application's download UI.
```

The low-level `documentToPsd(documentData, assetResolver, options?)` helper has no browser renderer. It supports only ordinary, unscaled, integer-placed raster records without masks/styles/active tone/erasures, and rejects richer content or missing assets instead of silently omitting it. Use the host export above for rendered documents. Its raw/RLE options remain independent from the host's RLE writer.


For trusted import adapters, `editor.openPsd(buffer, {mode?: "layered" | "flatten", legacyStraightAlpha?: boolean})` and the pure `psdToDocument`/`parsePsd` helpers accept `legacyStraightAlpha`. When absent, it automatically recognizes the older Canoli ICC identifier and container layout. Explicit `false` forces standard positive-count extra-alpha handling. Set it to `true` only for unmarked legacy Canoli files written without ICC metadata; the old positive-count straight-RGBA encoding cannot otherwise be distinguished from a standard separate alpha channel. It does not override modern negative-count transparency. The UI preflight uses standard/automatic recognition; the override is host-only. Reusing the ICC profile in a normally structured file does not by itself trigger legacy handling. Independent inbound fixtures generated with psd-tools test both signaled merged transparency and an opaque image with a separate zero-filled alpha channel.


## White Balance adjustment layers

Create `new AdjustmentLayer({ name?, adjustment: { kind: "white-balance", temperature, tint } })`, attach it through `document.layers.add(...)`, and replace `layer.adjustment` to edit through shared commands/history. Both numeric fields are required finite numbers: `temperature` is 2000–25000 K, `tint` is -100–100. Fractional values are accepted. Missing/unknown fields, invalid kinds, nonfinite or out-of-range values throw without committing. Locked layers/ancestors reject edits; failed transactions/scripts roll back atomically. There is no `setWhiteBalance()` convenience method.

The trusted `defaultWhiteBalanceAdjustment()` export from `src/dom` returns `{kind:"white-balance", temperature:6504, tint:0}`. That exact default is byte-identical, including hidden RGB under zero alpha. The helper is not a sandbox global. Scripts/plugins use explicit parameters:

```js
// example: white-balance
const balance = document.layers.add(new AdjustmentLayer({
  name: "White balance correction",
  adjustment: { kind: "white-balance", temperature: 9000, tint: 12 }
}));
balance.opacity = 0.85;
document.selectedLayer = balance;
print("White balance", balance.adjustment.temperature, balance.adjustment.tint);
```

This corrects an assumed illuminant in an already rendered image. Higher temperature warms the correction; positive tint adds magenta. It does not estimate scene illumination, read camera RAW multipliers or recover clipped source data. The temperature control uses a D65-calibrated Planckian approximation; it is not a claim of camera-specific RAW calibration or exact physical source CCT. The 2000–25000 domain keeps the combined temperature/tint model within supported illuminants; it is not an image import limit.

Processing contract: decode straight 8-bit sRGB to linear RGB with the standard sRGB transfer curve. Obtain Planckian xy with [Kang et al. (2002), as implemented by Colour Science](https://colour.readthedocs.io/en/develop/generated/colour.temperature.CCT_to_xy_Kang2002.html), then convert to CIE 1960 uv (`u=4*x/(-2*x+12*y+3)`, `v=6*y/(-2*x+12*y+3)`). Offset the curve by `uv(D65)-uv(Kang(6504))`, where D65 xy is (0.3127,0.3290). Tint moves `0.00005*tint` along the green normal `(dv/dT,-du/dT)/length` of the analytic curve tangent. Convert back to XYZ with Y=1. Adapt that source white to D65 using the [Bradford transform](https://colour.readthedocs.io/en/develop/generated/colour.adaptation.matrix_chromatic_adaptation_VonKries.html), conjugated by the editor's sRGB/XYZ matrices. Clamp corrected linear RGB to [0,1], encode sRGB and round to bytes. Alpha is copied unchanged; gamut clipping and brightness shifts are possible. Masks, opacity/fill, blend modes, Blend If, group ordering and undo remain shared adjustment-layer behavior.

Actual pixels run in the WASM image worker on bounded reference/export tiles, using float64 matrix math and a 256-entry sRGB decode table; supported WebGPU viewport frames use the corresponding float32 WGSL transform on premultiplied RGBA8 surfaces. The JavaScript implementation is a conformance reference, not the production pixel loop. Exact neutral defaults bypass the transform in both backends. The SwiftShader comparison fixture requires exact alpha, maximum premultiplied RGB error at most 3 bytes and mean RGB error below 1 byte, across temperature/tint extrema, masks, opacity, normal/multiply blending and alpha bytes 0/1/64/128/255. This is fixture conformance, not a universal error bound. Independent whitepoint/Bradford fixtures come from Colour Science 0.4.6 via `scripts/generate-white-balance-reference.py`; their numerical tangent is compared within 1e-8 for XYZ and 1e-7 for matrix entries. Broader device/color-fidelity gates require separate evidence; this does not establish linear/HDR/print or Photoshop parity.

Schema **19** stores these records. Valid schemas 1–18 migrate on opening/history restoration; new white-balance records under old schema labels reject explicitly. Outer project container v3/workspace v2 remain unchanged. Source assets are immutable; projects/recovery/workspace current and redo-only history and offline recipes retain both values. Plugins remain inert until run and require current document-write permission at host commit. REST uses the same strict DTO through existing layer.add/layer.update commands in its separate session; no new endpoint or browser synchronization is added.


## Color Lookup (LUT) adjustment layers

`AdjustmentLayer.setLut(source: string, options?: {amount?: number, interpolation?: "tetrahedral" | "trilinear"}): void` parses standard Adobe/IRIDAS Cube 1.0 text and replaces the adjustment through shared validation/history. Options default to amount 100 and tetrahedral interpolation. Unknown options, missing/malformed tables, nonfinite numbers, invalid ranges and locked targets throw atomically. Explicit null options/values are invalid. `setLut` works before or after attachment; a detached layer can be prepared before its one-entry insertion.

```js
// example: lut
const look = new AdjustmentLayer({ name: "Color lookup" });
look.setLut(`TITLE "Swap red and blue"
LUT_3D_SIZE 2
0 0 0
0 0 1
0 1 0
0 1 1
1 0 0
1 0 1
1 1 0
1 1 1`, { amount: 75, interpolation: "tetrahedral" });
document.layers.add(look);
document.selectedLayer = look;
print("Lookup", look.adjustment.lut.title, look.adjustment.amount);
```

The constructor/setter DTO is `{kind:"lut", lut:{title, dimension, size, domainMin, domainMax, data}, amount, interpolation}`. Every field is required and unknown fields reject. `title` is at most 240 characters without quotes/newlines; `dimension` is 1 or 3. Cube 1.0 specifies size 2–65536 for 1D and 2–256 per axis for 3D. Domains are three finite numbers each with positive finite spans. `data` is canonical base64 of exactly `3 * size` (1D) or `3 * size**3` (3D) little-endian finite float32 values, in red-fastest RGB order. Negative and greater-than-one table values are retained. `amount` is finite 0–100, including fractions; `interpolation` is exactly `"tetrahedral"` or `"trilinear"`. Use `setLut()` rather than constructing packed bytes manually.

Trusted module exports from `src/dom` include `parseCubeLut(text): CubeLutData`, `serializeCubeLut(lut): string` and `defaultLutAdjustment(): LutAdjustmentData`. These helpers are not sandbox globals; isolated scripts use `AdjustmentLayer.setLut`. The default is an identity 1D table, amount 100, tetrahedral setting. Current `adjustment` getter/setter and constructor accept the full DTO. Returned settings are copies. Masks, opacity/fill, blend modes, Blend If, reorder, locks and undo use ordinary adjustment behavior.

Supported files contain exactly one 1D or 3D table, optional quoted TITLE, DOMAIN_MIN/MAX, blank lines, # comments, BOM and CR/LF/CRLF separators. Keywords use standard uppercase spelling. Table rows contain three decimal/scientific numbers; counts and duplicate/misplaced directives are checked. Combined shaper+3D files, Resolve-specific INPUT_RANGE directives, other LUT formats and embedded color-space transforms reject explicitly. The importer does not silently discard unsupported sections. TITLE is inert text. Import/export .cube runs in a terminable worker. Imported bytes are also independently validated in cancellable chunks before command commit, with stale-target/lock checks. Reset returns the identity default; undo restores the imported table. Export .cube preserves the table/domain/title, without baking amount, masks or surrounding layers; save .luma for the complete editable effect.

Processing uses straight encoded sRGB byte inputs normalized to [0,1], mapped by each domain, and clamped to table endpoints. 1D performs independent linear channel interpolation. 3D uses the chosen tetrahedral (default) or trilinear interpolation, with red-fastest indexing. Clamp interpolated outputs to [0,1], mix with original normalized RGB by amount/100, then round once to output bytes. Alpha is unchanged and zero amount is byte-identical. This does not automatically convert camera-log, scene-linear, HDR or ACES input; apply a LUT designed for the actual image encoding. Format/interpolation references: [Cube 1.0 specification](https://kono.phpage.fr/images/a/a1/Adobe-cube-lut-specification-1.0.pdf), [OpenColorIO's IRIDAS reader](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/main/src/OpenColorIO/fileformats/FileFormatIridasCube.cpp). Independent fixtures use Colour Science's separate Cube reader/writer and interpolators.

Actual pixels execute in WASM on bounded native tiles with float32 tables and float64 coordinates/interpolation, or the corresponding float32 WGSL viewport shader. Decoded tables and GPU storage buffers have separate bounded caches; these do not cap image resolution. Tables exceeding GPU buffer budgets, float32-inexact domains/spans or extreme table magnitudes use the actual Canvas/WASM fallback without changing settings. Device/browser allocation failures remain possible for large standard tables. Export completion times and interactive latency require separate measurement; no hardware GPU, print, HDR or universal interchange fidelity claim follows from fixture tests.

Schema 20 stores packed tables in ordinary adjustment records; valid schemas 1–19 migrate, while new LUT records under older labels reject. Project container v3 and workspace v2 remain unchanged. Original assets are immutable. Projects, recovery, current/redo-only workspace history and recipes carry the table without an external file, network lookup or new asset permission. Plugin installation remains inert; commands require current document-write grants at commit. REST accepts the same strict DTO through existing commands in its separate session; it adds no pixel-rendering endpoint or browser synchronization. Existing script source/time, command-complexity and REST request-body limits still apply independently of LUT format size; a large table may not fit a particular automation request.


## Color Range selection

`await document.selectColorRange(options: ColorRangeOptions, control?: ColorRangeControl): Promise<void>` prepares native color coverage and commits a single selection edit. It requires a configured application host, runs outside synchronous `Document.transaction`, validates the host result, and rejects a changed revision or cancelled operation without committing coverage. The script runner applies successful staged script commands atomically; a later error discards them together. Source artwork/asset bytes and locks remain unchanged; locked artwork can be sampled because the operation edits document selection.

```js
// example: color-range
await document.selectColorRange({
  colors: ["#ff0000"],
  exclude: [],
  fuzziness: 0,
  invert: false,
  operation: "replace",
  source: { kind: "merged" }
});
print("Selected color range", document.selection.regions.length);
```

Options are strict. `colors` requires 1–32 six-digit RGB hex strings. `exclude` defaults to [], with up to 32 colors. `fuzziness` is finite 0–200 (default 40), including fractional values; zero matches exact encoded RGB bytes. `invert` defaults false. `operation` is replace (default), add, subtract or intersect. Source defaults to `{kind:"merged"}` (visible composite); `{kind:"layer", layerId}` samples that visible branch with its world placement and ancestor transforms/masks; `{kind:"asset", assetId, x?, y?}` samples the original decoded image at native dimensions and integer document offset (default 0,0). Asset sampling ignores placed-layer effects/transforms. Unknown/missing/invalid fields and missing layers/assets throw. Hidden layers remain hidden in source rendering; transparent pixels never gain Color Range coverage. The browser uses rendered/decoded 8-bit sRGB surfaces; premultiplication and color-management behavior can affect recovered RGB at low alpha.

Processing: decode sRGB, transform through the editor's published D65 XYZ/Bradford D50 matrices and D50 whitepoint to CIELAB. Use Euclidean CIE1976 distance. For each include/exclude list, take the largest `max(0,1-distance/fuzziness)` match (or exact RGB match at zero fuzziness). Compute `match=include*(1-exclude)`; invert changes this to `1-match` among visible source pixels. Round `sourceAlpha*match` to coverage bytes. Final Boolean selection composition uses the existing fractional-alpha selection rules; subtracting a fractional selection from itself can leave coverage. This is a documented editor model, not Photoshop Color Range compatibility, CIEDE2000, skin detection, localized-cluster matching or automatic subject segmentation. References: [CIE1976 difference](https://colour.readthedocs.io/en/latest/generated/colour.difference.delta_E_CIE1976.html), [Photoshop's separately implemented Color Range workflow](https://helpx.adobe.com/photoshop/desktop/make-selections/freehand-selections/select-a-color-range-in-photoshop.html).

Trusted host controls accept AbortSignal and `onProgress({completed,total})`; final sampling runs on bounded native Canvas tiles and a dedicated WASM image worker. Cancellation terminates the operation's workers, and source/session/revision checks precede commit. Isolated scripts/plugins use Scripts-panel cancellation; callback functions/signals cannot cross that bridge. Existing script time, command-complexity, recipe and memory limits remain. Prepared pixel coverage—not source sampling instructions—is recorded for deterministic offline recipes/redo. Project/document schemas are unchanged (current document 25, project 3, workspace 2); projects, recovery and current/redo-only workspace history retain existing pixel-selection data.

Plugins require apiVersion 2 and current `document:read`, `document:write` and `assets:read` grants for Color Range. Installation is inert, returned coverage does not expose source pixel buffers, and read/write revocation is checked during preparation and again at final script commit. REST remains a separate headless session: `POST /api/v1/documents/:id/color-range` takes expectedRevision plus the same options, requiring an explicit asset source. It supports uploaded unmarked/explicit-sRGB noninterlaced 8-bit PNG (gray/RGB/palette, optional alpha/tRNS), with CRC/order/filter/row validation and bounded scanline inflation. Profiled/HDR, animated, interlaced, 16-bit PNG and other source formats reject explicitly. It reads raw PNG pixels without EXIF orientation, layer effects, browser composition or ICC conversion. Supply a normalized sRGB PNG when those operations are needed. It is not browser synchronization or a headless scene renderer. Existing asset/body limits remain; errors preserve selection/history, stale revisions return 409, client disconnect/document deletion cancels work.


## Alpha channels

`new AlphaChannel({name?: string, selection?: MarqueeSelection} = {})` creates a detached, independent selection channel. Name defaults to "Alpha channel" and must contain 1–240 characters. Selection defaults to an empty black channel; pass a `MarqueeSelection` instance, never a plain mutation object. White coverage selects and black excludes; fractional coverage, Boolean regions, affine geometry and native RLE are retained with the same rasterization as ordinary selections. Channels are independent of source artwork and do not change the rendered image on their own. These are saved alpha channels; RGB/CMYK component editing, spot colors and PSD alpha-channel interchange remain unimplemented.

`document.alphaChannels` is an iterable collection with `length`, `items`, `at(index)` (including negative indices), `getById(id)` (undefined if absent), `add(channel)` and `capture(name = "Alpha channel")`. `add` accepts an unattached `AlphaChannel` instance. `capture` copies the active selection and returns an attached channel; null selection throws, while an explicitly empty selection is valid. At most 64 channels are stored per document, independently of image resolution.

Channel members:

- `id`: stable read-only identity.
- `name`: read/write validated name.
- `selection`: read/write `MarqueeSelection`; reads return independent values, and assignments replace the complete coverage expression.
- `toJSON()`: owned `{id, name, selection}` serialization.
- `captureSelection()`: replace this channel from its owning document's current non-null selection.
- `duplicate(name = (this.name + " copy").slice(0,240))`: independent new channel/identity, attached to the same document when the original is attached.
- `move(direction: "up" | "down")`: reorder one position in the channel list; up means toward index zero. End-of-list movement leaves ordering unchanged.
- `remove()`: remove an attached channel without changing the active selection or existing masks.
- `await load(options?: {operation?: "replace" | "add" | "subtract" | "intersect", invert?: boolean}, control?: ChannelLoadControl): Promise<void>`: rasterize the saved channel at native canvas resolution and commit one selection edit. Defaults are replace and false. Inversion covers the current canvas, including black pixels outside saved regions. A null prior selection is treated as empty for Boolean operations, as in Color Range. Byte coverage uses add `max(a,b)`, subtract `a*(1-b/255)` and intersect `min(a,b)`, rounded once after independently rasterizing each complete expression. Fractional self-subtraction can leave coverage.

Attached changes use shared commands, validation and undo; handles resolve by ID across undo/redo and throw while removed. A channel cannot be attached twice or shared between documents; duplicate it to create independent data. Loading requires a configured application host, rejects synchronous transactions, unknown options, invalid host output, cancellation and any intervening revision. It uses dedicated bounded native WASM selection tiles, bounded scanline bands and RLE, never a full document canvas. Trusted controls accept `AbortSignal` and `onProgress({completed,total})`; isolated scripts/plugins use panel cancellation and cannot transfer callbacks/signals. Script loads share the 32-selection-preparation budget with Color Range and modification. Later script errors discard all staged edits.

```js
// example: alpha-channels
const channel = document.alphaChannels.add(new AlphaChannel({
  name: "Saved soft edge",
  selection: new MarqueeSelection({
    shape: "ellipse", x: 4, y: 4, width: 24, height: 16
  })
}));
await channel.load({operation: "replace"});
print("Loaded channel", channel.name, document.alphaChannels.length);
```

The Inspector's Alpha channels section saves/renames/updates/duplicates/reorders/removes channels, previews bounded grayscale coverage, and loads with Boolean/inverse controls, progress/cancel/errors. To refine a channel, load it, edit the document selection with the usual tools, and call `captureSelection()` or Update from selection. Existing `layer.maskFromSelection(document.selection)` converts a loaded channel into a separate mask. No image bytes are modified or granted to scripts. Legacy apiVersion-1 and apiVersion-2 plugins use their current document-read/write grants; asset permissions are unnecessary. Installation stays inert, and revocation/removal prevents pending commits.

Document schema 21 adds optional `alphaChannels`; valid v1–v20 documents migrate without altering their contents, while alpha channels under older schema labels reject explicitly. Project container 3 and workspace 2 remain unchanged, including retained undo/redo. Crop translates channel geometry with the canvas origin; image resize scales it with artwork; canvas resize keeps geometry fixed and changes clipping. Loaded selection coverage records for deterministic offline recipe replay. Channel management commands currently report unsupported recipe steps rather than silently claiming replay. Normal image exports render artwork, not the channel preview. PSD export reports omitted saved channels; save `.luma` for complete editable data.

REST sessions have the same strict `alphaChannel.set`, `.remove` and `.reorder` commands plus `POST /api/v1/documents/:id/alpha-channel-load` with `{expectedRevision,id,operation?,invert?}`. The actual Node worker uses the same native coverage compositor, without source images or browser scene rendering. Invalid/missing channels return 400; stale revisions return 409; disconnect/deletion/revision changes cancel preparation. The four-worker selection-service concurrency budget and existing request/complexity limits remain. Large/dense RLE and process/browser memory remain practical limitations, without a document megapixel cap.


## Quick Selection brush

`await document.selectQuickSelection(options: QuickSelectionOptions, control?: QuickSelectionControl): Promise<void>` grows a native selection from painted source pixels. This is deterministic local region growing, not semantic subject detection or a model call. It requires a configured application host and runs outside synchronous transactions.

Options are strict:

| Field | Default | Contract |
| --- | --- | --- |
| `points` | required | 1–20,000 document-space `{x,y}` points with finite coordinates in the safe-integer range. |
| `size` | 32 | Finite diameter, 0.5–512 native document pixels. |
| `tolerance` | 32 | Finite 0–255 addition to each sampled color deviation limit. |
| `edgeThreshold` | 64 | Finite 0–255 maximum per-channel RGB difference across a connected neighbor edge. |
| `operation` | add | replace, add, subtract or intersect, using ordinary fractional selection composition. |
| `source` | `{kind:"merged"}` | Visible composite, `{kind:"layer",layerId}` visible isolated branch with ancestor appearance, or `{kind:"asset",assetId,x?,y?}` original decoded image at an integer offset. Same source semantics as Color Range. |

The polyline creates circular dabs with center spacing at most `max(.25,size/8)` pixels. Seed pixels have centers inside those dabs, plus the pixel under each dab center so subpixel brushes can seed a pixel. Segments are clipped to source bounds expanded by the radius before interpolation. Invisible seed pixels are ignored. All visible painted pixels are positive constraints, so paint inside the intended region; including background in a stroke can teach the model to select it.

For each encoded-sRGB channel, compute the mean and population standard deviation of the unique visible seed pixels. An unpainted pixel is eligible when its RGB components lie within `tolerance + 2*standardDeviation` of those means. Four-connected growth additionally requires every crossed edge's maximum RGB component difference to be at most edgeThreshold. Painted seeds remain included even when they have different colors. Fully transparent pixels are barriers; selected pixels retain source alpha as fractional coverage, and disconnected matching colors remain excluded until seeded separately. At zero tolerance a varied stroke still admits its sampled variation; zero edgeThreshold only crosses identical RGB neighbors. Browser canvas decoding/premultiplication can affect recovered RGB at low alpha. This defined brush model does not claim Photoshop Quick Selection parity, automatic object identity or hair/translucent-edge matting quality.

```js
// example: quick-selection
await document.selectQuickSelection({
  points: [{x: 4.5, y: 4.5}, {x: 6.5, y: 4.5}],
  size: 2,
  tolerance: 24,
  edgeThreshold: 64,
  operation: "replace",
  source: {kind: "merged"}
});
print("Quick Selection regions", document.selection.regions.length);
```

The rail/palette select Quick Selection with Shift+W; W remains Magic wand. Diameter, color tolerance, edge threshold, source and operation use custom controls. The visible brush marks are a transient seed preview; release starts actual native growth with progress, Cancel Quick Selection and Escape. Add is the default. Shift adds, Alt subtracts and Shift+Alt intersects, captured at stroke start. Locked artwork can be sampled. Escape, pointer cancellation, blur, tool/settings changes and stale revisions discard drafts or pending work. Typing shortcuts stay native in editable fields.

Successful application is one selection transaction. Missing sources, invalid options/host output, no visible painted pixels, cancellation, source/session/revision changes and allocation failures reject without changing selection/history or original assets. Trusted controls accept AbortSignal and `onProgress({completed,total})`; isolated scripts/plugins use panel cancellation. Scripts share a sequential 32-preparation budget across selection modification, Color Range, alpha-channel loading, Quick Selection and Select Subject, plus existing execution/result limits. A later script error discards staged edits. Plugins require apiVersion 2 and current document-read/write/assets-read grants during preparation and at final staged commit; installation remains inert and no source RGB buffers enter the sandbox.

Source readback uses at-most-512-square native tiles and yields to queued input between tiles after approximately eight milliseconds of work; individual rendering/allocation tasks can still take longer. Connectivity currently retains a full native RGBA plane plus a byte state plane in a private WASM worker (roughly five bytes per source pixel, plus spans/frontier/output and temporary capture/decoding buffers). The compiled WASM memory has a 256 MiB maximum; actual available browser/process memory may be lower. Large or dense work can exceed working memory or command/result budgets; failures are explicit. This does not limit imports, discard original pixels or change viewport/cache budgets. Bounded source readback is not a claim that global connectivity has constant memory. Worker termination stops cancelled growth.

Results reuse existing selection data in document schema 25/project 3/workspace 2. Masks, saved alpha channels, undo/redo, projects/workspaces and offline recipes retain final native coverage, not dependence on live source sampling. REST remains a separate headless session: `POST /api/v1/documents/:id/quick-selection` accepts expectedRevision plus options and requires an explicit uploaded asset source. A real Node worker decodes the same noninterlaced 8-bit unmarked/explicit-sRGB PNG subset as Color Range, clips native pixels to the canvas and runs the same WASM grower. It does not render browser scenes, orient EXIF or convert ICC data. Invalid/unsupported data returns 400, stale revisions 409; disconnect, deletion and revision changes cancel preparation. Existing upload/body/complexity limits and the four-worker selection-service concurrency budget remain.

The T19 mask-loss/fabricated-source findings have been corrected by the separate native Select Subject path below. Quick Selection remains independent. Semantic detection, challenging-edge matting quality and wider device/latency gates are still unfinished T19 work.


## Select Subject

`await document.selectSubject(options?: SelectSubjectOptions, control?: SelectSubjectControl): Promise<SelectionData>` prepares native raster coverage through the configured browser/isolated host or the separate headless REST host. It replaces the current selection in one ordinary command transaction and returns an owned copy. Independent Documents without a configured host reject. Call outside synchronous transactions.

Options are strict: `targetLayerId?: string` defaults to the selected layer; `threshold?: number` is finite in [0,1], default 0.35; `expandRadius?: number` is an integer in [0,64], default 0 original-source pixels. The target must be an existing raster with an available source asset. Missing, non-raster or unsupported sources reject; no white canvas or central rectangle is substituted. Original source pixels are sampled before layer adjustments, masks, opacity and blending. Hidden/locked rasters can be sampled. Native source width/height remain independent of placed dimensions; the output carries the complete parent/layer affine transform and placed-to-source scale. Selection rendering clips to the document normally; retained source coverage can extend outside the canvas.

The current algorithm is a deterministic **border-contrast heuristic**, not learned/semantic object recognition or an evaluated hair/transparency matte. The border is `max(1,min(16,floor(min(width,height)/20)))` source pixels thick. If a majority of border pixels are fully transparent, intrinsic source alpha is used as foreground evidence. Otherwise visible border pixels define a mean encoded-RGB background. Each visible pixel receives `(0.7*colorDistance + 0.3*edgeMagnitude) * spatialWeight`: Euclidean encoded-RGB distance divided by `sqrt(3*255^2)`, luminance Sobel magnitude divided by 1020 (zero on the outermost row/column), and `0.3 + 0.7*exp(-distanceFromCenterSquared/(2*(max(width,height)*0.45)^2))`. Luminance weights are 0.299/0.587/0.114; zero-alpha neighbors contribute zero luminance regardless of hidden RGB bytes. A positive score is selected when its ratio to the source maximum is at least threshold; maxima at or below 1e-12 produce no foreground. Selected coverage copies original byte alpha. No automatic hole closing, minimum-area removal or fabricated fallback is applied. Thin and disconnected evidence can survive. Expand applies the existing grayscale disk dilation on the source plane, clipped to its native bounds, before world placement. Its radius is not measured in document pixels after scaling.

Uniform/transparent images with no evidence reject with `No foreground found` and preserve the previous selection/history. A complex or weakly contrasting scene can still be selected incorrectly; normalized contrast is not a calibrated confidence score. The exported synchronous `detectSalientSubject` reference reports confidence 0 (unscored), genuine pixel alpha and zero-sized bounds when empty. `maskToSelectionData(mask,width,height,bounds?)` now RLE-encodes the actual nonzero bounding crop, preserving holes and fractional bytes; optional bounds place/scale that crop, and empty masks return no regions. These helpers run synchronously and are not the browser job API.

```js
// example: subject-selection
await document.selectSubject({threshold: 0.35, expandRadius: 0});
print("Subject regions", document.selection.regions.length);
```

Trusted controls accept `AbortSignal` and `onProgress({completed,total})`; the editor facade forwards them. Source capture uses <=512-square canvases with task yields after approximately eight milliseconds of work. The dedicated native worker holds a full RGBA source plane and bounded score/output bands, without full-image float/label planes or a full-image canvas. Its WASM memory maximum remains 256 MiB, and actual process memory, source decoding, private capture, RLE and history consume additional space. Allocation or command/result limits can fail without changing the document. No image import limit or destructive downsampling is added. Cancellation terminates the private worker, and final validation rejects source/session/revision changes or invalid results. The UI shares the command/shortcut handlers and offers real progress, Cancel Select Subject and Escape; late output cannot commit after cancellation.

Scripts/plugins await the same native host preparation from the validated staged snapshot. No source RGB crosses the sandbox boundary. A later script failure discards staged edits. Scripts share the sequential 32-selection-preparation and existing time/result budgets; panel cancellation applies instead of sandbox callbacks/signals. apiVersion-2 plugins require current document-read/write/assets-read grants during preparation and final commit, including late revocation. Installation remains inert. Document schema 25/project 3/workspace 2, masks, saved alpha channels and offline selection recipes retain the final coverage without a schema change.

`POST /api/v1/documents/:id/select-subject` accepts expectedRevision plus these options, normally with explicit targetLayerId in a headless session. The server resolves its own raster/asset geometry and transforms, decodes a genuine noninterlaced 8-bit unmarked/explicit-sRGB PNG in a private worker, and runs the same native kernel. Unsupported PNG/profile/depth and invalid/no-foreground inputs return 400; stale revisions return 409. Disconnect/deletion/revision changes cancel preparation. The four-worker selection budget and existing upload/body limits remain shared. Browser-only formats/orientation/color conversion are not added, and headless state does not synchronize with tabs.

Refine Edge/removeBackground now use the separate native tiled host contract above, including transformed inputs, isolated scripts/plugins and applied corrected RGB. Remaining T19 work includes semantic selection quality, challenging-edge held-out evaluation and wider device/latency gates. The global closed-form solver is now delivered; an additional KNN variant is not claimed. Green integration checks do not establish those quality gates.


### Local photographed matting evaluation

The optional developer workflow uses the public training data from [Rhemann et al., CVPR 2009](https://www.alphamatting.com/datasets.php). It pins archive hashes, retains images in an external local cache, validates native decoded source bytes/trimap labels and never uploads results. Image IDs divisible by three are a reserved local holdout; both supplied trimaps stay with their image. This is not the website's hidden test competition or a commercial dataset license claim.

```bash
python3 scripts/prepare-matting-evaluation.py --cache /tmp/canoli-matting-natural --download
node --import tsx scripts/benchmark-matting-natural.ts --dataset=/tmp/canoli-matting-natural --output=/tmp/canoli-matting-natural/development.json --split=development
python3 scripts/score-matting-natural.py --self-test
python3 scripts/score-matting-natural.py --dataset /tmp/canoli-matting-natural --report /tmp/canoli-matting-natural/development.json --output /tmp/canoli-matting-natural/development-scored.json
```

The preparation/scoring tools require Pillow, NumPy and SciPy; these are offline evaluation tools, not browser/runtime dependencies. The benchmark records every success/failure, source hashes, CG diagnostics, native alpha output and neutral/default smoothing scores. Scoring verifies the actual reference-alpha hash and prepared labels against independently decoded entries in the pinned official trimap archive; changing labels to other valid levels must also reject. Do not exclude failed cases from availability claims. Gradient/connectivity measures are explicitly defined local implementations, not certified website/MATLAB scores. Optional direct SciPy checks and actual-browser checks are available:

```bash
python3 scripts/reference-matting-natural.py --dataset /tmp/canoli-matting-natural --case GT01-Trimap1 --output /tmp/canoli-matting-natural/direct-GT01.alpha
CANOLI_MATTING_DATASET=/tmp/canoli-matting-natural CANOLI_MATTING_REPORT=/tmp/canoli-matting-natural/development.json npx playwright test --config playwright.matting.config.ts
```

The explicit browser configuration requires the local dataset and a completed successful reference report for its selected cases; it does not silently download data or join the default test suite. It checks actual worker/output bytes, history, original bytes, queued input and existing script timeout cleanup. The isolated script's existing five-second wall limit still applies to host preparation; larger photographed jobs can time out even when the trusted native editor call succeeds. No partial assets/history may leak from that timeout. Natural-image scores and numerical convergence do not establish semantic accuracy, universal hair/glass quality, real-user acceptability or hardware/device latency.

Run the reserved split only after freezing the candidate, then score it with the same tool:

```bash
node --import tsx scripts/benchmark-matting-natural.ts --dataset=/tmp/canoli-matting-natural --output=/tmp/canoli-matting-natural/holdout.json --split=holdout
python3 scripts/score-matting-natural.py --dataset /tmp/canoli-matting-natural --report /tmp/canoli-matting-natural/holdout.json --output /tmp/canoli-matting-natural/holdout-scored.json
```

`scripts/report-matting-natural.py` additionally requires matplotlib. It checks complete split membership, unique cases, source/manifest/output hashes, convergence and exact known labels, then aggregates both strengths and compares only matched successful development cases. Its JSON and numerical plot contain no photographs or alpha arrays. A historical baseline must come from an actual archived run; `--preconditioner=jacobi` on current code retains the new proportional smoothing and cannot reconstruct the old postprocessing baseline.

For subsequent solver comparisons, set `--baseline-label`, `--candidate-label` and `--baseline-description` to the actual measured versions. The report preserves each run's options, hashes and every case; labels do not change the scope or metrics. Previously reserved images remain a validation cohort, not a fresh unseen test set with every rerun.

The developer benchmark accepts `--coarse=false` to measure the base preconditioner alone; default is true and recorded in its options. Resume rejects changes to that flag or the selected base preconditioner, source hashes, manifest or image scope. This is an offline research control, not a new `refineEdge` option or sandbox capability. Reports record the actual coarse memory/cell/band/ridge diagnostics and verify the 1e-9 gate when active.

```bash
MPLCONFIGDIR=/tmp/canoli-matplotlib python3 scripts/report-matting-natural.py \
  --dataset /tmp/canoli-matting-natural \
  --baseline /tmp/canoli-matting-natural/baseline-scored.json \
  --development /tmp/canoli-matting-natural/development-scored.json \
  --holdout /tmp/canoli-matting-natural/holdout-scored.json \
  --date 2026-10-16 \
  --output /tmp/canoli-matting-natural/summary.json \
  --figure /tmp/canoli-matting-natural/summary.png
```

The initial IC(0)/Smooth [2026-10-16 evidence](../docs/benchmarks/matting-natural-2026-10-16.json) retained all 54 candidate cases: 35/36 development and 18/18 reserved cases converged, versus 24/36 historical development cases. At that stage GT13-Trimap2 rejected at 2,000 iterations. On the 24 matched successes, default-output mean unknown-region alpha error decreased 4.0% and local gradient error 2.5%, while local connectivity error increased 28.8%. Those joint preconditioning/smoothing results with supplied trimaps do not establish universal quality improvement or an official ranking. The reserved split is from public training data; photographed toy fibres/fur, foliage and fine structures do not establish real-human hair, glass, translucent-fabric or foreground-RGB correction quality. The [numerical plot](../docs/benchmarks/matting-natural-2026-10-16.png) retains those historical cohorts and tradeoff.

The later [sparse-row study](../docs/benchmarks/matting-sparse-2026-10-16.json) retained 53/54 successful cases and compared all 106 neutral/default outputs to the previous IC(0) version: at most one byte difference, below 0.000485 mean byte per image. Three sequential paired Node runs on GT04-Trimap2 reduced median solve time from 34.96 to 30.78 seconds and complete native pipeline time from 36.54 to 32.24 seconds, with byte-identical outputs and 797 iterations in every measured pair. This was a single-case throughput improvement, not a broad latency or quality gate. The [paired timings](../docs/benchmarks/matting-sparse-performance-2026-10-16.png) retain all repeats. Photographed browser observations at that stage took 2.83–46.25 seconds under overlapping work, with main-thread long tasks up to 129 ms. GT13-Trimap2 still rejected in that version.

The pre-WASM [RGB-aware coarse-correction evidence](../docs/benchmarks/matting-coarse-2026-10-16.json) records **36/36 development and 18/18 reserved cases converging**, all with verified native residual <=1e-9 within 2,000 CG iterations. The formerly failing GT13-Trimap2 now converges in 1,184 iterations. Five independent NumPy/SciPy native references pass the unchanged <=1-byte maximum/<0.02-byte mean alpha gates. Three match exactly. The other foliage trimap exposes an earlier four-byte worst numerical error; the tighter current solve is within one byte of its direct reference. Previous-output differences are reported rather than mistaken for reference errors. All 54 cases retain exact known labels; supplied trimaps still do not evaluate semantic selection. Those photographed browser observations took 1.97–53.47 seconds, with long tasks up to 102 ms; this does not establish universal responsiveness or natural-quality acceptance. Broader hair/glass/translucency, connectivity, corrected-RGB, semantic and device gates remain open. The [coarse-correction plot](../docs/benchmarks/matting-coarse-quality-2026-10-16.png) shows availability and matched-cohort scores.


Native closed-form workers now optionally use float64 WASM for packed matrix multiplication and IC(0) substitutions. The native Laplacian, RGB coarse correction, hard labels, genuine priors, final pixels, 2,000-iteration ceiling and recomputed residual gates are unchanged. The private kernel instance isolates persistent graph memory from ordinary pixel operations. Its additional scratch/metadata/page/bookkeeping/transient-chunk estimate fits only after the existing base/factor/coarse reservations within 192 MiB; otherwise the global JavaScript route remains available. Physical optional allocation failure also retains that route, including after some chunks have migrated. Graph memory estimates do not prove whole-process/GC/decoder peak memory. Public options, project/document schemas, permissions and the isolated five-second deadline are unchanged.

The offline benchmark additionally accepts `--iterations=wasm|javascript` (default `wasm`) to compare the current iteration implementations; this is not a scripting option. Resume checks this control alongside coarse/base-preconditioner controls, source hashes, manifest and image scope. Reports include private `iterationBackend`/`iterationBytes` diagnostics and hash the adapter, ABI, actual WASM and both worker integration sources.


The [private-WASM evaluation](../docs/benchmarks/matting-wasm-2026-10-16.json) retains 36/36 development and 18/18 previously reserved public-training cases converging at <=1e-9. All 108 neutral/default native mattes are byte-identical to the prior RGB-coarse version, with unchanged iteration counts and five independent direct-reference checks. Maximum estimated graph/coarse/optional-WASM work is 154,931,800 bytes (147.75 MiB); this is not a whole-process peak-memory measurement.

Three eligible sequential paired Node repeats per input reduce median solve time from 8.16 to 5.98 seconds on GT04-Trimap2 and 52.61 to 32.59 seconds on GT13-Trimap2. Complete native pipeline medians change 9.58 to 7.38 and 53.75 to 33.75 seconds, respectively. The first GT04 pair overlapped the build and is retained but excluded as warmup, with a replacement pair measured. All eligible neutral/default outputs are byte-identical. The [performance figure](../docs/benchmarks/matting-wasm-performance-2026-10-16.png) shows every eligible repeat; these are two-input container throughput results, not broad speedup, browser p95, input-to-photon or hardware GPU guarantees.

Four sequential photographed Chromium checks additionally confirm the actual WASM backend, every output alpha byte, original compressed source bytes and one-step undo/redo. Preparation observations are 1.60/7.25/3.16/33.02 seconds (GT01/GT04/GT25/GT13); one queued Hand callback responds in 0.9/1.0/1.2/1.1 ms. Long tasks remain, up to 104 ms. They are separate observations from the paired Node study, not a controlled browser speed comparison. The GT04 isolated script still reaches its unchanged five-second wall limit with no edit or private-asset leak. The genuine 10000×5000 seam fixture has 5,355 unknowns, not a dense 50 MP graph; it retains reference pixels, original bytes, project restoration and one revision, converging in 18 iterations while capture/solve/encoding takes 13.89 seconds. Broader latency, peak-memory/device and natural-quality gates remain open.


## Design checks

`await document.preflight(options = {}, control = {}): Promise<PreflightReport>` inspects a stable document snapshot without changing layers, selections, history or assets. `EditorApplication.preflight(options, control)` delegates to the active document. Open **Design checks** from the tool rail or command palette for the same policy, a navigable findings list and a downloadable version-1 JSON report. There is no default shortcut; the registered action can use custom shortcut settings.

| Option | Default | Meaning |
| --- | --- | --- |
| `outputDpi` | `72` | Positive finite inspection DPI applied to the native document pixel grid. Does not change image metadata or export settings. |
| `minimumPpi` | `72` | Positive finite minimum original-source sampling density at that DPI. |
| `checkBounds` | `true` | Flag non-group authored bounds beyond the canvas, with 1e-7 document-pixel numerical tolerance. |
| `checkFonts` | `true` | Inspect nonempty text's family references; availability depends on the execution environment. |
| `includeHidden` | `false` | Include hidden and zero-opacity subtrees when true. |

Unknown options, non-finite/nonpositive DPI/PPI and invalid external metadata reject. Trusted host `control.signal` aborts inspection; isolated scripts use Scripts-panel cancellation and cannot pass AbortSignal. Run outside synchronous `Document.transaction` callbacks. No image is decoded, resized, uploaded or sent to a provider by this operation. Browser/REST worker payloads omit unrelated selections, masks, effects/LUT tables, erasures and clone tiles.

<!-- example: design-checks -->

```js
const report = await document.preflight({
  outputDpi: 300,
  minimumPpi: 150,
});
print("Design checks", report.counts);
for (const finding of report.findings.slice(0, 10)) {
  print(finding.layerName, finding.code, finding.message);
}
```

Active isolated scripts/plugins obtain asset dimensions through the existing permission-checked `host.assets.list` service and inspect their private document snapshot, including earlier staged edits. Plugins need `document:read` and `assets:read`; write permission is unnecessary for inspection alone. Installation remains inert. Asset calls check current grants, including revocation before a later call. A later script error discards any other staged edits as usual. New detached `Document` instances can inspect their own geometry without a host; absent asset metadata produces `asset-unchecked` information rather than fabricated missing-asset errors.

Trusted editor calls use a dedicated geometry worker plus local font-family probes against loaded web fonts or `local(...)`. They do not enumerate installed families, request Local Font Access, read font files or make network requests. At most eight probes run together; each has a two-second observation deadline. Pending web fonts and timeout/unsupported/composite-family cases remain `unknown`; a failed local resolution is `unavailable`, not proof that a font is absent from the operating system. Face/weight/italic fidelity and licensing are not established. Isolated scripts, detached documents and REST have no browser-font evidence and report `font-unchecked` information. This avoids exposing host font availability through plugin scripts.

Reports contain `version: 1`, document ID, the inspected document instance's `revision`, normalized `options`, `layersChecked`, `findings`, `totalFindings`, `truncated`, severity `counts`, per-family `fonts` and explicit `limitations`. In isolated scripts, revision refers to the private snapshot-backed Document instance, not the browser's revision counter. Each finding contains `code`, `severity`, the selectable root `layerId`, breadcrumb `layerName`, instance/descendant ID `path`, and a message; source/family/bounds/effective-PPI evidence appears where relevant. Codes are `bounds-outside`, `low-resolution`, `asset-missing`, `asset-unchecked`, `font-unavailable`, `font-unchecked`, and `measurement-unavailable`. Reports are returned data, not editable document objects or readiness certificates.

Raster PPI is `outputDpi / sigmaMax`, where `sigmaMax` is the largest singular value of the composed native-source-pixel-to-document transform, including ancestor/instance placement, nonuniform scale, rotation and shear. A relative 1e-12 comparison tolerance avoids threshold roundoff. Original source dimensions come from the asset repository, not thumbnails. Embedded asset masters use their actual source dimensions; document masters inspect each reachable placement with its own composed scale. Their internal bounds are not classified against the root canvas because masters have separate clipping artboards; their font/source references are checked conservatively even when masks or clipping may hide them.

This is metadata/geometry inspection: bounds are not rendered-pixel coverage; masks, effects, clipping stacks, occlusion and intentional bleed need review. It does not evaluate print bleed conformance, alignment, text legibility/contrast, focus, compression, generated quality or separately resized export variants. There is no automatic fix, export block, AI judgment or print-ready badge. The report may flag references that do not contribute visible pixels.

Inspection stops explicitly above 4,096 visited placements or a 64-level path. At most 512 findings are retained in a report; `totalFindings` and severity counts include all findings within a completed inspection and `truncated` makes this visible in UI/JSON. These are inspection work/output budgets, not document or import limits. Genuine 50 MP sources are inspected through their native metadata without document-sized pixel allocation. Completed reports bind their document/revision/options and cannot be accepted after a revision change; browser hosts also reject changed/closed/switched sessions and changed source assets. The UI marks a previously completed report out of date after document or policy changes or a browser loading event for a referenced font family and disables its download/selection actions until refreshed. JSON exports include names, IDs and measurements, without source pixels or font files.


Native SVG backdrop frame rebasing can quantize transformed source edges differently from the direct PNG working origin; retained SVG master clips and outer mask/filter rasterization add their own edge differences. Pixel residuals remain reported alongside exact interior colors, transformed contour/shadow-support coverage, area and centroid checks. Native PNG remains the flattened reference; editable parent geometry is retained. Source/font guards now also run around each cooperative encoding-progress callback, so a stale callback stops further encoding and returns no file.


## Photoshop inspection and import workers (trusted application code)

`await editor.inspectPsd(source, control?): Promise<PhotoshopInspection>` accepts immutable `Blob`/`File`, `ArrayBuffer` or `Uint8Array` input. It returns `{version:1, header, layers, resolution?, report}`. Layer metadata includes name, width/height, blend key, byte opacity and group markers; no decoded ImageData/composite, original resource views or ICC bytes are returned. This is a read-only file operation: later document edits do not invalidate its report. The parser currently decodes full input planes inside the worker before preparing metadata; it is not a metadata-only/streaming parser or a constant-memory guarantee.

`await editor.openPsd(source, options?, control?): Promise<PsdImportResult>` now accepts those same source types, retaining the earlier byte-buffer calls and options `{mode?:"layered"|"flatten", legacyStraightAlpha?:boolean, convertCmyk?:boolean, preserveMasks?:boolean}`. Unknown option fields or invalid types reject. Existing defaults and prototype pixel/color/precision/mask/group limitations remain. Its result still contains `{document, report, assets:Map<string,ImageData>}`; the decoded map is separate from installed PNG source bitmaps. Mutating that returned DTO/map does not mutate the attached document or installed assets. Preserve a native project for the complete current editor model; imported decoded layer PNGs persist, not the complete original Photoshop container/private metadata.

`control` is host-only `{signal?:AbortSignal,onProgress?:(value:{phase:"inspecting"|"decoding"|"encoding"|"installing",fraction:number|null})=>void}`. Fractions are local to each phase. Callbacks must not throw; a thrown callback rejects and discards pending work. Pre-aborted signals reject before a worker is created. Cancellation/disposal terminates inspection/parse/PNG preparation workers, including synchronous parsing inside them. A native bitmap decode already executing cannot be preempted; its late private assets are discarded. Worker load/runtime/message errors, invalid metadata/document/source identities/extents, native decode failures, owner revision/session changes and cancellation publish no partial imported document. A successful import opens a new tab and preserves edited documents. Ordinary selection changes do not count as document revisions; owner edits/replacement/tab switches do. A later inspection can run after normal failure/cancellation; disposed editors reject.

Blob/File sources cross the private boundary as immutable blobs. Mutable legacy buffers are snapshotted and remain attached/unchanged. Dedicated workers own complete compressed input/decoded planes and PNG staging. Import transfers newly decoded RGBA buffers back only to preserve the legacy ImageData result; host validation and actual decoded-PNG dimensions guard publication. The host installs private assets and constructs the OO document after all checks. Original source buffers/bitmaps never transfer. Complete planes, returned decoded images, source bitmaps, PNG output and native decoding retain real memory costs; no arbitrary megapixel/file-size import cap is added.

The UI now opens a cancellable inspection state before decoding, pages layer/message lists without dropping report records, retains Cancel/close/Escape during import, and supports retry after failure. Inspector color/precision/mask/ICC warnings describe prototype losses; absence of additional reported losses is not full Photoshop fidelity. This adds no isolated script/plugin file/raw-pixel/font/network privilege, REST import route/browser synchronization, public command or document/project/workspace schema change. The low-level synchronous `parsePsd`/`psdToDocument` helpers remain available; trusted browser workflows use the workers.

After importing through the application, isolated Scripts can edit the ordinary raster layer using the shared OO mutation/history path:

<!-- example: photoshop-import-edit -->

```js
const imported = document.layers.at(0);
if (!(imported instanceof RasterLayer)) throw new Error("Import a Photoshop raster layer first.");
document.transaction("Adjust imported Photoshop", () => {
  imported.x += 1;
  imported.opacity = 0.8;
});
document.selectedLayer = imported;
print("Imported Photoshop pixels remain editable");
```


The verified Photoshop pixel subset is 8-bit RGB/Grayscale with Raw, PackBits, ZIP or ZIP with prediction, in both PSD and PSB. The trusted worker path decodes ZIP layer channels and the merged planar stream through native `DecompressionStream("deflate")`; 8-bit prediction resets at each row and channel boundary. Layer alpha and correctly signaled merged transparency retain the existing straight/white-matted interpretation. Native Deflate support is required for ZIP; its absence, malformed/truncated/checksum-invalid streams or decompressed output shorter/longer than declared geometry reject the operation without publishing partial work. ZIP channel output allocation follows declared geometry, with no arbitrary megapixel or file-size cutoff. Complete input/decoded planes, native sources and output still consume data-dependent memory. Raw/RLE retains strict 8-bit row/extent validation. Neutral grayscale expands one source channel into RGB. Unsupported higher-precision ZIP/other codecs remain explicit in reports; only an actually decoded layer/composite path is offered. Full 16/32-bit, CMYK/color management, masks and group reconstruction remain incomplete, with resource/precision/profile losses disclosed.


### Low-level asynchronous Photoshop adapters

Trusted engine modules may call `await parsePsdAsync(buffer, {legacyStraightAlpha?})` to obtain `PsdParsedDocument`, or `await psdToDocumentAsync(buffer, options?)` to obtain the same `PsdImportResult` as the synchronous bridge. Both accept `ArrayBuffer | Uint8Array`; options/defaults and report/alpha interpretation match their synchronous counterparts. Keep the supplied bytes stable until resolution. The async parser shares the Raw/RLE structure and validation core and adds 8-bit native ZIP/prediction decoding. Its returned planes are owned decoded arrays; resource views can reference input bytes. These low-level methods do not install a document/assets, start a worker or provide host abort/progress controls; application code should use `editor.inspectPsd`/`editor.openPsd` for isolation, cancellation, ownership validation and atomic publication. The synchronous `parsePsd`/`psdToDocument` compatibility helpers still report ZIP as unsupported instead of returning invented pixels. No isolated script/plugin import privilege or REST endpoint is added.


## Photoshop raster-mask input (trusted application code)

For supported RGB8/Gray8 PSD/PSB input, `preserveMasks` defaults to `true`. The decoded user-mask channel now becomes a native bitmap-mask PNG source with its original mask resolution, rather than a rectangle. Artwork pixels and mask pixels remain separate. The returned `PsdImportResult.assets` map includes both artwork and bitmap-mask `ImageData`; its IDs exactly match document asset references. Native project/workspace persistence carries both PNG sources through the existing model. Original complete Photoshop containers/private metadata are still not archived.

Mask rectangles have their own dimensions and Raw/RLE/ZIP/prediction channels. Outside coverage is the declared 0/255 background. White-background masks store complemented bitmap alpha with native inversion, so outside pixels remain white without allocating a document-sized padding image. The native `inverted` value therefore describes the normalized bitmap representation, not a literal copy of the Photoshop bit. Its combined visible effect preserves source inversion. Disabled state and density are retained. Empty rectangles use a constant native paint mask. PSD coordinate bit 0 maps layer-relative coordinates to a linked local mask; absolute coordinates use an unlinked document-space mask. Separate Photoshop UI linkage metadata is not inferred. `Layer.setMaskLinked` can change this native relationship while preserving world placement.

Non-raster/non-group masks, nonzero Photoshop feathering, combined/extended or rendered/vector-mask semantics and higher-precision masks remain unsupported for layered import. Preflight detects standalone vmsk/vsms tags as well as user-mask record losses and disables the layered path; an available merged composite remains the normal fallback. `preserveMasks:false` explicitly omits masks and reports the loss, allowing otherwise-supported layer data. It does not bypass unsupported image-channel compression. `getPsdCapabilityReport(parsed, {preserveMasks?:boolean})` uses the same default and policy as both bridge adapters. Invalid mask bounds/background, truncated mask fields/channels, corrupt ZIP data and worker/source/publication errors reject without partial assets. Worker cancellation and the existing host controls/ownership checks apply to both image and mask sources.

Imported bitmap sources support ordinary OO mask replacement, enable/density/inversion, linking and shared undo. `LayerMask` is a value object: use `with` and assign it back to the attached layer. No file/source access is added to isolated Scripts/plugins or REST.

<!-- example: photoshop-mask-edit -->

```js
const imported = document.layers.at(0);
if (!(imported instanceof RasterLayer) || !imported.mask) {
  throw new Error("Import a Photoshop layer with a supported raster mask first.");
}
document.transaction("Adjust imported pixel mask", () => {
  imported.mask = imported.mask.with({ enabled: !imported.mask.enabled, density: 0.25 });
  imported.x += 1;
});
print("Imported pixel mask remains editable");
```

Import still retains full input/decoded planes, legacy returned images, native bitmaps and PNG output. Private conversion reuses its decoded mask storage rather than allocating another full mask image. This does not establish constant process memory, multi-GiB/device or full Photoshop fidelity. Document/project/workspace schemas remain 27/3/2; no arbitrary file/megapixel limit or new dependency/host privilege is introduced.


## Native pass-through groups and Photoshop hierarchy (schema 28)

`new LayerGroup({blendMode?: LayerBlendMode, ...options})` retains all existing group options and defaults to `"normal"` (isolated). `LayerBlendMode` adds `"pass-through"` to the sixteen ordinary blend modes; only groups accept that value. `group.blendMode = "pass-through"` and `group.update({blendMode:"pass-through"})` use the same shared commands, locks, atomic transaction validation and undo as other attached edits. Raster/paint/vector/text/adjustment targets reject pass-through. Explicit pass-through under schema 1–27 rejects, while valid older roots/history migrate to 28 without changing normal-group semantics or injecting fields. Project container 3/workspace 2 stay unchanged.

Pass-through children blend and apply adjustments against their surrounding sibling backdrop; a normal parent still supplies an isolated scope. Group opacity and an enabled mask interpolate the completed group result against that backdrop once in premultiplied color/alpha. They do not attenuate each child separately. Translation/affine hierarchy, mask coordinates, child effects and ordinary visibility/locks retain existing semantics. A pass-through group's own `fillOpacity` must be 1 and its own color overlay, drop shadow and Blend If must be disabled. Setting an incompatible mode/style/fill rejects atomically; choose Normal before enabling these settings. Mask density/inversion/feather remain native controls, distinct from unsupported imported Photoshop feather semantics. Visible pass-through groups currently select the complete document's Canvas2D/WASM viewport fallback. No GPU or universal frame-rate claim is made.

The async Photoshop import/inspection adapters now reconstruct well-formed nested PSD/PSB section boundaries into editable `LayerGroup` objects. They preserve child order, Unicode names (within the existing native 240-character limit), absolute-to-local placement, supported ordinary/pass-through group modes, opacity/visibility and protection. Partial Photoshop protection, including transparency-only flags, maps conservatively to a full native lock with a report warning; folder expansion state is not imported. Supported user pixel masks also attach to groups as independent PNG assets. Native editing budgets remain 64 total layers/groups and nesting depth 8, distinct from image-size/import-memory limits. Malformed boundaries reject editable conversion; over-budget/unsupported modes, clipping layers, effects, nondefault group/non-Normal fill or Blend If retain explicit preflight merged fallback when an actual composite exists. Unknown constructs and broader native Photoshop type/adjustment/vector/feather/precision/color fidelity are unfinished. Complete original Photoshop containers are not archived.

PNG/native project output retains the native composition and complete editable state respectively. PSD/PSB now retain supported folder/user-mask records as described below, merging unsupported backdrop dependencies only within their real isolation scope. SVG host preparation still rasterizes the dependent native prefix instead of substituting browser CSS isolation semantics; later content keeps its supported representation. Preflight discloses baked editability. Synchronous standalone SVG/low-level PSD helpers without native preparation reject richer content. Cancellation/source/font ownership checks still govern output. These remain RGB8 appearance paths with documented byte rounding and incomplete Photoshop color/effect fidelity.

After importing a supported Photoshop document with a group as its second root layer, run this in Scripts. Both changes return as one host transaction and one Undo restores the imported placement/opacity; invalid or locked targets reject without partial changes. No file/network/export access is granted to the script.

<!-- example: photoshop-group-edit -->
```js
const group = document.layers.at(1);
if (!(group instanceof LayerGroup)) {
  throw new Error("Import a Photoshop document with a second-layer group first.");
}
document.transaction("Edit imported group", () => {
  group.x += 2;
  group.opacity = 0.5;
});
print("Imported group remains editable", group.blendMode);
```

## Native Photoshop folder and user-mask export

Trusted `editor.export({format:"psd"|"psb", psdMode?:"layers"|"flatten"}, control?)` keeps its signatures and default `layers` mode. This extends the rendered Photoshop contract above without adding a script/plugin export capability or REST renderer. Folder records preserve nesting/order, Unicode names, own visibility, quantized opacity, Normal/ordinary/pass-through blend modes and full locks. Integer world-space group origins are retained where representable; affine transforms bake into descendants. Empty folders, including a document containing only folders, remain folders. A well-formed group-only import may return an empty assets map; an empty or malformed non-folder decoder result still rejects. Native import editing budgets remain 64 total nodes and depth 8, independently of image dimensions.

Unstyled layer/group masks export as channel `-2`, with final native coverage over the document rectangle and a separate enabled/disabled flag. Even a disabled bitmap source is pinned and sampled. Export forces sampling on, then bakes density/inversion/feather into coverage; disabled output remains disabled. Native vector, painted and bitmap masks become editable Photoshop pixel masks, not editable path/stroke/control metadata. Coverage outside the document, mask geometry, linkage and separate density/inversion/feather controls are not retained. The exported mask uses absolute document-space placement; separate Photoshop UI linkage metadata is not preserved. Original sources and full controls remain in `.luma`. A custom host renderer missing `renderMaskCoverage` rejects masked `layers` export explicitly; use the native renderer or choose `flatten`.

Photoshop groups expose only overall Opacity, according to [Adobe's guide](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/set-layer-opacity-and-blending-modes.html). An unstyled Canoli group's fill therefore multiplies its exported opacity, losing the separate fill control while retaining current transparency. An unstyled Normal pixel layer retains separate fill (`iOpa`); non-Normal pixel fill and its attached mask bake into the pixel channel because special Photoshop fill-blending semantics are not implemented. Import likewise retains nondefault fill only on supported Normal non-group records; nondefault group/non-Normal fill requires the real merged fallback. These are explicit preflight boundaries, not a claim that broader Photoshop fill behavior is validated.

A styled group keeps its outer folder metadata and a single `Rendered <name>` child containing its visible native contents, fill, mask and styles. Internal children, hidden descendants and separate effect/mask controls are lost. Unsupported adjustments/Blend If merge only the prefix required by their true isolation scope; pass-through dependencies can reach the outer scope or root. Preflight names folded group fill, baked non-Normal fill, styled folders and actual scoped merges. Full Photoshop type/vector/adjustment/effect serialization, original source-container retention, high precision/color and independent desktop acceptance remain open.

The writer counts folder headers/dividers toward the format record limit, emits native PSD/PSB length/RLE fields and includes mask rows in progress. Mask strips cross the same private per-export worker as artwork using a validated one-channel response. Cancellation, worker errors/malformed replies, missing/disposed assets and native allocation failures release temporary surfaces, terminate the worker and produce no partial download; retry may start a fresh operation. Original document/history/assets are unchanged. No schema change is needed: document 28, project 3 and workspace 2 remain current. Source bitmaps, compressed output and row tables still require data-dependent memory; bounded strips do not prove a whole-process memory bound or 60fps.

The following isolated Scripts example authors ordinary native content. Export through the application UI afterward; it does not give the script file or download access.

<!-- example: photoshop-native-hierarchy -->

```js
document.resize(32, 24);
const backdrop = document.layers.add(new PaintLayer({name:"Backdrop"}));
backdrop.strokes.add(new PaintFill({bounds:{x:0,y:0,width:32,height:24},color:"#804020"}));
const folder = document.layers.add(new LayerGroup({name:"Native folder",opacity:0.5,fillOpacity:0.5}));
folder.mask = new LayerMask({selection:new MarqueeSelection({shape:"rectangle",x:4,y:4,width:24,height:16})});
const content = folder.layers.add(new PaintLayer({name:"Filled child",opacity:0.5,fillOpacity:0.5}));
content.strokes.add(new PaintFill({bounds:{x:0,y:0,width:32,height:24},color:"#408020"}));
folder.layers.add(new LayerGroup({name:"Empty pass",blendMode:"pass-through"}));
document.selectedLayer = folder;
print("Native folder export ready");
```

## Brush pressure response (schema 29)

`new PressureCurve({points: [{input, output}, ...]})` creates an immutable response value. It accepts 2–16 finite knots in `[0,1]`; inputs must increase strictly, begin at 0 and end at 1, and outputs must not decrease. Outputs may start above zero or end below one to author a minimum/maximum response. Unknown fields, duplicate/unordered inputs, decreasing outputs, nonfinite/out-of-range values and invalid knot counts throw. `PressureCurve.linear()`, `.soft()` and `.firm()` return normalized preset values. `.points` and `.toJSON()` return owned copies; editing those copies or constructor input does not change the curve.

`BrushOptions.pressureCurve?: PressureCurve | PressureCurveData | null` applies to `BrushStroke`, `PencilStroke`, `EraserStroke` and `CloneStroke`. Absent/null selects the existing response and omits the field from serialized data: pressure-size retains its 5% minimum and pressure-opacity its 1% minimum. An explicit curve uses its complete output range, including true zero. Zero size or alpha emits no dab; pencil rounding does not turn a zero-size response into a visible pixel. The independent flow behavior and whole-stroke opacity remain unchanged. The getter `stroke.pressureCurve` returns an immutable value or null. Strokes are immutable values; add a replacement through the existing stroke collection/transaction to change recorded artwork.

`pressureSize` defaults to true; `pressureOpacity` defaults to false. The curve affects only enabled dynamics. It is evaluated after interpolation of recorded point pressure, so the original stored samples are not replaced with curve outputs. Size, alpha, spacing, bounds, native Canvas replay, SVG dabs and supported WebGPU stamps share this response. Completely zero-response segments need no stamp iteration; the existing half-pixel minimum spacing and numerical-precision checks still govern nonempty replay. SVG retains the rendered dab geometry/coverage, not the original brush-command/curve controls. Subpixel strokes can require the reference Canvas path; this adds no universal GPU/performance guarantee.

`document.applyTonalSculpt(path, mode, range, exposure, options?)` also accepts `options.pressureCurve` as a PressureCurve value, strict DTO or null shorthand. HTTP tonal-sculpt options use the serialized DTO form. `TonalStroke` captures the curve through its BrushStroke value.

The Pressure response button in brush, pencil, eraser, clone, dodge/burn and healing controls opens the custom curve editor. Default response retains the existing minima; choosing Linear creates an explicit full-range curve. Presets, graph and paired slider/numeric knot controls support add/remove, validation, Apply, Cancel and Escape. Tool settings affect new strokes and remain transient; authored stroke curves persist. Existing strokes are not rewritten. The trusted host `editor.tools.configure({pressureCurve: curveData | null})` validates/copies settings before publication and cancels an active gesture when its curve changes. Invalid settings leave the gesture/settings intact. The host ToolController is not an isolated-script API or a persistent brush-preset library.

For explicit curves with enabled dynamics, browser pen pressure preserves finite zero/low values before the existing smoothing step; mouse input retains its normal fixed pressure. Default response keeps its prior normalization. Recorded points may therefore reflect normalization/smoothing, not raw hardware samples. Coalesced input and the final release endpoint follow the existing gesture contract. Physical tablet, tilt, textured-tip, mixer/smudge, wider brush-library and sustained F06/F14 acceptance remain unfinished.

Document schema 29 retains optional `pressureCurve: {points:[{input,output},...]}` on brush records, including painted masks/filter masks, raster erasures, tonal strokes and embedded document masters. Valid v1–v28 documents/history migrate; older root labels containing the new brush field reject. Project 3 and workspace 2 remain unchanged. Shared OO/REST commands keep locks, atomic batches, revision conflicts and undo/redo. Serialized brush DTOs omit the field for default response; explicit null is constructor/tool shorthand and is invalid in the strict serialized brush DTO. Installation remains inert; isolated Scripts/plugins gain the pure `PressureCurve` constructor through existing document-write commands, without new file, network, asset-byte or export privileges.

<!-- example: pressure-response -->

```js
document.resize(320, 180);
const study = document.layers.add(new PaintLayer({name:"Pressure studies"}));
const responses = [PressureCurve.linear(), PressureCurve.soft(), PressureCurve.firm()];
const colors = ["#3060a0", "#408020", "#a04060"];
for (let row = 0; row < responses.length; row++) {
  const y = 36 + row * 54;
  study.strokes.add(new BrushStroke({
    points: [{x:32,y,pressure:0}, {x:96,y,pressure:0.25},
      {x:192,y,pressure:0.5}, {x:288,y,pressure:1}],
    size:32, hardness:1, color:colors[row],
    pressureSize:true, pressureOpacity:true, pressureCurve:responses[row]
  }));
}
document.selectedLayer = study;
print("Pressure response study ready");
```


## Brush presets: trusted host preferences

The browser's Brush presets library saves tool/dynamics values independently of documents. Trusted application code uses the immutable BrushPreset value and EditorApplication.brushPresets service; exact signatures, bounds, optimistic revisions, portable packs and recovery behavior are in [BRUSH_PRESETS.md](BRUSH_PRESETS.md). ToolController.applyBrushPreset validates before cancelling/configuring future gestures and returns the tool name for UI selection. These are host APIs, not new isolated constructor/global services. Scripts still author complete BrushStroke/PencilStroke/EraserStroke/CloneStroke/TonalStroke values through existing commands. A stroke/project does not depend on a saved preset reference. Document 29/project 3/workspace 2 and script isolation remain unchanged.

## Brush tip shape and pen tilt (schema 30)

`new BrushTip(options = {})` creates an immutable tip value. Options are `roundness` (finite .01–1, default 1), `angle` (finite -180–180 degrees, default 0), `tiltAngle` and `tiltRoundness` (booleans, default false), and `tiltCurve` (`PressureCurve`, strict curve DTO, or null; default null/linear). Getters expose those values; `.with(options)` returns a new validated tip and `.toJSON()` returns an owned DTO. Invalid geometry, curves, or unknown fields throw before an attached document edit. Positive angles rotate clockwise in the downward-positive stroke plane.

`BrushOptions.tip?: BrushTip | BrushTipData | null` is supported by BrushStroke, PencilStroke, EraserStroke and CloneStroke; absent/null omits the field and retains legacy round/square rendering. `stroke.tip` returns an immutable BrushTip or null. A strict serialized tip requires `roundness` and `angle`; nullable input is constructor shorthand, not serialized brush data. Nondefault tips remain captured by value in each stroke, independently of tool preferences and library presets. A shaped pencil is a hard rectangle: its pressure-scaled width and roundness-scaled height round to whole local pixels, with a minimum of one pixel only for a positive size. Explicit zero pressure response remains empty. A rotated rectangle has conservative corner-aware bounds.

Each stroke point can additionally carry `tilt: {altitude, azimuth}` in **radians**. Altitude is 0–π/2 (horizontal to upright); azimuth is 0–2π clockwise from local +X. Both fields are required, finite, and strictly validated. Missing orientation acts upright. `tiltAngle` adds azimuth to the authored angle when inclined. For `tiltRoundness`, let `t = 1 - altitude/(π/2)` and `f` be the authored curve or linear response: effective roundness is `max(.01, roundness * (1 - f(t)))`. Tilt does not change authored pressure samples. Replay interpolates altitude linearly and azimuth along the shortest angular arc. It retains orientation-only changes at one position; smoothing interpolates orientation together with position/pressure. Spacing accounts for endpoint roundness while retaining the existing minimum replay step of .5 document pixels. Extremely thin/rotated geometry can require the complete Canvas fallback rather than GPU rendering.

Browser pen input prefers valid Pointer Events spherical orientation, falling back to the standard tiltX/tiltY projection. The ambiguous exactly horizontal non-axis tiltX/tiltY pair resolves to azimuth zero unless the browser supplies spherical angles. This sensor convention is not a claim of physical-tablet verification. Projected direction is transformed through the inverse linear layer/mask plane; altitude is preserved. Fresh paint/healing uses the document plane; reused paint, raster erasures and tonal layers use their layer plane. Filter-mask painting includes the smart master's pixel scaling. Mouse input uses static angle/roundness. Cursors show nominal full-pressure support in the same plane; shaped healing guides show endpoint footprints and a connecting centerline.

The **Brush tip…** dialog edits a local draft. Preview tilt/direction controls affect only its diagram. Tilt response opens the shared knot editor; Cancel/Escape returns to the tip draft, and applying a curve does not publish tool settings until **Apply tip**. Cancel leaves settings/history unchanged. Use default tip restores legacy rendering for future strokes. The trusted host accepts `editor.tools.configure({tip: tipData | null})`: it validates/owns data before cancelling an active gesture when settings change. Invalid input leaves gesture and settings intact. No new global shortcut is introduced.

`document.applyTonalSculpt(path, mode, range, exposure, options?)` accepts these optional point orientations and `options.tip` using the same constructor/null shorthand. LayerMask painted entries, filter masks, raster erasures, TonalStroke and healing requests retain the same validated brush records. Isolated scripts/plugins receive only the pure BrushTip constructor through existing permissions and host validation. REST uses strict serialized tip/point DTOs and existing revision/undo/lock rules; it remains a separate headless document service.

Document schema 30 admits tip and spherical point metadata in every brush-bearing context, including embedded masters and restored history. Valid schemas 1–29 migrate without inserting fields; older labels containing either new field reject. Project container 3 and workspace 2 stay unchanged. Tip-bearing saved presets/packs use version 2; version-1 presets retain their original shape and reset future tools to default tips. See [brush-library compatibility](BRUSH_PRESETS.md). Native Canvas, SVG and supported WGSL share stamp geometry; edge antialiasing can vary between engines. This does not complete textured tips, symmetry, mixer/smudge, hardware-tablet validation or universal 60fps.

<!-- example: brush-tip-shape -->

```js
const layer = document.layers.add(new PaintLayer({name: "Tilt study"}));
layer.strokes.add(new BrushStroke({
  points: [{x: 80.5, y: 80.5, pressure: 1,
    tilt: {altitude: Math.PI / 4, azimuth: Math.PI / 2}}],
  size: 80, hardness: 1, color: "#ff0000", pressureSize: false,
  tip: new BrushTip({roundness: 1, angle: 0,
    tiltAngle: true, tiltRoundness: true,
    tiltCurve: PressureCurve.linear()})
}));
document.selectedLayer = layer;
print("Tilt study ready");
```

The single hard stamp is 40 pixels wide and 80 pixels tall, centered at (80.5, 80.5), in the new layer's document coordinate plane. Its tip and spherical sample remain editable stroke data through undo and project reload.

## Brush symmetry replay (schema 31)

`BrushSymmetry` is an immutable value containing `copies`, an array of 1–31 finite invertible `AffineTransform` values or strict affine DTOs. The original copy is implicit; identity and duplicate copy matrices reject. Unknown fields and singular matrices reject before an attached edit. `.copies` returns immutable matrix values in an owned array; `.toJSON()` returns owned serialized data. This metadata budget permits at most 32 total copies and does not limit image dimensions.

Factories are `BrushSymmetry.mirrorVertical(x)`, `.mirrorHorizontal(y)`, `.bothAxes({x,y})` and `.radial({x,y}, count)` with 2–32 integer sectors. Mirror lines/centers use stroke-plane coordinates. `.transformed(mapping)` conjugates each copy with `mapping * copy * mapping.inverse()` to preserve complete ink geometry when moving between coordinate planes. Generic affine matrices support this conjugation through nonuniformly scaled/sheared layers; they are not restricted to rotations after conversion.

`BrushOptions.symmetry?: BrushSymmetry | BrushSymmetryData | null` applies to BrushStroke, PencilStroke, EraserStroke and CloneStroke. Absent/null selects ordinary ink and omits serialized metadata. `stroke.symmetry` returns a BrushSymmetry or null. Strict serialized brush data requires `{copies:[{a,b,c,d,e,f},...]}`; null is constructor/tool shorthand only. All copies share the original recorded point pressure/tilt and brush settings. The complete already-shaped tip footprint, including pixel-anchored pencil geometry, is transformed; merely reflecting a point does not suffice. Original-first, copy-array order applies at each interpolated dab. Overlapping copies accumulate flow on one stroke surface; captured selection clipping and whole-stroke opacity apply once to that surface. No original point is replaced or dropped.

Canvas/SVG/supported WGSL share geometry. Viewport clipping maps each copy's visible region back into the original plane and merges native stamp-index ranges, retaining replay order without scanning the gap between distant copies. Bounds/culling and clone source capture include reflected/rotated support. Numerical precision failures reject rendering or use the complete Canvas fallback; they do not truncate source resolution. Pixel-edge antialiasing remains backend dependent.

`document.applyTonalSculpt(path, mode, range, exposure, options?)` accepts `options.symmetry` using the same immutable value/DTO/null shorthand. Painted ordinary/filter masks, raster erasures, tonal and healing requests retain the same brush contract. Schema 31 admits the field in every brush-bearing context and retained history; falsely old labels reject, valid old roots/history migrate without injected fields. Project 3/workspace 2 remain separate formats. REST uses serialized values with the existing strict command/lock/revision/undo rules. Isolated scripts/plugins receive only the pure BrushSymmetry constructor, with no new file/network/export/asset privileges. REST continues to own separate headless documents.

Trusted tool configuration accepts `editor.tools.configure({symmetry: data | null})` in **document coordinates**. Settings validate before cancelling active gestures or publishing values. Actual painting captures conjugated layer/mask/native-master-plane metadata; healing/new paint uses the document plane. The Symmetry dialog and guide/cursor feedback are described below. Portable preset/pack v3 retains the same document-space setting; legacy v1/v2 presets clear symmetry when applied.

<!-- example: brush-symmetry -->

```js
const layer = document.layers.add(new PaintLayer({name: "Four-way ink"}));
layer.strokes.add(new BrushStroke({
  points: [{x: 16.5, y: 32.5}], size: 12, hardness: 1,
  color: "#ff0000", pressureSize: false,
  symmetry: BrushSymmetry.radial({x: 32.5, y: 32.5}, 4)
}));
document.selectedLayer = layer;
print("Four-way ink ready");
```

The four hard circular stamps have centers (16.5,32.5), (32.5,16.5), (48.5,32.5) and (32.5,48.5). They remain one self-contained stroke and one attached add operation through undo and project reload. This does not complete textured tips, mixer/smudge, physical-device verification or full F06/F14.


### Symmetry controls and feedback

Open **Symmetry…** from Brush/Pencil/Eraser/Clone/Dodge/Burn/Healing options. Choose Off, Vertical mirror, Horizontal mirror, Both axes or Radial. Exact line/center fields accept finite fractional document-pixel coordinates within safe integer bounds; they are not constrained to the current canvas. Radial sectors accepts integer 2–32; invalid drafts disable Apply. Center on canvas explicitly moves supported drafts to the current canvas midpoint. Cancel/Escape preserves settings and history; Apply affects future strokes only. Opening the modal cancels transient gestures. Custom affine copies remain intact unless replaced with another mode; the dialog preserves unchanged values rather than reconstructing approximate inferred geometry.

Guides identify supported mirror lines/radial sectors. Nominal full-pressure ghost cursors use the complete current layer/mask/tilt plane and document-space copies. Their SVG is bounded to the visible viewport, with screen-width contrast strokes and at most 32 retained copy groups; offscreen copies remain in stroke metadata and exports. Panning/zooming changes presentation, not captured geometry. Changing symmetry cancels the current gesture after all dynamics validate. Tool preferences remain transient across reload; stored strokes and named v3 presets retain their own values. Preset coordinates are absolute document pixels; applying to a differently sized document does not silently recenter them. Reopen Symmetry and use Center on canvas when desired. See [brush preset compatibility](BRUSH_PRESETS.md) for format compatibility and storage conflicts.

## Image-backed brush textures (schema 32)

`new BrushTexture({assetId, channel?, invert?})` creates an immutable reference to an image already imported into the document's AssetStore. `assetId` is a nonempty string of at most 240 characters; `channel` is `"luminance"` (default) or `"alpha"`; `invert` defaults to false. Unknown fields, invalid enums and nonboolean inversion reject. Read-only getters expose these three values. `.with(partialOptions)` creates another validated value; `.toJSON()` returns an owned `{assetId, channel, invert}` DTO. Constructors do not read or import files and do not prove an asset exists. The host checks referenced assets before applying isolated results or external commands.

`BrushStroke`, `PencilStroke`, `EraserStroke` and `CloneStroke` accept `texture: BrushTexture | BrushTextureData | null` in their existing options. Omitted/null options preserve the ordinary tip and serialize no texture field; the `.texture` getter returns null. A supplied DTO must include all three fields. A serialized stroke's optional `texture` field cannot be null. Invalid records reject before committing. `Document.applyTonalSculpt(..., options)` accepts the same texture option; mask/refinement strokes, filter masks, raster erasures and embedded component content retain it through their ordinary commands, locks and undo. Schema labels below 32 reject texture metadata, including retained history. Valid older documents upgrade without inserting texture fields. Project v3/workspace v2 remain unchanged.

Coverage stretches the complete source image over each normalized ellipse or pencil rectangle before applying existing hardness, flow, pressure, tip orientation and symmetry. Texture angle remains meaningful on a round tip. Alpha mode uses source alpha; inverted alpha uses the projected opaque source-image support minus projected alpha, so inversion never adds ink outside the projected image. Encoded luminance uses `(2126R + 7152G + 722B) / 10000`: black is ink by default and white is ink when inverted, multiplied by source alpha. Transparent pixels stay transparent in luminance mode. Coverage rounds half up to 8-bit alpha. This is encoded-channel coverage, not ICC-managed/linear-light luminance. Brush projection uses native Canvas smoothing; pencil projection uses nearest-neighbor sampling. Captured selection and whole-stroke opacity apply once after dab-flow accumulation. Clone textures modulate the captured destination-relative source field; they do not replace it.

Native replay samples original bitmap pixels directly into bounded visible tiles; it does not store a resized thumbnail as the tip. Original Blob bytes, dimensions and TIFF page/precision settings remain project/workspace/recipe sources. Working tile/cache/prefix budgets do not cap source resolution. Texture paint currently selects complete Canvas/WASM viewport fallback; masks can use native coverage with GPU composition. SVG embeds streamed source-resolution white/alpha PNG coverage and references it from dab masks. It retains visible dabs, but not original texture bytes, color channels, asset identity or editable brush dynamics. SVG sampling/edge rounding can differ from native Canvas. Source/output/browser memory remains data dependent.

Import an image and select its unlocked raster layer before running this example. The source layer is hidden, not removed; its original asset also remains referenced by the textured stroke. The entire run is one undo entry. No file, network, export or additional plugin capability is granted by `BrushTexture`.

<!-- example: brush-texture -->

```js
const source = document.selectedLayer;
if (!(source instanceof RasterLayer)) {
  throw new Error("Import and select an unlocked texture image first.");
}
const texture = new BrushTexture({assetId: source.assetId, channel: "luminance"});
const ink = document.layers.add(new PaintLayer({name: "Image-backed ink"}));
ink.strokes.add(new BrushStroke({
  points: [{x: 32.5, y: 32.5}], size: 32, hardness: 1,
  pressureSize: false, color: "#ff0000", texture
}));
source.visible = false;
document.selectedLayer = ink;
print("Image-backed ink ready");
```

This authored API/compositor integration is in verification. Active-tool texture controls, texture-aware cursors and per-gesture source ownership are now connected and in verification. Portable source-bearing brush presets are now connected and in verification. Existing metadata-only preset packs do not carry texture sources. Mixer/smudge, physical-tablet testing, hardware-GPU/display and sustained all-tool frame-rate gates remain open.

### Recipe layer-template defaults

Portable recipe `layer.add` templates may omit `strokes` on a paint layer, `paths` on a vector layer, or `adjustment` on an adjustment layer. Execution fills these fields from the existing constructors (empty paint/path collections and the default Curves adjustment). Supplied complete artwork remains unchanged. Source collection/remapping accepts these partial templates while still requiring concrete asset IDs for supplied texture/image references. A package of default layers contains no image sources and commits through the ordinary atomic recipe/undo boundary.

### Trusted shared image ownership

`sourceStore.shareTo(destinationStore, assetId, sharedId?): Readonly<ImageAsset>` is a trusted host AssetStore operation, separate from isolated document constructors. The source must be fully imported, its native bitmap/dimensions must still agree, and both stores must be open. Omitted `sharedId` creates a fresh ID; an explicit ID must contain 1–240 characters and cannot collide with an installed or pending destination asset. Sharing the same source ID into the same store is a no-op. Other calls create a distinct frozen record referencing the same original Blob and bitmap, with copied/frozen TIFF page/precision choices. There is no image resampling, file read, command, document revision, undo entry or automatic metadata analysis.

Both stores hold explicit bitmap ownership. Removing/disposing one reference keeps other references alive; the last removal closes the bitmap exactly once. Returned image records and bitmaps are borrowed: do not modify or close them. Ordinary `install(asset, analyzeMetadata=true)` retains its adoption contract for caller-owned, unshared assets; adopting a shared/borrowed record rejects and must use `shareTo`. Duplicate/pending IDs, missing/stale sources and disposed stores reject before a new shared reference is installed. Store disposal is terminal and idempotent; new import, install, share or lifetime capture rejects afterward. Existing captured lifetime guards still reject disposal during asynchronous work.

This adds no image-byte access, AssetStore constructor or shared ownership method to Scripts/plugins/REST. It supports global texture preferences and document-local gesture capture. Original-byte portable texture presets are now connected and in verification.

The trusted `EditorApplication.brushTextureSource` service owns the current original source independently of open documents. Its borrowed `.source` is an immutable ImageAsset or null. `capture(store, assetId)` synchronously retains an existing ready source; invalid input leaves the current/pending source intact. `import(blob, name, options={})` privately decodes using the existing AssetImportOptions (`signal`, progress and TIFF choices), then replaces only on success. A newer capture/import, clear, cancellation or disposal prevents stale decode publication. Decode failure preserves the previous ready source. `ensureIn(destinationStore)` synchronously returns/reuses a live document-local lease, creating a fresh ID if an earlier reference was removed/reused. `clear()` releases the preference reference; `dispose()` is terminal/idempotent and is called by application disposal. Documents retaining a lease remain alive independently. These trusted services now support textured pointer tools and UI source controls/cursors, in verification. Portable texture presets are now connected and in verification; none of these services are isolated script/plugin bindings.

Recapturing the same original bitmap/Blob/name/dimensions/TIFF choices preserves the existing preference and its document-local references while cancelling an older pending replacement. Script repair and matting preview now retain borrowed inputs with explicit leases and release their private views completely; prepared script output remains alive in the document after successful atomic commit. The isolated `document.assetStore` remains null, and neither AssetStore nor BrushTextureSourceOwner is a script binding.


### Trusted texture tool preferences

`editor.tools.configure({texture: {channel: "alpha" | "luminance", invert: boolean} | null})` selects coverage for future gestures. The internal strict preference parser defaults omitted channel/invert to luminance/false. Null disables texture and retains the ready source for reuse. Enabling requires a ready `editor.brushTextureSource.source`; invalid texture/tip/symmetry/pressure values throw before cancelling the current gesture. Preferences carry no asset ID and are transient across workspace reloads. Each gesture captures its own authored BrushTexture and document lease, including masks, filter-mask master planes, erasures, tonal brushes and healing.

`sourceOwner.captureFrom(otherOwner)` synchronously captures the other owner's ready original without a document insertion; missing/disposed sources throw before replacement. `sourceOwner.leaseIn(destinationStore)` returns `{asset, created}` and reports whether a new reference was installed; `ensureIn` remains the asset-only convenience. Borrowed ImageAsset records/bitmaps must never be closed or adopted through install. `editor.tools.applyBrushTexture(draftOwner, preference)` validates coverage and ready source, captures that draft into the application owner, then cancels the previous gesture and configures future strokes. The caller still owns/disposes the draft. Invalid drafts/preferences preserve active source/settings. These are trusted application adapters, not constructors/members available to isolated Scripts, plugins or REST.

The visible Texture dialog provides file/document-source selection, TIFF review, channel/inversion, a bounded coverage proxy, and Apply/Cancel. No pixel data or preference source is uploaded. Existing metadata-only preset formats 1–3 cannot save textures: enabled texture capture throws an explicit source-bearing-pack error rather than discarding bytes. Applying an older preset disables texture. Original-byte portable packs and sustained/device acceptance remain unfinished.


Texture gesture continuation, queued previews and final commit also validate the captured store/record/bitmap identity. Removing or replacing the asset under the same ID cancels/rejects the stale gesture without document/history edits or deletion of the foreign replacement. This guard supplements document revision checks; asset IDs alone are not an ownership proof.


## Source-bearing brush presets — 2026-10-18, in verification

Preset/pack v4 carries image-backed coverage preferences and exact original Blob sources with native dimensions, MIME/name, SHA-256 and TIFF page/precision choices. Source-free JSON versions 1–3 remain readable/exportable. Binary packs use a checksummed 48-byte header, strict manifest and contiguous original-blob slices; readers reject missing/unused references, corrupted extents/checksums and native decode/dimension mismatches before any import commit. Portable source IDs are remapped and cannot bind to document asset IDs. The single existing IndexedDB v1 preset store now atomically stores optional source blobs alongside their preset; no physical schema migration is needed. Older strict readers reject these newer records while preserving bytes.

The library verifies actual stored source contents before writes and retains last-valid snapshots on failures. Read-only keepalive requests maintain the native write lock across asynchronous checks; only active request callbacks queue changes. Recovery v2 preserves raw records and original blobs, including invalid preset metadata, and compares complete content fingerprints under that lock before reset. Same-size byte changes and stale revisions cannot be erased with an old backup. Legacy JSON recovery remains available for source-free records; unsupported raw non-JSON values still fail without deleting data.

The custom preset dialog connects source-aware save/update/rename/duplicate/delete/import/export/download/recovery and shows source name/dimensions/coverage. Applying privately verifies/decodes an original, guards abort/supersession/document/tool/source changes, then uses normal tool selection/configuration; errors retain prior ready preferences and newer human edits. Preferences stay outside document undo; actual strokes still use shared OO commands/history and collision-safe document leases. Original images stay independent of viewport/cursor proxies, library deletion and closed source documents. This adds no isolated script/plugin file privilege, paid provider, upload, REST/browser sync or document schema bump. See [BRUSH_PRESETS.md](BRUSH_PRESETS.md) for signatures, binary contract, errors and limits. Complete native/production verification and wider F06/F14/device gates remain open.

Trusted browser APIs: `new BrushPreset(data, source?)`, `captureBrushPreset(name, tool, settings, sourceOwner, includeColor=false, signal?)`, `parseBrushPack(file, signal?)`, `exportBrushPack(presets, signal?)`, `editor.brushPresets.importFile(file, signal?)`, `exportFile(ids?, signal?)`, `exportRecoveryFile(signal?)`, `resetFromRecoveryFile(file, signal?)` and `editor.applyBrushPreset(preset, {signal?, selectTool?}={})` are asynchronous where file/verification work is required. Capture retains a ready original across hashing; Apply prepares privately and calls the optional trusted UI selector only after validation. Constructor shape validation alone is not a checksum/native verification proof. Missing source records, malformed packs, decode failures, changed sessions/preferences and cancellation reject before publication. Source-free JSON helpers remain compatible; attempted texture loss is rejected. These names are not bindings available to isolated Scripts/plugins or headless REST sessions.

### Paragraph styles in automation recipes

The trusted recipe recorder now supports paragraph-style creation, base updates/renames, removal, text apply/detach and selective/all override reset. Recorded dependencies contain full formatting and recipe step references, never a required source-document style ID. This also applies to linked text in added groups. JSON and portable recipe packages retain the references; deterministic batch runs use their saved recipe snapshot. Constructor scripting signatures and isolated plugin capabilities are unchanged.

See [paragraph-style recipe actions](RECIPE_PARAGRAPH_STYLES.md) for exact JSON signatures, dependency reuse/conflicts, parameters, conditions, template references and error behavior. Recipe v1/package v1 and document schema 40 remain unchanged. Older runtimes reject these unfamiliar action types. Existing unsupported commands still reject complete recordings; this does not make every editor command recordable.
