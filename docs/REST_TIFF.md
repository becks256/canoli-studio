# Verified high-precision TIFF sources in the local REST API

## Native worker startup

TIFF inspection/preparation and its long-lived window reader load TypeScript
inside their own trusted Node worker. No inherited parent loader flags are
required. This removes the Node 26 scoped-loader builtin-path failure while
retaining the existing source receipts, tile verification/cache repair, native
precision, cancellation, teardown and original ownership. The shared API parent
and isolated scripting host receive no additional module-loading capability.
[Implementation boundary](ARCHITECTURE.md#native-node-worker-startup).


The local Node API can inspect and admit original unsigned 16-bit and float32
RGB/grayscale TIFF pages into independent headless documents. Native row decoding
and the pinned Little CMS WASM engine produce linear-sRGB float32 source tiles.
Original file bytes remain authoritative. This source service does not render a
headless layer composition or synchronize a browser document.

## Requests

All routes retain the existing loopback/origin restrictions and configured bearer
or API-key authentication. TIFF inspection/import and float-window reads require
the current `expectedRevision`. Stale revisions return 409; deleted documents return 404;
invalid choices/data return 400. Complete binary TIFF bytes use `image/tiff` or
`application/octet-stream`, with `X-Tiff-Options` containing strict JSON.

- `POST /api/v1/documents/:id/tiff-inspect?expectedRevision=N`: read-only header/directory
  inspection, returns `{...snapshot, report}` with status 200. No asset/history
  mutation, conversion consent or color assumption is needed for inspection.
  This report does not certify complete pixel data or ICC conversion; import
  performs those checks before admission.
- `POST /api/v1/documents/:id/tiff-import?expectedRevision=N&name=Original.tif`:
  requires `editingPrecision: 'float32'`, returns status 201 with the snapshot,
  `layerId`, `assetId`, original report and source identity. It places the native
  raster and, if needed, converts an eligible document to float in one shared
  transaction. Canvas dimensions stay authored. TIFF orientation becomes an
  explicit layer transform; encoded raster/source dimensions remain unchanged.
- `GET /api/v1/documents/:id/assets/:assetId/float-window?expectedRevision=N&x=0&y=0&width=W&height=H`:
  returns owned straight RGBA float32 little-endian bytes in linear sRGB. These
  are original-derived source pixels in encoded TIFF coordinates, before layer
  placement, masks, adjustments or blending. They retain signed/HDR values and
  hidden RGB. Outside-source samples are transparent zero.
- Verified TIFF asset metadata includes native decode choices, source SHA-256,
  orientation, working encoding and the actual thumbnail conversion receipt.
  `?original=true` and `?raw=true` return complete original TIFF bytes.
  `?preview=true` returns a real bounded sRGB8 PNG with
  `X-Canoli-Preview-Only: true`; it is never a precision source.
- Existing `GET /api/v1/documents/:id/project?history=true` includes verified
  original TIFFs, their decode choices and retained history. Browser reopening
  reconstructs genuine native float sources and a real display thumbnail.

TIFF choices use the existing `TiffDecodeOptions` contract: `page` defaults to 0;
`allowPrecisionLoss` defaults to false and is unnecessary for float admission;
`floatColorSpace?: 'srgb' | 'linear-srgb'` is required when ICC is absent.
Embedded RGB ICC remains authoritative. Unsupported sample layouts, profiles,
codecs, nonfinite colors and invalid alpha reject before publication. No byte
proxy is substituted. Names are nonempty and at most 240 characters.

The binary window response declares `X-Canoli-Pixel-Format: rgba-float32-le`,
`X-Canoli-Color-Space: linear-srgb`, `X-Canoli-Document-Revision`,
`X-Canoli-Source-Sha256` and `X-Canoli-Source-Orientation`. Coordinates and sizes
are safe integers; sizes are positive. Each window contains at most 262,144
pixels. This is a request/working-buffer budget, not an image import limit.
Read successive windows to cover an original of any supported native extent.
General command/JSON request budgets and file-format/addressing constraints
remain unchanged; no megapixel or arbitrary original-file-size cutoff is added.

## Authority, workers and lifetime

Import uses the existing public RasterLayer constructor and shared precision/
layer commands. Expected revisions, current document ownership, locks, strict
validation, rollback and history remain authoritative. Precision and import are
one Undo; rejected/stale/cancelled preparation publishes no asset or history.
Already accepted TIFFs are encoded headless assets with an explicitly unavailable
browser bitmap. No bitmap object or native pixel surface is fabricated.

The server privately serializes native preparation and uses a real separate
reader worker with a bounded decoded cache. Every preparation batch is decoded,
checked for complete geometry, finite samples/alpha and compressed/raw hashes
before persistence and acknowledgement. Final publication requires complete
original/ICC/native identities and manifests plus a verified real PNG thumbnail.
Reads recheck disk bytes even when decoded pixels are cached. A corrupt read
fails; the next read rebuilds verified derivatives from the retained original.
Neither repair nor reading changes document history or original bytes.

Requests cancel on disconnect, document deletion or concurrent edits. Closing the
service terminates owned workers and removes its private derivatives. The trusted
`createApiServer({precisionCacheDirectory})` option chooses a parent for owned
private temporary folders, defaulting to the OS temporary directory. No request
can choose a path. Caches are disposable and are not a backup or a restartable
REST session store; portable project files preserve acknowledged originals.

## Existing surfaces and limits

Ordinary PNG and RAW routes retain their current contracts. Byte-only headless
selection/matting tools still require supported PNG input. Shared float commands
can edit admitted TIFF documents, while pixel-domain composition errors belong
to actual scene rendering and delivery in the browser. REST source windows are
not a new scene renderer, soft-proof service, arbitrary profile chooser or bridge
to a browser tab. Plugins gain no file, worker, network or raw-pixel grant;
installation remains inert and isolated document edits retain existing grants.

## Verification

Real Node native/HTTP tests check the independent source corpus, complete original
identity, shared Undo/Redo, malformed input, stale revisions, cancellation,
disconnects, deletion/disposal and original-backed cache repair. Browser tests
cover all eight orientations and native project reopening. A genuine 50 MP
REST original matches all 200 million raw source samples; actual browser export
after a shared exposure edit independently matches all 200 million composed
samples with exact ICC and original bytes. Source reads and composed browser
output are separate checks. The dated repository implementation roadmap records terminal matrix counts,
retained failures, evidence and remaining gates.
These checks do not establish full format, device or editor-wide performance
acceptance.
