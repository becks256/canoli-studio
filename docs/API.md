# REST and scripting APIs

Both are required product surfaces. They share the same OOP document model, command validation and history behavior. Neither is a Photoshop-compatible API. These are local prototype APIs, not a published SDK stability guarantee.

## Scripting API

See the dedicated **[Scripting API guide and reference](SCRIPTING_API.md)** for quick start, constructor options/defaults, properties and methods, collections, transactions, ownership, runnable recipes, errors and runtime budgets.

Open **Scripts** in the tool rail or press **Mod+Shift+K**. Run JavaScript using the provided `document`, `Document`, `RasterLayer`, `LayerGroup`, `ToneAdjustment` and `print` bindings, plus paint/vector/stroke/selection/style constructors listed in the guide. The supplied `document` controls the open composition; `new Document()` creates a separate in-memory model.

Successful edits apply together as one undo step. Script errors, cancellation, timeout, invalid assets or stale revisions apply no script edits. Import images through the editor first; the Scripts panel does not expose files, network access, export or host application services. See [application integration](SCRIPTING_API.md#application-integration) for the separate trusted application interface.

## Plugins

Installable command plugins reuse the isolated scripting API with versioned manifests, document permissions and one named history entry per run. See [PLUGINS.md](PLUGINS.md). They are distinct from REST sessions; the server does not install or execute plugins.

## REST API

Run `npm run dev:api`; default base URL is `http://127.0.0.1:8787/api/v1`. `LUMA_API_PORT` changes the local port.

### Authentication

Set the `LUMA_API_KEY` environment variable to require token-based authentication. When configured:

- Supply the key via standard HTTP Bearer token: `Authorization: Bearer <key>`
- Or via custom header: `X-API-Key: <key>`
- Requests missing or supplying an invalid key receive **401 Unauthorized** with the header `WWW-Authenticate: Bearer realm="Luma REST API"`.
- When `LUMA_API_KEY` is omitted, loopback Host and Origin checks protect the local development service against cross-site requests.

| Method | Endpoint                         | Behavior                                                               |
| ------ | -------------------------------- | ---------------------------------------------------------------------- |
| GET    | `/health`                        | Service status and storage/scope description                           |
| GET    | `/documents`                     | IDs, names and revisions                                               |
| POST   | `/documents`                     | Create from optional `name`, `width`, `height`                         |
| GET    | `/documents/:id`                 | Document DTO, revision, undo/redo availability                         |
| POST   | `/documents/:id/commands`        | Apply validated command array as one atomic history entry              |
| POST   | `/documents/:id/undo`            | Undo one entry                                                         |
| POST   | `/documents/:id/redo`            | Redo one entry                                                         |
| DELETE | `/documents/:id`                 | Delete from the in-memory session                                      |
| POST   | `/documents/:id/assets`          | Upload binary image or base64 asset to document's asset store          |
| GET    | `/documents/:id/assets`          | List stored assets for the document                                    |
| GET    | `/documents/:id/assets/:assetId` | Retrieve raw image binary or JSON asset metadata                       |
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
    "schemaVersion": 12,
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

`{ type: "smartObject.filters", id, filters }` atomically replaces one instance's ordered stack. Each entry requires `id`, `enabled`, and one of: `{ kind: "gaussian-blur", sigma }`, `{ kind: "unsharp-mask", sigma, amount, threshold }`, or `{ kind: "tone", exposure, contrast, saturation }`. Fields are strict; values match the constructor limits in SCRIPTING_API.md, at most 32 entries are accepted, and IDs must be unique within the stack. Empty arrays clear filters. Wrong layer kinds, locked ancestry, invalid values and stale revisions reject without partial mutation. The command uses normal history/undo and is available through isolated scripts via the constructor methods. Schema 11 persists `smartFilters`; older schema versions reject that field on instances, including nested masters. REST sessions still do not render these filters headlessly.

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

`editor.export(options, control?)` and `editor.exportPng(control?)` accept optional `{ signal?: AbortSignal, onProgress?: (progress: { phase: "rendering" | "encoding", fraction: number | null }) => void }`. Controls are host-only execution state, separate from serialized format options; isolated Scripts and REST do not receive these browser services. Progress callbacks must not throw. Cancellation rejects with the signal reason (normally AbortError), releases current raster resources and prevents a completed result from being returned by the host. Raster work checks between tiles/strips; browser encoding and synchronous SVG/PSD work are not preemptible. See the application-integration section of SCRIPTING_API.md for the complete current boundary.
