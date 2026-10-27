# Independent native float processing references

Generated explicitly by `python3 scripts/generate-float-pixel-fixtures.py`.
NumPy starts from exact original float32 samples and evaluates W3C source-over
and blend formulas in float64 before the final float32 store. Source inputs
have over 8,000 channel levels, including normalized corners, partial/zero/full
alpha and float coverage. Eighteen complete blend results and a signed/extended
RGB affine result are retained as raw little-endian float32 gzip streams.

The manifest records complete encoded/decoded hashes, source levels, generator
identity and a declared 2^-22 absolute normalized-color tolerance. Alpha must
match exactly. Native/window/worker tests separately verify original input
ownership, arbitrary chunk boundaries, private memory, overflow/failure and
retry. This is not a reference image quantized through Canvas or a byte PNG.

Original-TIFF -> native ICC -> float affine/composition -> float TIFF is tested
separately against native libtiff/Linux CMM/NumPy, including every sample of a
50 MP source. Those generated files are runtime evidence, not source fixtures.
The precision document/compositor/tool/persistence integration remains open.
