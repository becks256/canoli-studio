The import decoder is built from libavif 1.3.0 and AOM 3.12.1 with Emscripten
4.0.10. Source revisions and resulting hashes are recorded beside the artifacts.
The existing jSquash 2.1.1 export encoder remains separate and unchanged.

The checked C ABI propagates source-selection, decoding, pixel-allocation and
YUV/RGB-conversion errors. It explicitly selects the primary item, returns native
depth/alpha/CICP for host validation, copies owned unassociated RGBA8 out before
releasing native allocations, and uses built-in bilinear color conversion.
Libavif's bundled small libyuv scaling helpers remain covered by its notice;
the external libyuv color converter is disabled. No encoder, network service or
shared-memory/threaded worker is required.

Libavif's optional default 32768-axis guard is disabled. Its pixel-count field is
set to the uint32 representation maximum. This does not make WASM/browser memory
unlimited or promise region/constant-memory decoding; impossible allocations and
native representation failures reject. It does not introduce an application
megapixel/file-size limit.

Libavif 1.3.0 also has an early parser check that refuses a pixel guard larger
than its default. CMake applies one checked textual replacement to a build-local
copy of `src/read.c`, leaving the pinned checkout unchanged. That replacement
permits the uint32 field range; existing division-based dimension checks and
per-plane/PTRDIFF allocation overflow checks remain. The wrapper rejects an
unrepresentable RGBA extent immediately after parsing, before frame decoding.
Source-shape changes fail configuration and require explicit patch review.

To rebuild, prepare isolated directories outside the checkout, then run:

```sh
git clone --depth 1 --branch 4.0.10 https://github.com/emscripten-core/emsdk.git /tmp/canoli-avif-emsdk
/tmp/canoli-avif-emsdk/emsdk install 4.0.10
/tmp/canoli-avif-emsdk/emsdk activate 4.0.10 --embedded
git clone --depth 1 --branch v1.3.0 https://github.com/AOMediaCodec/libavif.git /tmp/canoli-avif-native/libavif
git clone --depth 1 --branch v3.12.1 https://aomedia.googlesource.com/aom /tmp/canoli-avif-native/libavif/ext/aom
python3 -m venv /tmp/canoli-avif-build-tools
/tmp/canoli-avif-build-tools/bin/pip install cmake==3.31.6 ninja==1.11.1.4
python3 scripts/build-avif-decoder.py --emsdk /tmp/canoli-avif-emsdk --libavif /tmp/canoli-avif-native/libavif --tools /tmp/canoli-avif-build-tools/bin --build /tmp/canoli-avif-native/build-local
```

The build script checks exact source revisions and clean tracked dependencies;
CMake uses only the already-cloned AOM source. Downloads are explicit setup
operations, not part of the application build or browser runtime. Generated
artifacts are checked in so ordinary npm builds need no native toolchain.
Corresponding third-party notices are copied into `public/licenses`.
