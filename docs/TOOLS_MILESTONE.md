# Rich editor tools milestone

Status: implemented and verified on 2026-09-20. This records the requested tool scope and the added initial plugin extension surface.

| Requirement             | Intended behavior                                                                                                                | Required evidence                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Draggable layers        | Move layers on canvas; drag rows to reorder and move into/out of groups, with valid ownership and undo.                          | Browser gestures, ordering/position assertions, cycle/lock tests.                                    |
| Paint brush             | Continuous strokes with color, size, hardness, opacity and pressure; saved independently of original image pixels.               | Pixel checks, gesture history, project round trip and scripting example.                             |
| Pencil                  | Hard, precise marks, distinct from the soft brush; configurable color/size/opacity.                                              | Full-resolution pixel checks and browser drawing.                                                    |
| Vector pen              | Click/drag Bézier anchors, close/finish paths, edit anchors and handles; fill/stroke properties remain editable.                 | Browser path creation/editing and rendered/persisted curve checks.                                   |
| Marquee                 | Rectangle/ellipse selection with replace/add/subtract/intersect; visible selection; constrains paint/clone; deselect/select-all. | Selection geometry and clipped pixel checks, keyboard behavior.                                      |
| Clone brush             | Alt/Option-click source, paint sampled visible content with brush controls; preserve original sources.                           | Source/target pixel checks, selection clipping, undo and reload.                                     |
| Layer properties/styles | Existing properties plus fill opacity, richer blend modes, color overlay, drop shadow and Blend If.                              | Inspector interactions, actual rendered styles and persistence.                                      |
| Blend If                | Luminance/R/G/B; source and underlying ranges with independently adjustable dark/light transition endpoints.                     | Exact WASM alpha checks for hard/feathered ranges, underlying transparency, tile-edge export checks. |
| Developer docs          | An app link opens the scripting guide in dev and production builds.                                                              | Navigate from the app, check guide content and anchors in production.                                |
| Shared APIs             | OOP constructors, commands, REST validation and scripts support new document content.                                            | Constructor/ownership/transaction tests, script execution and API validation.                        |
| Plugins/extensions      | Install/review/update/export/remove versioned local command packages; document permissions, isolated execution and shared undo.  | Registry and browser lifecycle/permission/rollback tests; production command execution.              |
| Existing guarantees     | Source preservation, no arbitrary MP cap, local operation, keyboard access, save/open/export and custom design.                  | Existing 50 MP and regression suites plus updated documentation.                                     |

Paint strokes and vector paths are editable document data. Clone sampling snapshots visible content into bounded source tiles before applying a stroke. Rendering, project serialization and scripting must account for every referenced asset. Working-buffer budgets never become image import limits.

## Verification evidence

- `npm run build`: compiled WASM, isolated runtime, developer docs, TypeScript and production bundling.
- `npm test`: constructor ownership/undo/placement, clone asset references, strict REST commands/rollback, actual WASM tone/Blend If/selection coverage, and plugin validation/storage. See `tests/dom.test.ts`, `tests/api.test.ts`, `tests/wasm.test.ts`, `tests/plugins.test.ts`.
- `tests/tools.e2e.ts`: real brush/pencil/pen/marquee gestures; anchor/handle and individual path-property edits; layer reordering/group dragging; sampled clone pixels, cancellation cleanup and reopen; Blend If numeric controls, alpha and undo; Boolean selections and shadow/overlay/Blend If export compared across tile boundaries; in-app docs and all nine named scripting recipes in the real sandbox.
- `tests/plugins.e2e.ts`: inert install, named command history, undo, reload/update/export/remove, read-only enforcement, rollback, cancellation, blocked network and stale revisions.
- `tests/editor.e2e.ts`: original scripting/focus/persistence regressions plus 50 MP import, untouched original pixels, actual WASM adjustment, save/reopen and full-resolution export. No image resolution caps were added.
- `tests/production.e2e.ts`: built-app documentation pages and fragment links, no development global, plugin command execution/undo, and PNG export. Run after a build using `npm run test:production`.

The browser checks ran in Chromium with a 1440×1000 viewport. Screenshots of pen tools, layer styles and plugin management were visually inspected. Build warnings about the Lucide `use client` directive and bundle size are nonfatal; initial-bundle optimization remains future work.

## Deliberate first-version boundaries

Selection outlines show component regions; the WASM mask evaluates the final Boolean selection on a fixed 4×4 subpixel grid. Clone sampling completes on release and records image tiles; the live gesture shows a trail. Strokes are immutable operations removable/replacable via the DOM; there is no individual stroke inspector. Vector path properties remain editable. Drop shadows and Blend If use the documented isolated-group/compositing order, without a Photoshop-compatibility claim.

Plugins are local command packages, not custom panels or a marketplace. They inherit the current script sandbox's capabilities and practical limits. REST remains a separate metadata service. No AI calls, accounts, billing or cloud uploads were added.
