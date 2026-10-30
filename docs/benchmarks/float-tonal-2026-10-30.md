# Native float Dodge/Burn verification — 2026-10-30

Baseline: `6716df5`. This advances F05/F10 within T20/T17. The full original
professional-editor roadmap remains active.

## Delivered behavior

Existing Dodge/Burn tools and TonalStroke constructors work in linear float
documents. Fixed-grid brush coverage includes pressure curves, tilt-shaped tips,
symmetry, selection clips and owned byte textures. Only coverage uses byte
surfaces; RGB stays native float through sequential exposure, masks, layer
appearance, Fill/opacity, blend interpolation and delivery. Pointer previews are
transient; Escape cancels, gestures/scripts share Undo, and Reset clears strokes
while retaining the tonal adjustment type.

The operator applies documented signed linear stop gains, with exact original
alpha. Default protection limits newly over-white positive peaks without
darkening existing HDR. It differs from the byte operator's existing roll-off;
Color Settings warns that converted strokes change appearance. Finite negative
and extended colors remain supported; overflow rejects output while editable
controls and history remain available. Neutral/uncovered/transparent identities
retain every native word, including signed zero. Empty work still validates.

Legacy byte-imported unsigned TIFFs prepare a separate native view of the same
retained original Blob. Conversion switches precision and source references in
one command, preserving byte bitmaps for exact Undo. Repeated raster references
share one prepared view. Source identity, page, source-color choice and geometry
are enforced at attached commit, including nested transactions and locked
layers. Mappings cannot substitute another original or rebind already-float
documents. Cancellation/stale work releases staged views. Unprofiled originals
still require an explicit color assumption; no byte-decoder assumption is
silently promoted. Recipe recording explicitly rejects conversions requiring
prepared source transport. Constructors, document schema and grants stay the
same; the existing precision command gains an optional source-mapping field.

## Numerical and lifecycle evidence

Independent NumPy fixtures cover all mode/range/protection combinations over
2,049 signed/extended RGBA samples. Scaled color error is bounded by 2^-22;
alpha words, ownership and awkward partition identity are exact. Actual WASM
tests cover native memory growth, invalid controls/pixels/coverage, overflow,
healthy retry, synchronous input capture and malformed worker replies.
Browser tests exercise transformed/masked textured strokes, exact fixed-grid
partitions, stale bitmap rejection, cancellation, original-bearing reopening,
isolated scripts and inert read-only plugin installation.

The small ordinary-UI workflow exports a 256 × 256 float32 TIFF through the real
dialog. Complete native libtiff/Linux-CMM readback compares all 262,144 samples
with zero different words and an exact embedded profile; 196,605 color samples
change under the independently defined stroke. Original source bytes and
reopened PNG output remain exact. Controls were inspected visually.

The new large-source interaction workflow uses a 400 × 300 document crop while
retaining a 10,000 × 5,000 raster and its original bytes. It restores the full
native canvas before export and readback. This checks cropped-area interaction
and complete native delivery; it does not measure uncropped 50 MP frame time.
The normal-production case passed in 246,311 ms: all 200,000,000 native samples
matched with zero different words, zero color error, exact alpha and complete
embedded profile. The independent scene changes 359,962 color samples. Native
TIFF: 81,113,736 bytes, SHA-256
`edb786c7ed43cca4ace02c87c3dc80bc77ecc98d3a36f84f5d3764e6e3d73c11`;
complete sample SHA-256
`a0b24e49d7d980d1d025d296862537adaac728b29106fe1b03f818d347dd67d9`.
Original bytes and exact project-reopened PNG output also passed.
The retained source is 2,150,238 bytes, SHA-256
`51db60ac1377c69a75fc49328cbcca09a62e663dd277e08c967f85a3c792ac1c`.

## Verification status

- Final application build passed: actual WASM, scripting runtime, font worker,
  notices, ChatGPT package, site, developer docs, TypeScript and production Vite.
- Final full unit/API run passed: 2,982 tests in 291 files, frozen source.
- Focused admission run: 9 passed. After the source-identity guard, all 4 affected
  conversion cases passed, including locked/nested rejection and exact Undo.
- Final affected browser matrix: 145 passed, zero retries/skips/failures,
  frozen source and release manifests. Includes complete native 50 MP clipping
  for both original source types and both TIFF precisions, exposure, zero-Fill
  shadows, pressure, tip/symmetry erasure, textures, source lifetimes, gesture
  authority and Layers keyboard behavior. Elapsed time: 1,869,371 ms.
- Final normal-production matrix: 185 passed, zero retries/skips/failures,
  frozen source and release manifests, without developer globals. Includes the
  new small and native 50 MP tonal workflows and all previous production cases.
  Elapsed time: 1,112,915 ms. The final build regenerated the two architecture
  documents corrected after unit verification; application/test code stayed
  unchanged through the final build and both complete browser runs.

The first broad run was deliberately interrupted (exit 130) to add the source
identity guard found during review. Earlier pilot failures and disk/layout
events are retained; they are not counted as passing checks. Generated worker,
server and mutable runtime outputs use retained task RAM paths because root
storage is constrained. Unused npm temporary cache files were relocated
losslessly with per-file hashes; canonical SDKs and historical releases remain.

## Retained evidence

[Verification archive](float-tonal-2026-10-30.json.gz): 4,870,728 bytes, SHA-256
`2c50030da01f95ceb0b1cd93025f596b5e9167c233abefc9b2c2f7a2b8479b92`.
It contains frozen source/release manifests, terminal results, complete reports,
native reader/workflow records, failures and per-artifact hashes. Large binary
outputs remain under the recorded task directories:
`/run/lock/canoli-float-tonal-2026-10-30` and
`/dev/shm/canoli-float-tonal-artifacts-2026-10-30`.

Native pixel WASM SHA-256:
`3fae89f07f6c3e66e21b62442bb16fc6f392882a8a53562fa7c7bf34dda325fa`.
Node 24.0.1, TypeScript 7.0.2, AssemblyScript 0.28.20, Vitest 5.0.1 and
Playwright 1.63.0. Native reference: Little CMS 2.19.1,
SHA-256 `dc021a3a70e82f88eadff2deff512d155f846a87935658f5313d7cbb3ef9bcc6`.

This verifies this operator and its connected local workflow. Broader float
tools, photographic/device quality, physical hardware WebGPU, sustained
editor-wide latency/memory, accessibility and every other unfinished original
roadmap/release gate remain open. No REST/browser synchronization or new image
resolution/import cap is claimed.
