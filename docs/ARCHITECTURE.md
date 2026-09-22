# Architecture

Read [PRODUCT_BRIEF.md](./PRODUCT_BRIEF.md) for intent and [API.md](./API.md) for both automation surfaces. Luma is a working name.

## Boundaries

| Module                             | Responsibility                                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/dom`                          | Public OOP constructors: Document, raster/paint/vector/group layers, paths, strokes, selections, styles and adjustments. Browser-independent. |
| `src/core/model.ts`                | Versioned document DTOs and structural validation. No pixels or UI state in the layer tree.                                                   |
| `src/core/commands.ts`, `store.ts` | Validated atomic mutation, immutable snapshots, stable IDs, undo/redo.                                                                        |
| `src/core/validation.ts`           | Strict runtime command schemas for REST and scripting results.                                                                                |
| `src/core/assets.ts`, `project.ts` | Immutable original sources, small thumbnails, portable versioned project files.                                                               |
| `src/editor.ts`                    | Active document, assets, import/export, script application, session replacement.                                                              |
| `src/engine`                       | Region compositor, pixel worker bridge, WASM loader, tiled PNG export.                                                                        |
| `assembly/pixels.ts`               | AssemblyScript pixel kernel compiled to actual WASM.                                                                                          |
| `src/scripting`                    | Constructor-based JavaScript runtime and isolated worker runner.                                                                              |
| `server`                           | Optional loopback REST service using the same document model.                                                                                 |
| `src/ui`                           | React views, central shortcuts, custom tokens and components.                                                                                 |

UI actions and scripting setters use the DOM. Attached setters emit commands; REST accepts validated command data. Commands update immutable document snapshots. Rendering reads snapshots and immutable source assets. A future AI adapter should return validated operations and new assets through this boundary, with provenance; generated JavaScript is not an AI execution mechanism.

## Object identity and transactions

Constructors create detached objects. Adding to a document or owned group establishes ownership. A layer cannot belong to two documents, and groups cannot create cycles. Attached handles resolve their stable ID in the current revision, so retained handles reflect undo/redo. Access to a removed node throws until it exists again. Duplicates have independent node/effect IDs and share the original source asset. Constructor-driven duplicate commands include an ID mapping so replay in a script's host produces the same references.

`Document.transaction(label, callback)` is synchronous, atomic and one undo entry. Nested transactions and async callbacks are unsupported. Do not schedule asynchronous mutation from a transaction; prepare asynchronous results first. Failed transactions discard document changes; handles created during a failed transaction must be discarded. Active-layer selection (`selectedLayer`) is session state and does not create history. Pixel selection (`selection`) is undoable document content. History retains up to 60 metadata revisions, not copied pixel arrays.

The underscore-prefixed methods are internal adapters, not supported external API. DTOs are for serialization and transport, not direct mutation. Document schema version is currently 1. Unknown layer/effect kinds fail instead of disappearing.

## Resolution and memory

**No fixed megapixel, image-byte-size, session-pixel-count, or 8192-pixel import cutoff.** User requirement: modern high-resolution images retain their original dimensions and source data. Document integer dimensions need only be positive and safely representable in JavaScript; this is a numeric representation constraint, not a product-resolution tier.

Working allocations are independent of document size:

- The browser decodes the original image with `createImageBitmap`; original compressed bytes are retained as a data URL for the current project format. Images are never silently resized on import. Layer placement may fit an image within an existing composition without modifying its source.
- The viewport renders only the visible document region. Zooming to 100% requests the corresponding source-resolution region. Screen buffers use a 4 MP / 4096-pixel-side allocation budget, not an import limit. Very dense/high-DPI viewports can use a reduced working preview.
- Each tone operation runs on tiles no larger than 1024 × 1024 in a worker. Tone and Blend If are point operations and require no halo. Drop shadows render padded regions that include blur/offset contributions across tile boundaries; verify seams against a full-region reference.
- Group opacity and blending apply once to an isolated group buffer for the current region. Intermediate canvases are released after compositing.
- PNG export renders full-resolution tiles and feeds rows into `CompressionStream('deflate')`. It never creates a document-sized output canvas. Scanline strips target about 4 MB; compressed PNG chunks remain in memory until download. Format dimension restrictions are export-format constraints, never image import limits.
- Thumbnails use small separate images, avoiding a second full-size decode per layer row.

This is **not** a claim of infinite-size support: browser decoding still materializes the source bitmap; original image assets remain resident for undo; `.luma` JSON/base64 parsing and saving materialize large strings. Device memory, browser decoders, numeric representation, and output formats impose real constraints. Recoverable decoder/allocation failures must report the actual operation, not invent an MP cutoff. A browser process killed by its OS cannot be caught reliably.

Next scaling boundary: lazy/region-capable image decoding, disk-backed asset storage and caches, streaming binary project files, cancellation/progress, and GPU compositing when measured performance justifies it. Do not reintroduce document caps to compensate for whole-image buffer allocation. Test 50 MP end to end and dimensions beyond prior cutoffs in model/API tests.

At reduced preview scale, adjustments operate on the resampled working pixels; nonlinear clipping can differ from final full-resolution export. Source-size crops and export use full-resolution processing. The first kernel uses encoded sRGB 8-bit channels; linear-light processing, ICC fidelity, RAW, CMYK and HDR need explicit future design.

## Tools and extended document content

`ToolController` tracks gestures, settings, command previews and a separate transient paint preview. Brush/pencil input accumulates all delivered/coalesced pointer samples, while preview publication is limited to one animation frame. A new empty paint layer is placed with the existing commands once at gesture start; subsequent samples never clone or validate the whole document. Pointer release includes the final endpoint and creates one validated DOM transaction. Escape, focus loss or session replacement cancels the gesture, including in-flight clone capture; a generation counter and document revision prevent stale commits. New paint/vector layers are placed above the selection or inside a selected group with document coordinates preserved. Preview placement uses the same commands.

Paint operations are immutable metadata (points, pressure, clip, style, source-tile references). Each operation renders into the current region, then its opacity applies once. Pencil uses pixel-aligned stamps. Clone snapshots the visible composition in at-most-1024px tiles before committing; staged assets are removed on cancellation/failure. Committed assets remain available for undo, and project serialization includes assets referenced by both rasters and clone operations. Stroke IDs and path IDs regenerate on duplication; original source assets remain shared.

Vectors store anchors and absolute local Bézier handles, stroke/fill and closure. Attached paths resolve by ID. Marquee regions evaluate ordered Boolean operations into a 4×4 subpixel mask in the WASM worker, with consistent coordinates across tiles; strokes capture that selection in local coordinates. New optional selection/style/fill-opacity fields are additive in prototype schema 1, with defaults for old files. Older builds may reject paint/vector layer kinds rather than silently discard them.

The region compositor isolates content, builds a shadow with padding, adds the color overlay, applies fill opacity to content, applies WASM Blend If to the styled result against preceding siblings, then composites with layer opacity/blend mode. Group child Blend If sees that group's internal backdrop. Color overlay and shadow pixels are browser Canvas operations; per-pixel tonal gates execute in the WASM worker.

`npm run build:docs` converts repository Markdown into local HTML/CSS under `public/developer`. Both `dev` and `build` generate these pages. The canonical source remains `docs/`; source-file references are labeled as repository references in the generated pages.

## Interactive rendering caches

`ActiveStrokeRaster` retains one unmasked brush/pencil canvas and draws only newly appended segments with the same stamp grid as full replay. It composites a copy with the captured selection mask and stroke opacity once, then feeds the normal layer/group/effect compositor. This preserves pressure, soft edges, translucent overlaps and export parity. A changed stroke/settings, rewritten or shortened point prefix, transform, viewport or scale resets the surface. The active surface retains at most 16 MiB; larger effect halos use full replay without imposing a document-size limit.

`CanvasCache` retains up to 64 MiB (and 64 entries) of least-recently-used layer content and active selection-mask canvases. Keys include the document, asset store, complete layer content, absolute placement and render space. Frozen layer signatures are memoized by object identity. Content is cached before its own styles; backdrop-dependent Blend If always runs against the current composition. Ancestors containing a live stroke recompose their children. Reads/writes copy synchronously, so asynchronous jobs cannot retain references to evicted buffers. Session replacement/disposal clears retained pixels and prevents in-flight jobs from repopulating an obsolete cache.

`RenderOptions.paintPreview` is an internal trusted tool/render adapter, not a scripting or REST mutation API. Export and clone sampling pass `cache: false` to avoid replacing useful viewport entries with one-off tiles. The same option provides the full-replay reference in renderer regression tests. Completed strokes remain editable metadata; the cache is neither persisted nor part of history. Stroke commit can still replay a changed paint layer once, and complex shadows/Blend If still cost work per frame; there is no universal frame-rate guarantee.

Browser tests in `tests/rendering.e2e.ts` cover pixel parity, segment work, frame batching, final samples, cancellation, cache eviction, and tone invalidation. The existing high-resolution import/export and tiled-effect tests remain required.

## GPU viewport backend

`AdaptiveRenderer` preserves `CanvasRenderer.render()` for export, clone capture and reference pixels. Its `prepareViewport()` selects `WebGpuRenderer` when a hardware adapter is available in a secure context (HTTPS or localhost), and otherwise prepares a Canvas/WASM frame. Software adapters are rejected in normal operation; an internal constructor option permits them in shader tests. This does not require a backend server, cloud upload, paid service or document-model change.

GPU viewport behavior:

- Source images are drawn into **visible-region** buffers before upload, never into a GPU texture sized to the entire imported image. Unchanged raw raster, paint and vector content stays in an LRU texture cache. Tone changes reuse the original uploaded raster.
- WGSL implements incremental brush/pencil stamps using the shared stamp-spacing iterator, tone adjustments, captured Boolean selection masks, color overlay/fill opacity, isolated group compositing, all 16 blend modes, and source/underlying Blend If. Brush coordinates are rebased in JS double precision before entering GPU buffers. Stroke opacity and clipping apply once to the accumulated surface.
- Fill/clear, clone and vector primitives currently use reference rasterization on a cache miss and then retain their uploaded texture. Drop-shadow documents use the complete Canvas/WASM path; GPU blur is not implemented. Brushes with projected stamp diameters below two working pixels use the reference path so supersampling cannot erase subpixel marks. These are backend choices, not document/tool restrictions.
- RGBA8 textures use premultiplied alpha and encoded sRGB. GPU preview and committed GPU strokes match; Canvas/export comparisons allow small 8-bit rounding and edge-antialiasing differences. The tested stacked-effect fixture differs by at most four channel values; the tested soft-brush edges by at most eleven, with mean error below 0.1. Do not describe the two backends as bit-identical or claim universal tolerances from these fixtures.
- Cached textures retain at most 64 MiB and 64 entries, plus at most 16 MiB for an active stroke. Renderer-owned live textures have a 192 MiB working budget. These exclude browser/driver overhead, source decoding, Canvas fallback allocations, diagnostic readback buffers and the browser-owned swapchain. Device texture limits, allocation/validation failures and precision-sensitive masks trigger fallback rather than resizing/rejecting the document.
- `ViewportFrame.present()` writes directly to a WebGPU canvas after the UI checks its render generation. It does not read pixels back to the CPU. The host replaces the canvas when switching backend because context types cannot be changed in place. Device-loss notifications request a fresh fallback frame automatically. Session replacement clears caches and invalidates pending frames; every prepared frame must be disposed.

The Canvas factory defaults to drawing surfaces without `willReadFrequently`; tone readback tiles, Blend If buffers and PNG readback explicitly request CPU-friendly buffers. Drawing surfaces no longer read back a probe pixel on allocation. The reference renderer continues to run per-pixel CPU operations in the WASM worker.

The footer reports **GPU accelerated** or **Standard rendering** for the displayed frame. Trusted development code can inspect `editor.renderer.gpu.diagnostics` (state, cumulative uploads/stamps/cache hits/frames/readbacks and retained/allocated bytes). This is an internal diagnostic, not a scripting or REST API. `ViewportFrame.readPixels()` exists for explicit GPU test readback only; ordinary viewport rendering does not call it.

`tests/webgpu.e2e.ts` runs actual WGSL through Chromium's SwiftShader adapter and reads GPU output buffers to check pixels, texture reuse, large-document regions and device-loss recovery. The presentation shader is separately tested against a real GPU texture in the preferred canvas format. The current headless software-adapter environment cannot present a browser-owned WebGPU swapchain canvas reliably; hardware presentation and hardware performance must be checked on a real GPU. Shader tests are not proof of hardware speedup. The regular browser/production suites exercise the automatic Canvas fallback, gestures and exports.

Reference: [WebGPU specification](https://gpuweb.github.io/gpuweb/), [canvas readback contexts](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext#willreadfrequently).

## Parameter controls

`src/ui/controls.tsx` owns the shared slider/number pair. Both tool options and bounded inspector properties use it. Tool previews update session settings directly; document-property previews remain transient commands until the gesture commits through the DOM. The control tracks pending gestures separately from committed values, so release followed by blur does not duplicate history. Path-width previews use the same command preview path as layer/tone/style adjustments. See the design system for keyboard, numeric-validation and scale rules.

## Asynchronous work

Reference-renderer pixel buffers transfer to a dedicated worker and back; the main thread does not execute WASM pixel loops. The adaptive viewport uses GPU shaders when supported and the Canvas compositor otherwise. A serial preview drain starts at most one render per animation frame and takes the newest queued snapshot. It rejects stale revisions, viewports and cancelled/replaced gestures; an earlier prefix of the same live stroke may display while its next frame waits, avoiding starvation during expensive effects. Cursor updates are frame-paced too. Export uses the same region compositor at source scale. Replacing a session releases its assets; callers should finish asset-dependent work before replacing a session.

The constructor API is TypeScript, not compiled to WASM. AssemblyScript is a separate, constrained TypeScript-like language used only for the numeric kernel. It is replaceable behind the worker protocol. The GPU viewport backend and Canvas reference/export renderer share document snapshots without changing the public DOM or document schema.

## Scripting boundary

See [SCRIPTING_API.md](SCRIPTING_API.md) for the public scripting contract, reference and runnable examples.

A sandboxed opaque-origin iframe creates a dedicated worker containing the bundled DOM implementation. The script receives a document snapshot, selected ID and constructor bindings, never host object references, credentials or image bytes. CSP denies network and external code loading. The host validates returned commands, checks that the document/revision has not changed, validates referenced assets, and commits one atomic transaction. A thrown error, invalid result, cancellation, timeout or conflict commits nothing.

This is an initial local scripting environment, not a reviewed public plugin security platform. Time is bounded to 5 seconds and result complexity is bounded; worker heap allocation is not strictly metered. Do not describe it as safe for arbitrary hostile code or enable server execution of user scripts. Constructor/command DTO validation alone is not a JavaScript sandbox.

## Plugin boundary

`src/plugins` validates version-1 packages and maintains an immutable registry backed by local browser storage. Installation stores inert data. `editor.runPlugin` resolves only an installed command, invokes the scripting runner, enforces document read/write permission at the host commit boundary, checks revision/assets, and applies one labeled transaction. Plugins inherit the script runtime's time, command and result limits; there is no privileged page-context execution. The React Plugins panel provides package/source review, explicit installation/replacement, run/stop/output, export and removal. See [PLUGINS.md](PLUGINS.md).

## REST boundary

The optional local service binds `127.0.0.1:8787`, uses in-memory documents, and checks loopback Host and allowed local browser origins. REST sessions are currently separate from the browser's active document. It exposes document metadata/commands/history, not image upload, raster rendering or script execution. Restarting loses server documents. Deployment, authentication, durable asset storage and browser session synchronization are future work; do not expose this prototype service publicly.

## External references

- [AssemblyScript introduction](https://www.assemblyscript.org/introduction.html)
- [MDN: canvas sizing and environment-dependent allocation limits](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas#maximum_canvas_size)
- [MDN: createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap)
- [PNG specification](https://www.w3.org/TR/png-3/)

## Appearance

`public/appearance.js` is a shared early bootstrap for editor and docs, loaded before styles. It owns validated local preference persistence (`luma.appearance.v1`), OS media-query changes, cross-tab synchronization, and resolved root theme attributes. `AppearanceToggle` in the tool rail tracks the resolved theme, toggles light/dark, and exposes `AppearanceSelect` in a native popover for System mode. `AppearanceSelect` subscribes to its `luma:appearance-change` event and requests changes through `luma:set-appearance`; static docs server-render the same selector and the bootstrap enhances it without React hydration. Appearance is UI state only and has no dependency on the document model, commands, renderer, export, or history. CSS tokens provide both palettes and a no-JavaScript OS fallback for documentation.
