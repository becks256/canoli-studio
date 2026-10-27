# Canoli Studio — product brief

## Initial float document workflow (F10)

The local professional-editor objective now includes an explicit initial float32/linear-sRGB workflow for original float TIFF raster artwork, masks, groups and exposure. Display remains SDR; unsupported tools and interchange reject. No paid operation, account or upload is added. Full color/tool/device/performance acceptance remains required. [Exact signatures, defaults, errors, limits and verification](FLOAT_DOCUMENTS.md).

## Character formatting increment

Source-indexed character formatting extends local professional typography through shared OO commands/undo, Inspector selections, native browser script metrics and portable document data. The broad professional-editor objective remains; path/vertical text, richer flow, wider shaping/interchange and sustained performance are still required. See [CHARACTER_TEXT.md](CHARACTER_TEXT.md) for the contract, limits and dated verification status.

## Local layout increment

Canvas and key-object alignment extend precise local editing through shared OO commands, separate REST sessions and semantic recipes. Authored geometry and original sources remain preserved; this does not change the broad professional-editor objective or authorize accounts, inference or uploads. See [LAYER_ALIGNMENT.md](LAYER_ALIGNMENT.md).

## Font-file binding (F08)

Document schema 43 supports separately owned font resources, shared FontFile commands, explicit trusted embedding and native-project 5/workspace persistence. Selected native fonts preload into isolated script workers before text construction; no font chooser, host store, credentials or network grant is exposed there. Portable recipe/package/batch transport is documented separately in [FONT_RECIPES.md](FONT_RECIPES.md); supported SVG font/text reimport is described in [SVG_FONT_IMPORT.md](SVG_FONT_IMPORT.md). Broader font/viewer/device/mixed-source acceptance and professional typography remain open. See [the current font-file contract and limits](FONT_FILES.md). Earlier font-source sections below describe read-only inspection/preview; explicit embedding is a separate operation.

Canoli Studio is the chosen product name (formerly Luma). This brief is the source of truth for product intent. Read it before planning or implementing features. See [REQUIREMENTS.md](./REQUIREMENTS.md) for acceptance criteria and [ARCHITECTURE.md](./ARCHITECTURE.md) for implementation boundaries.

The rebrand changes product-facing names and credits. Existing `.luma` projects, plugin/recipe formats, browser storage keys, development `window.luma` access and `LUMA_API_*` configuration remain compatible. The repository directory and existing deployment URLs remain unchanged until a new destination is configured.

## Application objective

Build a capable browser-based image editor in which people can combine precise visual editing with AI-assisted operations. Begin with a small, dependable editor and grow it through an extensible object-oriented document model. Users should be able to describe an outcome, inspect and refine the resulting changes, and reuse useful operations without losing control of their source artwork.

The long-term ambition is a professional, AI-native Photoshop alternative that competes on editing breadth and improves control, repeatability and time to a finished result. The owner has explicitly requested “Photoshop, but better,” including automatic metadata extraction and image-asset generation as layers. Broad professional parity is a staged objective, not a claim about the current prototype or the first release. The initial product must earn adoption through verified workflows.

The maintained plan is [FEATURE_STRATEGY.md](FEATURE_STRATEGY.md), supported by [competitive evidence](COMPETITIVE_RESEARCH.md), [detailed AI specifications](AI_FEATURE_SPECS.md), and the [implementation roadmap and work log](IMPLEMENTATION_ROADMAP.md). These documents specify proposed functionality; they do not imply model integration has shipped.

## Why this product

The founder is a self-taught full-stack engineer specializing in image manipulation and automation. Their industry experience includes wall art, lighting, and small furniture. Repetitive mockups, product variations, and art production provide useful domain knowledge and potential evaluation tasks.

Earlier discovery considered wall-art specification, factory costing, and quote automation. The current product direction is an image editor. Those earlier ideas are background research, not instructions to add procurement, manufacturing pricing, or factory communication to this application.

## Business objective and constraints

- Aim for $30,000+ in monthly recurring **business revenue**, not personal take-home income.
- Minimize upfront cash investment; founder time is initially limited to roughly 10–20 hours a week.
- Favor repeatable software workflows and modest support needs over custom services or customer-specific development.
- Low maintenance is an objective, not a promise. A broad creative application and fast-changing AI integrations create ongoing maintenance obligations.
- Pricing, audience, acquisition channels, and willingness to pay remain unvalidated. Do not present revenue arithmetic as a forecast or claim product-market fit.

## Intended users

Initial hypothesis: designers, image-production specialists, and small creative/ecommerce teams who repeatedly prepare or revise images. Home-decor and wall-art teams are promising discovery participants because of the founder's experience; they are not a confirmed exclusive market.

Users need both efficiency and precision. A plausible recurring task is creating approved variants from a source image while preserving the identity of a product, label, or artwork. Validate this with actual users before expanding scope around it.

## Intended experience

1. Open an image or project directly in the browser.
2. Organize the composition into meaningful layers and groups.
3. Make changes with direct tools, keyboard shortcuts, or—later—natural-language instructions.
4. See what changed, compare results, adjust parameters, and undo confidently.
5. Preserve original source assets and keep generated changes separately editable wherever the operation supports it.
6. Save the editable project, export a finished image, or reuse an approved sequence for related images.

AI should be integrated with the document, tools, and history. A future instruction should resolve to explicit operations with inspectable results. When a model only returns a flat raster, represent that result honestly as an asset/layer; do not claim it contains semantic editable objects that the model did not produce.

## Product principles

- **Control:** manual correction, predictable selections, reversible actions, and visible state matter as much as first-generation output quality.
- **Source preservation:** edits should not silently overwrite original image data. Protected content must be enforced by the operation/compositing path, not merely requested in a prompt.
- **One behavior model:** buttons, shortcuts, automation, and future AI tools operate on the same document API and validation rules.
- **Progressive capability:** ship a coherent vertical slice; add tools after the foundation can represent and persist their behavior.
- **Fast interaction:** canvas navigation and basic editing stay responsive while expensive operations run asynchronously.
- **Predictable costs:** future paid generation needs observable usage and limits. Measure cost per accepted result, including retries.
- **Honest scope:** distinguish implemented features, experiments, and roadmap ideas. Do not label simulated commands as working AI or claim unsaved edits are durable.

## Confirmed architectural direction

The founder explicitly requested:

- A browser application, inspired by Figma's delivery model.
- WebAssembly for appropriate engine work; a JavaScript/TypeScript-like language was requested for consideration.
- A Photoshop-inspired document object model.
- An object-oriented approach, with public APIs based on DOM constructors.
- Plugin/extension support, beginning with installable commands using the same isolated scripting API and undo boundary.
- Both a REST API and a scripting API; users must be able to write scripts that control the application through the document model.
- No arbitrary image/document resolution cap; high-resolution originals must be preserved.
- Keyboard shortcuts as an initial capability.
- Maintained requirements and a product brief that future agents can use.
- A distinct design system that is professional, modern, and appealing to artists/designers, explicitly excluding shadcn.

The current implementation uses TypeScript DOM classes and UI code, AssemblyScript compiled to WASM in a Web Worker for reference/export pixel operations, and an adaptive WebGPU viewport with Canvas fallback behind the renderer boundary. These choices serve the requested direction; future performance changes should be evidence-driven. Do not move all UI or business logic into WASM just because WASM is available.

## First milestone

A local, single-document desktop-browser editor with image layers and groups, basic transforms, visibility/locking/opacity/blending, non-destructive tone adjustments, undo/redo, central keyboard shortcuts, editable project files, and PNG export. Its public constructors must already be usable from code, including a local scripting panel. An optional local REST service exercises the same document semantics.

This milestone has no model API calls, billing, or cloud upload. The optional REST server is local, in-memory and separate from the browser session; it retains separate in-memory documents/assets and commands, with explicitly scoped jobs and PNG-source Color Range analysis. It does not render browser scenes or synchronize with the browser. It establishes the object and command boundaries required for future AI behavior. See the requirements document for exact limits and verification criteria.

## Current precision-tool milestone

The next requested slice adds paint brush, pencil, visible-composite clone brush, editable Bézier pen paths, rectangular/elliptical marquee, layer dragging/reparenting, fill opacity, color overlay, drop shadow and tonal/channel Blend If. These remain local operations with shared undo, source preservation and constructor-based automation. A Developer docs link exposes the maintained scripting guide in the app. See [TOOLS_MILESTONE.md](TOOLS_MILESTONE.md) for acceptance evidence and limitations.

## Explicit optional identity scope (T24)

The owner requested Sign in with ChatGPT in the implementation roadmap. Its optional identity-only account/session boundary is locally verified with signed fixtures; live OpenAI acceptance still needs an eligible registered client. It preserves local editing and artwork without accounts, and does not imply paid inference, plan access, document uploads, plugin permissions or cloud collaboration. See [identity contract and current acceptance limits](SIGN_IN_WITH_CHATGPT.md).

## Suggested evolution (subject to evidence)

The phased feature portfolio and implementation gates are now maintained in [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md); the principles below remain applicable.

1. **Editor foundation:** finish and verify the first milestone.
2. **Precision primitives:** selections, masks, richer transforms, and adjustment behavior needed by the first validated task.
3. **One AI workflow:** connect one operation to existing model capabilities through an adapter, with clear result provenance, review, and undo. Choose providers and credential handling at that point.
4. **Repeatability:** saved operation sequences and batch work for a demonstrated recurring need.
5. **Commercial product:** validate paid use, then add the minimal account, storage, metering, and subscription capabilities it requires.

No stage authorizes implementing every listed capability at once. Prioritize a small task that demonstrates measurable user value.

## Evidence of progress

- Users can complete a real editing task and reopen the project without losing editability or appearance.
- DOM constructors, UI actions, and shortcuts produce consistent results and history.
- Document resolution is independent of working-buffer size; test high-resolution imports, region previews and full-resolution export without destructive downsampling.
- Users repeat the task and can explain why this editor improves their current workflow.
- A future paid workflow has measured acceptance rate, time savings, inference cost, and support burden.

## Open decisions

- Initial paying audience and the first workflow worth switching tools for.
- AI providers, processing location, data retention, and commercial usage terms.
- Required PSD interoperability, color-management fidelity, and requirements for extremely large documents beyond browser decoding and memory capabilities. Fixed megapixel import cutoffs are explicitly excluded.
- Cloud collaboration versus local-first operation beyond the initial milestone.
- Pricing, distribution, and budget for operating the hosted product.

Do not silently turn open decisions into product requirements. Make reversible implementation choices when needed and record consequential assumptions.
