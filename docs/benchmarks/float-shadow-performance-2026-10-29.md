# Float shadow source-read performance — 2026-10-29

Baseline: `153617a3e508d66f4883a3e42eb8b54f2ec9e77e`. This is measured progress
within F10/F14. **The 33 ms input target, import latency and full editor-wide
performance/roadmap acceptance remain open.**

The previous 50 MP shadow workflow nearly exhausted its unchanged 600-second
deadline. Actual browser profiling identified repeated original-derived reads,
including foreground reads at zero Fill. The candidate batches required halo
reads within the existing 262144-pixel working budget, coalesces output blocks
while bounding their vertical alpha input, and validates full alpha planes before
omitting zero convolution work. Gaussian alpha retention remains capture-local
and at most 16 MiB.

An unmodified raster on the native integer grid can omit unused zero-Fill
foreground reads and fully masked shadow-source reads after original preparation.
Groups, active raster effects/erasures and other affine projections retain their
intrinsic evaluation and hidden-color/domain/overflow failures. Artistic backdrop
validation and source/capture cancellation remain. Existing OO commands, original
ownership, Undo, scripts/plugins, native persistence and separate REST sessions
keep their contracts. [Exact semantics and budgets](../FLOAT_DOCUMENTS.md#native-float-drop-shadows).

Larger batches trade round trips for larger temporary planes: each halo RGBA
plane can reach 4 MiB, within the pre-existing 262144-pixel wire limit. There is
no full padded RGBA halo, no source-resolution cap and no new public pixel API.
The alpha-intermediate and per-request limits do not establish global memory
acceptance.

## Measured comparison

Same retained 10000 by 5000 original, controls and coordinate windows; same pinned
Chromium 153.0.8010.12, Node 24.0.1, AssemblyScript 0.28.20, Playwright 1.63.0,
NumPy 1.26.4 and native Linux Little CMS 2.19.1 on Linux x64. Timings are local
observations, not hardware-wide guarantees or a statistically powered study.

| Measurement | Committed baseline | Optimized candidate |
| --- | ---: | ---: |
| Native-profile import | 120.433 s | 120.716 s |
| Cold 2 MP scan | 36.571 s | 10.564 s |
| Original reads, cold scan | 1024 | 108 |
| Cumulative awaited original reads | 32.564 s | 8.689 s |
| Retained scan | 2.528 s | 0.927 s |
| Original reads, retained scan | 256 | 0 |
| Full 50 MP shadow workflow | 595.189 s | 226.145 s |
| Production pointer-to-matching-pixels p50 | 176.7 ms | 68.4 ms |
| Production pointer-to-matching-pixels p95 | 203.6 ms | 84.2 ms |
| Drag-period main-thread tasks at least 50 ms | 0 | 0 |

The native scan covers 256 fixed 128 by 64 windows with both visible and empty
shadow regions, then repeats against the same capture. Every round compares all
**8388608 RGBA channel words** by independent NumPy Gaussian/scene hashes. The
candidate and baseline windows are identical, including transparent words; source
hash, original geometry, host state and separate Undo/Redo remain exact. These
cold/retained labels describe the captured shadow-field cache, not a controlled
cold operating-system or native-reader cache.

Read and worker timings are cumulative awaited wall times, not exclusive CPU
costs. Baseline Gaussian calls account for about 0.509 seconds of the cold scan;
the dominant measured API time is original reads. Source-build CPU diagnostics
also include substantial development React work; normal production was measured
separately. The 120-second import bottleneck is unchanged and remains required
performance work.

The actual production UI test uses 12 real two-pixel pointer updates in one
native-size linked-mask drag on a 256-square original. It waits for the entire
canvas alpha plane to match independent Gaussian/native-CMM expected pixels for
each input and also records the following animation-frame opportunity. It tests
one-step Undo/Redo and exact original bytes through ordinary isolated commands
and UI/project controls, without developer globals. The baseline distribution is
copied and hash-verified before rebuilding the candidate. Source-mode comparison
modules are separately SHA-pinned fixtures from the same baseline commit.

This measures input-event dispatch to independently matching canvas pixels. It
does not measure physical display latency or establish continuous 60fps. The
candidate p95 **84.2 ms** still misses the unchanged **33 ms** target;
zero recorded long tasks in this small drag is not an all-tool jank guarantee.
The full 50 MP workflow includes import, native witness/preview, PNG export and
independent readback; it is an aggregate measurement, not a phase breakdown.

## Correctness and regression evidence

- Full `npm run build` and final TypeScript check pass. All **2959 unit/API tests
  across 289 files** pass in one complete run, including actual WASM, owned inputs,
  malformed alpha, empty-work caching, native budgets and cancellation/retry.
- A complete **46-case native matrix across 13 files** and complete **180-workflow
  normal-production suite** pass without retries, skips, flakes or failures.
  Frozen source and full release identities remain exact throughout both runs.
- All **3684244 native RGBA words across 89 shadow/appearance
  scenes** match actual accepted baseline streams bit-for-bit. Existing independent
  scene/frame/partition references, source/Undo/project/workspace and receiving
  recipe checks pass. The normal UI and isolated example preserve float32/16-bit
  TIFF, PNG and PDF samples and exact embedded profiles through independent
  libtiff/Pillow/MuPDF and native CMM readback.
- New real-worker tests preserve hidden zero-Fill/empty-mask group LUT overflow,
  normalized artistic backdrop failures, active raster failure after pixel-worker
  closure and cancellation after a real empty mask read. Shortcuts do not turn
  these into successful transparent publication.
- The original 50 MP source hash and geometry remain exact. The witness retains
  6912 visible native pixels outside the source mask. All 200000000 delivered PNG
  channels, its complete profile, and the PNG container itself are identical to
  the accepted baseline. The independent streaming oracle also checks complete
  original alpha; 711928 visible output pixels prevent transparent acceptance.

The first anchored drag-test selector selected no tests. Its terminal/error is
retained and excluded from acceptance; the corrected selector and complete final
matrix pass. CPU-profiled diagnostics are separate from unprofiled acceptance
measurements. No numerical tolerance or deadline was widened.

The workspace had about 2 MiB free. Before reclaiming its regenerable Vite
optimizer cache, no live Vite process used it. All 42 cache files (11769327 bytes)
were backed up and byte/hash-verified in this task's RAM directory before removing
only those copies. This task's development cache now uses that RAM directory;
source files, historical evidence and toolchains remain intact. No repository
server configuration change is needed.

The adjacent compressed JSON verification record contains source/release
identities, complete case outcomes, measured profiles, readers, baseline word
hashes, orchestration and raw-artifact hashes. Raw reports/artifacts remain under
`/run/lock/canoli-float-shadow-perf-2026-10-29`. The committed source, fixtures and
pinned inputs support reproduction; this compact record is not a standalone
copy of every binary or the complete generated distribution.

Full F10 precision/layer/tool breadth, HDR/working profiles/CMYK delivery, wider
interchange, import latency, remaining all-tool F14 timing/global-memory/device
acceptance and every other unfinished original professional-editor/AI/provider/
workflow/installed ChatGPT/live identity/commercial gate remain required. The
full original roadmap remains active.

[Compact verification record](float-shadow-performance-2026-10-29.json.gz):
**270859 bytes**, SHA-256
`3e0e4d9d713b974f8a8050a30acf9add822f016139d4aac2e06abb0bb3adb356`.
