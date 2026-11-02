# Bounded projected wet composition — 2026-10-31

This advances F03/F06/F14 by reducing post-sampling byte composition work for
sparse wet fields. The baseline is `00c8c70`. Original resolution, the complete
native sampling grid, every accepted input and shared Undo remain required.
The full roadmap and editor-wide performance gates remain open.

## Behavior and correctness boundary

The compositor previously converted each nonempty canonical 512-pixel window
in full, even for a thin mark. It now finds the integer bounds of nonzero
independent removal coverage after sampling. Conversion, three scratch surfaces,
readback and optional once-only native opacity mixing use that rectangle.
Four covered corners prove full-window bounds directly for dense fields.

Validated coupled fields satisfy `0 <= RGB <= alpha <= removal coverage <= 1`.
The existing removal/replacement operator is identity outside nonzero removal
coverage. Replacement alpha alone would incorrectly discard transparent pigment
that removes existing artwork. The bounds therefore include every positive float
coverage value before byte quantization, including low coverage that later rounds
away. Native sampling/ROI, homography, bilinear neighbors, source validation,
geometry, original bytes, publication and cancellation stay unchanged.

## Complete-output native control

Two new browser tests compare every RGBA byte for 36 cases: identity and
perspective placement, six sparse/boundary/transparent-clearing/sub-byte/empty /
dense patterns, and operation opacities 0.23, 0.5 and 1. The background includes
seven alpha levels. Boundary patches cross canonical output windows. The control
uses the actual returned WASM fields but composes the complete canvas independently
of candidate bounds, including the final Canvas storage round trip.

The original committed compositor also passes this control. All 36 complete
baseline/candidate RGBA hashes match exactly. At opacity 0.5, instrumented
composition `createImageData` pixel totals are:

| Field                        | Identity before → after | Perspective before → after |
| ---------------------------- | ----------------------: | -------------------------: |
| Sparse patch                 |           221,184 → 144 |              221,184 → 231 |
| Window boundary patch        |           224,640 → 720 |              224,640 → 474 |
| Transparent clearing pigment |           221,184 → 144 |              221,184 → 231 |
| Low coverage                 |           221,184 → 144 |              221,184 → 231 |
| Empty                        |                   0 → 0 |                      0 → 0 |
| Dense                        |       224,640 → 224,640 |          224,640 → 224,640 |

These count conversion-image pixels, not total process memory or native sampling
work. Dense output stays complete; no source downsampling or input dropping is
involved. The initial control omitted final Canvas storage quantization and
reported differences; the corrected complete control passes both implementations.
An initial perspective boundary patch landed outside the target, and low coverage
at opacity 0.23 correctly rounded away. The final fixture keeps the boundary
visible and explicitly verifies that low-opacity zero-change result. All initial
reports are retained rather than treated as accepted checks.

## First ordinary-production pair

Six ordinary release workflows use actual pointer timestamps and new matching
foreground pixels without developer globals or CPU sampling. Complete foreground
hashing occurs after timing; readback is included. Twelve samples make p95 the
maximum, so these observations do not establish sustained or physical display
acceptance.

| Target                  | Median before → after | P95 before → after |
| ----------------------- | --------------------: | -----------------: |
| Affine raster           |        64.4 → 60.4 ms |     80.5 → 85.3 ms |
| Affine ordinary mask    |        68.6 → 61.2 ms |     89.1 → 79.8 ms |
| Affine filter mask      |        71.8 → 70.0 ms |     88.5 → 90.0 ms |
| Projected raster        |        89.0 → 88.7 ms |   114.3 → 114.7 ms |
| Projected ordinary mask |        89.2 → 89.1 ms |   131.3 → 130.6 ms |
| Projected filter mask   |      104.6 → 110.5 ms |   165.0 → 164.2 ms |

Every one of 72 complete foreground hashes and six final PNG exports matches
exactly. Original source bytes, all twelve accepted points and exact one Undo /
Redo survive. No long task is observed in these small gestures. Latency is mixed;
this is verified composition-work reduction, not a universal speedup or completion
of the ≤33 ms live-input p95 / <50 ms routine-task targets. The sustained all-tool,
physical device, process-memory and all other unfinished original roadmap gates
remain required.

## Verification and reproduction

The final source builds successfully with `npm run build` on Node 26.13.0.
All 122 affected browser cases across 17 files pass in one complete run without
retries, skips, failures or flakes. Coverage includes native wet coverage and
mixing, resident/evicted fields and storage, previews and owned leases, all paint
targets, reflected/projected gestures, distant 50 MP original-source edits,
project/workspace/SVG/Photoshop retention and cancellation. The two complete-output
native control cases are included in that final run.

Use the ordinary `npm run build` and `npm test` workflows, the affected wet and
renderer browser tests, and `npx playwright test --config playwright.wet-feedback.config.ts` for normal-production feedback. Exact dated
configurations, baseline-source override, complete reports, per-case artifacts,
release/source identities and comparison scripts are retained in the compact
evidence receipt. Larger artifacts remain local with byte counts and hashes.
Raw ZIP archives remain ignored under the benchmark storage policy.

The full `npm test -- --maxWorkers=2` run passes all **3,185 unit/API/native
tests across 310 files** on Node 26.13.0. The actual WASM built for the unit suite
matches the browser release kernel exactly. No application source changed after
the accepted release build and complete browser run.

## Final counterbalanced production pair

The candidate runs first and the unchanged baseline second, after all broad
checks finish. Both six-case runs pass without retries, skips or flakes.
All 72 complete foreground hashes and six final PNGs match again, with source
bytes, twelve accepted inputs and exact one Undo/Redo retained.

| Target                  | Median before → after | P95 before → after |
| ----------------------- | --------------------: | -----------------: |
| Affine raster           |        56.3 → 60.8 ms |     81.9 → 80.8 ms |
| Affine ordinary mask    |        56.0 → 61.9 ms |     82.5 → 85.6 ms |
| Affine filter mask      |        72.2 → 72.1 ms |     85.8 → 86.9 ms |
| Projected raster        |        86.6 → 87.5 ms |   114.7 → 115.2 ms |
| Projected ordinary mask |        98.8 → 90.6 ms |   147.4 → 131.0 ms |
| Projected filter mask   |      104.0 → 103.9 ms |   166.9 → 164.1 ms |

Final projected-mask median/p95 changes 98.8→90.6 / 147.4→131.0 ms, while
projected filter-mask median is flat at 104.0→103.9 ms and other controls vary.
No long task is observed in these small final gestures. Both complete pairs
remain recorded; no universal latency or process-memory conclusion follows.
Every measured p95 remains above 33 ms. Full sustained all-tool/device and every
other unfinished original roadmap gate remain required.

[Compact evidence archive](projected-wet-composition-2026-10-31.json.gz):

- Compressed bytes: **1,144,511**.
- SHA-256: `474cd77917f6f193eed07edee3d81c45e730209a95c1fb5795f9c24785bbb03c`.
- Retained artifacts: **280**; reconstructable changed files: **5**.
- Every artifact in this run fits the receipt; no larger local-only reference is needed.
