# Profile-aware batch delivery and portable recipes

Batch variants now support PNG, JPEG, WebP, AVIF, TIFF and raster PDF. PNG/TIFF/PDF
can use complete owned RGB ICC sources, with actual Little CMS conversion after
fitted native RGBA8 readback. The scene remains sRGB8. JPEG/WebP/AVIF are sRGB;
requesting ICC conversion for them rejects before a batch is created. Soft proof
is a view setting and never enters delivery.

## Choose and reuse settings

In Batch, **Add Custom** offers TIFF and PDF alongside the existing formats.
**Use current output profile** captures the current Color output profile, intent
and black point compensation into that variant. Subsequent workspace preference
changes do not alter the captured source. Unchecked variants retain sRGB output.
The chips show the owned profile name; review shows the actual conversion and
any native intent-table fallback.

**Export delivery preset** downloads a `.canoli-delivery` file containing the
variant list and exact original ICC bytes. **Import delivery preset** validates
its whole checksum/range graph and preflights all requested native transforms
before replacing the draft. Cancel/close aborts native work. Imports/exports do
not edit the document, advance its revision or create Undo entries.

With a recipe selected, **Export recipe with delivery preset** downloads a
complete recipe package carrying those settings. A selected portable package
loads its delivery settings into Batch; the displayed variants remain editable
before creating a new run. Ordinary recipe execution still applies only its
shared document commands. It does not export files or change Color preferences.

## Trusted browser APIs

```ts
const color = await editor.batch.captureColorOutput(
  editor.colorSettings.output, {signal});
const variants = [{
  id: 'print', name: 'Printed RGB', format: 'tiff',
  targetWidth: 10000, targetHeight: 5000, fit: 'contain',
  tiffVariant: 'auto', color,
}];
const file = await editor.batch.exportDeliveryPreset({name: 'Delivery', variants}, {signal});
const preset = await editor.batch.importDeliveryPreset(file, {signal});
const recipeFile = await editor.recipes.attachDeliveryPreset(recipeOrPackage, file, {signal});
// Install only on explicit request; attaching above is a file-only operation.
const installed = await editor.recipes.packages.save(recipeFile);
const run = await editor.batch.createBatch({
  name: 'Production', budgetId: 'default-budget', recipePackageId: installed.id,
  // Omit variants to use the package's defaults. An explicit list overrides them.
}, sourceImages, {signal});
await editor.batch.start(run.id);
const result = await editor.batch.waitForRun(run.id);
```

These are trusted host services. They add no isolated-script constructor,
profile store, native worker, file/download permission or REST rendering route.
Independent REST sessions remain headless and do not synchronize with the UI.
Headless package parsing checks transport bytes/references; native ICC admission
and actual browser rendering belong to the batch host. The existing job budget,
consent, recipe commands, preparation, review and source ownership rules apply.
No paid call or fake generation is introduced.

`ColorOutputSource` version 1 is `{version, profile: {name, sha256, source: Blob},
intent, blackPointCompensation}`. Capture resolves even built-in IDs into complete
original bytes. It inspects, hashes and compiles the actual RGB output transform.
CMYK/device-only, malformed, forged, substituted and unusable profiles reject.
The Blob is immutable and the returned record is frozen. Source names are at
most 240 UTF-16 units, and hash strings are lowercase SHA-256. These metadata
bounds do not restrict image import geometry or original file resolution.

Variant geometry, IDs, fit and naming retain the existing contract. TIFF
`tiffVariant` is `auto` (default), `classic` or `big`; PDF `pdfDpi` defaults to 72
and changes physical page sizing without resampling. Wrong-format options,
quality on lossless PNG/TIFF/PDF, duplicate IDs and unknown variant fields reject.
The raster PDF and TIFF editability, metadata and precision limits documented in
their existing export contracts still apply.

## Persistence, retry and manifest ownership

Batch storage database version 3 upgrades legacy rows without rewriting them
and prevents older clients from processing unsupported color contracts. Each run
owns cloned variant records and full ICC Blobs in IndexedDB, plus its
complete recipe-package snapshot where used. Native profile preflight and source
hash checks precede run publication/execution. Cancellation can abort both native preparation and the final atomic run/source
transaction; an already committed transaction remains acknowledged. Service
disposal cancels pending profile operations. A delayed preflight cannot revive
a cancelled/reconfigured run. Existing accepted outputs are checked against a
canonical settings fingerprint before retry, reuse or package generation. A
changed profile, intent, fit, dimensions, codec options or naming policy requires
a new batch. Missing color receipts cannot retroactively certify older files.

A completed profiled output records the source sRGB8 plane, target name/hash/byte
length, requested intent/BPC, actual native engine and WASM fingerprint, fallback
flag and warnings. Each file still has its own exact output SHA-256. Version-3
delivery manifests include color/settings receipts in the full canonical payload
checksum. Existing version-2 manifests remain readable/verifiable, and ordinary
legacy sRGB output is not retroactively assigned a measured color contract.
These are integrity hashes, not author signatures or physical color guarantees.

Delivery ZIPs with profile/TIFF/PDF settings contain
`delivery-preset.canoli-delivery` as well as `delivery-manifest.json` and the
verified output files. Original profile bytes can therefore be reused after
workspace preferences or recipe-library entries disappear. Existing RAW/font
prepared-project sidecars remain independent and preserve their originals.
Successful items/variants are not silently rerun or charged again.

## Binary and recipe versions

Delivery presets use the eight-byte `CANDELV1` marker, little-endian uint64 JSON
length, SHA-256 of the entire JSON envelope and contiguous ICC payloads. Envelope
format is `canoli-delivery`, version 1. Every payload records size, offset and
SHA-256; every variant has concrete profile metadata and an indexed payload
reference. Duplicate/unreferenced payloads, bad hashes, invalid references,
overlap/gaps, unsafe numeric extents and trailing bytes reject. Shared identical
profile bytes are stored once. JSON never expands ICC data into base64.

Recipe schema 3 requires a delivery descriptor `{version:1, name, sha256,
byteLength}` and may also carry existing font dependencies. Package version 4
(`LUMAR4` header family) owns the complete preset following asset originals and
font payloads. The descriptor hashes the whole preset. Package admission verifies
that descriptor, every nested profile hash and the final contiguous extent before
exposing any contents. Recipe/package versions 1/2/3 retain their existing
readers; delivery metadata cannot be smuggled into older versions or exported
without its complete source package. A font-bearing schema-3 recipe retains the
same exact selected-face originals/render sources as schema 2.

## Remaining scope

This increment does not complete F10, F11, W03, W06 or the whole roadmap.
Working-space assignment/conversion, high precision, CMYK/HDR delivery,
other-format profile fidelity, independent REST color rendering/jobs, arbitrary
artboards and broader delivery packaging, measured physical devices and sustained
browser/performance/resource acceptance remain required. Byte-exact reader checks
prove the tested RGB8 files under the recorded engine; synthetic profiles do not
establish printer quality or professional color parity.
