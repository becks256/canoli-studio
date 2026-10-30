# Owned float originals and derived tiles

The initial connected schema-49 float document workflow is now specified in [FLOAT_DOCUMENTS.md](FLOAT_DOCUMENTS.md). The dependency/legacy byte-mode sections below retain their individual boundaries; they do not describe the new mode as byte editing. Broader F10 and full-roadmap acceptance remain required.

The trusted browser host can retain independent leases over original unsigned
16-bit or float32 TIFF files and prepare persistent, losslessly compressed RGBA
float32 tiles. This is
an internal F10 source-storage dependency, now used by the initial connected
float Document workflow described above. Default byte documents retain sRGB8.
Broader float authoring, working profiles, tools and performance remain required
by the original roadmap.

## Admission and ownership

`FloatRasterSource.openTiff(original, tiff = {}, output = {profile: 'linear-srgb'},
control = {})` inspects a Blob without creating a bitmap or 8-bit proxy. It
requires a supported unsigned 16-bit or float32 RGB/grayscale page. An unprofiled
file requires explicit
`floatColorSpace: 'srgb' | 'linear-srgb'`. Page defaults to zero. Existing
`allowPrecisionLoss` defaults to false and does not authorize quantization in
this service. Original ICC takes precedence over an assumption. Output profile,
intent and black-point compensation use the existing ColorOutput validation.

`assetStore.captureFloatSource(assetId, output = {profile: 'linear-srgb'})`
captures a retained high-precision TIFF's exact original and source choices.
It rejects missing assets and assets without original float color metadata.
`FloatRasterSource.capture` is the lower trusted admission boundary; it checks
geometry and source identity again in preparation. These are internal host
services, with no new isolated scripting, plugin or REST capability.

Each source lease exposes readonly `original`, `width` and `height`, plus
`share()`, `prepare(control)`, `readWindow(bounds, control)` and idempotent
`dispose()`. Closing a document or bitmap owner does not close a separate source
lease. Closing one shared lease cancels its own pending work; the last close
terminates workers and releases native ownership. Closed leases reject use.
Original Blob bytes remain authoritative. No float sample is reconstructed from
an 8-bit canvas, preview, export or display profile.

## Identity, preparation and publication

A versioned canonical descriptor binds the entire original SHA-256 and byte
extent, native geometry/orientation/page/decode choices, source and target ICC
hashes, rendering intent, black-point compensation, pinned native CMM SHA and
tile geometry. Changing any choice gives a separate cache identity. Target and
source profile identities are checked against captured host choices. Original
hashing and sample decoding happen in a dedicated worker.

Metadata and cache lookup precede allocation of a native CMM owner. A complete
cache hit requires no CMM binary fetch or owner slot. Cold preparation acquires
the existing shared ICC semaphore, normalizes unsigned 16-bit originals without
byte quantization, converts straight float rows directly to target float32, and emits checked lossless Deflate tiles. RGB must be finite;
alpha must be in [0,1]. Signed/above-one finite RGB can remain in this internal
service; this does not implement HDR transfer interpretation or tone mapping.

IndexedDB `canoli-float-tiles` version 1 has `sources`, `heads`, `tiles` and
`stages` stores. A build UUID owns sequential staged tiles. Host validation
checks decoded length, geometry, both encoded/raw SHA-256 values, all samples,
the native conversion receipt and complete ordered coverage. Only then does one
transaction publish the full manifest and small ready pointer. Replacement
removes the preceding derived build atomically. The preparation worker waits for
host acknowledgement after each batch of at most eight stored tiles rather than
filling an unbounded message queue. All tiles are fully verified before one atomic
staging transaction; a bad later tile or failed write leaves none of that batch.
Ordered metadata and immutable Blob references are captured before any await;
later caller mutation cannot replace already validated bytes during database open.
The final partial batch follows the same checks. Progress may advance by a batch
rather than a single tile. Descriptor, tile and persistent cache formats remain
unchanged, so existing verified sources remain reusable.
Quota, native, worker and callback failures publish no partial
ready source; existing identities remain available. Retry starts fresh.

Preparation is shared for identical retained originals and choices. One caller's
abort or throwing progress callback cannot stop another waiter. The final waiter
leaving cancels the job, releases its CMM slot and discards its owned stage.
An interrupted browser process can leave unreachable draft cache records; these
are disposable through cache maintenance, not an authored-data recovery format.

## Reads, budgets and repair

`readWindow({x, y, width, height}, control)` accepts safe integer native coordinates,
positive dimensions and at most 262,144 pixels per request. Negative and outside
coordinates return transparent black. This working-buffer budget does not limit
original file size or resolution. Each successful call returns a new, complete,
finite, owned Float32Array; caller mutation cannot alter stored or later samples.

Reads check the current small ready pointer and fetch only intersecting encoded
tiles. A separate worker verifies them and maintains a 16 MiB / 64-entry decoded
LRU. Compressed hashes are checked even on LRU hits. At most four read operations
per source enter storage/worker processing; queued reads can be cancelled. Host
reply validation checks request identity, exact owned buffer length and samples.
Signal, progress exception and lease closure reject promptly and retain verified
cache data. Corruption invalidates only the observed build; the next read can
rebuild from the original. Concurrent replacement can require the same retry.

Preparation tiles are at most 256 × 64. Band height adapts to an 8 MiB float
conversion band, with a minimum of one full native row. One worker packet owns at
most eight compressed tiles (at most 2 MiB of raw samples, with each encoded tile
bounded by its existing raw-size-plus-64-KiB limit). The host decodes/verifies
one tile at a time before atomic staging and acknowledges before further packets.
TIFF block decompression,
row width, profile/WASM allocations, browser storage quota and process memory
remain actual resource constraints. No arbitrary source megapixel/file-size cap
or destructive downsampling is added. These budgets are not a measured peak
process-memory or sustained performance guarantee.

## Verification and remaining work

Independent references use Linux libtiff and native Little CMS with original ICC
bytes, no Canoli/WASM/canvas/byte reference. Twelve small layouts cover byte order,
compression/predictors, tiles/strips, planar/chunky, RGB/gray and alpha forms. A
genuine 10000 × 5000 float TIFF adds a 200-million-sample reference. Browser tests
export actual stored/read windows as float TIFF; a separate libtiff reader checks
every float word, decoded hash, geometry and complete linear ICC. The dated
roadmap records observed results and verification boundaries.

This cache stores only immutable original-derived pixels. Authored float edits
must never depend on disposable tiles as their sole persistent owner. Existing
native project/workspace containers retain original bytes/settings; they do not
serialize this cache. Versioned float Document/OO commands, actual scene/effects/
masks/tools/display, authored persistence/Undo/recovery, precision scene/batch
delivery, scoped automation, broader HDR/CMYK and physical/device/performance
acceptance remain required. REST sessions remain independent of the browser.

## Independent Node source service

The Node REST host now prepares the same pinned native linear-sRGB tiles through a separate private file service. Browser IndexedDB ownership is unchanged. Both actual reader workers share bounded window assembly, compressed/raw verification and a decoded LRU; Node sources are bound to exact accepted original/asset identities and rebuilt from originals after corrupt reads. [REST window/ownership contract](REST_TIFF.md).
