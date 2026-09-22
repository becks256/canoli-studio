# REST and scripting APIs

Both are required product surfaces. They share the same OOP document model, command validation and history behavior. Neither is a Photoshop-compatible API. These are local prototype APIs, not a published SDK stability guarantee.

## Scripting API

See the dedicated **[Scripting API guide and reference](SCRIPTING_API.md)** for quick start, constructor options/defaults, properties and methods, collections, transactions, ownership, runnable recipes, errors and runtime budgets.

Open **Scripts** in the tool rail or press **Mod+Shift+K**. Run JavaScript using the provided `document`, `Document`, `RasterLayer`, `LayerGroup`, `ToneAdjustment` and `print` bindings, plus paint/vector/stroke/selection/style constructors listed in the guide. The supplied `document` controls the open composition; `new Document()` creates a separate in-memory model.

Successful edits apply together as one undo step. Script errors, cancellation, timeout, invalid assets or stale revisions apply no script edits. Import images through the editor first; the Scripts panel does not expose files, network access, export or host application services. See [application integration](SCRIPTING_API.md#application-integration) for the separate trusted application interface.

## Plugins

Installable command plugins reuse the isolated scripting API with versioned manifests, document permissions and one named history entry per run. See [PLUGINS.md](PLUGINS.md). They are distinct from REST sessions; the server does not install or execute plugins.

## REST API

Run `npm run dev:api`; default base URL is `http://127.0.0.1:8787/api/v1`. `LUMA_API_PORT` changes the local port. No hosted deployment or API key is configured. Loopback Host and Origin checks protect the local service against ordinary cross-site access; they are not account authentication.

| Method | Endpoint                  | Behavior                                                  |
| ------ | ------------------------- | --------------------------------------------------------- |
| GET    | `/health`                 | Service status and storage/scope description              |
| GET    | `/documents`              | IDs, names and revisions                                  |
| POST   | `/documents`              | Create from optional `name`, `width`, `height`            |
| GET    | `/documents/:id`          | Document DTO, revision, undo/redo availability            |
| POST   | `/documents/:id/commands` | Apply validated command array as one atomic history entry |
| POST   | `/documents/:id/undo`     | Undo one entry                                            |
| POST   | `/documents/:id/redo`     | Redo one entry                                            |
| DELETE | `/documents/:id`          | Delete from the in-memory session                         |

Mutations to an existing document require `expectedRevision`; mismatch returns **409**. Re-read before retrying. Invalid requests return **400**, disallowed origins/hosts **403**, and missing documents/endpoints **404**. Successful creation returns **201**; other successful JSON operations return **200**. Requests must use `Content-Type: application/json`.

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
    "schemaVersion": 1,
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

| Type              | Fields                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `document.rename` | `name`                                                                                                                                    |
| `layer.add`       | `layer`: serialized RasterLayer, PaintLayer, VectorLayer or LayerGroup; optional `parentId`                                               |
| `layer.update`    | `id`, `patch`: name/position/opacity/fillOpacity/styles/visibility/lock/blend mode; raster width/height                                   |
| `layer.remove`    | `id`                                                                                                                                      |
| `layer.duplicate` | `id`; optional `newIds` maps source node/effect/stroke/path IDs to replay-stable IDs                                                      |
| `layer.reorder`   | `id`, `direction`: `up` or `down`                                                                                                         |
| `layer.reparent`  | `id`, `parentId`: group ID or null for document root                                                                                      |
| `selection.set`   | `selection`: full selection DTO or null; persisted and undoable                                                                           |
| `layer.place`     | `id`, `targetId` (layer ID or null), `placement`: before/after/inside, `preservePosition`: boolean. Inside requires a group or null root. |
| `paint.add`       | paint layer `id`, serialized `stroke` (brush/pencil/clone/fill)                                                                           |
| `paint.remove`    | paint layer `id`, `strokeId`                                                                                                              |
| `path.add`        | vector layer `id`, serialized `path`                                                                                                      |
| `path.update`     | vector layer `id`, `pathId`, `patch`: points/closed/fill/stroke/strokeWidth                                                               |
| `path.remove`     | vector layer `id`, `pathId`                                                                                                               |
| `effect.tone`     | raster `id`, `values`: exposure/contrast/saturation                                                                                       |
| `effect.reset`    | raster `id`                                                                                                                               |
| `effect.add`      | raster `id`, serialized tone `effect`                                                                                                     |
| `effect.update`   | raster `id`, `effectId`, `values`: enabled/exposure/contrast/saturation                                                                   |
| `effect.remove`   | raster `id`, `effectId`                                                                                                                   |
| `transaction`     | `label`, `commands`                                                                                                                       |

REST is currently **headless document metadata and commands**. It does not control the active browser tab, retain image bytes, render exports, run user scripts, or persist data after restart. Raster `assetId` values are metadata references until an asset service is added. Limits of 1 MB per JSON request, 256 commands per array, bounded nesting/complexity, and 100 session documents protect the control endpoint; they do not constrain browser image-import size. Authentication, durable storage, asset endpoints, OpenAPI generation and browser synchronization remain future work.

New drawing DTOs are defined in `src/core/drawing.ts`. The scripting guide documents their constructor defaults and coordinate conventions. Generate DTOs with `toJSON()` from trusted application code; REST accepts serialized values, not JavaScript constructor expressions. `styles` in a layer patch is a complete object containing `blendIf`, `colorOverlay` and `dropShadow`. Invalid colors, unordered Blend If ranges, malformed paths and unknown properties fail validation. REST clone tile asset IDs are metadata references only; browser script application additionally checks its real asset store.
