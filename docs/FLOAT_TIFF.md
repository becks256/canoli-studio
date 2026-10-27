# Float TIFF input and retained precision

The initial connected schema-49 float document workflow is now specified in [FLOAT_DOCUMENTS.md](FLOAT_DOCUMENTS.md). The dependency/legacy byte-mode sections below retain their individual boundaries; they do not describe the new mode as byte editing. Broader F10 and full-roadmap acceptance remain required.

Canoli can inspect and open normalized SDR float32 TIFF/BigTIFF pages, retaining
all original bytes and explicit decode choices. In the default byte mode,
import requires precision-loss consent and converts original float samples
through the actual source ICC profile before quantizing the editing proxy.
Explicit float document admission is described above. HDR tone mapping,
half/double TIFF input and physical color calibration remain required.

## Input and color contract

`editor.inspectTiff(file, control = {})` reports supported float pages with
`bits: 32`, `sampleFormat: 3`, `requiresPrecisionLoss: true`, and
`requiresColorAssumption` when ICC is absent. Ordinary unsigned reports keep
existing fields/semantics; the new fields are optional in report version 1.
Header inspection does not prove all compressed sample data is valid.

`editor.openTiff(file, options = {}, control = {})` uses the existing guarded
whole-document import. `TiffDecodeOptions` adds optional
`floatColorSpace: 'srgb' | 'linear-srgb'` alongside `page` (default 0) and
`allowPrecisionLoss` (default false). These choices are independent:

- Every float import requires explicit 8-bit editing consent. No precision-loss
  acceptance is inferred from selecting a color interpretation.
- A supported embedded RGB ICC profile is authoritative. It is compiled in
  native Little CMS as float32 source to sRGB8, with relative-colorimetric intent
  and no BPC. An unrelated assumption cannot override tagged source color.
- Without ICC, choose encoded sRGB or linear sRGB explicitly. This is a user
  interpretation, not verified calibration. There is no silent default for
  unprofiled float TIFF. Interpretation is stored with the complete original.
- RGB after de-association must be finite and within normalized [0,1]; alpha
  must be finite and within [0,1]. NaN, infinity, invalid alpha, RGB requiring
  HDR tone mapping and known PQ/HLG ICC CICP transfer declarations reject even
  with precision consent. There is no fake tone map or silent HDR clipping.
  The internal float source reader preserves finite extended samples; this
  rejection belongs to the current editing-proxy boundary.

RGB/RGBA and unprofiled BlackIsZero/WhiteIsZero grayscale/gray-alpha are supported
in 32-bit IEEE float sample layout. Gray ICC, unsupported classes/color spaces,
other sample types, mixed depths/formats and unsupported codecs remain explicit
limitations. Source little/big endian, chunky/separate planes, strips/tiles,
ordinary/unassociated/associated alpha, raw/LZW/Deflate/PackBits and supported
horizontal/floating prediction retain native geometry. Orientation stays a
non-destructive layer transform as with existing TIFF input.

The proxy is a real straight-alpha RGBA8 PNG with sRGB identification, not an
8-bit PNG carrying the original non-sRGB tag. The decoder reports a checked
version-1 color record: actual engine/release identity, source ICC hash or
explicit assumed space/hash, sRGB8 output, intent fallback and warnings.
`ImageAsset.tiffColor` is derived/read-only diagnostic data. It is reconstructed
from original bytes and choices rather than persisted as another source of
truth. It does not change document constructors, commands, schemas or Undo.

## Ownership, persistence and failure

Original float TIFF data and ICC remain in the asset Blob. Native projects,
workspaces/history, recovery, clipboard/shared assets and portable recipes use
the existing complete-original transport and TIFF decode-settings schema.
The new color interpretation participates in source identity/recovery hashes;
changing it cannot certify an older proxy as a different interpretation.
Legacy unsigned sources retain their prior decode choices and output route.

Float decoding shares the existing two-owner ICC semaphore with proof, output
and native RAW TIFF. Queued imports retain immutable encoded bytes and metadata;
no decoding worker/native CMM/pixel buffers exist while waiting for that lease.
Metadata inspection stays independent. Abort, callback failure, document edits,
source/session replacement, supersession and editor disposal cannot publish a
stale or partial document. Failure terminates private work/releases its lease;
original data and existing edited tabs remain available for retry.

The private float row reader reconstructs source samples, alpha and prediction
before any color conversion. Only decoded source rows, current native CMM
windows and bounded PNG batches are retained. Compressed source blocks stream;
extra/short decompressed data rejects. Extremely wide scanlines, browser bitmap
allocation and native CMM/pointer limits remain real resource boundaries. No
arbitrary original file-size/megapixel cap or downsampling is introduced.

This is trusted file I/O. Isolated Scripts/plugins receive no file chooser,
profile store/native worker access or new privilege; installation stays inert.
Independent REST sessions do not gain TIFF rendering or browser synchronization.

## Verification and references

Fixtures are written and read back through independent system libtiff 4.3.0.
A separate native Linux Little CMS 2.19.1 produces exact expected RGBA8 samples.
The source matrix covers byte order, layout, compression, prediction, alpha,
grayscale and tagged/explicitly interpreted color. Native libtiff 4.3.0's
cross-endian floating predictor writer swabs its input; the generator compensates
that writer input and verifies readback, while preserving the original diagnostic
separately. No decoder workaround or widened tolerance hides it.

The genuine 10000 × 5000 source is independently developed RGB16, converted to
P3 float32 and written as predictor-3 BigTIFF by native libraries. Its separate
sRGB8 reference streams through the native CMM without a Canoli decoder. Browser
checks must inspect every final sample, full original hashes, choices and actual
project reopening. See the dated roadmap for final observed gates and evidence.
Synthetic samples are not physical photographic quality, arbitrary profile/codec
compatibility, peak-memory, sustained 60fps or full-roadmap acceptance.

Primary definitions: [libtiff floating prediction source](https://gitlab.com/libtiff/libtiff/-/blob/8a481db9b52658b91d6b8d3053192b5617c56e78/libtiff/tif_predict.c),
[ICC CICP type](https://www.color.org/iccmax/download/CICP_tag_and_type_amendment.pdf).
