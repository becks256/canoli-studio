# Native float drop shadows — 2026-10-29

Baseline: `6ad52131549cfa6d84c622024a9025b317bc8eef`. This accepts a bounded
raster/isolated-group shadow increment. Full F10/F14 and the original roadmap
remain active. [Public defaults, ordering, example and limits](../FLOAT_DOCUMENTS.md#native-float-drop-shadows).

Float shadows use original-derived intrinsic alpha after own erasures/mask and
before own Fill/styles/opacity. Root-plane finite three-sigma Gaussian axes store
float32 after ordered float64 sums; fractional offset follows convolution.
Foreground overlay precedes normal foreground-over-shadow composition. Blend If
evaluates the completed appearance; final layer blend/opacity applies once.
Clipping-base shadow shape excludes members and base Fill. Child appearance
contributes to group intrinsic alpha. Disabled/zero-opacity shadows retain the
previous exact path. Direct adjustments have no intrinsic silhouette and require
an isolated artwork group. Existing OO/command, isolated grants, revision/history,
source validation, project/workspace and recipe boundaries remain.

Working budgets are independent of source geometry: native alpha requests contain
at most 262144 samples; output blocks are at most 128 by 128; source halo reads
use 32-row bands; the horizontal intermediate contains alpha only. The Gaussian
alpha LRU is capture-local, at most 16 MiB, and clears on disposal. This is not a
global process-memory limit or a source-resolution limit.

Verification used Node 24.0.1, AssemblyScript 0.28.20, TypeScript 7.0.2,
Playwright 1.63.0, Chromium 153.0.8010.12, NumPy 1.26.4 and the pinned native Linux
Little CMS 2.19.1 reader on Linux x64. No paid or external account operations.

- Full `npm run build` passes. All **2957 unit/API tests across 289 files** pass,
  including actual WASM, malformed native/protocol results, owned transfers,
  readiness/disposal/retry, strict public transactions and real REST subprocesses.
- All **41 native-browser cases across 10 files** pass in one frozen complete
  matrix, with no retries, skips, flakes or failures. Runtime/source identities
  remain exact throughout the run. Final guide verification adds one passing
  narrow-screen, JavaScript-disabled browser case.
- All **179 normal-production workflows** pass in one complete run without
  developer globals, retries, skips, flakes or failures. Production source and
  full release hashes remain exact throughout. The final release has
  **143 files** indexed by SHA-256.
- Seven independently generated complete Gaussian alpha planes match exactly
  (2261 output values). Sigma zero, fractional/maximum sigma, both axes, constants,
  subnormals and source ownership are covered. Additional whole-versus-partition
  checks cross both 128-pixel output seams; cache reuse/eviction/disposal and
  cancellation preserve output and prevent stale publication.
- Eleven independent complete native scenes match all **455356 RGBA channels**
  exactly, including alpha words. Their **111540 half-size frame channels** and
  partitioned reads are exact. Cases include masks/density/inversion, zero Fill,
  fractional/negative offsets, sigma 128, exact affine quarter-turn placement,
  clipping-base shape, isolated/nested groups and completed-appearance Blend If.
  Original hashes, one-step Undo/Redo and project reopening are exact; a workspace
  version/restore retains the authored shadow and native output.
- Real Inspector controls, preview cancellation, one Undo, the documented isolated
  script, adjustment-only shadow disabling, exact originals and reopened projects
  pass in source and production. Independent libtiff/Pillow/MuPDF and native CMM
  readback match every sample in float32 TIFF, 16-bit TIFF, PNG and PDF, with exact
  embedded profiles. A recorded edit replays on a receiving original after author
  closure and matches its independently decoded native float TIFF exactly.
- The real **10000 by 5000** source retains its complete original hash
  `51db60ac1377c69a75fc49328cbcca09a62e663dd277e08c967f85a3c792ac1c` and
  native geometry, with a separate 500 by 250 preview. At zero Fill the witness
  contains **6912 visible native pixels outside the source mask**.
  The exported PNG has **711928 visible pixels**;
  all **200000000 channels** match the independent complete reference exactly.
  The streaming oracle verifies every original alpha is opaque and derives the
  zero-Fill shadow from native source bounds/mask/Gaussian math; it does not use
  editor/display/WASM pixels. Original preservation and Undo/Redo pass.

The 50 MP shadow workflow took **595.189 seconds**, only
**4.811 seconds** inside the existing 600-second deadline. This
includes import, witness/preview, export and independent readback, with no phase
breakdown. It establishes correctness for this fixture, not interactive latency,
60fps, a speedup, or a causal explanation of the slow path. Profile and improve
large masked/empty-halo/native-composition work while preserving these exact
samples and the unchanged deadline. F14/all-tool/device/global-memory acceptance
remains open; the broad original objective is unchanged.

Final review found the guide stated a 35% default instead of the actual existing
45%. The exact pre-correction source/HTML and correction receipt are retained.
A fresh full build changed only `developer/float-documents.html`; all application
JavaScript/WASM and every other release file stayed identical. The corrected
390 px/no-JavaScript guide and complete production suite pass. The native matrix
used the same product code; only that documentation default differs afterward.
No numerical tolerance or acceptance deadline was widened.

[Delta evidence archive](float-shadow-2026-10-29.zip) contains changed product source, new
fixtures, a baseline reconstruction patch including documentation, complete
changed-file identities, generated/release identities, build/unit and
complete browser reports, orchestration/audit scripts and new shadow artifacts.
Unrelated regression binary artifacts are indexed by hash/path. Manifest v3 uses
SHA-addressed payloads and references unchanged payloads in the
[parent archive](float-appearance-2026-10-29.zip), pinned to SHA-256
`d6a8f5437d04e203897d932128ec27eeb66d2a8e3fa15dac329f2e01b1f392d1`.
Every local/external chunk and reconstructed file is verified before publication.
Apply the tracked-change patch to the baseline and overlay the supplied source
files; verify every changed-file identity. `release/` reconstructs the
complete tested final distribution. The parent archive is required for referenced
unchanged payloads. Historical evidence remains intact.

The initial archive exceeded the conservative disk staging-headroom guard and
was retained only in the task RAM directory. Compact source reconstruction and
exact repeated-map chunk deduplication reduced duplication before publication.

Published delta archive: **6402810 bytes**, SHA-256
`29a5d4507fc6214560fa12c0ade7c4bbd089a6c15bc91f9f99374e04360eec7e`.
