# Multipage TIFF export

This trusted browser-host workflow exports an ordered selection of open Canoli Studio documents as one TIFF. Each page is a flattened native-resolution RGBA8 sRGB image with unassociated alpha, lossless Deflate tiles, an output ICC profile and 72 DPI resolution metadata. Different page dimensions remain independent. Editable layers, history, original sources, font files and source/authored metadata remain in projects/workspaces. This does not upgrade the 8-bit working pipeline or establish print, CMYK/HDR, higher-precision or universal viewer fidelity.

## User workflow

Open **Export…**, choose **TIFF**, then change **TIFF pages** from **Current document** to **Selected open documents**. Include or remove documents and use Up/Down to arrange the displayed Page 1, Page 2 order. The initial selection follows open-tab order; the current-document default is unchanged. Reordering the export does not reorder tabs, switch the active document or change artwork/history. The rows show each page's native dimensions. Empty selections and closed selected documents disable Export; closed entries stay visible until explicitly removed. New tabs are offered without silently adding them to an existing selection. Font warnings cover every selected page.

Classic/Automatic/BigTIFF applies to the complete output. Some applications show only the first page; BigTIFF needs a compatible reader. Save native projects or a workspace when editability and original sources are required.

## Trusted application API

```ts
editor.exportTiffPages(
  documents: readonly Document[],
  options: {variant?: 'auto' | 'classic' | 'big'} = {},
  control?: ExportControl,
): Promise<ExportResult>
editor.getTiffPagesCapabilityReport(
  documents: readonly Document[],
  options: {variant?: 'auto' | 'classic' | 'big'} = {},
): ExportCapabilityReport
```

`documents` is required, ordered and nonempty. Every value must be the actual handle of an open document owned by this editor; a detached document, closed handle or repeated handle rejects. Distinct open copies with the same persisted document ID are valid: handle/session ownership, rather than a document-ID lookup, determines the source. Options default to `variant:'auto'`; unsupported variants, null/array options and unknown option fields reject. The result has `mimeType:'image/tiff'`, `extension:'tif'`, `blob` and a combined capability `report`. Capability inspection does not render or change state and validates the same selection/options. Existing `editor.export({format:'tiff',tiffVariant?...},control?)` still exports only the active document.

This example runs in a trusted browser adapter, outside isolated Scripts:

```js
const first = editor.document;
first.name = 'First page';
first.resize(400, 300);
editor.newDocument({name: 'Second page', width: 640, height: 480});
const pages = [editor.document, first];
const report = editor.getTiffPagesCapabilityReport(pages, {variant: 'auto'});
const result = await editor.exportTiffPages(pages, {variant: 'auto'});
// Review report/result.report and offer result.blob as a .tif download.
```

Use the owned `editor.document` handle after creation. This API adds no isolated `editor` global, plugin permission, headless REST render endpoint or browser/REST synchronization. Scripts can construct artwork through the existing document API; file creation remains a trusted host/UI operation.

## Snapshot and lifetime contract

All page models and visible referenced raster/paint/mask/master/font dependencies are captured before the first progress callback. The engine owns copies of mutable internal DTO inputs and reuses registry-proven immutable snapshots. Later ordinary model edits cannot alter captured pages. Active-tab changes, tab reordering and unrelated document/asset/font changes do not change the selection or output.

Closing a selected owner, disposing the editor/store, removing/replacing/closing a referenced source, changing a referenced registered font or using a pending referenced font rejects the complete export. Source and font guards run across all selected pages, including pages not yet rendered, around rendering, compression, callbacks and final assembly. OS fonts outside FontFaceSet cannot be monitored as resources. Hidden/unreferenced content does not become an output dependency.

Progress uses existing `rendering` fractions from 0 to 1 over all native storage tiles, followed by `encoding` with fraction null. Cancellation, callback failures, native allocation/render/readback/compression errors and invalid selections reject without returning a partial file. In-flight native calls are non-preemptible; their returned surfaces are released before rejection. Completed compressed pages remain private until all pages and directories succeed. No artwork command, revision, selection, history or active-tab mutation is performed by export.

## Container and resource boundaries

The file uses a main-IFD chain in the selected order, with a zero terminal link. Every page has its own geometry, tile offsets/counts and ICC profile. Multipage images have NewSubfileType bit 1 set. PageNumber is zero-based with the total count when both fit the optional SHORT pair; larger chains omit that optional field rather than truncating or imposing a new page-count cap. One-page output retains the existing single-page layout.

All payloads and directories are eight-byte aligned. Automatic chooses classic TIFF only when the complete compressed payload plus every directory/metadata block fits 32-bit addressing; otherwise it uses BigTIFF. Explicit Classic rejects overflow. Each image dimension follows TIFF's unsigned 32-bit field representation, and browser file addressing follows exact JavaScript safe-integer limits. These format/runtime boundaries do not introduce a document/import megapixel or source-file cap. Real output above 4 GiB remains unverified; synthetic addressing tests avoid huge allocations.

Rendering follows the canonical native PNG grid and crops into bounded padded TIFF tiles afterward. There is no full-document RGBA export array or large document-sized export canvas. Original decoded sources remain resident. Compressed output Blob parts, tile tables, page models and directories grow with output size/page count; this is not disk-backed or constant whole-process memory. Source resolution is retained, and allocation failures remain explicit.

Normative layout references: [LibTIFF multipage main-IFD chains](https://libtiff.gitlab.io/libtiff/multi_page.html), [BigTIFF structures and addressing](https://libtiff.gitlab.io/libtiff/specification/bigtiff.html). Acceptance requires actual browser exports, independent readers, native/source/history invariants, cancellation/lifetime races and the real 50 MP case. The dated roadmap records verification; this contract does not establish completion of F11 or the full roadmap.
