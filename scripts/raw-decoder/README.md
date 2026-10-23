# Checked RAW development dependency

This is the native dependency of the RAW workflow under implementation. It does
not by itself enable application RAW opening, editable development or persistence.

The maintained wrapper uses LibRaw 0.22.2 (`b93f6e45c194f5df9b02a43b1af9a54b4f41f33f`),
zlib 1.3.2 (`da607da739fa6047df13e66a2af6b8bec7c2a498`) and the existing isolated
Emscripten 4.0.10 toolchain (`62a853cd3b3134398ce85cde8bb5cbb2ef0194cb`). Sources are
unmodified. The explicit source list comes from the pinned upstream Makefile.
Normal application builds use checked-in JS/WASM and do not download or compile
these dependencies.

```sh
python3 scripts/build-raw-decoder.py \
  --emsdk /tmp/canoli-avif-emsdk \
  --libraw /tmp/canoli-raw-native/LibRaw \
  --zlib /tmp/canoli-raw-native/zlib \
  --tools /tmp/canoli-avif-build-tools/bin \
  --build /tmp/canoli-raw-native/build-wasm \
  --native-build /tmp/canoli-raw-native/build-reference
```

The optional native build compiles upstream `dcraw_emu` independently of the
wrapper. `scripts/generate-raw-fixtures.py --reference <dcraw_emu> --large` creates
synthetic DNG sensor files and native linear16 references with NumPy. It writes
the 50 MP DNG/reference with gzip for repository storage; browser tests import
the complete uncompressed source, not a reduced preview. The manifest identifies
synthetic inputs explicitly. These cases do not establish real-camera quality.

The C ABI checks native inspection, selected image, calibration, white-balance
availability, unpacking, corruption counters, development, allocation and pixel
copy. It does not use embedded thumbnail extraction. LibRaw's memory-image helper
ignores a copy status, so this wrapper owns and checks that operation directly.
Output is an owned linear sRGB RGB16/grayscale16 plane. Source/output dimensions
are checked against actual native field and pointer-difference representation;
optional working-memory defaults do not become source import caps. Native codec
behavior, address space, full-input/full-plane memory and actual allocation remain
limits. Extra sample channels reject rather than silently becoming opaque.

The adapter copies bounded row intervals and enforces one active native call or
output lease. The worker uses the standard sRGB transfer and explicit consent
before producing an RGBA8 working PNG. The original RAW remains separate. This
does not implement the still-required F10 high-precision/HDR compositor.

The build includes zlib, internal X3F and native demosaicing. It excludes DNG SDK,
RawSpeed, external lossy-JPEG DNG, arbitrary camera/output ICC files, OpenMP and
network/filesystem services. An upstream camera list is not a tested coverage
matrix for this build. Unsupported native data rejects. Calibrated output is not
a claim of evaluated photographic/profile/print fidelity.

LibRaw's copyright, LGPL/CDDL alternatives, bundled BSD/MIT notices and zlib
license are retained under `public/licenses`. Emscripten/musl notices are already
bundled there. This wrapper/build source and the pinned upstream inputs permit
rebuilding the separate decoder module. Review source revisions and regenerate
`build.json` when changing native code.

Primary references:

- [LibRaw 0.22.2](https://github.com/LibRaw/LibRaw/releases/tag/0.22.2)
- [Native data and processing options](https://www.libraw.org/docs/API-datastruct-eng.html)
- [Pinned native reference CLI](https://github.com/LibRaw/LibRaw/blob/0.22.2/samples/dcraw_emu.cpp)
- [DNG specification](https://helpx.adobe.com/camera-raw/desktop/dng-and-file-formats/digital-negative.html)

Native protocol 2 retains the existing exported functions and 128-byte information
record, adding recorded focal length, 35 mm-equivalent focal length, aperture,
exposure seconds and ISO as five checked float32 values. Two bounded strings
carry the declared lens make/model; a missing maker is not inferred from the
camera maker. Standard metadata takes precedence over available native makernote
fallbacks. Missing, nonpositive or non-finite declarations become unknown, not
zero measurements or import failures. These are recorded values, not calibrated
sensor geometry, measured exposure or a basis for silent lens-profile selection.
No serial numbers, GPS coordinates or timestamps are exported by this addition.
