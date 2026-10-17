# Plugins and extensions

Schema-25 text wordSpacing/fontKerning setters and resetSpacing use the existing isolated constructor runtime, document-write permission and shared commands/history. They introduce no font-file access, font enumeration, network/asset permission or install-time execution. Native font metrics vary between isolated workers, the browser and headless REST; these settings do not embed fonts or claim portable shaping. A failed script, invalid value or revoked/missing grant rolls back ordinary staged edits. See the TextLayer guide and its tested spacing example.

Canoli Studio supports local command plugins: install a JSON package, review its access and JavaScript, then run its named commands from the **Plugins** panel (tool rail, or **Mod+Shift+L**). Commands use the same constructor-based [scripting API](SCRIPTING_API.md) as the Scripts panel. This is the first extension surface; a marketplace, custom panels, background services, external network access and native/WASM plugin modules are not implemented.

## Try the example

1. Open Plugins and choose **Load example**.
2. Review **Studio utilities**, its document access and command source. Click **Install plugin**. Installation itself does not execute code.
3. Run **Add guide frame**. It creates an editable vector frame in the current composition. Close Plugins and undo to remove that command's edits together.
4. Reopen Plugins to export its package, inspect the composition, or remove it. Installed packages persist in this browser profile across reloads; document edits still require saving a project.

## Package format

Use a UTF-8 JSON file named `your-plugin.luma-plugin.json`. No ZIP, build process, dependency install or external script URL is required. JavaScript source is embedded as a string for each command.

```json
{
  "format": "luma-plugin",
  "apiVersion": 2,
  "id": "example.document-tools",
  "name": "Document tools",
  "version": "1.0.0",
  "description": "Reusable commands for this studio.",
  "author": "Your name",
  "permissions": ["document:read", "document:write", "jobs:run"],
  "commands": [
    {
      "id": "rename",
      "title": "Name this composition",
      "description": "Rename the open document.",
      "source": "document.name = 'Studio composition'; print(document.name);"
    }
  ]
}
```

| Field                          | Contract                                                                                                                                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`, `apiVersion`         | Must be `"luma-plugin"`. `apiVersion` can be `1` (legacy manifest) or `2` (extended permissions); unsupported versions fail explicitly.                                                                                                                         |
| `id`                           | Stable package ID, 1–100 characters, matching `[a-z][a-z0-9.-]*`. Reverse-domain-style identifiers are recommended.                                                                                                                                             |
| `name`, `version`              | Nonblank display name, at most 80 characters; version `major.minor.patch`, optionally with a hyphenated prerelease, at most 40 characters.                                                                                                                      |
| `description`, `author`        | Description at most 500 characters (defaults to empty); optional author at most 100. These are author-provided metadata, not verified identity.                                                                                                                 |
| `permissions`                  | Unique permissions; `document:read` is required. `apiVersion: 1` supports `document:read` and `document:write`. `apiVersion: 2` also supports `jobs:run`, `ai:generate`, `assets:read`, `assets:write`, and `assets:analyze`. Unknown permissions are rejected. |
| `commands`                     | 1–16 commands; unique IDs with the same syntax as the package ID.                                                                                                                                                                                               |
| Command `title`, `description` | Nonblank title at most 80 characters; description at most 300, defaults to empty.                                                                                                                                                                               |
| Command `source`               | JavaScript body, 1–50,000 string code units. The complete package must fit within 250,000 UTF-8 bytes.                                                                                                                                                          |

Unknown manifest/command fields are rejected. Invalid JSON, duplicate command IDs, unsupported API versions and oversized packages do not replace an installed package. Importing the same package ID shows the installed version and an explicit **Replace installed plugin** action; it replaces the package atomically, including permissions. No automatic updates or version ordering are applied.

## Execution and permissions

Each command runs in a fresh isolated worker through the existing scripting sandbox. It receives the document snapshot, active layer, the documented DOM constructors, the `host` bridge (see [SCRIPTING_API.md](SCRIPTING_API.md#host-bridge-and-asynchronous-jobs)), and `print`. Top-level `await` works; direct network access, arbitrary imports, and raw host application access do not. Commands can construct paint layers, strokes, paths, selections, adjustments and styles. Use `document` to change the open composition; `new Document()` creates a separate model.

### Permission model and dynamic revocation

The host enforces strict capability boundaries:

- `document:read` exposes document metadata, names, geometry, IDs, paths, strokes and existing asset references. It does not expose raw image bytes.
- `document:write` allows committing document mutations and active layer changes. If a plugin without `document:write` emits mutations or changes the active layer, the host commit gate rejects the entire result. Edits commit as one undo entry named **Plugin name: Command title**.
- `jobs:run` and `ai:generate` allow submitting and managing asynchronous background jobs via `host.jobs`.
- `assets:read` and `assets:write` allow inspecting or modifying document asset references via `host.assets`.
- `assets:analyze` allows invoking image analysis operations.

Users can inspect permissions in the **Plugins** panel and dynamically grant or revoke permissions using interactive **Grant** / **Revoke** buttons. Permission state is stored locally in `localStorage` under `luma.plugins.permissions.v1`. If a user revokes `document:write` or `jobs:run`, subsequent command executions are immediately blocked at the host boundary from modifying the document or submitting background tasks.

Commands have the same five-second deadline, 256-command and payload-complexity budgets as [scripts](SCRIPTING_API.md#errors-and-limits). A thrown exception, invalid output, missing image asset, timeout, cancellation or document revision conflict applies no plugin edits. **Stop plugin**, Escape or closing the panel cancels a pending run. No activation or load hook runs at installation/startup. Concurrent runs are not a supported plugin service.

The worker has no page DOM, `editor` service, credentials, image import/export service, local storage, external network or external code loading. Permissions do not grant these capabilities. Plugins cannot import one another or install additional plugins. This prototype sandbox has a time limit but no strict heap quota and has not undergone a hostile-plugin security review. The UI therefore exposes source review and does not present installed code as vetted. Use packages from authors you trust.

## Persistence and lifecycle

Packages are local browser-profile data in `localStorage` under `luma.plugins.v1`, separate from `.luma` project files. At most 32 packages are installed. Storage quota failure leaves the previous registry intact and reports an error. If browser storage cannot be accessed, the panel states that installation lasts only for the tab. If saved package data is invalid, the panel reports that it could not restore packages; it does not execute them.

Export packages to back them up or transfer them to another browser. Clearing site storage removes installed plugins; a private browsing profile may discard them on close. Removing or updating a plugin does not undo its previously committed document edits. Saving/opening projects does not install plugins. No plugin-specific preferences or secret storage API exists yet.

## Trusted application integration

These methods are for application code, not plugin command source:

| Method                                            | Behavior                                                                                                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor.plugins.install(package)`                 | Validate an object or JSON string and store it; replaces the same ID. Does not run commands. UI callers should first show package access/source review. Returns the installed manifest. |
| `editor.plugins.get(id)`                          | Installed immutable manifest or null.                                                                                                                                                   |
| `editor.plugins.getSnapshot()`                    | Immutable `{ plugins, storageMessage }` for UI rendering.                                                                                                                               |
| `editor.plugins.subscribe(listener)`              | Subscribe to registry updates; returns an unsubscribe function.                                                                                                                         |
| `editor.plugins.export(id)`                       | JSON string for an installed package; throws if absent.                                                                                                                                 |
| `editor.plugins.remove(id)`                       | Remove the package from the registry.                                                                                                                                                   |
| `editor.plugins.getGrantedPermissions(id)`        | Returns array of user-granted permissions for the plugin.                                                                                                                               |
| `editor.plugins.isPermissionGranted(id, perm)`    | Returns whether a specific permission is currently granted.                                                                                                                             |
| `editor.plugins.grantPermission(id, perm)`        | Grants a permission and persists update to local storage.                                                                                                                               |
| `editor.plugins.revokePermission(id, perm)`       | Revokes a permission and persists update to local storage.                                                                                                                              |
| `editor.plugins.setGrantedPermissions(id, perms)` | Replaces the granted permissions array for a plugin.                                                                                                                                    |
| `editor.runPlugin(pluginId, commandId)`           | Run the installed command through isolation/permissions/validation; returns `Promise<string[]>` logs. Throws if command/package is absent.                                              |
| `editor.scripts.cancel()`                         | Cancel the currently running script/plugin.                                                                                                                                             |

The REST service remains a separate metadata service; it neither installs plugins nor executes JavaScript.

## Future extension boundaries

Keep manifests versioned and installation inert. Extend the existing validated command boundary rather than handing third-party code page or engine objects. Custom panels, parameter forms, command-palette contributions, keybinding customization, persistent settings, new file formats and permissioned external services each need an explicit capability design. A future panel should communicate through a typed bridge and produce the same undoable DOM operations. Do not use unrestricted `eval` in the app or server as an extension mechanism.

The scripting result includes the complete layer-selection set, not just its active member. `document:read` forbids changing that set even when `selectedLayer` remains unchanged. Write-capable commands use the same `document.selectLayers` and `layerSelection` methods documented in SCRIPTING_API.md. No new permission is introduced.

### Scripted patch preparation

Version 2 plugins may call awaited `document.patchRegion` when `document:write`, `assets:read` and `assets:write` are all declared and currently granted (alongside required `document:read`). Preparation and final transfer recheck grants, so revocation or plugin removal during asynchronous work discards private patch assets. Preparation does not expose source image bytes to plugin code. Patch operations share the entire script's final transaction and resource/time budgets; see the scripting guide for signatures and examples.

`Layer.healSpot` uses the same granted `document:write`, `assets:read` and `assets:write` permissions, private preparation scope and final commit checks as `Document.patchRegion`. Mixed patch/healing commands remain one atomic plugin edit. Both count toward the shared 32-repair limit per script.

Smart-object `await layer.rasterize()` uses the private host asset preparation boundary. Plugins require `document:write`, `assets:read` and `assets:write`; permissions and target revision/lifetime are rechecked before final commit. Prepared PNG assets remain private until successful script completion. Exceptions or revoked permissions discard those assets along with script edits. Plugin installation remains inert.

`document.selectPolygon(points, operation = "replace")` uses the same isolated constructor API and final shared command validation as other selection edits. It requires granted `document:write`; read-only plugins cannot commit selection changes. Installation remains inert, and no additional capability or source-image access is introduced. See SCRIPTING_API.md for vertex, coverage and error limits.

`await document.modifySelection({operation, radius})` prepares Expand/Contract/Feather coverage in a private worker using the plugin's staged document commands. It requires granted `document:write` before work and again before result transfer/host commit. It does not read source-image assets and introduces no new permission. Revocation, removal, cancellation, script failure and stale revisions discard prepared coverage. Await each modification; at most 32 per script run and the existing time/result budgets apply. Installation remains inert. See SCRIPTING_API.md for the exact circular/feather kernels and radius limits.

Color Balance and Vibrance use normal `AdjustmentLayer` construction and `.adjustment` replacement through the shared isolated DOM/command boundary. The strict schema-17 parameter contracts are documented in SCRIPTING_API.md. They require current `document:write` permission, introduce no new capability and do not run code on installation. Source assets remain immutable and final script commits retain shared revision/undo validation.


Gradient map layers use the existing `AdjustmentLayer` constructor with `{kind: "gradient-map", stops, reverse}` and the documented 2–32 ordered stops. They need ordinary `document:write` at host commit, no new permission or package version. Installation stays inert; edits remain isolated, revision-checked and atomic, including invalid-stop rollback. No image bytes or external LUT access is added to scripts.

After an isolated command returns, the host rechecks installation and current `document:write` permission before committing staged document commands or selection changes. Removing a plugin or revoking write while its command is pending discards those staged edits. Re-granting write permits later runs. This commit check does not undo host jobs or other already completed in-band operations.


White Balance commands construct `AdjustmentLayer` with the strict `{kind:"white-balance", temperature, tint}` DTO and use existing document-write grants. No package version, permission, network access or raw-image exposure is added. Installation remains inert, and current host commit checks discard revoked/removed-plugin edits. Exact bounds/defaults/processing and schema-19 compatibility are in SCRIPTING_API.md.


Color Lookup commands can call `AdjustmentLayer.setLut(cubeText, {amount?, interpolation?})` or use the strict packed DTO through existing document-write grants. Tables are inert document data, without network/file-read capability or new sandbox globals. Installation remains inert; pending revoked/removed commands cannot commit. Schema-20 records are portable in command recipes/projects; format, parsing, processing and script/request limits are in SCRIPTING_API.md.


Color Range adds `await document.selectColorRange(options)` through the existing isolated scripting boundary. Packages need apiVersion 2 and current document:read, document:write and assets:read grants. This authorizes reading source appearance for selection coverage, without exposing pixel buffers, adding network access or changing asset data. Install remains inert. The host rechecks grants during native preparation and at final staged script commit, including asset-read revocation after preparation finishes. Current source modes/limits, stale-result behavior and runnable examples are in SCRIPTING_API.md.


Saved alpha channels use AlphaChannel/AlphaChannelCollection plus awaited channel.load through the same isolated scripting boundary. apiVersion 1 or 2 packages need currently granted document-read/write permission; no image/asset permission is added because coverage is document metadata. Installation remains inert. Native preparation and final staged commit enforce revocation/removal, stale revisions and shared selection-preparation limits. Source image buffers never cross the bridge. Complete signatures/defaults, errors and the runnable example are in SCRIPTING_API.md.


Quick Selection adds awaited Document.selectQuickSelection(options) through the isolated selection host bridge. Packages require apiVersion 2 and current document-read/write/assets-read grants during source preparation and final staged commit, including revocation after native output. Installation is inert; source pixel buffers and workers are not exposed. Shared script preparation/time/result limits remain. Returned final selection coverage supports ordinary masks and undo, with errors/algorithm/source/memory limits in SCRIPTING_API.md.

Select Subject now uses awaited Document.selectSubject(options) through that same isolated host boundary, resolving original raster geometry from validated staged commands and preserving native coverage/full placement. apiVersion-2 document-read/write/assets-read grants are checked during preparation and final staged commit. Empty/unsupported targets reject without fabricated output. Source pixels stay outside the sandbox; panel cancellation terminates private native work. The shared sequential 32-selection budget, runtime/result limits, inert installation and one-transaction rollback/undo remain. Native Refine Edge/removeBackground use the separate retouch asset-preparation boundary below.


### Native matte and corrected foreground preparation

`await raster.refineEdge(options)` and `await document.removeBackground(raster, options)` are supported through the existing isolated retouch host. apiVersion-2 packages need current document:read/write and assets:read/write grants both during preparation and final staged commit, including late revocation after genuine output. Installation remains inert. Pixels, bitmaps, workers and asset stores are not exposed to package code. Panel cancellation applies; sandbox callbacks/signals reject.

Matte and optional corrected RGB assets stay private until the complete script validates and commits once; later script errors discard them. The shared sequential retouch budget is 32 owned assets, with corrected output using two slots and mask-only one. Existing runtime/result/command limits remain. New-layer output hides the source and retains its original bytes; default mask output changes no RGB. Exact signatures, defaults, source/coordinate precedence, errors, resampling and local-solver limitations are in SCRIPTING_API.md. This adds no permission, network access or package-format change.


Native refinement now defaults to the global closed-form solver; `solver:"color-line"` retains the local estimator explicitly. Both use the same isolated retouch/asset/grant boundary. Graph-budget, covariance or convergence failures discard the staged job and subsequent script commit; no approximate matte or silent solver downgrade is installed. Trusted progress/cancellation remain host-only. See SCRIPTING_API.md for exact solver defaults, numerical limits and the tested example.


IC(0) matting preconditioning and proportional Smooth values change numerical preparation without changing package grants, inert installation, private assets, rollback or final commit validation. The existing five-second isolated script wall limit includes host work; a large native photo operation may time out and must discard its staged work. Trusted UI/REST calls retain their independent lifetime controls. No network access, new package permission or silent local-matte fallback is introduced.

Budgeted RGB-aware Galerkin correction is another private numerical stage under that same contract. It never exposes raw source colors or coarse arrays to plugin code and does not grant additional runtime time. Native convergence, current grants, owned assets, stale-revision checks and the single staged history commit remain required. Optional correction failure retains the original global solve; it does not substitute a coarse image or waive validation.

Optional private WASM sparse matting iterations change only trusted host preparation. Installation remains inert; scripts cannot supply a kernel/backend or access graph memory. Existing document/asset grants, revision checks, private staging, one-step undo and the five-second isolated wall deadline remain unchanged. Optional memory/capacity failure retains the same global JavaScript numerical route, not an approximate matte or an expanded sandbox permission.


`await document.preflight(options)` adds read-only local metadata/geometry design checks. Active plugin documents require `document:read` and `assets:read`, using the existing asset-list host service; no new permission or host capability is added. Current asset grants are rechecked at dispatch, including revocation between calls. The analysis runs in the isolated script worker and leaves font availability unverified, without probing the host's fonts. It does not access pixels, read font files, enumerate fonts, upload data or mutate history. Other staged script edits still require ordinary commit grants and roll back on failure. Installation remains inert and the five-second execution/payload limits are unchanged. See [Design checks](SCRIPTING_API.md#design-checks) for defaults, snapshot revision semantics, report truncation and inspection limits.

Pure `VectorLayer.toSvg(width=1920, height=1080)` returns SVG text inside the existing isolated worker, including eligible unfeathered vector masks. It does not download files or access host image bytes. Masks requiring native coverage (painted/sampled/bitmap/feathered or with corrective strokes) reject in this synchronous method; native preparation is available only to trusted host export. This adds no grant or host capability, changes no installation lifecycle and preserves script deadlines, output limits and commit validation. See [VectorLayer](SCRIPTING_API.md#vectorlayer) for mask placement and error details.

SVG color overlays/drop shadows also serialize to filter text inside the existing isolated constructor runtime, without image bytes or file downloads. Pure vector masks and effects need no new host grant; native mask preparation still belongs to trusted host export. Fill opacity does not suppress a separately defined shadow. Script output/deadline and commit-validation boundaries are unchanged; see SCRIPTING_API.md for effect coordinates and viewer limits.

Raster-image SVG preparation likewise belongs only to trusted host export. Embedding sanitized decoded pixels or rendering raster tone/erasures does not add an export/download method, image-byte access, package permission or background execution to plugins. `VectorLayer.toSvg` remains a synchronous vector constructor method inside isolation. Installation stays inert; existing grants, deadlines and host commit validation remain unchanged.

Editable SVG text also uses trusted host font measurement. Plugins may create ordinary TextLayer objects through existing validated commands, but gain no font-file access, font enumeration, measurement host call or export/download method. Font-family references in a later host export do not embed font bytes. Installation, grants, five-second script deadlines and host commit validation stay unchanged.

Smart-master SVG expansion/native-filter preparation likewise belongs to trusted host export. Plugin-authored shared masters and filter stacks retain their ordinary command/history model in the project; a later SVG file may independently expand or bake them as reported. No component-export host call, asset-byte/font-file/download grant, background execution or linked-file access is added. Installation remains inert and current host commit validation still applies.


SVG paint export also remains a trusted host operation. Plugins can create ordinary validated paint commands using existing constructors; a later host export serializes supported dab/fill/eraser geometry and prepares clone pixels/stroke clips outside isolation. There is no new paint-export method, asset-byte/download permission or background execution. Original project command/history and inert installation/commit-validation rules remain unchanged.


Native SVG adjustment/Blend If backdrop preparation is likewise host-only. Plugin-authored layers retain their existing validated command/history model; a later host export may bake an affected sibling prefix with reported losses. Synchronous VectorLayer.toSvg rejects enabled Blend If rather than reading a native backdrop. No source-byte/font-file/export/download service, grant or background execution is added, and installation/commit validation remain unchanged.


SVG import is a trusted browser file service, not a plugin permission. Inspection, files, image decoding, native rendering and publication remain outside isolated commands. The shared pure `VectorPath.fromSvgPath` helper supports all SVG path command families with reported cubic arc approximation in the import workflow; it rejects malformed or compound single-path input. Installation remains inert; these changes add no code execution or file/network grants.


Schema-22 VectorPath stroke setters and factory options are available through the existing isolated command boundary. They share host validation for enum/range/dash complexity, immutable ownership, locks and one successful script transaction. No manifest permission, file/network service or install-time code execution is added. See the VectorPath stroke example in the scripting guide.


Schema-23 VectorPath gradient constructor/factory options and attached `fillGradient` setters share the existing isolated scripting boundary. Gradient descriptors are copied values, not live mutable document objects. Existing current document-write validation/permissions, shared locks/undo/revisions, commit validation and inert installation apply; no new network/file/asset-byte permission is introduced. See the scripting guide's gradient-fill example.


### Native compound geometry

Schema-24 `VectorContour`, `VectorPath.subpaths` and fill-rule edits use the existing isolated constructor runtime, shared path.update validation/locks/history, and current document-write permission checks. No file/network/asset capability or manifest change is introduced. Installation remains inert. Geometry and nested arrays are defensive values; live edits use owner-backed methods. See the documented compound-path example. Boolean preparation uses the isolated host boundary described below.


### Boolean path preparation

The isolated `Document.combinePaths` / `VectorLayer.combinePaths` methods await a native curve worker through the host bridge, then emit ordinary validated `paths.replace` geometry. The host reconstructs validated staged commands before geometry capture. Current document-read/write grants are checked during preparation and final commit; revocation/removal aborts active work. There is no new permission, source-image access, file/network operation, background plugin code or install-time execution. Plugins use panel cancellation, while AbortSignal and progress callbacks belong to trusted application code. Native preparation remains sequential and shares the 32-operation script budget. Failure/cancellation/stale revision rolls back the complete staged script. See the [Boolean example](SCRIPTING_API.md#boolean-path-operations). Existing layer-add recipes can retain results, but standalone path replacement recording remains unsupported.


## Paragraph text boundary

TextLayer paragraph setters/resetParagraph reuse existing document-write permission, schema-26 strict commands and one atomic isolated commit. Installation stays inert. Invalid paragraph fields, missing/revoked grants, errors or timeouts leave the host unchanged. Layout uses the pinned host/runtime break engine and native grapheme segmentation; it adds no network, font-file/enumeration, asset or install-time privilege. Existing five-second execution and operation budgets remain; paragraph measurement is part of that work. Original text/style fields persist in native projects, while SVG positioned-line reflow and glyph portability limits remain explicit. Worker/page fonts and headless estimates can differ; no font or REST/browser synchronization is implied.

## Paragraph justification

TextLayer paragraphJustify none/inter-word uses schema-27 shared strict commands and the existing document-write grant. It adds no permission, network/font-file access or install-time execution. Invalid enum/types, wrong targets, revoked grants or isolated failures leave the host unchanged. Reset paragraph includes none in its one atomic host commit. Native/worker font and SVG placement limits remain as documented in SCRIPTING_API.md.

## SVG whitespace boundary

Whitespace-only SVG calibration remains a trusted host export operation. Plugin-created text uses ordinary validated constructors/commands; this adds no export, font-file, measurement, download or network privilege. Native grapheme checks and transient spans do not change authored project data, inert installation, grants, host commit validation or atomic undo.


TIFF export is trusted browser-host/UI functionality. Plugins may author ordinary editable content using their existing granted constructors/commands; they do not receive `editor.export`, downloads, filesystem, font enumeration or a new permission. Installation remains inert. User-initiated TIFF output flattens current native pixels, excludes source metadata/font files and preserves native project sources/editability separately. See SCRIPTING_API.md for the host-only export contract.
