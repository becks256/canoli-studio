# Compact wet pigment reference

`native-reference.json.gz` contains complete changed-pixel arrays from the actual
WASM engine at `ff1d711`, before carrier compaction. Six cases cover native tile
sizes 8, 16 and 128, reflected/non-reflected affine tips, pressure, tilt and
original-first symmetry. The manifest pins the original source and fixture hash.
This is a regression reference, not an independent mathematical oracle.

`tests/wet-spatial.test.ts` compares every native result against that reference
with zero and bounded caches. Separate independently calculated bilinear tests
and exact dense/compact float-word comparisons exercise negative coordinates,
partial cells, shear/reflection and distant origins. Storage checks require
complete native processor support rather than nonzero bounds.

The original capture generator, source reconstruction, commands and measured
storage/output/production feedback evidence are retained in
[`wet-feedback-2026-10-31.json.gz`](../../../docs/benchmarks/wet-feedback-2026-10-31.json.gz).
