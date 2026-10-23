# Canoli Studio

An early browser image-editor foundation with a constructor-based document model, AssemblyScript/WASM adjustments, local JavaScript scripting, installable command plugins, and an optional REST document service. The product is named Canoli Studio (formerly Luma).

Optional website accounts use `npm run start:site` after the normal build (Node.js 24+). The self-contained site host serves `dist` and an explicitly configured Sign in with ChatGPT identity flow; local editing remains available without sign-in. Account controls include metadata-only download and explicit deletion with current-identity verification, preserving local artwork and undo. See [configuration, privacy and the still-pending live OpenAI acceptance](docs/SIGN_IN_WITH_CHATGPT.md). The existing loopback REST service remains independent.

## Run locally

Use Node.js 24 (tested).

```sh
npm install
npm run dev
```

Open http://127.0.0.1:5173. Import a PNG/JPEG/WebP or review a TIFF/BigTIFF page or AVIF primary image, inspect an SVG for editable geometry/gradient fills/strokes or explicitly flattened import, or open the sample composition. Combine closed vector areas with Union/Subtract/Intersect/Exclude from Properties or the command palette, retaining editable holes/curves and one undo step. Save editable work as `.luma`; export PNG/JPEG/WebP/AVIF, flattened lossless RGBA8 sRGB TIFF (Automatic/classic/BigTIFF), a native-resolution raster PDF with physical DPI sizing, SVG or the supported rendered PSD/PSB subset (PSB supports dimensions beyond PSD’s 30,000-pixel axis limit). Photoshop inspection/import runs in cancellable private workers, including 8-bit RGB/Gray Raw/RLE/ZIP and ZIP prediction with supported raster masks retained as separate pixel sources; preflight exposes the current color, mask and hierarchy limits before import. SVG keeps vector paths, editable paint dabs/fills and text (with measured whitespace correction and explicit font/glyph portability limits), embedded raster imagery and supported smart-object contents, with native adjustment/Blend If backdrop prefixes and baked editability disclosed in the export report. The browser editor runs locally without an account, paid service or image upload. Committed edits are checkpointed locally for recovery; use the rail’s Recover work action to reopen them. Download project files as backups.

For the separate local REST service, run `npm run dev:api` in another terminal. Default: http://127.0.0.1:8787/api/v1/health.

The **Artwork library** saves selected editable layers and original sources locally, with names/tags/search, verified portable packs and one-step placement/undo. See [the library workflow, source retention and privacy](docs/ARTWORK_LIBRARY.md).

## What works

- Local metadata extraction in a worker, an Asset info inspector, and JSON sidecars with explicit privacy choices.

- Image layers/groups; move, scale, opacity, 18 blend modes, visibility, locking, duplication and ordering.
- Manual frequency separation into editable native low/high retouch layers, retaining the original image; command search and raster context menu. Live native previews, original comparison, native panning and one shared band radius are functionally verified; exact native render shortcuts avoid decomposing untouched regions. Portrait-quality and broader performance acceptance remain open.
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

This is not yet an AI-integrated or commercial product. Real model calls, full Photoshop-native editability, RAW development, account/billing infrastructure and collaboration remain incomplete. Supported masks, Photoshop interchange and retained workspace history are documented separately. The current raster pipeline is 8-bit encoded sRGB. New project files store original blobs directly; source decoding and manifest allocation still need further work for very large production documents.

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

TIFF browser/production checks require Python 3 with Pillow (built with libtiff and ImageCms) and NumPy. They decode actual downloaded classic/BigTIFF files through `scripts/check-tiff-interoperability.py` and compare every RGBA pixel with native PNG. Input tests use independently generated libtiff/Pillow fixtures, including one 50 MP single-strip BigTIFF. They fail explicitly if that independent reader is unavailable; they do not substitute the editor's own decoder.

Import supported TIFF/BigTIFF through the image picker or drop target. Review the selected page and conversion report first; 16-bit input requires explicit consent to 8-bit editing. Original TIFF bytes and page/precision settings remain in native projects, recovery, workspace and portable recipes. Orientation stays a non-destructive transform. Unsupported codecs/color/sample layouts reject explicitly; higher-bit-depth editing and broad color/device fidelity remain unfinished. See [the TIFF host contract](docs/SCRIPTING_API.md#tiff-import-trusted-application-code).

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

PDF browser/production checks also require independent PyMuPDF (tested with 1.28.2), Pillow and NumPy. For a test-only environment, run `python3 -m venv --system-site-packages /tmp/canoli-pdf-check`, then `/tmp/canoli-pdf-check/bin/python -m pip install PyMuPDF==1.28.2 Pillow NumPy`. Set `CANOLI_PDF_PYTHON=/tmp/canoli-pdf-check/bin/python` when running Playwright. The checker parses actual downloaded PDF objects, compares every stored native RGB/alpha sample and independently renders the page through MuPDF. PyMuPDF is a verification tool, not an application dependency. PDF output is one raster page; searchable text, editable PDF content, PDF import and PDF/X/CMYK/prepress remain unimplemented.


Supported Photoshop group import reconstructs native editable hierarchy, ordinary/pass-through modes, opacity/visibility, conservative locks and user pixel group masks. Native schema 28 preserves this state and independent image/mask sources. PSD/PSB export now retains supported folder hierarchy, child records, modes, locks and separate document-bounded user pixel-mask coverage. Group fill folds into group opacity; non-Normal pixel fill and unsupported effects/dependencies bake with explicit preflight losses. SVG still prepares native backdrop prefixes. Pass-through currently uses Canvas/WASM fallback. Full Photoshop effects/clipping/type/vector/feather/color/precision fidelity, original mask controls/off-canvas coverage, native desktop certification and general 60fps/device acceptance remain unfinished. See [the scripting contract](docs/SCRIPTING_API.md#native-photoshop-folder-and-user-mask-export).

Brush, pencil, eraser, clone and tonal brush records support authored pressure curves under document schema 29. The Pressure response dialog edits normalized knots/presets for future strokes; explicit curves include true zero, while absent curves preserve prior minima. Curves share constructor/REST validation, undo, project/workspace persistence and native/SVG/supported-GPU replay. Physical tablet validation and richer brush engines and full F06/F14 gates remain unfinished. See [the pressure contract](docs/SCRIPTING_API.md#brush-pressure-response-schema-29).


Brush tools now offer **Brush presets…**: named local presets, four built-in starters, search, optional foreground capture, editable copies and portable JSON packs. Storage uses atomic browser transactions with stale-update protection, explicit recovery backup/reset and no document-history changes. Applied strokes/projects keep complete settings and do not require the library. See [brush preset contracts](docs/BRUSH_PRESETS.md); broader artist-engine and device/performance gates remain open.

Authored brush-tip angle/roundness and spherical pen tilt use schema 30 with shared native/SVG/supported-WGSL geometry. Brush tip controls, immutable BrushTip values and v2 portable presets retain new stroke settings. See [the precise tip contract](docs/SCRIPTING_API.md#brush-tip-shape-and-pen-tilt-schema-30). Broader brush-engine and device-performance gates remain open.

Brush symmetry adds vertical/horizontal mirrors, both axes and radial 2–32 sectors, with exact document-space centers, guides and viewport-sized ghost cursors. Immutable BrushSymmetry values retain complete affine copies in schema-31 strokes, with shared native/SVG/supported-GPU replay, commands/history and portable preset v3. Legacy presets remain readable and reset symmetry to Off. See [the symmetry contract](docs/SCRIPTING_API.md#brush-symmetry-replay-schema-31). Richer brush engines and physical-device/performance gates remain open.

AVIF export and custom batch delivery use the locally bundled single-thread [jSquash AVIF encoder](https://github.com/jamsinclair/jSquash/tree/main/packages/avif), with quality/lossless/compression controls, always-lossless alpha and an explicit sRGB identifier. Output is a flattened RGBA8 still image; full-frame codec memory and compatible viewer support remain real limits. See [the host contract](docs/SCRIPTING_API.md#avif-export-trusted-application-code). Bundled notices cover [jSquash](public/licenses/jsquash-avif-LICENSE.txt), [libavif](public/licenses/libavif-1.0.1-LICENSE.txt), [AOM](public/licenses/aom-3.7.0-LICENSE.txt), [AOM patents](public/licenses/aom-3.7.0-PATENTS.txt) and [libsharpyuv](public/licenses/libsharpyuv-COPYING.txt).

AVIF browser/production checks require a test-only Pillow build with native AVIF support. Tested independently with Pillow 12.0.0 and libavif 1.3.0: create a separate environment using `python3 -m venv /tmp/canoli-avif-check`, install `Pillow==12.0.0`, and set `CANOLI_AVIF_PYTHON=/tmp/canoli-avif-check/bin/python`. The checker `scripts/check-avif-interoperability.py` compares every native RGBA sample (or alpha in explicit lossy mode) with PNG/raw references and verifies the sRGB identifier. The independent reader is not an application dependency.

Workspace layout in the tool rail and command search docks/hides/reorders Layers and Properties and saves named local arrangements. Save/update applies; Cancel discards the draft. Restore defaults is always reachable from the rail/command search, even with both panels hidden. Layout preferences stay separate from artwork and project history; failed storage and detected newer-tab changes require retry/reload. Floating/tabbed docks, layout file exchange and atomic cross-tab preference synchronization remain unfinished. See [workspace layout preferences](docs/SCRIPTING_API.md#workspace-layout-preferences).

Recent files beside Open retains disclosed local copies of successful file-backed imports/opens and requested project downloads, with integrity-checked reopening, removal/clear controls and a twenty-entry retention policy. Command search also lists open document sessions and recent copies by name. These are local copies rather than live disk links; keep downloaded projects as backups. Images reopen in independent native-resolution documents, while SVG/TIFF/Photoshop retain their existing conversion preflight. See [the trusted-host contract](docs/SCRIPTING_API.md#recent-files-trusted-browser-host).


AVIF input supports local primary-image review and native document opening: trusted embedding code can call [`editor.inspectAvif`](docs/SCRIPTING_API.md#avif-input-preflight-trusted-application-code) for read-only primary-image preflight and `editor.openAvif(file, options, control)` for guarded import. High-bit precision loss and unidentified-color fallback require explicit consent. Original bytes and choices persist in native projects/workspaces, recovery, recipes, brush sources and cross-document copies. The local decoder has separate independent input fixtures; `scripts/generate-avif-import-fixtures.py` uses Pillow 12/libavif 1.3 and ffmpeg, and `--large` regenerates the native 50 MP case. `scripts/avif-reference.py` selects explicit native built-in bilinear RGBA conversion and retains the default Pillow viewer path separately. These are test-generation tools, not runtime dependencies. Full-frame decode/browser memory remains a real limitation; HDR, animation and unsupported transformations reject.

The AVIF input foundation uses an [owned checked decoder build](scripts/avif-decoder/README.md) with pinned libavif 1.3.0/AOM 3.12.1 and an explicit native-error/geometry boundary. Generated code/WASM and provenance are checked in; normal app builds need no compiler or downloads. Notices include [libavif and its bundled helper notices](public/licenses/libavif-1.3.0-LICENSE.txt), [AOM](public/licenses/aom-3.12.1-LICENSE.txt), [AOM patents](public/licenses/aom-3.12.1-PATENTS.txt), [Emscripten](public/licenses/emscripten-4.0.10-LICENSE.txt) and [musl](public/licenses/emscripten-musl-COPYRIGHT.txt). Input and export have distinct codecs and queues; neither implies HDR/high-precision editing or complete format coverage.
