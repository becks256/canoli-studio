# Independent precision/source-profile references

`manifest.json` covers 24 direct native Linux Little CMS 2.19.1 transformations.
The generator calls the native library through ctypes and imports no Canoli
wrapper, JavaScript, WASM or browser output. Complete profiles are the owned
synthetic/standard sources in `../icc-native`, with their hashes recorded here.
The pinned native build is reproducible with `scripts/build-icc-reference.py`.

The 16-bit input contains 4,096 distinct red values and sub-byte differences;
float inputs include differences smaller than 1/255. Every pair of RGBA8,
RGBA16LE and RGBA float32LE input/output formats is covered. Additional cases
exercise independent source spaces, every intent with BPC, a 16-bit identity,
and extended negative/above-one linear float identity samples. Integer outputs
and all alpha samples require exact native reference values; float RGB permits
absolute error at most 0.000002 across native/WASM math implementations. Identity
precision assertions require exact input preservation. These tolerances are
fixed before browser execution, not widened to hide a failed result.

`large-reference.json` uses the existing genuine 10000 × 5000 synthetic RAW
fixture's independently developed **linear RGB16** samples. The original RGB16
SHA-256 and compressed source hash remain recorded. A native ctypes transform
converts all 50 million pixels from linear sRGB to Display P3 in windows of
100,000 pixels with deterministic full-range alpha. The reference hashes every
RGBA16LE byte, then hashes the ordered 500 window digests. Chromium streams the
same complete input through the actual worker/WASM and compares the digest
root. Neither path requires an unbounded decoded image plane. This is a native
sample-conversion check, separate from application import/edit/export acceptance.

Regenerate explicitly from the repository root:

```sh
python3 scripts/generate-icc-precision-fixtures.py --native-lcms /tmp/canoli-color-lcms2.19.1-native.so
python3 scripts/generate-icc-precision-large.py --native-lcms /tmp/canoli-color-lcms2.19.1-native.so
```

Normal builds/tests never regenerate references. These synthetic profiles and
sources do not establish calibrated device/print quality, HDR display, a
high-precision document renderer, photographic quality or sustained performance.
