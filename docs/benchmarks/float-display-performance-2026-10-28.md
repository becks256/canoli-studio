# Float display performance — 2026-10-28

This bounded T01/F14 increment starts at `ea1fa4a`. Repeated float previews
previously created a new native ICC display worker and used narrow 32-row
transactions even for a 256-square frame. The change batches display windows
within the same 65,536-output-pixel ceiling, with each axis at most 2,048 pixels,
and retains one idle prepared linear-sRGB-to-sRGB transform across renderers in
the same host realm. Native scene evaluation still precedes frame sampling and
the actual native ICC conversion. Original resolution, commands, Undo, file
contracts, schema, isolation and separate REST sessions retain their contracts.

The idle session still owns one of the existing two native slots. Queued
source/profile work retires it synchronously when it needs that slot; FIFO
admission and cancellation remain. Each borrow has its own abort/progress scope,
which detaches before idle retention. Symbols identify renderer ownership without
retaining a renderer, scene or source. Failed, cancelled, pending, closed and
oversized-scratch sessions do not enter the cache. Larger valid windows still
process normally. Renderer clear/disposal retires its idle session, while
explicit `IccSession.dispose()` continues to terminate immediately.

Attribution on the frozen baseline records 20 native display preparations during
each 20-input diagnostic, with median request times of 74.45 ms for LUT and
68.75 ms for Gradient Map. It also records 160 display-window requests per case.
Larger windows alone leave copy p95 around 176 ms. Retaining the actual prepared
transform removes repeated warm preparations and reduces the final control times
below. Diagnostic worker timings include messaging/startup and can overlap;
their sums are not a physical frame breakdown.

Three alternating comparisons use unchanged real keyboard/checkbox inputs and
independent palette pixel guards. Order: before/after, after/before,
before/after. Each case records 20 paced edits after initial document readiness,
the matching prepared model, actual canvas pixels, source SHA/dimensions and
20 exact undo operations. Rendering is Canvas2D on this host.

| Control | Pair | Canvas-copy p95 before / after, ms |
| --- | --- | --- |
| LUT | 1 | 219.9 / 100.9 |
| LUT | 2 | 213.7 / 89.0 |
| LUT | 3 | 218.2 / 88.6 |
| Gradient Map | 1 | 231.1 / 93.3 |
| Gradient Map | 2 | 224.6 / 96.3 |
| Gradient Map | 3 | 238.7 / 95.8 |

No long tasks were observed in these paced control cases, before or after.
The final complete performance sweep records LUT / Gradient Map copy p95 of
97.0 / 91.3 ms and verified readback p95 of 97.3 / 92.6 ms. Readback includes
verification/flush overhead; neither timestamp measures physical presentation.
These remain above the 33 ms live-input target. Initial preparation, cache misses,
eviction, contention and sustained high-frequency editing are separate cases.

The fresh baseline release is byte-identical across all 142 files to the
previously verified `ea1fa4a` benchmark release. Its sealed 77-case baseline
inventory remains valid; the new complete 77-case/31-file sweep passes every
functional guard. One host, six paired phases and one complete after sweep do
not establish editor-wide latency or memory budgets. No other heavy verification
ran during those timing phases. Every release was fingerprinted before/after and
the actual served entry HTML was checked.

The 31-case native matrix passes without skips, retries or flaky outcomes. Four
new browser tests verify all 16,400 output bytes of an independent native Linux
Little CMS 2.19.1 corpus, reuse across partitions/leases, detached old callbacks,
active/queued cancellation, idle eviction for actual original-source preparation,
renderer clear and recovery. The instrumented ICC/display and source-preparation owner count stays within
two; those workers retire at each new test's end. The corpus includes a
4,096-pixel float ramp plus four extended/hidden-RGB/alpha samples and imports no
editor/WASM code to generate expected words. Existing ICC formats, proof failures,
source repair, capture cancellation and nonlinear transformed-frame checks pass.

The same matrix verifies genuine 50 MP data: all 200,000,000 stored-source float
samples match independently, with zero differing words, and 500 complete RGB16
conversion-window digests match the independent reference with exact alpha.
These are bounded synthetic reference checks, not photographic/device acceptance.

Twelve actual compiled before/after image comparisons cover ordinary scenes,
clipping/masks and groups at 131×79, 256×256, 2,057×79 and 17×2,057 output sizes,
using a fractional region and affine root. All 3,280,284 RGBA channels match
exactly. Independent Pillow decoding of both PNGs agrees with the complete raw readbacks; nonempty-artwork, exact requested dimensions, unchanged model and
original-source guards accompany the hashes. This verifies the changed window
boundaries without downsampling the requested output or weakening pixel bounds.

The full unit suite and normal production build pass: 2,871 tests in 286 files.
All 175 final normal-production browser cases also pass, with no skips, retries,
flaky outcomes or unexpected failures. Source, generated inputs and all 142 served
release files match their frozen identities. The nine new unit tests
exercise owner eviction/fairness, exclusive leases, cancellation, failed output,
idle-worker failure, pending release, callback detachment and valid oversized
windows. Native tests supply the actual color/math evidence separately.

The complete after sweep reports a sampled descendant PSS maximum of
2,115,571,712 bytes; the separate native matrix reaches 3,513,344,000 bytes,
including large independent-reader/test overhead. The prior complete baseline
sweep reported 2,204,653,568 bytes. These are different sampled workloads, not a
global peak or a measured memory-improvement claim. RSS double-counts shared
pages; 500 ms samples can miss transients, missing/exited processes and physical
GPU allocations. Raw process identities and sampling gaps remain in the evidence.

Exploratory failures remain preserved: an occupied test port, a new unit fixture
missing its required legacy mode, test-only TypeScript corrections, a standalone
CommonJS top-level-await collection error, and a Python-version hashing-helper
error. The evidence packager also rejected an existing provenance symlink; a
verified regular copy retains its exact bytes and link receipt without weakening
the general symlink guard. The collection failures ran zero product tests. Corrected runs retain the
same pixel, ownership, latency and sample-count guards. Native-source tests use a
development server; their inherited comparison-build fingerprint is explicitly
qualified as not being proof of a served production release.

Pixel WASM and the four tracked native codec binaries remain byte-identical.
Pixel WASM SHA-256:
`bd6a519864eb8c8893e1ff8ef23ce5da6b8910c39532467fae9828ba9b305311`.

The [sealed evidence](float-display-performance-2026-10-28.zip) retains changed
source, generated inputs, normal/comparison releases, complete reports, worker
timelines, pixels, native references, process samples, failures and verification
scripts. Its version-2 manifest maps each logical file to verified SHA-256 payload
chunks, byte counts and modes. Prior evidence and original commits are retained.

Full F14 and the original roadmap stay open: remaining float latency, scripts,
font/document/retouch tails, sustained all-tool performance, broader precision and
photographic/interchange quality, global memory and physical GPU/display/tablet/
device acceptance, plus every other unfinished professional/AI/workflow gate.
