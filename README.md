# Canoli Studio

An early browser image-editor foundation with a constructor-based document model, AssemblyScript/WASM adjustments, local JavaScript scripting, installable command plugins, and an optional REST document service. The product is named Canoli Studio (formerly Luma).

## Run locally

Use Node.js 24 (tested).

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Import a PNG/JPEG/WebP, inspect an SVG for editable geometry/gradient fills/strokes or explicitly flattened import, or open the sample composition. Combine closed vector areas with Union/Subtract/Intersect/Exclude from Properties or the command palette, retaining editable holes/curves and one undo step. Save editable work as `.luma`; export PNG/JPEG/WebP, flattened lossless RGBA8 sRGB TIFF (Automatic/classic/BigTIFF), SVG or the supported PSD subset. SVG keeps vector paths, editable paint dabs/fills and text (with measured whitespace correction and explicit font/glyph portability limits), embedded raster imagery and supported smart-object contents, with native adjustment/Blend If backdrop prefixes and baked editability disclosed in the export report. The browser editor runs locally without an account, paid service or image upload. Committed edits are checkpointed locally for recovery; use the rail’s Recover work action to reopen them. Download project files as backups.

For the separate local REST service, run `npm run dev:api` in another terminal. Default: http://127.0.0.1:8787/api/v1/health.

## What works

- Local metadata extraction in a worker, an Asset info inspector, and JSON sidecars with explicit privacy choices.

- Image layers/groups; move, scale, opacity, 16 blend modes, visibility, locking, duplication and ordering.
- Paint brush, pixel pencil, visible-composite clone, editable Bézier pen paths, and rectangular/elliptical marquee with Boolean operations.
- Layer-row dragging and grouping, fill opacity, color overlay, drop shadow, and luminance/RGB Blend If with feathered ranges.
- Install/export/remove local plugins, named commands, per-browser persistence and document permissions.
- Hardware WebGPU viewport acceleration for brush/pencil, tone, masks and layer blending, with retained textures and automatic Canvas/WASM fallback. The footer shows the active backend.
- Non-destructive exposure/contrast/saturation; GPU viewport shaders and a real WASM worker for reference/export processing.
- OOP document/layer/stroke/path/selection/style constructors, transactions and undo/redo.
- Central keyboard shortcuts, custom studio styling, and a JavaScript Scripts panel.
- Save/open binary project files (legacy JSON imports supported), local recovery checkpoints, and tiled full-resolution PNG export.
- No fixed megapixel import cap. Viewport regions and adjustment tiles bound working buffers independently of source resolution. Browser decode and device memory still matter.
- Local REST creation/query/commands/history with validation and revision conflicts. Server sessions are currently separate from the browser document and contain metadata only.

This is not yet an AI-integrated or commercial product. No model calls, PSD/RAW support, arbitrary layer masks, account/billing infrastructure, versioned recovery history or collaboration is implemented. The current raster pipeline is 8-bit encoded sRGB. New project files store original blobs directly; source decoding and manifest allocation still need further work for very large production documents.

## Documentation

- [Local asset metadata and sidecar policy](docs/ASSET_METADATA.md)
- [Project storage format and local recovery](docs/STORAGE_FORMAT.md)

- [Product brief and objective](docs/PRODUCT_BRIEF.md)
- [Professional editor feature strategy and catalog](docs/FEATURE_STRATEGY.md)
- [Competitive research and source evidence](docs/COMPETITIVE_RESEARCH.md)
- [Planned metadata, AI generation and automation specifications](docs/AI_FEATURE_SPECS.md)
- [Implementation roadmap, gates and planning work log](docs/IMPLEMENTATION_ROADMAP.md)
- [Requirements and keyboard map](docs/REQUIREMENTS.md)
- [Architecture and memory strategy](docs/ARCHITECTURE.md)
- [Scripting API guide, reference and examples](docs/SCRIPTING_API.md)
- [Plugin package and extension contract](docs/PLUGINS.md)
- [Tools milestone verification](docs/TOOLS_MILESTONE.md)
- [API overview and REST reference](docs/API.md)
- [Custom design system — no shadcn](docs/DESIGN_SYSTEM.md)
- [Instructions for future agents](AGENTS.md)

## Verification

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
npm run test:production
```

TIFF browser/production checks require Python 3 with Pillow (built with libtiff and ImageCms) and NumPy. They decode actual downloaded classic/BigTIFF files through `scripts/check-tiff-interoperability.py` and compare every RGBA pixel with native PNG. They fail explicitly if that independent reader is unavailable; they do not substitute the editor's own decoder.

The browser suite exercises actual drawing/dragging gestures, selection and style export pixels, plugin installation/permissions/persistence, documented scripting recipes, scripting isolation/history, keyboard focus, project round trips, and a 10000 × 5000 (50 MP) image through import, WASM adjustment, save/reopen and full-resolution PNG export. It checks source preservation and pixels across tile boundaries. Tests are evidence for the tested environment, not a universal browser/device support guarantee.

`PLAYWRIGHT_CHROMIUM_EXECUTABLE` can point to an existing Chromium binary. Builds generate the WASM module, isolated scripting bundle and in-app developer docs; generated files are ignored by Git. The local REST service binds loopback only and is not ready for public deployment.

The Plugins panel (**Mod+Shift+L**) includes **Load example** → **Install plugin** → **Add guide frame**. Command plugins are the initial extension surface; custom plugin panels, marketplace distribution and network services remain future work. The tool-rail book icon opens the scripting guide.

## GPU verification

WebGPU requires a compatible hardware adapter and a secure context (localhost is supported). It is selected automatically; unsupported features/devices use the reference renderer. Drop shadows and subpixel brushes currently use that fallback. Source-resolution export remains Canvas/WASM. See [backend scope and budgets](docs/ARCHITECTURE.md#gpu-viewport-backend).

`npx playwright test tests/webgpu.e2e.ts` validates actual WGSL through a software adapter using diagnostic GPU readback. This container has no hardware GPU, and its headless software swapchain cannot be used to verify direct canvas presentation reliably. Test hardware presentation and performance on a supported desktop browser; do not treat software-adapter timings as GPU speedups. Development-console diagnostics are available at `luma.editor.renderer.gpu.diagnostics`.

Open **Design checks** from the rail or command palette to inspect font families, authored bounds and native raster sampling under an explicit DPI/PPI policy. Reports are read-only, downloadable JSON with visible limitations; this does not certify print readiness. The same [preflight API](docs/SCRIPTING_API.md#design-checks) is available through OO scripts and separate REST sessions.

Boolean curve calculation uses Paper.js core under the [bundled MIT license](public/licenses/paperjs-LICENSE.txt). The library runs in the calculation worker; saved native geometry has no live library dependency.

Paragraph text is available in Text properties: choose Paragraph text, set its width, then adjust paragraph spacing and first-line indent. Width drags keep font size and grow height automatically. Native projects preserve complete source text; SVG exports positioned editable lines with explicit font/whitespace portability warnings.

Text properties also offer Inter-word justification for soft-wrapped paragraph lines. It preserves native whole-line shaping and authored source/spacing; final/forced lines and text without expandable spaces retain their spacing. Reset paragraph restores point text and clears justification.
