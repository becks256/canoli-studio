# Conservative projective field culling — 2026-10-31

This advances F03/F06/F14 by avoiding native sampling for proven-empty scalar
and coupled wet-field windows. It preserves original resolution, complete field
precision, all input, output pixels and shared Undo. The full roadmap and
editor-wide performance targets remain required. The baseline is `5315447`.

## Measured cause and behavior

A real-pointer trace separates native append, preview construction, PNG streams,
asset admission and viewport preparation. Filter-mask viewport median is about
56 ms, compared with 30 ms for raster artwork. PNG stream writes/closes are about
0.1/0 ms and asset adds about 2 ms. Inspection identifies canonical side windows
whose mapped axis bounds overlap finite support while the actual quadrilateral
misses it. Those windows unnecessarily read prepared fields and run native work.

After the existing axis bounds test, a constant-sign homography may prove
separation on convex edge normals. Expanded native support, a dot/division
roundoff bound and projection tolerance guard a strict positive gap. Uncertain
denominators, nonfinite proof arithmetic and unknown support keep the established
native path. Horizon branches still split. Source/input origins, canonical grids,
complete bilinear neighbors, output/background and working budgets stay fixed.
External prepared-PNG validation, source lifetimes, cancellation and public
commands/history/isolation remain unchanged. No source extent or import cap is
introduced.

Matched filter-mask development traces reduce coupled-field calls from **29 to
13** and requested field output pixels from **1,960,400 to 878,800** across twelve
viewport preparations. Viewport median changes **55.65→51.35 ms**. These CPU/stage
traces include instrumentation and development React; they locate work rather
than establish production or physical presentation acceptance.

## Native correctness

All **47 focused native cases** pass on actual WASM, including four new tests:

- The measured 260×260 side window produces bit-identical zero five-channel
  output with **zero source reads and zero native packets**.
- Disjoint diagonal scalar windows retain exact backgrounds 0, signed zero,
  0.375 and 1.
- Grazing corners and one-row/one-column/one-pixel windows retain every
  fractional native border neighbor and perform required sampling.
- **144 complete-native differential cases** compare every float32 word across
  both directions, affine inputs, reflection, large origins and subpixel phases.
  Both nonempty and empty witnesses are required.

Existing independent NumPy scalar/coupled fields, horizon cases, fractional
backgrounds, distant/unbounded/50 MP support and exact irregular partitions stay
unchanged. The full-native differential control bypasses window culling, so it
cannot inherit an erroneous empty-window decision from the candidate.

Review added an explicit finite check for separating-axis projections, retaining
native fallback when proof arithmetic overflows. The in-progress broader browser
run was stopped intentionally and its report retained; final acceptance runs
against the guard. A pre-existing perspective-tool test expected Mixer disabled,
contradicting the committed projected wet tool. Its assertion now checks enabled
DOM/controller availability before and after reset. No product capability was
removed or tolerance relaxed to satisfy that test.

## First ordinary-production pair

The same six affine/projected workflows run on ordinary production builds without
developer globals or CPU profiling. Each uses twelve actual pointer timestamps,
new endpoint witnesses and matching foreground pixels sampled on animation frames.
Readback is included; complete frame hashing happens after timing. Twelve samples
make p95 the maximum. These small headless observations are descriptive, not
sustained or editor-wide acceptance.

| Target                | Median before → after | P95 before → after |
| --------------------- | --------------------: | -----------------: |
| Affine raster         |        67.2 → 72.5 ms |     86.7 → 96.2 ms |
| Affine mask           |        72.8 → 73.7 ms |     82.1 → 91.3 ms |
| Affine filter mask    |        71.6 → 85.3 ms |    104.6 → 97.9 ms |
| Projected raster      |        88.4 → 88.4 ms |   131.0 → 130.8 ms |
| Projected mask        |      104.3 → 104.4 ms |   147.5 → 148.6 ms |
| Projected filter mask |      122.2 → 106.3 ms |   197.3 → 181.7 ms |

All **72 complete foreground hashes and six final PNGs** match exactly. Each
operation retains original PNG bytes, twelve accepted samples, one Undo restoring
the whole prior document and exact Redo document/PNG. No long task is observed in
these small gestures. Control timings vary; this is mixed latency evidence, with
a measured reduction in targeted native work rather than a universal speedup.
The first candidate predates the additional finite-proof guard. Final build,
complete checks and counterbalanced ordinary-production results follow below.
Every measured target still exceeds **33 ms live-input p95**; full sustained /
all-tool/device/process-memory and all other unfinished roadmap gates remain open.

## Reproduction and evidence

Run the full build and `npm test`, the affected wet/scalar-field/projective-mask /
perspective/placed-mask browser files, and ordinary feedback with
`npx playwright test --config playwright.wet-feedback.config.ts`. Exact local
configurations, commands, source reconstruction, release identities, all initial /
interrupted/final reports, native and production artifacts and raw timings are
retained in the compact receipt. Large artifacts remain local with size/hash
references. New raw ZIPs stay out of Git under the benchmark storage policy.

The final expanded browser matrix passes **148 cases across 22 files** in one
run, with no retries, skips, failures or flakes. It includes real 50 MP byte and
float source/alpha workflows, all mask geometries/refinements, inverse/forward
transport, saved projects, SVG/Photoshop delivery, native storage and renderer
cancellation. The final fresh release builds successfully. All **3,185 unit/API /
native tests across 310 files** pass in one complete run on Node 26.13.0. The
unit and browser release WASM kernels match exactly. The final ordinary-production pair runs candidate first, baseline second.
Both six-case runs pass without retries/skips/flakes, preserving every one of the
72 foreground hashes and six PNG exports, source bytes, accepted inputs and exact
one Undo/Redo. The field trace on the final guard still makes 13 coupled calls.
The second-pair measurements are:

| Final counterbalanced target | Median before → after | P95 before → after |
| ---------------------------- | --------------------: | -----------------: |
| Affine layer                 |        62.9 → 59.7 ms |     81.4 → 80.7 ms |
| Affine mask                  |        61.7 → 62.7 ms |     80.8 → 84.7 ms |
| Affine filter-mask           |        72.1 → 72.1 ms |     94.0 → 87.4 ms |
| Projected layer              |        88.0 → 88.3 ms |   114.7 → 114.9 ms |
| Projected mask               |      103.0 → 103.3 ms |   147.9 → 143.5 ms |
| Projected filter-mask        |      120.6 → 105.1 ms |   180.9 → 181.0 ms |

The targeted projected filter-mask median improves in both pairs (122.2→106.3 ms
and 120.6→105.1 ms), while final targeted p95 is essentially unchanged at
180.9→181.0 ms. Controls and other tails are mixed. No long task is observed in
these small final gestures; that does not establish editor-wide absence of long
tasks. All live-input p95s still exceed 33 ms. The complete roadmap remains active.

[Compact evidence archive](projective-field-culling-2026-10-31.json.gz):

- Compressed bytes: **1,788,184**.
- SHA-256: `f6b913001d800599b55d6815b6d71b6d1d54ef525ed76d668f29dbf60f1c4238`.
- Retained artifacts: **415**; reconstructable changed files: **6**.
