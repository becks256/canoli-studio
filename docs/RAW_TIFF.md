# Native RAW master TIFF delivery

The trusted browser host and RAW review can export a developed sensor master as
real RGBA16 integer or RGBA32 float TIFF. This is separate from the document's
sRGB8 renderer. Original sensor bytes and the document's accepted working image,
placement, masks, layer styles, other artwork, history and save state remain
independent. It does not add document working spaces, a high-precision canvas,
float TIFF import, HDR reconstruction or CMYK delivery.

## Host contract

```ts
editor.exportRawTiff(
  source: File | SmartObjectLayer,
  options: RawTiffExportOptions = {},
  control: RawTiffControl = {},
): Promise<RawTiffResult>
```

`source` is an explicitly selected complete local RAW File or an attached RAW
smart object in the current document. A retained master uses its exact original
Blob after project/workspace reopening; ordinary asset-backed smart objects and
foreign/detached layers reject. Linked instances share the same sensor source.
The resulting image has the developed master's native display dimensions,
including selected-image orientation. Instance placement/transform, layer or
filter masks, opacity, styles and other document layers are excluded.

Strict options:

- `development?: RawDevelopOptions` uses the current retained master's complete
  development settings when omitted, or ordinary native defaults for a File.
  An explicitly provided object is normalized with native defaults; it is not a
  patch against retained settings. White balance, demosaicing, exposure,
  highlights and supported manual/calibrated lens correction use the same native
  development definitions as Import/Apply. Unknown settings and unavailable
  camera white balance reject. Existing camera/calibration/extra-channel/native
  representation limits remain explicit.
- `sampleFormat?: 'rgba16' | 'rgba-float32'` defaults to `rgba16`. Native linear
  RGB16 (or replicated grayscale16) goes directly through the pinned CMM into
  the requested target precision. There is no 8-bit transfer table, PNG proxy or
  canvas in this path. Float output retains fractional color-conversion values
  from a 16-bit development; it does not add sensor information or reconstruct
  clipped highlights/HDR. Lens borders retain the established 8-bit coverage
  policy, scaled exactly to uint16 and normalized for float.
- `variant?: 'auto' | 'classic' | 'big'` defaults to `auto`. Automatic addressing
  uses the actual complete output size; classic overflow rejects. A forced
  BigTIFF writes a true 64-bit directory. No source size/megapixel cap or
  downsampling is introduced.
- `color?: ColorOutput` defaults to a captured copy of the current output preset.
  It accepts a built-in RGB profile or immutable inspected `IccProfile`, one of
  the four actual ICC intents and black-point compensation. Complete original
  profile bytes, settings and name are captured before asynchronous work. RGB
  transform preparation is authoritative; unusable/CMYK targets reject. Intent
  table fallback is disclosed. Proof preferences do not enter the file.

`control.signal` cancels waiting, native processing, encoding or result
verification. `onProgress` receives `{phase, fraction}` with phases `waiting`,
`inspecting`, `developing`, `encoding`, `verifying`; fraction is null when
unknown, otherwise 0–1. Throwing callbacks reject without returning a file.
Dispose aborts jobs. Retained-layer export also rejects document/session/revision
or captured source changes. File-only exports own their immutable File and
captured output settings, so unrelated document edits do not change their data.
No method downloads automatically; the UI downloads only after success.

The result is `{tiff: Blob, report: RawImportReport, receipt}`. The TIFF Blob has
`image/tiff` type. The strict version-1 receipt records `sourceSpace:
'linear-srgb16'`, source SHA-256/byte length, normalized settings fingerprint,
RAW/lens/CMM WASM identities, target profile name/hash/length, actual intent/BPC,
sample format, native width/height and intent-fallback warnings. A settings
fingerprint covers full normalized development/calibration and output choices;
it is not a signed credential or a substitute for retaining the original and
settings when reproducing delivery.

For example, in the trusted browser host (not the isolated Scripts panel):

```ts
const result = await editor.exportRawTiff(selectedRawFile, {
  sampleFormat: 'rgba16',
  color: {profile: 'display-p3', intent: 'relative-colorimetric'},
}, {signal: abortController.signal});
// result.tiff can now be saved by an explicit host download.
```

This file service is outside document constructors/commands. It adds no isolated
Scripts/plugin file/native privilege, REST rendering endpoint, browser/headless
synchronization, account, upload or paid operation. Existing editable RAW
commands, 8-bit consent and one-Undo Import/Apply contracts remain unchanged.

## Files, ownership and validation

The core TIFF encoder supports strict RGBA8, uint16 and float32 tile samples.
Default 8-bit directories/payload behavior remains compatible. Integer16 writes
four 16-bit samples with unsigned SampleFormat; float writes four IEEE float32
samples with floating SampleFormat. All use little-endian, lossless Deflate,
straight/unassociated alpha, independent tile payloads and the complete original
ICC tag. Files retain current Software/72 DPI metadata; sensor/EXIF metadata
stays in the RAW original and returned inspection report, not copied to TIFF.
Current TIFF reopening requires explicit 16-to-8-bit editing consent; float
TIFF input remains explicitly unsupported.

The exporter shares the single RAW owner and the two-owner ICC semaphore with
existing inspection, 8-bit development, proof and delivery. Waiting jobs retain
immutable sources/settings without allocating native source/decoded planes.
One private worker owns the native sensor result and CMM. Output/ICC conversion
uses source rectangles no larger than 2048 × 64, with bounded native lens source
caching; only compressed Blob parts accumulate. The upstream sensor decoder
still needs full-frame source/processing memory. These tile bounds are separate
from document geometry, original resolution and real browser/native memory
limits.

The client terminates native work before accepting a result. It checks the
source/settings/engine receipts, selected native report, actual TIFF addressing,
geometry, every sample tag and tile interval, single-page layout and exact
complete ICC bytes. Each Deflate tile is decoded into its expected bounded
allocation; excess/short/corrupt payloads reject. Float samples must be finite
with alpha in [0,1]. Invalid replies, cancellation, callbacks and worker/native
failures release both host leases and permit retry. No partial Blob is returned
as accepted output.

## Verification boundary

Tests use the actual checked-in RAW, lens and CMM WASM. Independent libtiff
4.3.0 reads original uint16/float32 samples; a separate native Linux Little CMS
2.19.1 transform consumes independently developed dcraw_emu RGB16 references.
Manual lens checks use independent NumPy equations before CMM conversion.
Integer/alpha references require exact values; manual lens integer color allows
one code value from independent float rounding, and float RGB allows absolute
error 0.000002. These bounds are fixed before browser execution.

The genuine 10000 × 5000 RAW reference retains its original 100,000,672 sensor
bytes and all 50 million RGB16 pixels; its native source has 223/152/306 distinct
channel values. Native integer and float deliveries are compared across every
sample and embedded profile. See the dated roadmap and evidence for actual
counts/results; synthetic color/geometry checks do not establish physical
camera/print quality, arbitrary codec/profile support, sustained throughput,
peak process memory or all-tool 60fps. Full F10/F11/F12 and the original roadmap
remain required.
