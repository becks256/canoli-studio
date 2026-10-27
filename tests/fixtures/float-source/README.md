# Independent float source references

`manifest.json` binds each original TIFF, complete source/linear ICC and raw
RGBA float32 reference hash. Gzip payloads contain row-major little-endian RGBA
float32, losslessly compressed with deterministic gzip metadata.

Regenerate explicitly with:

```sh
python3 scripts/generate-float-source-fixtures.py \
  --native-lcms /path/to/native-lcms2.19.1.so --large
```

The generator uses system libtiff for original sample decoding and native Linux
Little CMS for original ICC → linear-sRGB float32 conversion, with no Canoli,
WASM, Canvas or byte intermediate. Native library identity and generator hash
are recorded. Original-bearing TIFFs live in `../tiff-float/`; profiles live in
`../icc-native/`. The small cases include raw/Deflate/LZW/PackBits, predictors,
byte order, planar/chunky, gray and alpha layouts. The genuine 50 MP case has
200 million independently generated RGBA samples.

`scripts/check-float-source.py` reads actual exported float TIFFs through native
libtiff and compares every float word plus complete embedded ICC, geometry and
decoded sample hashes. Production worker tests compare the same independent
hashes. These synthetic correctness fixtures do not establish physical color
quality, peak memory, sustained performance or a float Document renderer.
