# Independent coupled wet-field references

Regenerate with `python3 scripts/generate-projected-wet-fixtures.py` in an
installed NumPy environment. The generator solves the homography independently
with NumPy DLT and computes five-channel bilinear interpolation without editor,
worker or WASM imports. Scalar fixture manifests supply geometry only.

Each little-endian float32 sample contains premultiplied encoded RGB,
replacement alpha and independent removal coverage, in that order. Source data
uses a fixed random seed, with explicit fully clearing and inert cells.
`manifest.json` pins the generator, decompressed source and every reference by
SHA-256. Gzip headers use timestamp zero. The absolute comparison bound is
2e-7; bounded worker/helper and irregular row partitions must be bit-identical
to complete actual-WASM output.

These numeric fixtures cover both transport directions, reflection, strong
perspective, large placement, pixel-corner contact, horizons and affine input
origins. Browser workflows separately exercise prepared PNG reconstruction,
ordered overlaps, opacity, mask settings, real input, source lifetimes,
persistence, recipes, exports, 50 MP originals and measured presentation latency.
They do not establish photographic resampling quality or device performance.
