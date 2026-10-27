# ICC native reference fixtures

These profiles and RGBA windows are owned synthetic test material. The narrow
RGB device is an intentionally smaller gamut, not a calibrated monitor. The
CMYK device is an educational pair of coarse LUTs based on multiplicative
CMYK and 50% gray-component replacement, not a measured printer or a physical
print-quality reference. Generated synthetic profiles are dedicated to CC0;
built-in profiles retain the application's existing generated copyright.

`manifest.json` records every complete profile/window hash and reference engine.
The cube contains 729 RGB colors, including dark transfer-curve samples, with
varying independent alpha. Five RGB profiles exercise output conversion and
device proofing. The CMYK fixture exercises actual four-channel proofing and
intent fallback; it must reject RGB delivery.

An older Little CMS 2.16 perceptual/BPC result differs from 2.19.1 on the coarse
v2 CMYK fixture. Its original RGBA result remains present and hashed. An
independent native Linux build of the pinned CMM reproduces the actual WASM
result for both RGB/RGBA buffers, global/private contexts and the full cube.
That version-sensitive case uses a separate exact native reference. Other RGB
cases require exact older-reader colors; the other two CMYK cross-version
cases allow at most one code value. Every case requires exact alpha. No
threshold was widened to accept the discovered version difference.

To regenerate explicitly with Pillow 10.3.0 / Little CMS 2.16 and the pinned
source/toolchain described in `scripts/icc-engine/README.md`:

```sh
NODE_DISABLE_COMPILE_CACHE=1 node --import tsx scripts/generate-icc-standard-fixtures.ts
python3 scripts/build-icc-reference.py --lcms /tmp/canoli-color-lcms2191 --clang /tmp/canoli-avif-emsdk/upstream/bin/clang --output /tmp/canoli-color-lcms2.19.1-native.so
/path/to/pillow-10.3-python scripts/generate-icc-fixtures.py --native-lcms /tmp/canoli-color-lcms2.19.1-native.so
```

Normal tests/builds never regenerate these values or fetch native sources.
They do not prove arbitrary profile compatibility, physical color quality,
high-precision scene authoring, CMYK/HDR output or application integration.
