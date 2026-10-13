# Plugins and extensions

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
