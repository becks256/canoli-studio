# Prepared HDR wet assets and fields

Status: private F03/F10 dependency. This is not a public scripting service,
document edit format or enabled float Smudge/Mixer workflow. Public commands,
schema, authoring, history/project integration and tools remain required.

## Lossless asset pair

`core/float-wet-tile.ts` encodes owned straight Float32 RGBA samples as lossless
Deflate TIFF. This prepared format requires one native-orientation, chunky,
unassociated RGBA32 page with the complete pinned linear-sRGB ICC. Finite
signed/HDR RGB is valid; alpha is in [0,1]. No color conversion or byte staging
occurs. Hidden RGB and signed-zero sample words remain in the file. Other
original TIFF profiles/layouts retain their existing import workflow; these
restrictions apply only to prepared wet files.

Private functions are `encodeFloatWetTile(pixels,width,height,control?)`,
`validateFloatWetTile(blob,width,height,control?)`,
`validateFloatWetTilePair(pixels,coverage,width,height,control?)`,
`floatWetTileRows(blob,width,height,control?)` and
`readFloatWetTileWindow(blob,width,height,region,control?)`. Controls capture
AbortSignal/source checks before work; encoding owns samples before its first
await. Complete original sample validation precedes a reusable proof. Failed or
cancelled work establishes no proof. Reads return owned Float32 with transparent
zero outside the stored rectangle. Internal inspection objects stay private.

Encoding/read windows have a 262,144-pixel working budget. Full file validation
reads native rows; extreme row widths still depend on available memory. No new
file-size or original-image megapixel limit is introduced.

Pair validation is shared by direct field capture and host asset capture. A
completed proof belongs to both immutable TIFF Blobs. Every use still checks
native dimensions and caller cancellation/lifetime; failed or cancelled pair
comparison establishes no pair proof. Replacement alpha must not exceed removal
alpha anywhere in either complete original, including offscreen pixels.

## Shared host asset capture

Private `core/hdr-wet-assets.ts` exposes
`captureHdrWetAssets(tiles,provider,control?)`. Input is an ordered, nonempty
array of strict `{x,y,width,height,assetId,coverage:{assetId}}` references.
Native geometry must have safely representable integer pixel centers; there is
no original resolution, file-size or tile-count tier. Controls are the same
optional `{signal,check}` used by the codec. All metadata and original source
identities are captured before the first await. Every complete pair validates
before the frozen owner exposes its `tiles`, `check()` and `dispose()`.

The internal `WetAssetProvider.get(id,"float32")` supplies immutable original
TIFF bytes and native dimensions. Browser providers validate the expected
display-thumbnail dimensions but never read thumbnail color or alpha for HDR.
Headless encoded TIFF records need no fabricated ImageBitmap or PNG decoder.
The omitted precision argument preserves native byte geometry and PNG alpha
validation for existing public wet strokes. Float preparation never calls the
provider's byte `alpha()` stream.

`engine/hdr-wet-field.ts` connects these hosts through private
`captureHdrWetAssetField(tiles,provider,control?)`. Its field retains all source
identity, dimensions, Blob and display-surface identity checks during reads,
including a disjoint read and completed-proof reuse. Missing or changed sources,
store disposal, cancellation and reentrant retirement reject before publishing
samples. Disposal releases owned pins and the provider/check callback; arrays
already returned remain independently owned. This is a dependency for public
host commits, not a new scripting grant, REST route or accepted document DTO.

## Coupled field and ownership

Private `captureHdrWetField(tiles,control?)` takes ordered
`{region,pixels:Blob,coverage:Blob}` pairs. Both files use the format above;
coverage uses alpha and ignores RGB. Complete samples are checked, including
outside the requested viewport, and replacement alpha cannot exceed coverage.
The owner copies metadata, retains immutable originals and exposes frozen finite
bounds, bounded `readWindow`, `check` and `dispose`. Disposal retires reads and
releases captured references; returned arrays remain owned by their caller.

Derived fields use Float64 `[premultiplied R,G,B,alpha,removal]`. RGB is finite
and unclipped; alpha/removal are normalized, alpha cannot exceed removal, and
zero alpha requires numerically zero RGB. Signed zeros are valid. For new
straight color S, alpha a and removal c, recorded overlaps use
`P'=P*(1-c)+S*a`, `A'=A*(1-c)+a`, `C'=C*(1-c)+c`. Coverage never multiplies
the already-covered pigment again. Zero removal is inert. First/full replacement
avoids adding synthetic zero so signed-zero pigment remains exact.

## Projection and composition

`projectMappedHdrWetFieldWindow` and `projectPerspectiveHdrWetFieldWindow` share
the scalar/byte field stream's conservative ROI, complete neighbors, relative
origins, horizon subdivision and disjoint culling. Private worker methods
`floatMappedHdrWet` and `floatProjectiveHdrWet` retain Float64 fields. There is no
image-quad clip or RGB gamut clamp. Missing finite-support samples reject.

Exact parallelograms compile as affine matrices in the new HDR path, avoiding
tiny weights from an identity homography solve. Both directions, affine input
and separate origins retain their meanings. General perspective keeps the
existing homography. Accepted scalar and encoded-byte arithmetic is unchanged.
Identity sampling preserves valid field words, including signed zero. Nonzero
pigment is cleared if interpolated alpha underflows to zero.

For straight destination D, alpha d, field (P,A,C) and operation opacity o,
native `floatCompositeHdrWet` computes `keep=1-o*C`, `alpha=d*keep+A*o`,
`RGB=(D*d*keep+P*o)/alpha`, then stores Float32 once. Zero opacity/removal copies
all destination words. Full removal skips a synthetic zero contribution, so
positive-alpha completed Float32 colors survive premultiply/divide without
Float32 field rounding. Alpha rounding to zero stores zero RGB.

Invalid controls, nonfinite samples and unrepresentable output reject without
publishing partial work; later work and unrelated owners remain usable. Worker
inputs and nested mappings are captured before readiness; only private copies
transfer. Replies require exact Float32/Float64 type, complete fixed owned
buffers, lengths, finite samples and valid alpha/removal. Shared, detached,
resizable and malformed/subarray replies reject. Source/output packets are at
most 262,144 pixels; final native composition uses 65,536-pixel scratch windows.
Float64 is temporary processing data, not a new document precision mode.

## Evidence and remaining work

Independent NumPy references check native/worker output words, large origins,
projective horizons, partitions and signed/HDR values. A Float32-premultiplied
control changes 2,818 reference words; the Float64 path preserves completed
positive-alpha replacements. Native libtiff reads actual saved TIFFs and their
complete ICC; NumPy replays them and checks exact reopened output. Genuine
50 MP source acceptance uses a disclosed 64x48 native window, not every-pixel
full-image wet editing or delivery. Dated findings record complete runs.

Versioned public HDR wet strokes/assets, connecting guarded validation to shared commands,
FloatScene replay in operation order, projection/resize semantics, original-bearing
history/project/workspace/recipe transport, independent REST/isolated surfaces
as scoped, and authoring previews/commit plus tools remain required. Current
document schema and byte wet constructors remain unchanged. Plugin installation
stays inert and grants no new source pixels, files, network or document authority.
