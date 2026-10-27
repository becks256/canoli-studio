# Independent float TIFF fixtures

Generated explicitly by `scripts/generate-float-tiff-fixtures.py` using native
libtiff 4.3.0, NumPy, Pillow for reference PNG encoding only, and a separate
native Linux Little CMS 2.19.1. No Canoli codec, renderer or WASM participates in
fixture/reference generation. Every generated supported TIFF is read back via
libtiff's original float sample API and checked against the intended samples.

Twelve positive layouts cover RGBA/RGB and gray/gray-alpha, original source ICC
versus explicit linear-sRGB interpretation, little/big endian, classic/BigTIFF,
strips/tiles, chunky/planar, raw/PackBits/LZW/Deflate, predictors 1/2/3 and
associated/unassociated alpha. Negative fixtures include NaN/Infinity, HDR range,
invalid alpha and normalized RGB with known PQ/HLG ICC CICP declarations.
Expected small RGBA8 references require exact decoded bytes, including hidden
color/alpha. Native browser compositing is checked separately.

`diagnostic-byteswapped-predictor3-be.tif` preserves the initial cross-endian
libtiff writer behavior: intended float input is byte-swapped in its own native
readback. The generator explicitly reproduces and checks that diagnostic. The
supported big-endian predictor-3 fixture compensates only the writer input;
its intended native values then read back exactly. The application decoder
continues the standard byte-plane reconstruction; no exception guesses an
incorrectly written file's intended pixel values.

With `--large`, the genuine 50 MP dcraw_emu RGB16 source is streamed into native
CMM linear-sRGB16 -> P3 float32 and native predictor-3 BigTIFF. A separate native
P3 float32 -> sRGB8 pass writes its full reference PNG. The source RGB16 hash,
expected RGBA8 hash and every full file hash remain in the manifest. This checks
genuine source precision beyond 256 levels without relabeling an 8-bit image.

```sh
python3 scripts/generate-float-tiff-fixtures.py --native-lcms /tmp/canoli-color-lcms2.19.1-native.so --large
```

Normal builds/tests never regenerate fixtures or fetch a compiler/library.
These are owned synthetic sources/profiles, not calibrated device quality,
HDR tone-map, high-precision scene or sustained performance acceptance.
