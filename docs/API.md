# REST and scripting APIs

## RAW development workflow in implementation

Trusted `editor.inspectRaw(file, image = 0, control = {})` performs read-only native sensor preflight. It returns the version-1 camera/decoder, sensor/visible/display geometry, selected-image/count, precision, calibration/white-balance, extra-sample and warning/capability report. It changes no document, assets or history. Controls accept AbortSignal and progress with phases inspecting/developing/encoding and a nullable fraction. Inspection needs the local native worker and full-input buffer; queued inspections/development share one application-context lease. Native failure, malformed results, cancellation and throwing callbacks reject and terminate private work.

Trusted `editor.openRaw(file, options = {}, control = {})` opens a clean native-resolution smart-object document with a retained sensor original and accepted sRGB8 PNG. Explicit `allowPrecisionLoss:true` is required. `RawDevelopment` values and attached `SmartObjectLayer.rawDevelopment` / `developRaw(value, control)` expose editable parameters through the trusted host; Apply uses one shared master-replacement command and ordinary locks/history. Cancellation, callback failures, supersession and intervening human/session changes discard private work. See [signatures, defaults, errors and limits](SCRIPTING_API.md#raw-input-and-development-trusted-browser-application-code).

Projects with RAW use checksummed container v4, preserving original bytes, accepted pixels, normalized settings and native provenance independently; other projects stay v3. Current/history outputs share deduplicated originals. Workspace/recovery/copy, source-bearing recipe packages v2 and brush packs v6 preserve those records. Accepted PNG reopening and undo/redo do not require the native RAW decoder. The dated implementation roadmap records automated acceptance and outstanding gates for this increment; direct RAW batches are trusted browser services documented in SCRIPTING_API.md. Semantic RAW recipes are trusted browser-host services described in SCRIPTING_API.md; no REST recipe renderer is introduced. Isolated development and separate headless REST operations are specified below. These services grant no isolated file privilege or live browser/headless synchronization.

The checked decoder produces linear RGB16/grayscale16 before explicit RGBA8 sRGB working conversion. Its build omits DNG SDK/RawSpeed/external lossy-JPEG DNG and external ICC-file processing. Metadata support is not proof of valid sensor payloads, device memory or photographic fidelity. Broader camera/color, merge workflows, F10 precision and the complete F12 gates remain open.


## Native RAW REST sessions

RAW endpoints belong to this server's independent in-memory documents. They neither locate browser documents nor synchronize browser edits. Existing API token/origin policy applies. Native LibRaw work runs in a private Node worker with the same checked C ABI, options/report validation and sRGB8 output as the browser. Server inspection/development share a cancellable FIFO; waiting jobs own original bytes but no worker/native heap. Workers terminate on success/error/abort, and termination completes before the next native job starts. Headless assets retain validated PNG/original bytes and real native dimensions; browser-bitmap access is explicitly unavailable, with no fabricated surface or general headless renderer claim.

- `POST /api/v1/documents/:id/raw-inspect?expectedRevision=N&name=Camera.dng`: send complete binary sensor bytes. Optional `X-Raw-Options` is strict JSON with the RAW options from the scripting guide; inspection uses `development.image` (default 0) and needs no conversion consent. Returns `{...snapshot, report}` with status 200, no asset/history change.
- `POST /api/v1/documents/:id/raw-import?expectedRevision=N&name=Camera.dng`: the same binary transport, with `X-Raw-Options: {"allowPrecisionLoss":true,"development":{...}}`. Name may alternatively use `X-Asset-Name`. The original MIME comes from Content-Type. Native development adds a native-size shared smart-object master/layer in one `Import RAW` command, returning `{...snapshot, layerId, report}` with status 201. Existing document geometry stays authored; place/resize/crop through normal commands if required. Complete original bytes and accepted PNG remain distinct.
- `POST /api/v1/documents/:id/raw-develop`: JSON `{expectedRevision,layerId,options:{allowPrecisionLoss:true,development:{...}}}`. It invokes the attached OO `SmartObjectLayer.developRaw` host hook and shared master validation/commands. Returns `{...snapshot,report}` with status 200 and one `Develop RAW` undo entry; every shared dependent instance/ancestor lock applies.
- `GET /api/v1/documents/:id/assets/:assetId` and asset listings include Blob-free `raw` provenance/settings when present. `?raw=true` retains the existing accepted-image download; `?original=true` downloads the complete retained RAW Blob, or 404 when absent.
- `GET /api/v1/documents/:id/project` downloads a checksummed native `.luma` snapshot. `?history=true` additionally retains validated undo/redo assets. RAW projects use v4 original deduplication and ordinary projects stay v3. The supported bytes can reopen in the browser; this is explicit file exchange, not session synchronization. Ordinary image sources must pass full sRGB8 PNG decoding and dimension checks; other legacy metadata-only source formats reject rather than produce an unverified deliverable. RAW-derived PNGs retain their already validated native identity.

```bash
curl -H 'Authorization: Bearer TOKEN' \
  -H 'Content-Type: image/x-adobe-dng' \
  -H 'X-Raw-Options: {"allowPrecisionLoss":true}' \
  --data-binary @Camera.dng \
  'http://127.0.0.1:8787/api/v1/documents/DOCUMENT_ID/raw-import?expectedRevision=0&name=Camera.dng'
```

Expected revision is required; stale or intervening edits return 409, document deletion returns 404, and malformed input, unsupported development, missing consent/calibration/WB, locks or codec/worker/allocation failure return 400 without a new asset or partial command. Client disconnect terminates private native work. Original assets and their content/dimensions remain pinned through acceptance. The original body can exceed ordinary metadata request budgets: binary image uploads and base64 image-asset JSON have no arbitrary file-size/MP cap; command JSON retains its separate 1 MB metadata budget. Actual Node/Blob/Buffer/WASM address space, full compressed inputs/native planes and device memory remain limits. Native color/codec/camera coverage and fidelity are exactly the owned build's tested subset; no embedded JPEG preview, HDR/high-precision compositor or physical-camera quality claim is implied.

## Trusted recent-file and raster-file opening surfaces

`editor.openImage(file:File, control?:{signal?:AbortSignal}):Promise<RasterLayer>` opens a native-resolution raster in an independent document at revision zero; it preserves existing edited tabs, original bytes and metadata, and rejects cancellation, decode/validation/allocation failure or a changed/disposed owner before publication. Unlike importImage(file), it does not place an image in the active composition. Trusted `editor.recentFiles` exposes local-copy status/subscription, refresh/flush, explicit remember(file,kind), verified read(id,signal?), remove(id) and clear(). Successful file-backed host opens/imports notify the optional service; failed copying does not roll back accepted artwork. Project-download UI records its named output, while saveProject() alone returns a Blob. These are browser-only surfaces, not REST rendering/session synchronization or isolated scripting/file privileges. See [defaults, metadata, lifecycle and examples](SCRIPTING_API.md#recent-files-trusted-browser-host).

Denied browser-storage capability access disables optional recent files without aborting startup. Advisory notification failures do not reject an already committed copy; durable generation invalidation still applies, and explicit refresh remains available.

## Workspace layout is browser UI state

Docking/visibility/order, responsive/preferred widths and named layout management use local browser preferences. They do not mutate document commands/history or add a REST/isolated scripting endpoint. The current envelope `luma.workspace-layout.v1` supersedes read-only legacy panel-width values; failed validation/storage and detected newer-tab state prevent publication. Projects and binary workspace graphs retain their current schemas. See [the user-facing contract](SCRIPTING_API.md#workspace-layout-preferences).

## Trusted local AVIF input and output

Trusted browser code has read-only `editor.inspectAvif(file, control?)` and transactional `editor.openAvif(file, {allowPrecisionLoss?:boolean, assumeSrgb?:boolean}, control?)`. Both flags default to false. Opening returns the resolved capability report and installs a clean native-resolution primary-image document only if the captured owner/revision remains current. Picker/drop/recent and brush-texture review require explicit conversion/fallback consent. Original bytes and choices survive projects, workspaces, recovery, recipes, brush packs and cross-document copies. Crop/orientation affect derived presentation pixels, while the report retains encoded geometry. Errors/cancellation retain existing artwork. See [signatures, errors and examples](SCRIPTING_API.md#avif-input-preflight-trusted-application-code). No REST upload/decoder route or isolated Scripts/plugin file privilege is added.

Browser `editor.export({format:"avif", quality?:number, avifLossless?:boolean, avifSpeed?:number}, control?)` returns `{blob,mimeType:"image/avif",extension:"avif",report}`. Quality defaults to 0.8 (finite 0.01–1), lossless to false, speed to 8 (integer 0–10). Lossless or quality 1 retains captured RGBA8; alpha is always lossless. Output is one flattened native-resolution image, explicitly identified as sRGB, with no source metadata/font/editable content. A private locally served WASM worker supports abort, source/font lifetime rejection and fresh retries; full-frame/codec memory and browser/viewer limits remain. Custom local batch variants accept the same settings and share fitting, snapshots, durable hashes and integrity-checked packages. AVIF-only flags reject on other batch formats. These trusted methods add no REST rendering route or isolated Scripts export privilege. See [signatures, examples and limits](SCRIPTING_API.md#avif-export-trusted-application-code).

## Linked paragraph style commands (schema 40)

Strict commands accept paragraphStyle.set `{style:{id,name,format}}`, paragraphStyle.remove `{id}`, text.paragraphStyle `{id,styleId:string|null,keepOverrides?:boolean}`, and text.paragraphOverrides.clear `{id,keys?:ParagraphFormatKey[]}`. A serialized format contains all documented typography fields; overrides contain only controlled keys. Unknown/null/invalid values, duplicate names/IDs, missing definitions and inconsistent snapshot fields reject. Libraries have at most 128 styles. Removing a style detaches its followers with resolved format retained; applying a style clears overrides unless keepOverrides=true. Reset keys must be unique and known. Existing layer.update edits automatically become local overrides on bound text, and undefined optional controlled values restore inheritance in the OO surface.

Commands share expectedRevision, transaction rollback, lock/ancestor validation, native/headless font measurement and undo/redo. A base change that affects a locked follower rejects atomically; a name-only edit or a fully overridden unchanged follower can remain valid. REST uses its separate headless document and does not synchronize browser scenes. Libraries/bindings require schema 40 in roots and embedded masters. See the [complete constructor and behavior guide](SCRIPTING_API.md#linked-paragraph-styles-schema-40). Existing project/workspace/plugin/recipe transport versions remain unchanged.

## Bilateral smart filter (schema 39)

Existing strict smartObject.filters commands accept `{id:string,enabled:boolean,kind:"bilateral-denoise",radius:number,colorSigma:number,amount:number}`. All serialized fields are required and unknown fields reject. Radius is an integer 0–16 native pixels; colorSigma is finite 0–255 encoded byte levels; amount is finite 0–1. The OO constructor `new BilateralDenoiseFilter(options?)` defaults to radius 2, colorSigma 25, amount 0.5, enabled true and generated nonblank ID. Apply with SmartObjectLayer.addFilter/setFilters. Any zero control or disabled entry is inert, including affine resampling/SVG planning. Invalid values, locked instances/ancestors and stale expectedRevision reject atomically; undo/redo retain the stack. Schema 39 admission includes embedded masters. Existing transport versions and separate headless REST sessions remain unchanged; REST does not render/synchronize browser scenes. See the [tested scripting example](SCRIPTING_API.md#bilateral-denoise-schema-39).

## Median smart filter (schema 38)

The existing strict smartObject.filters command accepts `{id:string,kind:"median",enabled:boolean,radius:number}`. Radius must be an integer 0–32 native master pixels; fields are required in serialized commands, unknown fields reject, and zero is inert. The OO value is `new MedianFilter({radius?:number,id?:string,enabled?:boolean})`, defaulting to radius 1, generated ID and enabled true. Apply through `SmartObjectLayer.addFilter` or `setFilters`. Revision conflicts, locked instances/ancestors, invalid values and duplicate IDs reject atomically through the existing command endpoint; undo/redo retain the complete stack. Headless REST stores these edits in its separate session and does not render or synchronize browser pixels. Project/schema admission checks include embedded masters; transport versions are unchanged. See the [scripting example](SCRIPTING_API.md#median-denoise-schema-38).

## Shared frequency controls (schema 37)

Existing strict layer.update patches accept `frequencyRadius:number|null` only on a group. Finite values span0–4096/3 native master pixels; null inherits an enclosing controller or restores individual filter fallbacks. The nearest group controls descendant frequency filters in its document plane; component masters have independent scopes. A group/ancestor lock, wrong layer kind, invalid value or stale expectedRevision rejects the whole batch; changing one group radius is one undoable command and does not unlock/mutate protected correction children. The public OO surface is LayerGroup.frequencyRadius and Layer.frequencyGroup. Schema37 field-age checks include embedded masters. Existing36 filters remain readable and independent until placed under an explicit controller.

The browser's prepared preview object and native canvas sampling are trusted application APIs only. REST still receives prepared assets and shared commands, without browser synchronization or a headless scene renderer. See [the complete contract](SCRIPTING_API.md#shared-frequency-radius-and-native-preview-schema-37). Project/workspace remain3/2.

## Frequency-separation primitives (schema 36)

The current document schema is 37; project/workspace remain 3/2. REST clients can upload prepared original-resolution snapshots through the existing asset endpoint, define embedded masters, and submit ordinary component/layer/filter/mask commands to build the same editable low/high/correction workflow. `smartObject.filters` accepts strict `frequency-band`, `native-composition` and trailing `document-tone` DTOs; `layer.update` masks accept strict `raster-erasures` coverage. Both new blend modes are `linear-light` and `linear-burn`. Required serialized fields, defaults of the OO constructors, coordinate phases and reconstruction math are documented in [the scripting contract](SCRIPTING_API.md#frequency-separation-and-native-composition-schema-36).

The public OO factory is `Document.createFrequencySeparation(source,snapshot,options?)`; it records existing shared commands rather than introducing a second mutation API. Invalid bands/radii/filter-phase order, missing assets, locks and malformed masks reject the entire batch; expectedRevision and undo/redo retain their normal behavior. Old schema labels reject these additions, including embedded component masters. REST does not prepare native captures, render browser scenes or synchronize with the active browser session. The trusted browser application's separateFrequencies method is not a REST endpoint.

## Red-eye correction (schema 35)

Existing `layer.add` / `layer.update` adjustment DTOs accept strict `{kind:"red-eye",threshold:32,strength:100}`. Threshold is finite 0–255 encoded RGB8 red excess; strength is finite 0–100 percent. Both fields are required in serialized commands. Use an ordinary editable layer mask to isolate pupils; headless sessions perform no automatic eye detection. Invalid values reject the entire batch, locks apply, stale `expectedRevision` returns 409, and success is undoable through the existing history endpoints. The shared constructor is `RedEyeAdjustment`; see [its numeric rule and runnable example](SCRIPTING_API.md#redeyeadjustment-schema-35). No new REST renderer or browser synchronization is introduced. Current schema is 37; prepared-mask records retain their schema-34 introduction and project/workspace remain 3/2.

## Prepared mask replacements (schema34)

Ordinary mask values in layer.add/layer.update.mask and smartObject.filterMask accept ordered `{mode:"wet",stroke:<complete WetPaintStroke DTO>}` entries. Embedded master definitions use the same version rule and asset discovery. Upload original output/coverage PNGs through the existing assets endpoint first. Native output alpha must not exceed coverage alpha, even for opacity0 metadata, disabled masks or hidden layers. The shared host validates these bytes before a synchronous command batch; invalid content returns400 with no partial rename/mask edits, stale revisions return409, and success is one undo step. No server brush-simulation endpoint or browser/session synchronization is added. Mask/filter-mask engine authoring is a separate trusted-browser `editor.applyWetPaint(...,{target})` contract documented in SCRIPTING_API.md.


Prepared wet `opacity:0` remains serialized with all image references, whose validity is still checked before commands commit; it does not force native reconstruction or SVG rasterization. Constructor opacity/nativeTransform defaults apply only to undefined; explicit null rejects like invalid raw DTO fields. Retained spatial sessions remain internal to the browser engine, with no new REST endpoint or isolated host service. Current document schema37/project3/workspace2 apply; ordinary prepared layer records retain their schema33 introduction.

Schema 33 introduces prepared `WetPaintStroke` values through existing `paint.add`, `layer.add` and raster `layer.update.erasures` commands. No new REST simulation/render endpoint is added. A wet record contains `id`, `kind:"wet"`, independent `opacity` (0–1), `clip:null`, brush/pencil `brush` metadata, normalized `load`/`mix`, invertible `nativeTransform`, and native `tiles:[{x,y,width,height,assetId,coverage:{assetId}}]`. See [the constructor contract and runnable isolated example](SCRIPTING_API.md#prepared-wet-paint-schema-33). Native pixels are authoritative; metadata does not execute a brush engine on the server.

Upload prepared output/coverage PNGs using the existing assets endpoint, then reference their returned IDs. Both must have matching actual tile dimensions; output alpha must already be masked and cannot exceed coverage alpha. Validation finishes before the synchronous transaction and rechecks session/revision. Invalid content returns 400 without partial edits; stale revisions return 409. Existing locks, batches and undo apply. The headless alpha decoder supports noninterlaced RGB8/RGBA8 PNGs with unmarked/sRGB color; ICC/APNG and other unsupported declarations reject explicitly. Browser decoding can accept additional declarations; this explicit headless limit is not a browser import restriction. Existing REST body/upload budgets apply, and sessions remain independent of the browser.

Both are required product surfaces. They share the same OOP document model, command validation and history behavior. Neither is a Photoshop-compatible API. These are local prototype APIs, not a published SDK stability guarantee.

## Scripting API

Text `layer.add`/`layer.update` accept optional `wordSpacing` (finite -50…500 document pixels, effective default 0) and `fontKerning` (`auto`/`normal`/`none`, effective default auto). Typography fields require a text layer and use normal validation, locks, expectedRevision, atomic batches and undo. There is no separate text-spacing endpoint or font transfer. Headless intrinsic bounds remain approximate without native fonts/Canvas; the browser's explicit Reflow text action refreshes local metrics. New fields require document schema 25; project/workspace formats remain 3/2. See [TextLayer](SCRIPTING_API.md#textlayer) for reset/unsupported-browser behavior and the tested constructor example.

See the dedicated **[Scripting API guide and reference](SCRIPTING_API.md)** for quick start, constructor options/defaults, properties and methods, collections, transactions, ownership, runnable recipes, errors and runtime budgets.

Open **Scripts** in the tool rail or press **Mod+Shift+K**. Run JavaScript using the provided `document`, `Document`, `RasterLayer`, `LayerGroup`, `ToneAdjustment` and `print` bindings, plus paint/vector/stroke/selection/style constructors listed in the guide. The supplied `document` controls the open composition; `new Document()` creates a separate in-memory model.

Successful edits apply together as one undo step. Script errors, cancellation, timeout, invalid assets or stale revisions apply no script edits. Import images through the editor first; the Scripts panel does not expose files, network access, export or host application services. See [application integration](SCRIPTING_API.md#application-integration) for the separate trusted application interface.

## Trusted TIFF file import

Browser application code can call `editor.inspectTiff(file, control?)` and `editor.openTiff(file, {page?: number, allowPrecisionLoss?: boolean}, control?)`. These return a validated TIFF capability report; page defaults to 0, precision-loss consent to false. The UI reviews page/codec/color limitations before opening a selected raster page. Original TIFF bytes and decode settings persist independently of editing pixels, including recovery integrity keys. Cancellation, callback errors and changed/disposed host sessions reject without partial publication. See [the complete host contract](SCRIPTING_API.md#tiff-import-trusted-application-code) for supported codecs, sample/color layouts, progress, errors, budgets and the runnable constructor example. File access remains outside isolated scripts/plugins, and no TIFF REST decoder or browser synchronization is added.

## Trusted PDF export

Trusted browser `editor.export({format:"pdf", pdfDpi?:number}, control?)` returns one native-resolution raster PDF page; DPI defaults to 72 and changes physical size without resampling. Transparency and output sRGB ICC are retained; the report discloses unsearchable/rasterized text, editability, metadata and prepress losses. Invalid geometry, source/font lifetime changes, cancellation and callback errors reject without a file. This adds no isolated export/download capability or REST/batch PDF rendering route. See [the complete PDF host contract](SCRIPTING_API.md#pdf-export-trusted-application-code).

## Plugins

Installable command plugins reuse the isolated scripting API with versioned manifests, document permissions and one named history entry per run. See [PLUGINS.md](PLUGINS.md). They are distinct from REST sessions; the server does not install or execute plugins.

## REST API

Run `npm run dev:api`; default base URL is `http://127.0.0.1:8787/api/v1`. `LUMA_API_PORT` changes the local port.

### Authentication

Set the `LUMA_API_KEY` environment variable to require token-based authentication. When configured:

- Supply the key via standard HTTP Bearer token: `Authorization: Bearer <key>`
- Or via custom header: `X-API-Key: <key>`
- Requests missing or supplying an invalid key receive **401 Unauthorized** with the header `WWW-Authenticate: Bearer realm="Canoli Studio REST API"`.
- When `LUMA_API_KEY` is omitted, loopback Host and Origin checks protect the local development service against cross-site requests.

| Method | Endpoint                         | Behavior                                                               |
| ------ | -------------------------------- | ---------------------------------------------------------------------- |
| GET    | `/health`                        | Service status and storage/scope description                           |
| GET    | `/documents`                     | IDs, names and revisions                                               |
| POST   | `/documents`                     | Create from optional `name`, `width`, `height`                         |
| POST | `/documents/:id/vector-boolean` | Combine closed path areas in a worker, revision checked; one atomic undo |
| GET    | `/documents/:id`                 | Document DTO, revision, undo/redo availability                         |
| POST   | `/documents/:id/commands`        | Apply validated command array as one atomic history entry              |
| POST   | `/documents/:id/undo`            | Undo one entry                                                         |
| POST   | `/documents/:id/redo`            | Redo one entry                                                         |
| DELETE | `/documents/:id`                 | Delete from the in-memory session                                      |
| POST   | `/documents/:id/assets`          | Upload binary image or base64 asset to document's asset store          |
| GET    | `/documents/:id/assets`          | List stored assets for the document                                    |
| GET    | `/documents/:id/assets/:assetId` | Retrieve raw image binary or JSON asset metadata                       |
| POST   | `/documents/:id/color-range` | Prepare native color coverage from an explicit PNG asset, revision checked |
| POST | `/documents/:id/selection-modify` | Modify native selection coverage with expand/contract/feather |
| POST | `/documents/:id/quick-selection` | Grow native color/edge coverage from painted seeds in an explicit PNG source |
| POST | `/documents/:id/select-subject` | Native original-raster contrast/alpha coverage with complete layer placement |
| POST | `/documents/:id/preflight` | Read-only native metadata/geometry design report with expected revision |
| POST | `/documents/:id/alpha-channel-load` | Load a saved channel with native Boolean/inverse coverage and a revision check |
| POST   | `/documents/:id/jobs`            | Submit asynchronous generation job (supports idempotency key)          |
| GET    | `/jobs/:jobId`                   | Poll status, progress, staged candidate, and error for an async job    |
| POST   | `/jobs/:jobId/cancel`            | Cancel an active or queued background job                              |
| POST   | `/documents/:id/apply-candidate` | Apply staged candidate to document with revision check and 1-step undo |

Mutations to an existing document require `expectedRevision`; mismatch returns **409**. Re-read before retrying. Invalid requests return **400**, disallowed origins/hosts **403**, missing or invalid authorization **401**, and missing documents/endpoints **404**. Successful creation returns **201**; async acceptance returns **202**; other successful JSON operations return **200**. JSON requests must use `Content-Type: application/json`. Binary asset uploads accept `image/png`, `image/jpeg`, `image/webp`, or `application/octet-stream`.

Create:

```sh
curl http://127.0.0.1:8787/api/v1/documents \
  -H 'Content-Type: application/json' \
  -d '{"name":"50 MP composition","width":10000,"height":5000}'
```

Using the ID from that response:

```http
POST /api/v1/documents/DOCUMENT_ID/commands
Content-Type: application/json

{
  "expectedRevision": 0,
  "label": "Name the composition",
  "commands": [{ "type": "document.rename", "name": "Autumn campaign" }]
}
```

Response envelope:

```json
{
  "document": {
    "schemaVersion": 27,
    "id": "...",
    "name": "Autumn campaign",
    "width": 10000,
    "height": 5000,
    "colorSpace": "srgb",
    "children": []
  },
  "revision": 1,
  "canUndo": true,
  "canRedo": false
}
```

Undo/redo/delete body: `{ "expectedRevision": 1 }` (use the current revision).

### Command reference

Commands use `type` plus the fields below. Unknown properties in command envelopes/patches fail validation. See `src/core/validation.ts` and `src/core/commands.ts` for exact schemas.

| Type              | Fields                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `document.resize` | Positive safe-integer `width`, `height`; resize canvas without moving artwork.                                                                                           |
| `document.crop`   | `bounds: { x, y, width, height }`; signed integer origin, positive integer dimensions, safe integer edges. Rebase content and unlinked masks; retain off-canvas artwork. |
| `document.rename` | `name`                                                                                                                                                                   |
| `layer.add`       | `layer`: serialized RasterLayer, PaintLayer, VectorLayer, TextLayer, AdjustmentLayer or LayerGroup; optional `parentId`                                                  |
| `layer.update`    | `id`, `patch`: name/position/opacity/fillOpacity/styles/metadata/mask/visibility/lock/blend mode; raster width/height; adjustment                                        |
| `layer.remove`    | `id`                                                                                                                                                                     |
| `layer.duplicate` | `id`; optional `newIds` maps source node/effect/stroke/path IDs to replay-stable IDs                                                                                     |
| `layer.reorder`   | `id`, `direction`: `up` or `down`                                                                                                                                        |
| `layer.reparent`  | `id`, `parentId`: group ID or null for document root                                                                                                                     |
| `selection.set`   | `selection`: full selection DTO or null; persisted and undoable                                                                                                          |
| `alphaChannel.set` | `channel: {id,name,selection}`: complete saved-channel data, added or replaced by ID |
| `alphaChannel.remove` | `id`: remove a saved channel without changing selection or masks |
| `alphaChannel.reorder` | `id`, `direction`: `up` or `down`; move within the saved-channel list |
| `selection.polygon` | `points`: 3–20,000 document-space `{x,y}` vertices; optional `operation`: replace (default), add, subtract, intersect. Closes/clips an even-odd polygon into fractional pixel coverage, with shared history. |
| `layer.place`     | `id`, `targetId` (layer ID or null), `placement`: before/after/inside, `preservePosition`: boolean. Inside requires a group or null root.                                |
| `paint.add`       | paint layer `id`, serialized `stroke` (brush/pencil/clone/fill)                                                                                                          |
| `paint.remove`    | paint layer `id`, `strokeId`                                                                                                                                             |
| `path.add`        | vector layer `id`, serialized `path`                                                                                                                                     |
| `path.update`     | vector layer `id`, `pathId`, `patch`: points/closed/fill/stroke/strokeWidth                                                                                              |
| `path.remove`     | vector layer `id`, `pathId`                                                                                                                                              |
| `effect.tone`     | raster `id`, `values`: exposure/contrast/saturation                                                                                                                      |
| `effect.reset`    | raster `id`                                                                                                                                                              |
| `effect.add`      | raster `id`, serialized tone `effect`                                                                                                                                    |
| `effect.update`   | raster `id`, `effectId`, `values`: enabled/exposure/contrast/saturation                                                                                                  |
| `effect.remove`   | raster `id`, `effectId`                                                                                                                                                  |
| `transaction`     | `label`, `commands`                                                                                                                                                      |

REST provides **headless document metadata, assets, jobs, and commands**. It does not control the active browser tab, render interactive canvas exports, or run browser user scripts. Raster `assetId` values reference uploaded or generated assets stored in the session's AssetStore. Limits of 10 MB per binary asset upload, 1 MB per JSON request, 256 commands per array, bounded nesting/complexity, and 100 session documents protect the control endpoint; they do not constrain browser image-import size. Durable persistent storage, OpenAPI generation and browser synchronization remain future work.

New drawing DTOs are defined in `src/core/drawing.ts`. The scripting guide documents their constructor defaults and coordinate conventions. Generate DTOs with `toJSON()` from trusted application code; REST accepts serialized values, not JavaScript constructor expressions. `styles` in a layer patch is a complete object containing `blendIf`, `colorOverlay` and `dropShadow`. Invalid colors, unordered Blend If ranges, malformed paths and unknown properties fail validation. REST clone tile asset IDs are metadata references only; browser script application additionally checks its real asset store.

### Authored layer metadata

All layer kinds accept `patch.metadata` in `layer.update`. It is a **complete replacement** object containing all seven fields below, or `null` to clear it. Omitting `metadata` leaves the existing record unchanged. Missing/unknown fields and invalid values return 400; limits match [LayerMetadata](SCRIPTING_API.md#layermetadata). Layer and ancestor locks apply. The command shares revision checks, atomic batches and undo/redo with other edits.

```json
{
  "expectedRevision": 1,
  "label": "Describe artwork",
  "commands": [
    {
      "type": "layer.update",
      "id": "LAYER_ID",
      "patch": {
        "metadata": {
          "title": "Botanical study",
          "description": "Working title for the collection",
          "altText": "Green leaves against a cream background",
          "creator": "Studio",
          "copyright": "",
          "license": "",
          "keywords": ["botanical"]
        }
      }
    }
  ]
}
```

Authored metadata was introduced in document schema v2. Current responses use schema v10; the REST route remains `/api/v1`. Metadata is returned in layer DTOs separately from immutable embedded file declarations. REST sessions remain independent of the browser document.

### Layer masks

`layer.update` accepts `patch.mask`: null to remove, or a complete object with `kind: "selection"`, `selection: { regions: [...] }`, `enabled`, `inverted`, and `density` (0–1). Regions use the existing selection DTO, but coordinates are local to the target layer rather than the document. The command obeys revision checks, locks, atomic batches and undo/redo. Unknown fields, kinds and invalid geometry fail validation. The constructor [LayerMask](SCRIPTING_API.md#layermask) documents compositing and coordinate behavior.

```json
{
  "expectedRevision": 1,
  "commands": [
    {
      "type": "layer.update",
      "id": "LAYER_ID",
      "patch": {
        "mask": {
          "kind": "selection",
          "enabled": true,
          "inverted": false,
          "density": 1,
          "selection": {
            "regions": [
              {
                "shape": "ellipse",
                "operation": "add",
                "x": 10,
                "y": 20,
                "width": 100,
                "height": 80
              }
            ]
          }
        }
      }
    }
  ]
}
```

A vector mask uses `kind: "vector"`, `paths: [{ points: [{ x, y, in: { x, y }, out: { x, y } }, ...] }]`, `fillRule: "evenodd" | "nonzero"`, and the same required `enabled`, `inverted`, `density` settings. Paths are implicitly closed; IDs and visual fill/stroke settings are not accepted. At most 128 paths / 20,000 total anchors are allowed; empty `paths` hides all before inversion. The DTO must contain either vector fields or selection fields, never both. It uses the same full replacement, validation, revision and undo contract. See [Bézier masks](SCRIPTING_API.md#bézier-masks) for constructor and source-layer capture semantics.

Selection, vector and painted mask DTOs accept optional `feather` (finite 0–128 document pixels). Omission means zero for compatibility with prior masks. It softens coverage before inversion/density; use a full mask replacement as with other settings. Invalid radii fail validation before any command commits. See [mask feathering](SCRIPTING_API.md#mask-feathering) for the kernel and rendering-budget contract.

Mask DTOs also accept optional `x`, `y` (finite numbers bounded by ±`Number.MAX_SAFE_INTEGER`, default 0) and `linked` (boolean, default true). Linked mask origins are relative to the accumulated layer origin; unlinked origins are document-space. Switching `linked` in a REST patch is a literal flag change. To preserve position while unlinking, add the layer/ancestor world translation to `x/y`; subtract it when linking. Submit the converted complete mask under the existing revision/transaction contract. No source geometry is mutated. See [mask position and linking](SCRIPTING_API.md#mask-position-and-linking).

Painted masks use `kind: "paint"`, required `base` (finite 0–1), `strokes: [{ mode: "hide" | "reveal", stroke: <complete brush/pencil DTO> }]`, and the same required enabled/inverted/density and optional position/link/feather fields. Stroke DTOs follow paint-layer brush/pencil data including IDs, points, size, hardness, opacity, color, nullable clip and empty tiles. Color is ignored for mask coverage; clone/fill/source tiles are rejected. Bounds are 2,048 strokes and 200,000 total points (20,000 per stroke); request payload bounds still apply. Submit a complete replacement via `layer.update`, preserving revision checks, locks and undo. Selection/vector fields are not allowed on a painted mask. See [painted masks](SCRIPTING_API.md#painted-masks).

Selection and vector mask DTOs also accept optional `strokes` with the same ordered Hide/Reveal brush/pencil entries and budgets. Omission means no refinements. These operations run after selection/path coverage and before feather/inversion/density. Their presence does not change `kind` or replace the geometry. Existing full-replacement, strict validation, revision and undo rules apply.

Bézier subdivision through `VectorPath.splitSegment(index, t)` emits the existing `path.update` with the complete subdivided `points` array. REST clients submit that array via the same command and revision precondition; no separate split endpoint exists. Mask subdivision instead replaces the vector mask through `layer.update`, retaining its settings/refinements.

Canvas crop uses the same revision-checked command endpoint:

```json
{
  "expectedRevision": 3,
  "commands": [
    {
      "type": "document.crop",
      "bounds": { "x": 32, "y": 24, "width": 640, "height": 480 }
    }
  ]
}
```

A crop can extend outside the prior canvas. It preserves source assets and local geometry, rebases root layers/unlinked masks/pixel selections, and applies to locked layers as a document-level coordinate change while retaining their locks. Invalid rectangles or resulting out-of-range coordinates fail atomically. The next successful undo restores the previous canvas and positions. This does not add image rendering or asset storage to the headless REST service.

### Adjustment layers and tonal adjustments

Document schema version 4 introduces `kind: "adjustment"` layers. Adjustment layers modify the preceding backdrop stack non-destructively, strictly preserving the backdrop's alpha channel. They do not own raster assets or spatial width/height; spatial bounds return undefined.

Adjustment DTOs use `adjustment: AdjustmentData`:

- **Curves (`kind: "curves"`)**: `rgb: CurvePoint[]`, optional `red`, `green`, `blue: CurvePoint[]`. Each point has `x` and `y` in `[0, 255]`. Control points must have strictly increasing `x` values (at least 2 points). Evaluated using monotone cubic spline interpolation (Fritsch-Carlson algorithm).
- **Levels (`kind: "levels"`)**: `rgb: LevelChannelData`, optional `red`, `green`, `blue: LevelChannelData`. Each channel defines `inputBlack` (0..254), `inputWhite` (1..255 with `inputWhite > inputBlack`), `gamma` (finite > 0, typical 0.1..5.0), `outputBlack` (0..255), and `outputWhite` (0..255 with `outputWhite >= outputBlack`).
- **Tone (`kind: "tone"`)**: `exposure` (-5..5), `contrast` (-100..100), `saturation` (-100..100).

Clients mutate adjustments through `layer.update` with `patch: { adjustment: ... }`. Invalid point orders, non-monotonic curves, overlapping level ranges, or non-adjustment layer patches fail validation atomically.

### Asset management endpoints

The REST API supports storing and serving real binary assets for document layers.

- **Upload asset (`POST /api/v1/documents/:id/assets`)**:
  - Accepts raw binary image files (`Content-Type: application/octet-stream`, `image/png`, `image/jpeg`, `image/webp`) or JSON payload with `{ name, mimeType, data }` where `data` is base64-encoded bytes.
  - Stored in the document's session `AssetStore`.
  - Returns `201 Created` with asset metadata: `{ asset: { id, name, mimeType, byteSize, width, height } }`.
- **List assets (`GET /api/v1/documents/:id/assets`)**:
  - Returns `{ assets: AssetDescriptor[] }` for all assets registered to the document.
- **Get asset (`GET /api/v1/documents/:id/assets/:assetId`)**:
  - Request with `Accept: application/octet-stream` (or matching image mime type) returns the raw binary image buffer.
  - Request with `Accept: application/json` returns the asset metadata descriptor.

### Asynchronous generation jobs

REST job execution is a separate headless integration boundary, not the browser generation service. The default server has no generation executor and returns **503** without creating a job or fabricating pixels. A host may explicitly configure `createApiServer({ executeGeneration(request, signal) })`; the executor must own provider authorization, budget enforcement and billing and return decoded RGBA bytes matching the requested dimensions. The server validates the byte count and encodes a real PNG. No production provider adapter is bundled. REST analysis jobs return **501** until implemented. Tests inject a procedural executor from test fixtures only.

- **Submit job (`POST /api/v1/documents/:id/jobs`)**:
  - Accepts a generation request: `{ kind?: "generation", prompt?, targetWidth?, targetHeight?, idempotencyKey?, expectedRevision? }`.
  - Keys are scoped to the document and normalized request content. Identical retries return the original job; changed inputs return **409**. Keyed jobs remain retained for the server session rather than losing deduplication through pruning. Restart persistence is not implemented.
  - Returns `202 Accepted` with `{ job: JobDescriptor }` (`status: "queued"` or `"running"`).
- **Poll job status (`GET /api/v1/jobs/:jobId`)**:
  - Returns `{ job: JobDescriptor }` containing current `status` (`"queued"`, `"running"`, `"succeeded"`, `"failed"`, `"cancelled"`), `progress` (0.0–1.0), `error` (if failed), and `candidate` (if succeeded).
- **Cancel job (`POST /api/v1/jobs/:jobId/cancel`)**:
  - Cancels an in-flight or queued job and signals the executor. Late output cannot become a candidate. Completed jobs retain their terminal status.

### Applying staged candidates

Once an async generation job succeeds, its staged candidate can be applied directly onto the document canvas.

- **Apply candidate (`POST /api/v1/documents/:id/apply-candidate`)**:
  - Request body: `{ candidateId: string, expectedRevision: number, layerName?: string, parentId?: string | null, blendMode?: BlendMode, opacity?: number }`.
  - **Precondition check**: Requires matching `expectedRevision`; returns **409 Conflict** if the document was mutated concurrently.
  - **Single-transaction undo**: Creates a new `RasterLayer` backed by the candidate's asset in the document's `AssetStore` and applies it within a single `Document.transaction`.
  - Returns `200 OK` with `{ document: DocumentData, revision: number, canUndo: true, canRedo: false }`.
  - Can be undone in 1 step via `POST /api/v1/documents/:id/undo`.

### Affine selection regions (schema v5)

`selection.set` accepts an optional `transform: { a, b, c, d, e, f }` on each region. It maps region-local rectangle/ellipse coordinates into selection coordinates; absent means identity. Matrices must be finite and invertible. Mixed transformed regions preserve add/subtract/intersect order. Invalid matrices reject the entire command batch without changing the document or revision. The same representation persists in selection-based masks and captured paint clips. Existing v1–v4 documents migrate through `Document.fromJSON`; this change does not expose affine layer transforms yet.

Protected generation candidates are verified by the host using copied reference/mask data and actual candidate pixels; provider diff reports are not trusted. Masked-edit staging requires matching reference dimensions. `applyMaskedEdit` must use a retained staging verification context or provide `referenceBuffer` with exact candidate dimensions. Missing context/readback fails even with `allowViolationOverride`; that flag only permits an evaluated violation. Ordinary candidate application also rechecks retained masked-edit context before commit.

Host-side `EditorApplication.saveProject(): Promise<Blob>` asynchronously saves a v3 `.luma` container with SHA-256 checksums. Await it before constructing a File or starting a download. The snapshot and immutable source references are captured before hashing, so edits made while saving are not silently marked saved. This is a host API; the isolated scripting runtime does not gain filesystem/download access. V1 JSON and v2 binary projects remain readable and migrate on the next save.

Layer selection now carries an ordered set alongside the active layer. Public DOM callers use `document.selectLayers(...)`, `document.selectedLayers`, and `document.layerSelection` for atomic translation/alignment/removal. Isolated script transport validates and round-trips the full selected ID set; read-only plugins cannot alter it. This is ephemeral session state, independent of serialized pixel-marquee selection. REST command batches can express the resulting layer updates atomically; there is not yet a dedicated REST multi-selection session endpoint.

Host workspace tab ordering: `editor.moveDocument(document, index): void` moves an open document to a zero-based final tab index. It throws for a document outside the workspace or an invalid index. Moving tabs preserves the active document, selection, history and revision. This host method is not exposed in the isolated script runtime.

`await editor.copySelectedLayersTo(targetDocument)` copies selected root layers from the active document into another open document and returns the new layer handles. Selected descendants under a selected ancestor are included once. Copies receive fresh layer/effect/stroke/path and asset IDs; original source blobs, bitmap-mask assets and clone-tile assets are copied into the destination's store. Root positions remain in document space. Copying adds one undo entry and selects the destination copies without activating the target tab. It rejects empty selections, same-document/closed destinations, missing assets, or destination edits during async decoding; failure removes newly installed destination assets. Captured source content is a point-in-time snapshot. This is a host API, not an isolated scripting API or OS clipboard integration.

`await editor.saveWorkspace(): Promise<void>` atomically replaces this browser's explicit workspace checkpoint after encoding every open document as a checksummed portable project. It captures tab order, active index, selections and per-tab canvas views at invocation. It does not mark documents as downloaded/saved. Storage failures reject.

`await editor.restoreWorkspace(): Promise<Document[]>` validates and decodes all checkpointed documents before opening any. It restores order, selection, active tab and views, appending copies beside existing work (only an untouched initial blank is discarded). Missing/invalid checkpoints reject without adding tabs. Restored documents have fresh session identities and require a downloaded backup; undo history and transient tool gestures are not restored. These are host APIs, unavailable inside isolated scripts. The checkpoint is browser-local and is removed by clearing site storage.

Workspace checkpoints also retain each document session's standard RGB profile and soft-proof options (proof space, rendering intent, gamut warning and optional RGBA warning color). Earlier version-1 checkpoints without these fields restore as sRGB with no proof. Values are validated before save/load; unsupported spaces/intents and nonfinite or out-of-range warning channels reject. These workspace settings do not imply arbitrary ICC-profile embedding in portable projects.

Concurrent `saveWorkspace()` calls on one editor capture their own invocation-time content and publish checkpoints in request order. Failed encoding/storage rejects that call without blocking later saves. Browser transaction failure preserves the previous completed workspace checkpoint. Independent application tabs still share the explicit checkpoint slot; cross-tab named workspace management is not implemented.

Named workspace milestones: `await editor.saveWorkspaceVersion(name): Promise<string>` captures an immutable browser-local version and returns its unique ID. Names are trimmed and must contain 1–120 characters; duplicate labels create separate versions. `await editor.workspaceRepository.listVersions()` returns IDs, labels and timestamps, newest first. `await editor.restoreWorkspace(versionId)` restores a named version through the same validated all-or-nothing decode path. Named versions do not replace the current/startup checkpoint. They are full snapshots and consume browser storage; deletion/retention controls are not yet exposed. These methods remain host-only.

`await editor.workspaceRepository.removeVersion(versionId): Promise<void>` removes only a named-version key and its embedded project blobs in one transaction. Invalid IDs, including `current`, reject. Removing an already absent valid ID succeeds. This does not affect open document copies or the current/startup checkpoint. Recover work exposes a two-click Remove version / Confirm remove version control.

Schema v6 adds an optional invertible layer `transform` basis. Shared `layer.update` accepts `{ transform: { a, b, c, d, e: 0, f: 0 }, x, y }`; nonzero basis translation, singular matrices and nonfinite coefficients reject. The OOP `layer.transform` property exposes the full local-to-parent AffineTransform and splits translation into x/y on assignment. Rendering/export/bounds/hit testing use nested matrices. Interactive tool/reparent/mask-link/alignment migration remains unfinished; this is not full transform-tool support.

Host generation jobs expose `billingState: "reserved" | "pending" | "settled"` separately from execution state. A dispatched request without a confirmed cost retains its budget reservation after timeout, cancellation, or provider failure. Late provider results settle the reported cost without changing the terminal job state or staging late pixels. Host integrations must await `GenerationJobService.reconcileBilling(jobId, actualCostCents): Promise<void>` with a provider-confirmed final amount (including zero). Repeating the same settlement is idempotent; conflicting amounts, negative/nonfinite costs, unknown jobs, and undispatched jobs reject. This settlement method is not exposed to isolated scripts or plugins. Browser EditorApplication instances now use an IndexedDB accounting journal. `ready: Promise<void>` loads saved budgets/reservations; `recoveredAccounting()` refreshes and returns durable job accounting entries. `setBudgetConsent(budgetId, consentGiven, approverId?)` persists approval changes and must be awaited. Reconciliation also accepts a persisted job ID absent from the current in-memory job list. Headless services without an injected journal remain session-local. `cancelRecoveredQueued(jobId): Promise<void>` atomically cancels an undispatched saved request and releases its reservation; pending requests reject, and repeated zero-charge cancellation is safe. The generation dialog lists unfinished accounting and exposes queued cancellation. `restoreCandidates(): Promise<GenerationCandidate[]>` loads integrity-checked saved images and provenance for explicit review without a provider call. Restored candidates require `allowStaleRevision: true` placement approval; protected-composite checks still apply. `discardCandidate(id): Promise<void>` must be awaited and removes durable storage before the review bitmap. Repeating a completed request with its original idempotency key now reconstructs a successful job from its verified saved candidate, preserving the original ID, timestamps, base revision, cost and provenance. Lookup happens before provider resolution or fresh spend approval, so recovery works without a configured adapter or renewed consent. Conflicting request contents reject. Pending or discarded results return an explanatory terminal job without redispatch. Full in-flight/queued reconstruction and automatic queued resumption remain incomplete.

Headless `GenerationJobService` instances bind idempotency keys to canonical request contents, provider and budget. A repeated key returns the original job even after a billed validation failure; creating a deliberate retry requires a new key. Headless keyed jobs remain retained for the service session so cleanup cannot break polling or replay their charges; browser jobs can recover from their durable journal instead. This service contract is distinct from the REST server executor boundary described above.

Generation host submissions reject malformed target/reference geometry and mask buffers before budget reservation or provider invocation. Dimensions must be positive safe integers with a representable RGBA byte count. References contain exactly four RGBA bytes per pixel; masks contain one coverage byte per target pixel. Protected edits require matching reference dimensions, finite region geometry, and a finite nonnegative feather radius. No application megapixel ceiling is introduced by these checks.

Host-only protected placement preview: `GenerationJobService.previewCandidate(candidateId, { document, assetStore, ...ApplyCandidateOptions }): Promise<void>` renders the proposed placement using the application verifier and updates the staged candidate's composite report/thumbnail. It does not commit a layer, select a layer, add undo history, retain a promoted asset, or authorize an override. Protected candidates only; missing reference context, invalid placement and concurrent document changes reject. Reported pixel violations are review results rather than preview errors. The browser's Check placement action explicitly previews against the current document; subsequent Apply still performs its own revision and invariant checks. No REST or sandbox scripting preview endpoint is implied.

For candidates with a host-verified protection reference, placement evaluates the final rendered composition before requiring a violation override. Raw candidate differences hidden by the proposed layer mask do not themselves require an override if the rendered protected pixels remain unchanged. Check placement can establish this result for UI review; Apply always renders and checks again before committing.

### Persistent guide command

`{ type: "document.guides", guides: [{ id, orientation, position }] }` replaces the document guide array through `/documents/:id/commands`. Shared validation rejects duplicate IDs, invalid orientations and nonfinite/out-of-safe-range positions. Revision checks and one-transaction undo apply. Inner document schema 7 persists guides; this REST surface remains separate from browser sessions.

Tonal strokes use inner document schema v8 and the existing adjustment-layer command surface: an adjustment can be `{ kind: "tonal", strokes: [...] }`, with each stroke containing `brush`, `mode`, `range`, `exposure`, and optional `protectTones`. Shared validation rejects this data in schemas below v8. The browser scripting constructors and sample are documented under [Editable dodge/burn strokes](SCRIPTING_API.md#editable-dodgeburn-strokes); REST remains a separate headless document session.

Candidate placement assigns a fresh project asset ID for each promotion. Candidate IDs and staged asset IDs must not be treated as the inserted layer's asset ID; use the returned layer's asset reference. Reapplying after undo is supported and retains earlier history assets. Closing the destination document during asynchronous promotion or composite verification rejects the operation without adding layers or history. Explicit stale-revision approval does not bypass destination lifetime checks.

### Tonal sculpt REST operation

`POST /api/v1/documents/:id/tonal-sculpt` accepts JSON containing `expectedRevision`, `path`, `mode`, `range`, `exposure` and optional `options`. These are the same arguments and settings as `Document.applyTonalSculpt` in the scripting reference. It calls that DOM method and returns the document snapshot (`document`, `revision`, `canUndo`, `canRedo`) plus the new `layerId`.

```json
{
  "expectedRevision": 0,
  "path": [{ "x": 16, "y": 16, "pressure": 1 }],
  "mode": "dodge",
  "range": "midtones",
  "exposure": 1,
  "options": { "size": 12, "hardness": 1 }
}
```

A stale revision returns 409; invalid arguments or unknown keys return 400 without mutation. One undo removes the new adjustment layer; redo restores it. Current REST request-body limits still apply. This operation creates retained tonal stroke data in the independent headless document session; it does not synchronize with an open browser document or provide a new raster-rendering endpoint.

Isolated scripts now support awaited `document.patchRegion(selection, offset, options?)` through the private retouch preparation host. See the scripting reference for options and limits. Preparation includes preceding script commands, keeps new assets private until successful final commit, and never returns source pixels to the sandbox. This is not a REST endpoint: headless patch solving remains unimplemented.

The isolated scripting DOM additionally supports `await layer.healSpot(center, radius, options?)`. This uses private host preparation and the same atomic final commit as script patch regions. It returns an adjustment layer with retained repair pixels; it does not add a REST healing endpoint. See the scripting reference for coordinate, sampling, permission and resource-limit contracts.

### Embedded smart objects (introduced in schema 10; current schema 11)

The existing `/api/v1/documents/:id/commands` endpoint accepts:

- `{ type: "component.set", definition: { id, name, source } }`: register or replace an embedded master. `source` is `{ kind: "document", document: <document DTO> }` or `{ kind: "asset", assetId, width, height }`.
- `{ type: "component.remove", id }`: remove an unused master. Placed instances and references from other masters prevent removal.
- `layer.add` with a complete `SmartObjectLayer.toJSON()` DTO (`kind: "smart-object"`, `componentId`, `width`, `height` and common layer fields).

Define masters before adding their instances in the command array. Nested master documents contain smart-object references to the owning document's registry, not registries of their own. Shared graph validation rejects cycles, missing references and invalid geometry. Replacing a master rejects if any affected placed instance, including a transitive dependent, is locked directly or by an ancestor. Use the normal `expectedRevision` guard and command-array transaction for atomic undo; schema 11 is returned on document reads. Inner schema versions below 10 reject component fields and smart-object nodes.

The REST session remains separate from the browser; these commands do not implement headless smart-object rendering or file-linked masters. Public constructors and detached editing semantics are documented in [SmartObjectLayer and shared masters](SCRIPTING_API.md#smartobjectlayer-and-shared-masters).

`{ type: "smartObject.convertRaster", id, componentId, instanceId }` converts an existing raster layer through the same REST command endpoint. Supply a fresh component ID and fresh layer instance ID. It keeps the parent/stack index and placement properties, embeds existing tone effects and reuses original assets. Non-raster targets, missing targets, locked ancestry and duplicate IDs reject the transaction. Undo restores the raster and removes the newly created definition; redo retains the same generated identities. The constructor equivalent is `RasterLayer.convertToSmartObject()`.

`{ type: "smartObject.duplicateIndependent", id, instanceId, componentIds }` creates an independent smart-object copy. `componentIds` maps every master reachable from the selected instance (including its root) to a fresh component ID. The map must contain exactly those keys; missing/extra mappings, duplicate destination IDs, existing component IDs, reused layer IDs, non-smart targets and locked ancestry reject atomically. The new instance is inserted directly above the source with the ordinary 24-pixel duplicate offset. Root/nested definitions are cloned and references remapped without copying asset bytes. A command-array transaction preserves revision protection and one-step undo/redo. The public constructor method `SmartObjectLayer.duplicateIndependent()` allocates this mapping automatically.

`{ type: "component.replaceAll", definitions: [...] }` atomically replaces the document's embedded definition registry. It validates the complete graph and root placements and rejects changes affecting locked instances. Use the ordinary `expectedRevision` command-request guard. This permits coordinated edits to nested masters without requiring an intermediate graph to be valid. It does not upload image bytes or open browser tabs. Interactive contents tabs use this same shared command after privately preparing and validating image assets; their host-only lifecycle is documented in the scripting guide.

`{ type: "smartObject.filters", id, filters }` atomically replaces one instance's ordered stack. Each entry requires `id`, `enabled`, and one of: `{ kind: "gaussian-blur", sigma }`, `{ kind: "unsharp-mask", sigma, amount, threshold }`, `{ kind: "tone", exposure, contrast, saturation }`, `{kind:"frequency-band",sigma,band:"low"|"high"|"correction"}`, `{kind:"native-composition"}`, or `{kind:"document-tone",exposure,contrast,saturation}`. Document-tone entries must trail all native entries, including disabled entries. The three latter kinds require schema36. Fields are strict; values match the constructor limits in SCRIPTING_API.md, at most 32 entries are accepted, and IDs must be unique within the stack. Empty arrays clear filters. Wrong layer kinds, locked ancestry, invalid values and stale revisions reject without partial mutation. The command uses normal history/undo and is available through isolated scripts via the constructor methods. Schema 11 persists `smartFilters`; older schema versions reject that field on instances, including nested masters. REST sessions still do not render these filters headlessly.

### Generation request ownership and returned size

The trusted host's `GenerationJob.request` and `.options` getters return detached snapshots; changing them does not edit an accepted job. Submit a new request to change generation inputs. Output dimensions must equal the requested width and height. A mismatched result fails validation and cannot be published as a successful candidate, while any reported provider charge remains accounted for.

### Smart-filter mask command

`{ type: "smartObject.filterMask", id, mask }` sets a smart-object instance's filter-stack mask. `mask` is a validated LayerMask DTO or `null`; ordinary layers reject the command. Shared locks, asset validation, revision checks and transactional undo apply. Linked geometry uses native master pixels; unlinked geometry uses the containing document. See the scripting guide for density, inversion and coordinate semantics. New document snapshots use schema 14.

### Trusted-host batch notifications and generation transparency

Batch runner/service subscribe callbacks receive independent event snapshots. Mutating a notification does not change execution or other subscribers' notifications; use service methods for changes. GenerationRecord.hasAlpha reflects validated candidate pixels, including when the provider's alpha claim disagrees. These corrections add no REST or sandbox scripting endpoints.

Selection conversion uses `{ "type": "smartObject.convertLayers", "ids": ["layer-a", "layer-b"], "componentId": "new-master", "instanceId": "new-instance" }` in the existing document command endpoint. IDs must identify distinct contiguous siblings with unlocked ancestry; fresh component/instance identities are required. Input order does not reorder contents. Invalid selections reject the transaction. Successful conversion produces an isolated embedded master and one replacement instance, with ordinary revision checks and undo. Backdrop-dependent blending may change when the backdrop is outside the selection. Headless REST sessions remain separate from browser documents.

`smartObject.convertToRaster` accepts `{ type: "smartObject.convertToRaster", id: "smart-instance", layer: rasterLayerData }` through shared command arrays. The source must be an unlocked smart instance and the result must validate as a raster with a fresh layer ID. Replacement retains the sibling slot and participates in normal revision/undo rules. This headless endpoint commits externally prepared raster data; it does not generate raster pixels server-side. Browser hosts and isolated scripts prepare pixels through `await smartLayer.rasterize()` before issuing the same command.

Schema 13 asset component sources accept optional `link: { kind: "local-file", name, sha256, byteLength, lastModified }` through `component.set`. The cached asset ID and decoded width/height remain required. This endpoint records a declaration; it does not open files, verify local paths or fetch URLs. Project save/load verifies that declared fingerprints match embedded source bytes. Omitting `link` on a replacement asset definition embeds the same cached source. Shared lock/revision/undo rules apply. Browser file relinking is a separate host operation.

### Layer comp commands

Schema-14 documents optionally contain `layerComps`. REST command arrays accept `{ type: "layerComp.set", comp }`, `{ type: "layerComp.apply", id }` and `{ type: "layerComp.remove", id }`. Set inserts or replaces a strict LayerComp DTO: `{ id, name, documentId, options: { visibility, position, appearance }, layers }`. Each entry has `{ id, parentId }` and exactly the enabled category fields: `visible`, `position: { x, y, transform, width?, height? }`, `appearance: { opacity, fillOpacity, blendMode, styles }`. Dimensions are paired where present. IDs must be unique within a comp; document ownership must match. Missing saved target IDs are allowed so deleting a layer does not corrupt its saved comps. Application rejects changed coordinate parents or incompatible geometry and uses shared locks/revision/history validation atomically. It skips removed targets and leaves newly added layers untouched. Inspect comp IDs versus current layers to identify missing targets through REST. Constructor scripting provides capture and recapture helpers and returns missing IDs on application.

`{ type: "layer.distribute", ids: string[], axis: "horizontal" | "vertical", mode: "gaps" | "centers" }` distributes at least three independent existing roots in document space. IDs must be distinct. Selected descendants of selected groups are excluded. Shared lock, geometry and revision validation applies before committing one undoable operation. Endpoints and stacking order remain fixed; geometric spacing may be negative for overlapping artwork.

`{ type: "layer.flip", ids: string[], axis: "horizontal" | "vertical" }` reflects existing selected roots around their combined document-space geometric center. IDs must be nonempty and distinct. Selected descendants of selected groups are excluded. Locks, geometry, transforms and revision validation apply atomically. Native raster dimensions/source assets are retained; undo restores the original transforms.

Schema 15 adds adjustment DTO `{ kind: "hsl", hue: number, saturation: number, lightness: number }`: hue -180…180 degrees, saturation/lightness -100…100; all fields required and finite. Create through `layer.add` with an adjustment layer or replace its adjustment through `layer.update`. Existing revision, lock, validation and undo rules apply. Documents declaring schema 14 or earlier reject HSL nodes; supported older documents migrate to schema 15 when opened.

Host `BudgetLedger` methods return detached accounting snapshots, including `createBudget`, `getBudget`, `requireConsent`, `listBudgets`, `reserve`, and `listReservations`. Mutating a returned value does not change approval, reserved balances, or settlement ownership. Use explicit ledger operations for mutations; browser approval changes must use the durable service method described above.

### Schema 16 raster edits

Shared `layer.update` validation accepts `erasures` only on raster layers: an array (maximum 2,048) of `{ width, height, stroke }`, where positive dimensions capture the layer geometry at edit time and stroke is an eraser operation or an erasing fill. REST command clients use this validated DTO field; constructor-based scripts use `RasterLayer.erase(EraserStroke)` or `RasterLayer.clear(MarqueeSelection | null)`. Both follow shared locking, history and revision rules. Pixel selections use `shape: "pixels"` with validated RLE coverage; see SCRIPTING_API.md. Existing schema 1–15 inputs migrate to 16 after validation. Browser clipboard/wand sampling is not exposed as a headless REST service.

### Image size

`{ type: "document.resizeImage", width, height }` scales canvas dimensions and layer placement together. Both dimensions must be positive safe integers. This is distinct from `document.resize`, which changes canvas bounds only. REST commands use the same atomic validation and undo behavior as `Document.resizeImage(width, height)`; sources remain immutable and layers editable. Masks, selections, guides and saved root comp positions follow the document scale. Pixel-based effect settings retain their values. Recipes accept and record the same action (including numeric parameter expressions).

### Trusted browser export execution controls

`editor.export(options, control?)` and `editor.exportPng(control?)` accept optional `{ signal?: AbortSignal, onProgress?: (progress: { phase: "rendering" | "encoding", fraction: number | null }) => void }`. Controls are host-only execution state, separate from serialized format options; isolated Scripts and REST do not receive these browser services. Progress callbacks must not throw. Cancellation rejects with the signal reason (normally AbortError), releases current raster resources and prevents a completed result from being returned by the host. Raster work, including rendered PSD, checks between tiles/strips; browser encoding, synchronous SVG work and a single PSD strip are not preemptible. See the application-integration section of SCRIPTING_API.md for the complete current boundary.

### Polygon selections

`selection.polygon` closes the supplied contour and stores antialiased pixel coverage using the same `Document.selectPolygon` implementation as the browser and isolated scripts. Coordinates may be fractional but must be finite and within the safe-integer range. Even-odd filling, 4×4 subpixel coverage and clipping to the current canvas match the lasso. Unknown fields, invalid modes, fewer than 3/more than 20,000 vertices, an empty/off-canvas polygon, or more than 128 combined regions fail atomically with 400. Normal `expectedRevision` conflict checks (409), undo/redo and transaction rollback apply. Layer locks do not prevent document selections. Subtract/intersect without a prior selection selects nothing. This is synchronous local geometry work; it performs no image upload or model call.

```json
{
  "expectedRevision": 0,
  "commands": [{
    "type": "selection.polygon",
    "points": [{"x": 10, "y": 10}, {"x": 80, "y": 10}, {"x": 10, "y": 80}],
    "operation": "replace"
  }]
}
```

The headless REST document remains separate from the browser document. Pixel coverage uses the existing schema-16 representation; no project-format migration is required.

### Asynchronous selection modification

`POST /api/v1/documents/:id/selection-modify` accepts `{ expectedRevision, operation, radius }`, with operation `expand`, `contract` or `feather` and required integer radius 1–128 document pixels. It uses the same `Document.modifySelection` boundary and actual WASM/native tile implementation as the browser. Disk expansion/contraction preserve grayscale coverage; feathering uses three box passes with radius/3 per pass. The current combined selection is sampled at native resolution, outside-canvas coverage is zero, and the final result is clipped to the canvas. Existing layers and source assets are unchanged.

The HTTP response waits for a dedicated Node worker and returns the normal document snapshot on success (200), with one undo entry. GET and other document requests remain available while pixel work runs. Invalid/unknown fields, missing selection or processing failure return 400. A stale expected revision or a concurrent document edit returns 409 without applying prepared coverage; deletion and client disconnect discard the result. Disconnect terminates the worker. This local endpoint does not expose browser-session state or cloud services. Large/fragmented coverage can still consume significant processing time and serialized-result memory.

```bash
curl -X POST http://127.0.0.1:8787/api/v1/documents/DOCUMENT_ID/selection-modify \
  -H 'Content-Type: application/json' \
  -d '{"expectedRevision":1,"operation":"feather","radius":8}'
```

The local service allows at most four concurrent selection workers across its documents. Excess requests receive 409 with a busy/retry message. This bounds active processing resources and does not limit image dimensions or import size. Deleting a target document aborts its pending selection workers; server shutdown also disposes their controllers.

### Color Balance and Vibrance

Shared `layer.add` and `layer.update` adjustment DTOs accept schema-17 Color Balance and Vibrance through the existing authenticated/revision-checked commands endpoint. No new route is needed. Color Balance is `{ kind: "color-balance", shadows: {red,green,blue}, midtones: {red,green,blue}, highlights: {red,green,blue}, preserveLuminosity: boolean }`; all nine channel values are required finite numbers in [-100,100]. Vibrance is `{ kind: "vibrance", vibrance, saturation }`, with both required finite values in [-100,100]. Unknown/missing/invalid fields return 400 without committing; ordinary revision conflicts return 409. Locks, transaction rollback, undo/redo and constructor handle behavior remain shared. See SCRIPTING_API.md for exact encoded-sRGB tonal weights and gamut/luma math. Headless REST state remains separate from browser state and this route does not render pixels on the server.


### Gradient map adjustment commands

The existing revision-checked `layer.add` and `layer.update` commands accept schema-18 `{kind: "gradient-map", stops: [{position, color}, ...], reverse: boolean}`. All fields are required; stop objects reject unknown fields. Use 2–32 strictly ordered, distinct finite positions in [0,1] and six-digit `#RRGGBB` colors; duplicate/unsorted/invalid stops return 400 without edits. Revision conflicts return 409; locks, transaction rollback and undo/redo are shared. See SCRIPTING_API.md for brightness/interpolation, endpoint clamping, reverse, alpha and processing-space semantics. There is no new route or permission. REST documents remain separate from the browser and this command endpoint does not render server-side pixels.


### Browser-host rendered PSD output

Trusted `editor.export({format:"psd", psdMode?:"layers"|"flatten"}, control?)` defaults to supported nested folders, child pixel records and separate document-bounded user masks. It merges unsupported adjustments/Blend If in their real isolation scope, carrying dependencies through pass-through groups. Styled folders keep one rendered child; group fill folds into opacity, non-Normal pixel fill/masks bake, and unstyled Normal pixel fill stays separate. Preflight reports each loss, including hidden contents omitted inside baked scopes. Flatten emits one visible-composition layer. Native dimensions, placed-raster bounds, names/visibility/locks/opacity/modes and current appearance are carried through this RGB8 subset, with white-matted-preview rounding. Format/allocation failures reject explicitly without an import-resolution cap. See SCRIPTING_API.md for defaults, masks/control/off-canvas limits, errors, progress/cancellation and zero-asset group-only import. No HTTP export endpoint or browser synchronization is added.


Trusted browser `editor.openPsd(buffer, {mode?, legacyStraightAlpha?})` accepts an explicit legacy straight-alpha override for old unmarked files; the normal path recognizes older Canoli ICC identifiers and container layout automatically and distinguishes standard extra alpha channels from signaled merged transparency. This is a browser import option, not a REST endpoint or script capability. See SCRIPTING_API.md for the exact default/compatibility boundary.


### White Balance adjustment commands

Existing revision-checked `layer.add`/`layer.update` commands accept schema-19 `{kind:"white-balance", temperature, tint}`. Both fields are required finite numbers: temperature 2000–25000, tint -100–100; unknown/missing/invalid fields return 400 atomically. Revision conflicts remain 409. Locks, history and transaction behavior are shared. SCRIPTING_API.md specifies D65-relative illuminant/tint semantics, Bradford adaptation in linear sRGB, defaults, clipping, alpha and byte precision. This does not add REST pixel rendering or synchronization with browser documents.


### Color Lookup (LUT) adjustment commands

Existing revision-checked `layer.add`/`layer.update` commands accept the strict schema-20 LUT adjustment DTO specified in SCRIPTING_API.md. The packed little-endian float32 table, 1D/3D dimensions, domain, amount and interpolation are validated at the common host boundary. Malformed base64/length, nonfinite values, invalid domains, unknown fields and unsupported interpolation return 400 atomically. Locks, revision conflicts (409), undo/redo and transaction validation remain shared. This adds no REST parsing/rendering route or browser synchronization. Trusted clients can call the exported `parseCubeLut` helper before submission; the existing 1 MB JSON request limit remains and may exclude larger packed tables from a single REST request.


### Native PNG-source Color Range

`POST /api/v1/documents/:id/color-range` accepts `{expectedRevision, colors, exclude?, fuzziness?, invert?, operation?, source:{kind:"asset", assetId, x?, y?}}`. Sampling is at original PNG resolution, translated by integer x/y (default 0) and clipped to document bounds. The shared ColorRangeOptions/Document.selectColorRange contract defines CIELAB distance, falloff, defaults, strict validation and fractional Boolean operations; see SCRIPTING_API.md. Success commits one selection edit and returns the normal snapshot. Invalid options/assets/results/formats return 400 without edits; stale revisions return 409. Locks on artwork do not prevent document selection. The shared selection-worker concurrency limit is four; client disconnect/deletion/revision change cancels native preparation.

The real Node worker decodes noninterlaced 8-bit unmarked/explicit-sRGB PNG (gray, RGB, indexed, optional alpha/tRNS), validates chunk CRC/order and row filters, inflates bounded scanlines/strips and executes the same WASM color kernel as the browser. Color declarations precede the palette and image data; an optional palette precedes transparency. These ordering rules follow the [PNG specification](https://www.w3.org/TR/png-3/#5ChunkOrdering). Unsupported ICC/HDR (including cICP/mDCV/cLLI), animated/interlaced/16-bit PNG, other source formats and non-asset source modes reject explicitly. It reads raw PNG pixels without EXIF orientation, ICC conversion, layer effects or a headless scene compositor. Upload a normalized sRGB PNG when those operations are needed. Separate REST documents never control the browser tab. Existing JSON/binary upload limits remain; no image megapixel/import cap was added.


### Saved alpha channels

Document schema 21 adds optional `alphaChannels: [{id,name,selection}]`, with at most 64 unique channel IDs. `selection` is the complete existing fractional selection DTO. Channels do not affect rendered artwork by themselves. CRUD commands use the normal revision-checked commands endpoint: `alphaChannel.set` with `channel` adds/replaces complete validated data; `alphaChannel.remove` with `id` removes it; `alphaChannel.reorder` with `id,direction:"up"|"down"` moves one list position (up toward index zero). Invalid data, missing IDs and failed batches leave state unchanged. Artwork locks do not restrict document-level channels.

`POST /api/v1/documents/:id/alpha-channel-load` accepts `{expectedRevision,id,operation?,invert?}` and returns the usual snapshot after one selection commit. Operation defaults to replace, with add/subtract/intersect alternatives; invert defaults false and applies across the current canvas. The real Node worker rasterizes complete saved/current expressions at native resolution using the same WASM selection math as the browser, then combines byte alpha. It uses bounded native tiles/scanline bands, not image decoding or a headless scene renderer. Document revision, session deletion and client disconnect cancel preparation. This shares the four-worker selection-service concurrency budget. Missing/invalid channels/options return 400; revision conflicts return 409. Existing body/command limits remain.

Channels are retained by `.luma` projects and workspace history. Crop/image resize transform channel geometry with the artwork; canvas resizing keeps it fixed. Loading/renaming/removing channels preserves source assets and previously captured layer masks. See [Alpha channels](SCRIPTING_API.md#alpha-channels) for constructor/member contracts, precision, errors and current limitations.


### Native PNG-source Quick Selection

`POST /api/v1/documents/:id/quick-selection` accepts `{expectedRevision,points,size?,tolerance?,edgeThreshold?,operation?,source:{kind:"asset",assetId,x?,y?}}`. Defaults, exact seeded region-growing math, native coordinates, fractional coverage and errors match Document.selectQuickSelection in SCRIPTING_API.md. The actual Node worker decodes the published plain noninterlaced 8-bit PNG subset, validates its payload/dimensions, clips it to document bounds at integer source placement and runs the shared WASM grower. It does not read/render the browser session, orient EXIF or convert ICC data. Original PNG bytes are unchanged. Unsupported/malformed data, missing/transparent seeds and invalid requests return 400 without edits; stale revisions return 409. One successful request creates one selection undo entry.

The existing four-worker selection-service budget, upload/body/complexity limits, client-disconnect/session-deletion/revision cancellation and isolated headless document scope remain. Native connectivity retains source/state planes and can exceed actual WASM/process memory; bounded PNG strips do not imply constant-memory segmentation or an image import limit.


### Native original-raster Select Subject

`POST /api/v1/documents/:id/select-subject` accepts `{expectedRevision,targetLayerId?,threshold?,expandRadius?}`. Specify the target raster in headless sessions; otherwise the DOM's selected target is used. Threshold defaults to 0.35 in [0,1]; expansion defaults to 0 and accepts integer 0–64 original-source pixels. The host resolves its own source asset/dimensions and complete world placement, decodes a real noninterlaced 8-bit unmarked/explicit-sRGB PNG in a private Node worker and runs the same native contrast/alpha kernel as the browser. It retains holes, disconnected evidence and fractional source alpha, without a bounds-only result or fabricated source/fallback. Layer appearance adjustments/masks/opacity are not sampled; original bytes remain unchanged. Full ancestor transforms and placed scaling are applied to the retained native coverage.

The exact heuristic, defaults, source-plane expansion, errors and memory limits are documented under Select Subject in SCRIPTING_API.md. Missing/non-raster/unsupported/no-foreground sources and invalid options return 400 without changing prior coverage/history; stale revisions return 409. Success creates one ordinary selection undo entry. Disconnect, document deletion and revision changes cancel private work. The shared four-worker selection capacity and existing upload/body/result limits remain. No browser scene rendering/synchronization, EXIF orientation, ICC conversion, semantic model or evaluated matting accuracy is added.


### Native Refine Edge and background removal

`POST /api/v1/documents/:id/refine-edge` prepares a source-native matte for an attached unlocked raster in that headless session. Upload original/trimap PNGs through the existing assets endpoint and create the raster through shared constructors/commands first. The strict body contains `expectedRevision`, `layerId` and optional nested `options`; all defaults, aliases, ranges, output modes and source-coordinate strokes are defined in SCRIPTING_API.md.

```json
{
  "expectedRevision": 3,
  "layerId": "raster-id",
  "options": {
    "radius": 25,
    "smoothness": 0,
    "decontaminate": true,
    "trimapAssetId": "uploaded-trimap-id"
  }
}
```

JSON clients use `trimapAssetId` (native-sized PNG alpha labels 0/128/255), rather than the in-process Uint8Array `trimap`. Native circular trimap strokes are also supported. The default output edits the bitmap mask on the existing raster; decontamination defaults to a new corrected raster immediately above the hidden original. Explicit decontamination plus `outputTo:"mask"` rejects. Successful responses contain the ordinary revision/document snapshot and one undo entry; new asset IDs are in the resulting raster/mask and can be downloaded through the existing raw-asset endpoint. Source compressed bytes remain unchanged. The foreground PNG retains intrinsic alpha separately from the relative mask.

The worker decodes the same noninterlaced 8-bit unmarked/explicit-sRGB PNG subset as Select Subject, validates native dimensions, samples the effective existing selection/bitmap mask with density/inversion/feather and complete placement, otherwise current selection, otherwise the native Subject heuristic. Painted/stroked/vector input masks reject explicitly; provide a supported mask or remove it and supply a native PNG trimap. Bitmap masks use defined bilinear alpha sampling; arbitrary Canvas antialias/scene parity is not implied. Disabled/zero-density masks do not seed refinement. No EXIF orientation, ICC conversion, browser formats, browser scene rendering or tab synchronization is added.

The default global closed-form Laplacian and fractional WASM feather run in a terminable private Node worker. `options.solver:"color-line"` explicitly selects the former local method. Unknown rows keep connections across capture seams; budgeted IC(0) preconditioning (or global Jacobi when that factor cannot fit) preserves the original system and previous base graph capacity. An optional RGB-aware global Galerkin correction fits within that same budget after reserving base/IC(0) capacity; unavailable optional memory/work/factorization retains the base route. The 192 MiB estimated graph budget and 2,000-CG-iteration ceiling apply before any asset commit. Base success requires actual relative residual <=1e-7; active coarse correction tightens this to <=1e-9 without changing the native matrix or hard constraints. Genuine graph allocation/nonconvergence errors return 400 with the original intact. This is not an evaluated semantic model or a claim of natural hair/glass accuracy. Output PNGs stream bounded tiles/strips, while source/optional bitmap-mask decoding retains full native planes. Actual address-range/memory/format failures return 400 with no commit; no image import cap is added. Invalid options/labels, locks, missing sources, no foreground and unsupported inputs also return 400. Stale revisions and the shared four-worker selection capacity return 409. Disconnect, deletion and revision changes cancel the job; private assets cannot commit late. Current upload/body limits remain.


The shared native closed-form matting solver can use private float64 WASM sparse iterations when optional graph capacity fits. This is an internal backend choice; REST request fields, commands, output ownership and revision/cancellation behavior remain the same. Optional allocation/capacity failure retains the global JavaScript route. Headless REST sessions still do not synchronize with the browser. The scripting guide describes operation budgets and measured limitations.


### Read-only design checks

`POST /api/v1/documents/:id/preflight` accepts the strict body `{ "expectedRevision": 0, "options": { "outputDpi": 300, "minimumPpi": 150 } }`; options may be omitted. Success is HTTP 200 `{ "report": PreflightReport }`, without a revision/history/selection/asset change. See [Design checks](SCRIPTING_API.md#design-checks) for all defaults, finding codes, evidence and operation/output limits. The document's configured OO `preflight` method uses a terminable private Node worker and the same numerical/geometry rules as the browser. Original stored dimensions are used without decoding pixels; no font environment is supplied, so referenced families remain unverified. This service does not inspect or control a browser tab.

Expected-revision mismatch or a document change during inspection returns 409. Invalid options return 400. Client disconnect and document deletion stop pending work; no result commits anything. The existing four-worker selection/inspection concurrency budget is shared. Standalone constructor use can inspect geometry without a configured host, with unavailable metadata explicitly reported. Native document dimensions, schemas and import limits are unchanged.


### Host SVG extraction (2026-10-16)

Trusted browser editor.export({format: "svg"}, control?) pins an immutable document snapshot before yielding, so later edits cannot change the captured output. It uses the hierarchical vector/raster/text/paint/group serializer with smart-master expansion: full local affine matrices, ancestor visibility, isolated layer/fill opacity and CSS blend modes. Outside native backdrop prefixes, unfeathered vector masks remain editable; other masks use native-resolution embedded PNG coverage with rasterization reported. Color overlays and document-space drop shadows remain editable SVG filters; the capability report exposes native adjustment/Blend If backdrop prefixes and their baked editability; remaining SVG blending depends on viewer support. SVG encoding reports phase "encoding" with fraction null and yields between bounded fragments for cancellation. Constructor VectorLayer.toSvg remains synchronous and extracts only its own immediate parent plane; see SCRIPTING_API.md for exact defaults, errors and limits. No REST SVG-render endpoint or browser synchronization is introduced.


SVG masks use document-resolution coverage without embedding original bitmap RGB. Native preparation reports rendering progress, checks current asset identities/repository lifetime and releases each tile on success, failure or cancellation. Missing/changed source assets reject the operation. Standalone layer serialization supports pure vector masks and rejects those requiring native host preparation; exact behavior is in SCRIPTING_API.md. This changes the existing trusted host export surface, not REST routes, asset permissions or isolated-script file access.


Host SVG and standalone VectorLayer.toSvg preserve color-overlay/drop-shadow parameters as SVG filters. Shadow blur/offset remain in document-pixel units through full affine nesting; mask coverage precedes effects, fill opacity affects content without suppressing the shadow, and final layer opacity affects both. Native coverage tiles include required off-canvas shadow support. Viewer filter/rounding/allocation limits and the remaining Blend If loss are reported explicitly. Signatures and script/asset/REST permission boundaries are unchanged.

Host SVG export also embeds visible raster layers. Unmodified rasters use source-resolution PNG pixels with editable affine placement; repeated instances share one image definition. The host re-encodes decoded pixels, excluding original EXIF/GPS/author and other source-file metadata without altering original asset bytes. Complete decoded source images include pixels hidden by masks or canvas clipping; choose PNG for flattened delivery. This is not redaction. Raster tone edits and erasures are baked into document-resolution PNG images clipped to expanded shadow support, while masks, styles and surrounding vectors remain separate. The report identifies baked operations and lost off-support content; save a project for full editability.

Image preparation reuses streamed native PNG rendering with bounded tiles/strips. All image and bitmap-mask sources are pinned together before progress callbacks; missing/replaced/disposed sources and cancellation reject without a partial result. Known rendering progress covers images and native masks before indeterminate SVG encoding. Output PNG/base64, resident decoded sources and viewer allocations still consume memory. Native PNG format geometry and real decoder/device limitations apply; no import-resolution cap is added. This changes neither export signatures nor REST/script/plugin capabilities.

Visible nonempty text outside native backdrop prefixes also exports as editable SVG text, with per-line native baseline measurements, typography, physical alignment, direction and the existing affine/mask/style hierarchy. Fonts are referenced, never embedded; viewer substitution/shaping/hinting can change appearance. Pending fonts and relevant registered-family changes reject; unrelated font loads do not invalidate output. Invalid font/color assignments, missing measurement support, cancellation and XML-invalid text fail without partial output or history changes. This adds no REST renderer, isolated script export method or font-file capability. See [editable SVG text](SCRIPTING_API.md#editable-text-in-svg-export) for whitespace, defaults, measurement limits and a verified constructor example.

Host SVG also expands unfiltered smart masters into supported editable vector/raster/text/paint contents, with nested placement, masks, styles and editable master-canvas clips. Enabled smart filters instead use native document-resolution PNG content with native filter masks, while outer instance masks/styles/opacity remain separate. The report distinguishes baked content/filters/off-support pixels from independent editable contents, and identifies lost shared master links. Linked images use stored snapshots without file access/refresh. Native filtered dependencies and text fonts are captured/checked across preparation and encoding; missing/changed sources, graph/budget errors and cancellation reject without partial output or history changes. The shared 4,096-node/64-level render budget is independent of import resolution. See [smart SVG contents](SCRIPTING_API.md#smart-object-contents-in-svg-export); API signatures, schemas, REST rendering and isolated script/plugin file privileges are unchanged.


Host SVG retains visible paint outside native backdrop prefixes as editable vector dabs and fill rectangles, with native pressure/flow, whole-stroke opacity and ordered erasure masks. Clone snapshots embed sanitized native-resolution source pixels beneath editable brush coverage; layer/group masks/styles/placement remain separate. Stroke selections use native coverage bounded to their transformed extent, without downsampling. The report distinguishes these primitives from the original brush-command model and discloses omitted off-support dabs, raster coverage/source pixels and dense/deep viewer limits. Original strokes and source bytes remain in projects. Native and SVG replay reject stamp indices beyond safe integer precision instead of entering a non-advancing loop; this does not impose an import-resolution cap. See [paint in SVG](SCRIPTING_API.md#paint-in-svg-export) for defaults, errors, limits and a runnable constructor example. Export signatures, schemas, REST routes and script/plugin privileges are unchanged.


Host SVG now retains visible adjustments and enabled Blend If through native sibling-prefix images, instead of omitting them. Each isolated stack renders only through its last visible dependency; later artwork and outer parent settings stay separate. Reports identify affected stack endings and baked internal editability/off-support pixels. Source/font capture includes the complete native prefix, with existing cancellation/progress/cleanup and immutable snapshots. All current native adjustment kernels and Blend If rules use the real compositor. Synchronous VectorLayer.toSvg rejects enabled Blend If with a host-preparation error. See [native SVG backdrop composition](SCRIPTING_API.md#native-backdrop-composition-in-svg-export) for defaults, exact scope, errors and a runnable example. No export option/signature, schema, REST render route or script/plugin capability changes.


### Trusted local SVG file services

The browser host exposes `editor.inspectSvg(file, control?)` and `editor.openSvg(file, {mode?: "editable" | "flatten"}, control?)`; see [the current import contract](SCRIPTING_API.md#local-svg-import). They inspect inert XML in a terminable worker and publish only a complete validated native document. Editable mode is the default and rejects unsupported features; flattening requires an explicit choice. UI preflight/cancel, source-byte preservation and normal OO edit/undo behavior apply. Headless REST sessions and isolated scripts/plugins gain no file parser, browser renderer, download or network privileges. The shared `VectorPath.fromSvgPath` helper now rejects malformed/compound single-path input instead of skipping it and supports quadratic/arc conversion.


### Native vector stroke command fields

Schema 22 adds optional `strokeCap`, `strokeJoin`, `strokeMiterLimit`, `strokeDashArray`, and `strokeDashOffset` to path records and `path.update.patch`. The same `path.add`/`path.update` validators apply to UI, scripting/plugins and headless REST commands. See [VectorPath](SCRIPTING_API.md#vectorpath) for defaults, ranges, examples and error behavior. Unknown enums/fields, negative/nonfinite dash values, arrays over 256 entries, limits below 1 and invalid offsets reject atomically; ancestor locks, expectedRevision/409 and shared undo remain enforced. Pre-22 labels containing these fields reject; valid old roots migrate with legacy round appearance. This does not add browser rendering or SVG-file access to REST sessions. Existing layer-add recipe templates retain styled path records; standalone path-update recipe recording remains explicitly unsupported.


### Editable vector gradient fills (schema 23)

Path records and `path.update.patch` accept nullable `fillGradient` with strict linear/radial geometry, 2–32 ordered color/opacity stops and an optional invertible affine paint transform. See [VectorPath gradient fills](SCRIPTING_API.md#gradient-fills) for signatures/defaults/ranges/examples/errors. The OO setters, isolated scripting/plugins, UI and separate headless REST sessions share validation, ancestor locks, expectedRevision/409 and undo. Older roots migrate to the current schema without injecting paint; older labels containing this field reject. Solid fill is retained beneath gradient paint; setting the gradient to null restores it. No REST renderer/SVG-file endpoint/browser synchronization or asset-byte access is added.


### Native compound paths (schema 24)

`path.add` and `path.update.patch` accept optional `fillRule: "nonzero" | "evenodd"` (default nonzero) and `subpaths: [{id, points, closed:true}]`. Primary `points` remain the first contour; additional contours share paint/stroke. Each path supports at most 128 contours and 20,000 total anchors, unique contour IDs (including the primary), finite absolute local handles and a closed primary when extras exist. Complete merged-path validation, ancestor locks, expectedRevision/409, atomic commands/history and project persistence apply. Unknown fields, invalid fill rules/open extras/duplicates/budgets reject with 400 and no mutation. Empty `subpaths` removes all additional boundaries. See [compound paths](SCRIPTING_API.md#compound-paths-and-vectorcontour) for OO geometry editing, defaults, example, error behavior and mask capture rules. Boolean operations use the revision-checked endpoint below; sessions remain separate from browser documents.


### Boolean vector areas

`POST /api/v1/documents/:id/vector-boolean` accepts `{expectedRevision, operation, operands:[{layerId,pathId}, ...]}`. `operation` is `union`, `subtract`, `intersect` or `exclude`; operand order defines the first path's paint/layer plane and subtraction order. Example:

```http
POST /api/v1/documents/DOCUMENT_ID/vector-boolean
Content-Type: application/json

{"expectedRevision":4,"operation":"subtract","operands":[{"layerId":"FIRST_LAYER_ID","pathId":"FRAME_PATH_ID"},{"layerId":"SECOND_LAYER_ID","pathId":"CUTOUT_PATH_ID"}]}
```

The response is the ordinary session snapshot plus `result: {layerId,pathId} | null`. Computation runs in a terminable Node worker using closed cubic areas, each input's fill rule and complete ancestor transforms. Results retain first path identity/style/layer appearance; other operand paths and empty operand vector layers are removed. Empty results remove operands and return null. Unselected paths/groups/content remain. Stroke outlines, masks/effects and other operands' appearance are excluded from area calculation. One atomic `paths.replace` provides undo/replay of final native geometry, without rerunning calculation.

Strict 2–128 distinct paths, 128 total input contours and 20,000 total input anchors apply. Each intermediate pair result and the final result must also fit 128 contours/20,000 anchors; later simplification does not bypass the intermediate budget. These are geometry limits independent of raster import resolution. Open/missing/foreign/locked operands, malformed geometry, unknown operations/fields and calculation/result-budget failures return 400 without replacement. Expected/stale revision conflicts and the shared four-native-worker capacity gate return 409. Disconnect/deletion/revision changes cancel work; calculation has a 30-second wall-clock budget. No progress stream, browser synchronization, asset bytes or new auth mechanism is added. See [Boolean OO/scripting methods](SCRIPTING_API.md#boolean-path-operations) for controls, normalization/precision limits and the runnable example. Document schema 24, project 3 and workspace 2 remain unchanged.

The ordinary `/commands` surface also accepts `{type:"paths.replace", operands:[{layerId,pathId},...], result: VectorPathData|null}` as a final-geometry replacement. It uses the same closed-source/existence/distinctness/lock checks. A nonempty result must retain the first path ID and be closed; complete strict path/subpath validation applies. Replacement occupies that first path's original slot, removes other operands and prunes only empty operand vector layers. It does not calculate or certify a Boolean operation for clients supplying arbitrary final geometry. Invalid batches roll back atomically. Recipes still report standalone path replacement as unsupported; complete layer-add templates can retain resulting geometry.


## Paragraph layout commands

Schema-26 text layer.add/layer.update accept optional wrapWidth (finite 1…Number.MAX_SAFE_INTEGER document px, or null to select point text), paragraphSpacing (0…10000 px, effective 0) and firstLineIndent (-10000…10000 px, effective 0). The same locks, expectedRevision, strict external validation, atomic batches and undo apply; no endpoint is added. Use wrapWidth:null, paragraphSpacing:0 and firstLineIndent:0 in one patch to match TextLayer.resetParagraph(). Non-text targets and invalid fields return 400 without partial edits; stale revisions return 409. Headless advances/line counts remain approximate without browser fonts, while authored width is retained exactly. Reflow in the browser refreshes local metrics; REST documents do not synchronize with the browser. See the scripting Paragraph layout section for Unicode/grapheme, overflow, whitespace, persistence and SVG limits.

### Inter-word paragraph justification

Schema-27 text layer.add/layer.update accept optional paragraphJustify: "none" | "inter-word". Defaults remain absent/none. Width wrapping, shared locks, strict external validation, expectedRevision and atomic undo remain unchanged. Point text has no soft lines; inter-word affects only eligible soft-wrapped lines. Use paragraphJustify:"none", wrapWidth:null, paragraphSpacing:0, firstLineIndent:0 in one patch to match resetParagraph(). Invalid enum/types or non-text targets return 400 with no partial changes; stale revisions return 409. Headless native-font metrics remain approximate and REST sessions are separate from browser sessions. See SCRIPTING_API.md for native support, separator policy, fit precision and SVG limits.

## SVG whitespace preparation

Trusted host SVG export may add whitespace-only inline spans after full-line native advance and ink-response checks, retaining literal root typography and one shaped chunk per visual line. Spans and boundary trimming respect native graphemes after ASCII normalization; unavailable segmentation declines optional styling. Invalid prepared ranges reject. Font pins, cancellation, cleanup, immutable snapshots and signed-advance fallback remain active. The verified NBSP/boundary correction is not universal glyph parity; combining marks, font-state and fractional/affine/viewer differences remain disclosed. Export signatures, schema 27/project 3/workspace 2, separate headless REST and isolated scripting privileges are unchanged. See the SVG whitespace example in SCRIPTING_API.md.


## TIFF export remains a browser-host operation

Trusted `editor.export({format: "tiff", tiffVariant?: "auto" | "classic" | "big"}, control?)` returns a native-resolution, flattened lossless RGBA8 sRGB `.tif`, with alpha and an output ICC profile. Automatic selects classic TIFF or BigTIFF from actual file addressing. The existing Export dialog exposes compatibility, progress and cancellation. See [SCRIPTING_API.md](SCRIPTING_API.md#native-tiff-export-trusted-application-code) for defaults, limits, errors and lifetime behavior. This adds no REST rendering route, sandbox file method, cloud transfer or synchronization between headless and browser sessions. TIFF import and higher-precision/multipage/editable output remain planned.


### Trusted browser PSB delivery and Photoshop import

`editor.export({format:"psb", psdMode?:"layers"|"flatten"}, control?)` returns the rendered RGB8 PSB version-2 subset, with `layers` as default. `editor.getExportCapabilityReport(options)` describes bounds, hidden content and baked editability before export. Large lengths/RLE rows follow PSB; actual multi-GiB and broader reader/device acceptance remain unverified. PSD keeps its format limits. `editor.openPsd(buffer, options?)` keeps its signature for both versions and now stages decoded PNG planes without a source-sized canvas, discarding stale owner/revision/session results. Its private worker still parses/allocates full input and decoded planes; inspection is not metadata-only parsing. See SCRIPTING_API.md for exact signatures/defaults, errors, source/font/cancel lifetimes, memory/precision and examples. These trusted methods add no REST export/import route, browser-session synchronization, isolated capability or schema change.


PSD/PSB host export now uses a private strip-encoding worker with unchanged options/results. Abort terminates pending encoding; native rendering calls remain non-preemptible. Worker errors/message errors, invalid row/Blob results and source/font changes reject without output, with worker/surface cleanup and normal retry. This changes no REST endpoint, revision/command behavior, browser-session link or isolated script capability. See SCRIPTING_API.md for the complete lifetime/cancellation boundary.


### Trusted Photoshop input controls

`editor.inspectPsd(source, control?)` returns version-1 metadata/report without raw planes. `editor.openPsd(source, options?, control?)` now also accepts Blob/File sources and optional host progress/abort controls while retaining the existing document/report/ImageData-map result. Dedicated workers parse/encode privately; owner/source/session/native-asset checks precede publication. Cancellation, callback/worker/message/validation errors and stale work discard private results, with retry and edited-tab retention. See SCRIPTING_API.md for exact signatures/defaults/phases, errors, mutable-buffer snapshotting, result ownership and existing color/precision/mask/memory limits. There is no new REST import route, browser synchronization or isolated capability.

Trusted browser Photoshop inspection/import workers now decode 8-bit RGB/Gray ZIP and ZIP prediction, including layer channels and the merged planar image. Native Deflate/checksum/declared-output validation and worker cancellation protect private publication. Higher-precision ZIP and full Photoshop semantics remain incomplete; synchronous compatibility helpers retain explicit unsupported-codec reporting. See SCRIPTING_API.md for async low-level adapter signatures, defaults, failures and memory/source boundaries. This adds no REST import route or browser-session synchronization.


Trusted browser Photoshop import now retains supported 8-bit user-mask coverage as separate native bitmap-mask PNG sources, with flags, outside coverage, density and coordinate placement. The legacy decoded assets map includes mask images. Unsupported feather/combined/rendered/higher-precision mask semantics remain explicit with merged fallback; preserveMasks:false reports omission. See SCRIPTING_API.md for exact defaults, representation, errors and the OO edit example. No REST file route or browser synchronization is added.


### Schema-28 group-only pass-through blending

The shared `layer.add` group DTO and `layer.update` patch accept `blendMode:"pass-through"` on group nodes only. Other layer kinds reject it. Default Normal stays isolated. Pass-through allows group opacity/masks and child effects but requires own fill opacity 1 and own overlay/shadow/Blend If disabled; incompatible requests reject atomically. Existing ancestor locks, expectedRevision/409, validation/400 and single-transaction undo apply. Valid legacy roots/history migrate to schema 28; pass-through labeled as an older schema rejects. No new endpoint or privilege is introduced. REST sessions remain headless and independent of the active browser. See SCRIPTING_API.md for the complete OO constructor/setter contract, trusted Photoshop hierarchy import/export, scoped baking and Canvas fallback.

### Schema-29 brush pressure DTOs

Shared brush records accept optional `pressureCurve:{points:[{input,output},...]}` with 2–16 finite normalized knots, strict increasing inputs from 0 to 1 and nondecreasing outputs. Default response omits the field; raw DTO null/unknown fields and malformed curves reject atomically. Pure OO PressureCurve values and constructor null shorthand serialize through the existing commands. Paint, masks/filter masks, erasures and tonal-sculpt options use the same validation; attached locks, expectedRevision/409, atomic batches and undo remain shared. New document/history schema is 29; project 3/workspace 2 are unchanged. See SCRIPTING_API.md for presets/defaults, zero/minimum behavior, persistence and errors. No new route, browser-session synchronization or isolated privilege is introduced.


### Browser brush preferences

Saved brush presets are local browser preferences, not headless REST document resources. No preset/file/library endpoint or browser synchronization is introduced. Resulting authored strokes retain the existing strict DTO validation, source/lock/revision checks and atomic undo. See [BRUSH_PRESETS.md](BRUSH_PRESETS.md) for the separate trusted-host preference contract.

## Brush-tip and pen-tilt records

Document schema 30 accepts optional brush `tip: {roundness, angle, tiltAngle?, tiltRoundness?, tiltCurve?}` and point `tilt: {altitude, azimuth}` in shared paint, mask/filter-mask, erasure and tonal commands. Roundness is .01–1, angle -180–180 degrees; spherical point angles are radians (altitude 0–π/2, azimuth 0–2π). Both point fields and the tip's angle/roundness are required in serialized DTOs. Unknown fields, null DTOs and invalid geometry reject atomically. Tonal-sculpt options accept the same strict serialized tip and oriented path points. Existing expectedRevision/locks/undo apply. See SCRIPTING_API.md for interpolation, response and coordinate-plane semantics. REST sessions remain separate from browser documents.

## Brush symmetry records

Schema 31 admits optional brush `symmetry: {copies:[{a,b,c,d,e,f},...]}` across paint, masks/filter masks, raster erasures and tonal commands. The original is implicit; 1–31 distinct finite invertible nonidentity copy transforms are permitted in the stroke's coordinate plane. Unknown fields, null serialized metadata, identity/duplicate/singular matrices and unsupported schema labels reject. Shared atomic validation, locks, expectedRevision and undo remain. Tonal-sculpt options use the same DTO. See SCRIPTING_API.md for original-first replay order, complete tip bases, coordinate conjugation, selection/opacity and current numerical/working-buffer limits. This adds no browser synchronization or rendering endpoint to independent headless REST sessions.

### Authored brush textures (schema 32)

Brush/pencil/clone/eraser DTOs accept optional `texture: {assetId, channel: "alpha" | "luminance", invert: boolean}`. All three fields are required when present; null and unknown fields reject. This uses existing paint, mask/filter-mask, raster erasure and tonal command envelopes, shared locks, revision preconditions, atomic batches and undo. Upload the source asset into the same headless session first; missing references reject the whole batch. Document schema 32 admits textures; project/workspace versions remain 3/2. Source preparation and rendering are browser services, not new REST rendering or file capabilities. See the [texture constructor contract](SCRIPTING_API.md#image-backed-brush-textures-schema-32). Active-tool controls and source-bearing presets remain in progress.

### Based-on paragraph styles

Document schema 41 admits optional paragraph-style basedOn `{id, overrides}` (or null/omission for independent styles). Overrides are strict partial ParagraphFormat fields; format remains the complete resolved value. Existing paragraphStyle.set/remove commands share transitive inheritance, cycle/missing-base/coherence validation, follower locks, atomic history and revisions. A parent update derives child formats automatically; a supplied child record must agree with its base/overrides. Removal preserves formatting while detaching immediate child styles/direct text. Mislabeled pre-41 inheritance rejects. REST sessions remain separate from the browser and have existing headless font limits. See SCRIPTING_API.md for OO methods and the complete field contract.

## RAW lens options

RAW import/development options accept optional strict `development.lens` version-1 settings documented in SCRIPTING_API.md. Independent native workers perform geometric validation and linear RGB16 radial/chromatic/vignette correction before returning RGBA8 working pixels. Transparent correction borders are supported; original RAW extra-sample coverage remains unsupported. Existing expectedRevision, locks, original/accepted validation, project/history and cancellation contracts remain. Invalid correction publishes nothing; no browser synchronization or general REST renderer is introduced.
