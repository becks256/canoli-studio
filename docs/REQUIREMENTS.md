# Luma editor requirements

Status: local editor foundation and rich tool milestone implemented; verification and limitations below. This document separates requested requirements from implementation decisions and future work.

## Product context

The owner is a full-stack engineer with image-processing and home-decor experience. The broader business target is $30,000+ in monthly recurring revenue, with little initial capital and low ongoing maintenance. Available development time is 10–20 hours per week. The current product direction is a browser-based AI-native photo editor, beginning with a small editing foundation. Business viability, pricing, and customer demand have not been validated.

## Confirmed requirements

| ID  | Requirement                              | Acceptance                                                                                                                                                                                                                             |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Browser-based application                | Runs in a modern desktop browser with no desktop installation.                                                                                                                                                                         |
| R2  | Use WebAssembly                          | At least one real image operation executes in a compiled WASM module.                                                                                                                                                                  |
| R3  | Start bare-bones; preserve extensibility | Document model, UI, rendering, image processing, and persistence have separate boundaries.                                                                                                                                             |
| R4  | Photoshop-inspired document object model | Documents own ordered layers; groups own child layers; image layers refer to source assets and adjustments. This is not a claim of Photoshop API/file compatibility.                                                                   |
| R5  | Object-oriented design                   | Public DOM objects use constructors and methods/properties. The application uses the same DOM API intended for future integrations.                                                                                                    |
| R6  | Public API uses DOM constructors         | `new Document`, `new RasterLayer`, `new LayerGroup`, `new TextLayer`, and `new ToneAdjustment` work today; attached mutations are validated and undoable.                                                                                               |
| R7  | Keyboard shortcuts from the start        | A central registry drives shortcut handling and discoverable help; text entry is protected.                                                                                                                                            |
| R8  | Document requirements                    | This file records scope, acceptance criteria, decisions, limitations, and open questions.                                                                                                                                              |
| R9  | Product brief for future agents          | The application objective, intended experience, constraints, and unvalidated decisions are recorded in `PRODUCT_BRIEF.md`; `AGENTS.md` links the documents.                                                                            |
| R10 | Distinct custom design system            | Professional, modern visual language appealing to artists/designers, with reusable components and tokens. No shadcn. See `DESIGN_SYSTEM.md`.                                                                                           |
| R11 | REST API                                 | Local versioned document creation/query/commands/history endpoint, runtime validation and revision conflicts; current limitations documented.                                                                                          |
| R12 | Scripting API                            | Users run custom JavaScript with DOM constructors from a Scripts panel; successful edits apply atomically with shared undo. Constructor/member reference and runnable examples are maintained in [SCRIPTING_API.md](SCRIPTING_API.md). |
| R13 | Preserve high-resolution images          | No fixed MP, image-file-size or dimension cutoff; keep original dimensions/data, separate working-buffer budgets, test 50 MP end to end. Browser/device constraints must be reported honestly.                                         |

## Plugin extensions

R14: Support plugins/extensions. The first implementation installs versioned JSON packages with named JavaScript commands, explicit document read/write permissions, source review, local browser persistence, export/update/remove actions and sandboxed execution. Each successful editing command shares the DOM and one history entry. See [PLUGINS.md](PLUGINS.md) for the current contract and future extension boundaries. Plugin UI panels, network capabilities, background hooks and a marketplace are not part of this first slice.

## First usable slice

| ID  | Capability                  | Acceptance                                                                                                                                                                     |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | Import images               | PNG, JPEG, and WebP files become image layers, with clear validation errors.                                                                                                   |
| M2  | Layer editing               | Select, rename, show/hide, lock, duplicate, delete, reorder, group, and change opacity/blend mode.                                                                             |
| M3  | Canvas navigation           | Zoom, fit, hand pan, temporary Space pan, and drag an unlocked layer.                                                                                                          |
| M4  | Non-destructive adjustments | Exposure, contrast, and saturation are stored on the layer; original source pixels remain unchanged.                                                                           |
| M5  | Undo/redo                   | UI and constructor-API changes share one history; a transaction is one undo entry; invalid transactions roll back. A continuous drag/slider gesture creates one history entry. |
| M6  | Portable project files      | Save/open versioned `.luma` JSON containing document data and referenced images; reopen reproduces the composition.                                                            |
| M7  | Export                      | PNG uses the same compositing path as the editor, without selection outlines or viewport zoom.                                                                                 |
| M8  | Local operation             | Browser editing requires no server backend, account, paid API, or image upload to an external service. The REST service is optional.                                           |
| M9  | Responsive processing       | WASM pixel loops run in a Web Worker; stale preview results cannot replace a newer document revision.                                                                          |

## Rich tools milestone

See [TOOLS_MILESTONE.md](TOOLS_MILESTONE.md) for the acceptance audit. Brush, pencil, clone, Bézier pen and rectangle/ellipse marquee use the shared command/history model. Drag layer rows above/below siblings, into the center of groups, or onto the document-root drop target. Reparenting via the UI preserves document position; dragging a selected group on canvas moves its children together.

Brush controls include color, size, hardness and opacity; pointer pressure changes stamp size. Pencil uses hard pixel-aligned marks. Clone uses Alt/Option-click to set a source, samples visible content on release, and supports aligned sampling. Drawing over an image creates a separate paint layer. Vector paths have editable anchors/handles, fill/stroke, close and finish actions. Marquee supports replace/add/subtract/intersect and constrains paint, clone, fill and clear operations. Layer properties include fill opacity, 16 blend modes, color overlay, drop shadow and source/underlying Blend If ranges with four endpoints each, in luminance/R/G/B.

The Developer docs link in both the rail and Scripts panel opens generated, locally served documentation; these pages are included in production builds. Scripts and REST commands represent every new document primitive; REST still has no asset/rendering service.

## Tool adjustment controls

R15: Every bounded numeric tool adjustment pairs a reusable slider with an adjacent exact number input. Brush/pencil/clone diameter and opacity, brush/clone hardness, and pen width support both methods, with equivalent bounds and synchronized values. Use the same paired control for path widths and bounded inspector adjustments. Inputs accept precise fractions; invalid/empty values revert. Sliders support keyboard steps/endpoints, live preview, cancellation, and one committed undo entry for document changes. Both inputs respect disabled/locked state. Tool settings remain outside document history. The bar must keep the controls accessible at narrower desktop widths. See [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md#paired-numeric-adjustments).

## Responsive drawing

R16: Brush/pencil previews accumulate input samples without committing or validating the entire document on each movement. Publish previews and start queued drawing work at most once per animation frame; consume coalesced events where available. Render only new stroke segments and reuse unchanged layer content within bounded working-memory caches. A cached preview must match full replay with pressure, opacity, clipping, grouping and styles. Release retains the final endpoint and commits exactly one undo step; Escape, focus loss, pointer cancellation/capture loss and document replacement discard transient work. Changed content, transforms, viewport/scale and history must not display stale cached pixels. Export preserves full-resolution originals and uses the same compositing rules.

## GPU acceleration

R17: Prefer hardware WebGPU for supported viewport rendering, with automatic Canvas2D/WASM fallback on unsupported devices, unsupported effects, precision/allocation limits or device loss. Retain unchanged visible-region textures; draw new brush/pencil segments and run supported effects on the GPU without CPU readback for presentation. Keep source resolution, constructor APIs, history, clipping and exports intact. Report the actual displayed backend. Test real shader output against the reference renderer with documented rounding/antialiasing tolerances, check resource cleanup and device-loss recovery, and distinguish software-adapter correctness tests from real-GPU performance/presentation verification. See [GPU backend scope and limitations](ARCHITECTURE.md#gpu-viewport-backend).

## Initial keyboard map

`Mod` means Command on macOS and Control on Windows/Linux. Shortcuts are suspended while typing in inputs, textareas, selects, or editable content. Escape can close a dialog or cancel a gesture.

| Action                                 | Shortcut                                                  |
| -------------------------------------- | --------------------------------------------------------- |
| Move tool                              | V                                                         |
| Hand tool                              | H                                                         |
| Artboard editor                        | A                                                         |
| Text tool                              | T                                                         |
| Paint bucket (Fill)                    | G                                                         |
| Brush / Pencil / Pen / Marquee / Clone | B / N / P / M / S                                         |
| Brush/pencil/clone diameter            | [ / ]                                                     |
| Finish active path                     | Enter                                                     |
| Remove last active path anchor         | Delete / Backspace while drawing with Pen                 |
| Select entire canvas / deselect pixels | Mod+A / Mod+D                                             |
| Clear selected paint                   | Delete / Backspace with a pixel selection and paint layer |
| Temporary hand tool                    | Hold Space                                                |
| Import image                           | Mod+O                                                     |
| Open project                           | Mod+Shift+O                                               |
| Save project                           | Mod+S                                                     |
| Export PNG                             | Mod+Shift+E                                               |
| Undo                                   | Mod+Z                                                     |
| Redo                                   | Mod+Shift+Z, Ctrl+Y                                       |
| Duplicate selected layer               | Mod+J                                                     |
| Delete selected layer                  | Delete / Backspace                                        |
| New empty layer                        | Mod+Shift+N                                               |
| Add group containing selection         | Mod+G                                                     |
| Move selected layer forward/backward   | Mod+] / Mod+[                                             |
| Nudge selection                        | Arrow keys; Shift for 10 px                               |
| Fit canvas                             | Mod+0                                                     |
| Actual size                            | Mod+1                                                     |
| Zoom                                   | + / −                                                     |
| Keyboard help                          | ?                                                         |
| Plugins                                | Mod+Shift+L                                               |
| Scripts                                | Mod+Shift+K                                               |
| Run script in code editor              | Mod+Enter                                                 |

Buttons remain available for browser/OS-reserved shortcuts. Only handled shortcuts prevent the browser default. Runtime shortcut rebinding is a future feature; definitions must remain centralized to make it possible.

## Architectural decisions

1. TypeScript for browser UI, application orchestration, and public DOM classes; React for the UI.
2. AssemblyScript for the initial WASM pixel kernel. It resembles TypeScript but is a different, constrained language. Ordinary npm/React code is not compiled into WASM.
3. Public class handles resolve objects by ID in the current document revision. Plain, versioned data-transfer objects are used for snapshots, files, and worker boundaries; attached state is immutable outside commands.
4. Constructor-created layers are detached until added to a document/group. Ownership, stable IDs, validation, atomic transactions, and undo are enforced centrally.
5. Adaptive WebGPU viewport rendering with retained textures and WGSL shaders; Canvas 2D and a WASM worker provide reference/export rendering and automatic fallback. Public document APIs are independent of the selected backend.
6. Original image assets are held separately from document/history metadata. Duplicate layers share sources.
7. No model/provider API in this milestone. A future AI adapter should produce validated document commands and new assets through the same public API. It must not evaluate generated JavaScript.

## Current practical limits

- Desktop browsers; PNG/JPEG/WebP imports and PNG exports.
- sRGB, 8-bit RGBA. The initial exposure/tone operator works on encoded channels; it is not a color-managed photographic pipeline.
- No fixed source/canvas megapixel cap. Positive safe-integer document dimensions; 64 layers, 8 group nesting levels, 60 undo entries.
- No fixed image/project byte-size cutoff. Browser decoding, memory and JSON/base64 string allocation still impose real practical constraints; there is no infinite-size guarantee. Original sources remain resident.
- Manual project saves; the UI must not claim durable autosave. Source assets retained for undo are released when changing documents.
- Rectangular layer hit testing and isolated groups. No alpha hit testing, arbitrary layer masks, rotation, text layers, PSD, RAW, CMYK, or multi-document workspace yet.
- Drawing limits: 2048 operations or paths per layer; 20,000 points per stroke/path; 128 marquee regions; 4096 clone tiles per stroke. These bound metadata complexity, not image dimensions. Paint operations can be removed/replaced through scripting; there is no individual stroke inspector yet.
- Marquee displays component outlines rather than a traced combined contour. Clone displays its stroke trail until sampling completes on release. Canvas 2D uses encoded sRGB blending and browser antialiasing; Photoshop parity is not claimed.
- Reparenting uses the destination group's coordinate system; preservation of world position is future behavior.

## Future scope — not implemented commitments

- AI-assisted edits, provider choice, credentials, generation budgets, and product-specific workflows.
- Arbitrary masks, richer adjustment stacks, transforms, text nodes, disk-backed/lazy source decoding, streaming binary project persistence, GPU acceleration, color management, and more formats.
- Public plugin/automation SDK packaging, persisted keyboard customization.
- Autosave/recovery, cloud storage, authentication, collaboration, and billing.

## Verification

Automated tests should cover DOM constructor ownership, live handles after undo/redo, transactions/rollback, cycle rejection, locked ancestors, project validation, and actual WASM pixel output. Browser checks should cover import, edit, keyboard shortcuts/focus, save/reopen, and export through the real worker/rendering pipeline. A 10000 × 5000 fixture must retain dimensions and original pixels through import, adjustment, save/reopen, and PNG export; inspect pixels across tile boundaries. Verify constructor scripting rollback/timeout/network isolation/revision conflicts and REST conflict/atomicity behavior.

## Automation and large-image acceptance

- Scripts execute off the UI thread with no host object references or network access, a 5-second timeout and explicit cancellation. Validate all returned operations and asset references; discard stale-revision results. This is a local prototype sandbox, not a security-reviewed marketplace runtime.
- The REST service uses local in-memory sessions and exposes metadata/commands/history only. Browser synchronization and image upload/render endpoints remain future scope. Document this distinction wherever the API is presented.
- Viewport rendering uses visible regions and bounded preview surfaces. Adjustments use small WASM tiles. PNG export uses tiles/scanline strips at document resolution rather than a document-sized canvas. Preview budgets must never be applied to import acceptance.
- Decoder/allocation failures report device/browser capability problems without silently resizing originals. See ARCHITECTURE.md for current memory limitations.

### Appearance modes

The editor and all developer docs support Light, Dark, and System. The editor exposes a compact sun/moon toggle at the bottom of the tool rail, with System available in its right-click/keyboard appearance popover; docs retain the labeled selector. Default to the OS preference, persist explicit choices locally, synchronize tabs, and respond to OS changes while System is selected. Apply the preference before first paint. Theme changes affect UI chrome and syntax highlighting only; rendered artwork, exported pixels, document data, and undo history must be unchanged. Storage failure must not prevent switching for the current page. Docs remain readable and follow the OS with JavaScript disabled.
