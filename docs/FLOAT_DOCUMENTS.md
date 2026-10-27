# Float document editing

Schema 49 adds an explicit `float32` / `linear-srgb` working mode alongside the
default sRGB8 document. Original unsigned 16-bit and float32 TIFF samples, raster
transformations, Normal composition, groups, masks and linear tone adjustments use this
mode. Display
conversion happens at the final SDR canvas boundary. PNG, PDF and TIFF delivery
reads the float scene directly, without reading colors from the display canvas.

This is an initial connected precision workflow. It does not complete F10,
professional color/precision editing, all-tool performance or the full roadmap.

## Opening and changing precision

The custom TIFF import dialog offers 8-bit sRGB or 32-bit linear sRGB editing for
supported unsigned 16-bit and float32 RGB/grayscale pages. The default remains
8-bit, requiring explicit precision-loss consent. Float editing does not require that consent. Both choices retain
the complete original TIFF, selected page, orientation and color interpretation.
In float mode, an unprofiled file requires an explicit sRGB or linear-sRGB
assumption; an embedded supported RGB ICC profile remains authoritative.

Trusted browser host:

```ts
await editor.openTiff(file, {
  page: 0,
  editingPrecision: 'float32',
  // Required only when the original page has no ICC profile:
  floatColorSpace: 'linear-srgb',
}, {signal, onProgress});
```

`editingPrecision?: 'float32'` is optional. Omission retains the old byte import.
Page defaults to zero; `allowPrecisionLoss` defaults to false. The float choice
accepts original unsigned 16-bit or float32 samples. Other integer depths, RAW
and ordinary byte image admission do not acquire float precision through this flag.
Unsigned samples divide by 65535 in float64, invert white-zero grayscale and
unassociate alpha where declared, then round once to float32 before native ICC
conversion. Normalized float32 can distinguish all 65,536 unsigned levels.
Declared alpha association still determines unassociated colors, and associated
zero-alpha colors become zero. This is float32 working precision.
The existing `floatColorSpace` option supplies the explicit original
interpretation for either supported source type when ICC is absent; embedded ICC
remains authoritative. Default byte-mode unsigned import keeps its existing sRGB
assumption and consent. Float mode never invokes that byte decoder.
Nonfinite color, alpha outside [0,1], unsupported pages/profiles and known PQ/HLG
ICC transfer declarations reject. Finite negative and above-one RGB values are
retained with supported source profiles; no HDR transfer decoding, tone mapping
or HDR display is implied.

An existing eligible byte document can switch using Color Settings → Working
precision. Apply stages the output profile together with the precision choice;
Cancel changes neither. All original sources and the actual float-to-output
transform prepare before publication. Unsupported current layers block this
conversion. A missing high-precision original or source color identity cannot
be reconstructed from byte pixels. Legacy byte imports of unsigned TIFF lack
that precision-source identity; reopen the original with the explicit float
editing choice. Trusted host signature:

```ts
await editor.convertDocumentToFloat(
  {signal, onProgress},
  {output: {profile: 'display-p3', intent: 'relative-colorimetric',
            blackPointCompensation: false}, proof: null},
);
```

`control: FloatSourceControl = {}` accepts an optional abort signal and source
preparation progress callback. `settings?: ColorSettings` defaults to the current
output settings with proof disabled. `editor.floatConversionIssue: string | null`
provides the current eligibility reason. Already-float conversion through this
host preparation service rejects. Replacement preparation, document edit, tab
change, asset disposal, changed preferences, cancellation or preparation failure
reject without applying precision or staged preferences. Output preferences are
workspace settings outside document history; ordinary Undo restores precision.

## Object model, commands and isolation

`DocumentOptions.precision?: 'uint8' | 'float32'` defaults to `uint8`.
`new Document({precision: 'float32'})` creates an empty linear-sRGB document.
Readonly `document.precision` and `document.workingSpace` expose effective state.
`document.convertToFloat(): void` dispatches the shared strict zero-argument
`{type: 'document.precision.float'}` command. It is idempotent in an existing
float document; it does not expose decoding, files, workers or preference changes.
Source validation at host commit requires retained original high-precision TIFF raster
assets. Synchronous structural construction without an attached asset store
still requires final source admission before rendering or host publication.

For an already-open original high-precision TIFF, an ordinary isolated script can use:

<!-- example: float-exposure -->
```js
document.convertToFloat();
const original = document.layers.at(0);
if (!(original instanceof RasterLayer)) throw new Error('Select a raster original');
original.adjustments.add(new ToneAdjustment({exposure: 1}));
```

Full tone uses the same existing options and properties, with exposure −3…3
and contrast/saturation −100…100. Defaults are zero; `enabled` defaults to true.
In byte documents the existing encoded-sRGB byte operator remains unchanged.
Float documents apply the working-linear definitions above. For example:

<!-- example: float-tone -->
```js
document.convertToFloat();
const original = document.layers.at(0);
if (!(original instanceof RasterLayer)) throw new Error('Select a raster original');
document.selectedLayer = original;
original.adjustments.add(new ToneAdjustment({
  exposure: 0.7, contrast: 37, saturation: -43,
}));
```

The existing isolated execution transaction, expected revision, command limit,
locks, permission checks and Undo boundary remain authoritative. Plugins require
their existing document read/write grants; installation remains inert. No new
file, native or network grant is added. REST accepts the shared structural state
and strict command in its own independent sessions. Its PNG-only original asset
admission does not provide original float TIFF sources, render the browser scene
or synchronize with a browser document.

The semantic recipe action `{type: 'document.precision.float'}` records/replays
the same command against recipient content. Recipe execution does not import
files or change preferences; unsuitable receiving originals reject at host
commit. Existing source-bearing project/recipe transport retains original TIFF
choices independently of this zero-argument action.

## Supported scene and controls

The initial mode supports original unsigned 16-bit or float32 TIFF raster layers, Normal isolated
groups, pass-through groups, transforms, visibility, opacity, Normal fill
opacity, existing masks and full tone controls in raster effects or Tone
adjustment layers. Exposure multiplies native linear RGB by `2 ** exposure`.
Active contrast follows with `(value - 0.5) * 2 ** (contrast / 100) + 0.5`.
Active saturation uses `luminance + (value - luminance) * (1 + saturation / 100)`,
with linear-sRGB luminance weights 0.2126, 0.7152 and 0.0722. The contrast pivot
is linear 0.5, rather than a camera middle-gray control. Each tone uses float64
intermediates and rounds once to float32; it preserves alpha and finite signed/
extended RGB without gamut clipping. Neutral stages skip subtract/add arithmetic
to preserve identity and exposure-only precision. Nonfinite input, invalid alpha
or unrepresentable float32 output rejects without publishing a partial result.
Raster tone stacks run in collection order before projection. Adjustment exposure
changes the accumulated backdrop; pass-through group opacity interpolates
premultiplied before/after backdrops rather than source-over compositing a second
copy. Masks use the existing byte coverage rasterizer; color stays float32.

Other layer types, artistic blends, styles, raster erasures,
frequency separation and other adjustment types reject
atomically. Pass-through groups require fill opacity 1. The tool rail, shortcuts,
palette and context controls disable unsupported creation/color tools. Move,
Hand, selections, Crop, Artboard and mask drawing retain their existing commands;
mask brush/pencil/eraser and mask Pen require their corresponding mask target.
Device soft proofing is unavailable. Selecting float mode disables it; isolated
precision conversion clears existing proof state with a visible notice. Saved
float workspaces with proof enabled reject before publication.

## Sibling clipping in float documents

The existing `Layer.clipped` boolean now works in float scenes through the same
OO commands, Inspector checkbox, palette and history. Consecutive clipped
siblings share the preceding unclipped pixel-bearing base. Orphans and members
after an adjustment-only base are transparent. Membership never crosses groups;
release/reorder/deletion recomputes the current sibling relationship.

The renderer builds an owned float32 color plane, paints members there, and
restores the base's pre-fill intrinsic alpha once. Repeating soft coverage per
member would darken edges. Base fill changes its own color coverage; zero fill
can still show independently visible members within the original boundary. Base
mask and opacity apply to the completed stack. A pass-through base supplies
isolated child coverage; pass-through members see the stack's color plane.
Normal groups, raster transforms, full tone effects, clipped tone adjustment
layers, member masks/opacity/fill and nested sibling stacks keep their existing
float semantics. Pass-through fill still requires 1. Unsupported styles, blends
and layer types remain gated; this does not add Photoshop advanced clipping
switches or float SVG/PSD/PSB interchange.

No bitmap/display pixel supplies clipping colors. Working arrays remain bounded
to the existing per-window budget, with checks/yields and owned results. Source
bytes, geometry and outside-base artwork remain editable in native projects,
workspaces/history, copies and portable recipes. REST supports the structural
commands in independent sessions; it still supplies no float raster admission
or browser renderer/synchronization. Existing plugin document read/write grants
suffice; installation is inert.

For an original-bearing float document:

<!-- example: float-clipping -->
```js
const base = document.layers.at(0);
if (!(base instanceof RasterLayer)) throw new Error('Open a float TIFF raster');
base.name = 'Float clipping base';
base.fillOpacity = 0.375;
base.opacity = 0.75;
base.mask = new LayerMask({linked: false, selection: new MarqueeSelection({
  shape: 'rectangle', x: 15, y: 10, width: 90, height: 55,
})});
const member = new RasterLayer({
  name: 'Clipped float tone', assetId: base.assetId,
  width: base.width, height: base.height, opacity: 0.5, clipped: true,
});
member.adjustments.add(new ToneAdjustment({
  exposure: 1, contrast: 25, saturation: -40,
}));
document.layers.add(member);
document.selectedLayer = member;
```

## Ownership, rendering and persistence

Float assets retain native width/height and exact original Blob bytes. Their
bitmap and thumbnail are bounded 96-pixel display images, explicitly unsuitable
for native color processing. Shared source-role validation rejects use of these
display-only pixels as byte raster artwork, masks, brush textures or other byte
roles. Ordinary native-sized byte assets remain unchanged.

The source service prepares lossless float32 tiles in IndexedDB. Captured scenes
pin original leases and mask sources before callbacks, validate source identity
across awaits and reject stale/disposed owners. All source preparation precedes
display/output ICC acquisition, preventing cold-source work from deadlocking
behind the shared two-owner ICC queue. Each captured scene owns a cancellation
signal and a final identity check. Renderer disposal/cache clearing aborts queued
source and output ICC work without waiting for unrelated owners to close. PNG
checks original ownership again after its last pixel read and final compression.
The renderer retains at most 64 original
source leases, with no full decoded color plane or bitmap ownership in that LRU.

Projection uses float64 geometry and premultiplied bilinear filtering with
analytic transformed-rectangle coverage, rounding output to float32. Output
windows and adaptive source ROIs are bounded to 262,144 pixels; this is a working
allocation budget, not an original image or document resolution cap. Heavy
minification can read many source windows. No sustained 60fps or whole-process
peak-memory claim is made. The current viewport uses the standard float path;
WebGPU does not silently run the byte compositor for these documents.

The model stores `schemaVersion: 49`, `colorSpace: 'linear-srgb'`,
`precision: 'float32'`. Legacy byte documents omit precision or use `uint8` with
`srgb`; contradictory pairs and precision in older schemas reject. Native
projects, retained history, workspace/recovery and existing original-bearing
transport retain the working state plus `tiff.editingPrecision`. Tile caches are
derived, separate from authoritative original files. Older strict readers reject
the new model/choice rather than reinterpret a thumbnail as original pixels.
Admission validates source roles across the current document, both Undo/Redo
directions, branch forks/tips and saved comparisons before returning a project.
A malformed byte state that references a float thumbnail rejects the complete
load and disposes its privately prepared sources; Undo cannot admit that state.

## Delivery

```ts
await editor.export({format: 'tiff', tiffPrecision: 'float32'});
await editor.export({format: 'tiff', tiffPrecision: 'uint16',
                     color: {profile: 'display-p3'}});
await editor.exportTiffPages(editor.openDocuments,
                            {precision: 'float32', variant: 'auto'});
```

`ExportOptions.tiffPrecision?: 'uint8' | 'uint16' | 'float32'` and multipage
`TiffPagesExportOptions.precision` default to `uint8`. All high-precision pages
must be float documents. Mixed byte/float pages are allowed for uint8 output.
`tiffPrecision` on another format rejects. Classic/BigTIFF choice remains
`auto | classic | big` with `auto` default. Each float page converts directly
from linear float32 to the selected complete RGB ICC profile and file sample
type, with correct integer/float tags and straight alpha. Omitted color defaults
to linear-sRGB for high-precision TIFF and sRGB for byte output. Explicit output
settings override the default. Float output retains finite extended values only
where the selected profile/transform supports them.

PNG/PDF convert directly to target RGB8 and embed the exact target profile.
JPEG/WebP/AVIF retain their existing sRGB SDR delivery. Byte/integer formats
quantize and clip unrepresentable colors without tone mapping; capability reports
disclose this. SVG/PSD/PSB float interchange rejects before producing a file.
Native projects remain the editable interchange path.

Batch variants accept optional `tiffPrecision` only for TIFF. Prepared float
project checkpoints preserve working mode through fitted delivery. Fitting
samples the composed native artboard, excluding outside layers and applying
fractional boundaries once. Explicit profile receipts use version 2 with
`sourceSpace: 'linear-srgb-float32'` and the actual output sample format; byte
receipts retain version 1. Settings, checkpoint precision and profile receipt
must match before accepted-file reuse. Portable delivery presets and manifests
retain the new precision and integrity fields. Direct batch image inputs retain
their existing admission contract; this does not add direct float TIFF batch
source selection.

## Verification and remaining scope

The dated implementation roadmap records actual completed checks and failed
pilots. `scripts/check-float-document.py` reads every delivered channel with
independent native libtiff/Pillow/MuPDF and compares it against independent native
CMM source references, exact power-of-two exposure and native output conversion.
Float identity/exposure and integer checks require exact words, with no widened
rounding tolerance. Pure projection tests separately cover affine partitioning,
hidden RGB/alpha, sparse large geometry and cancellation.

Required later work includes broader source/working profiles and conversion,
other integer depths and non-TIFF high-precision admission, all remaining tools/layer types,
blends/styles, float coverage, device proofing, HDR transfer/display/tone
mapping, CMYK delivery, interchange, wider photographic/device validation and
sustained all-tool performance. This initial mode is not full F10 acceptance.
