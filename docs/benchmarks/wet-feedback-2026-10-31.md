# Wet pigment storage and viewport feedback — 2026-10-31

This F06/F14 increment compacts private pigment storage and admits completed
Smudge/Mixer prefixes directly to the existing viewport queue. It retains
original resolution, every accepted input, complete native interpolation
support, prepared pixels, private frame leases and one shared Undo. The complete
roadmap and its editor-wide performance requirements remain open.

## Changes and exact-output checks

Carried float cells retain the complete intersection of native cell and dab
support, with explicit owned coordinates and stride. Original/destination cells
stay complete, including hidden RGB. Missing support and invalid stored planes
reject. Four-neighbor summation and Float32 rounding remain unchanged. Native
resident, evicted, zero-cache and custom stores keep their existing ownership,
transaction, cancellation and disposal boundaries.

A completed tool prefix may start rendering before surrounding React controls
update. Admission requires the same live document/source, host assets, proof,
view/backend and gesture owner, with a retained frame lease. React recognizes
that exact prefix and does not prepare it twice. New-owner/view transitions
keep normal admission; obsolete work cannot publish.

The actual-WASM reference generated before optimization contains six complete
changed-pixel outputs across tile sizes 8/16/128, reflected tips, pressure, tilt
and original-first symmetry. All results match exactly with zero and bounded
caches. This is a regression reference; separate independent bilinear equations
and dense/compact float-word comparisons cover native sampling. A custom-store
probe records all 17 carrier writes for a six-pixel brush: **1,600–1,760 bytes**
per cell, versus **262,144 bytes** for the former padded 128-pixel float cell.
Every stored extent equals the actual native working extent, 200 pixels change,
and disposal empties the store. This is storage-plane evidence, not a claim
about total process memory.

## Production comparison

One profiled before/after pair uses ordinary production builds without developer
globals, six affine/projected targets and twelve real pointer events per target.
Each new endpoint is more than three brush diameters from earlier visible ink.
Timing runs from the actual pointer timestamp to matching foreground-canvas
pixels sampled on animation frames; pixel readback is included. Complete frame
hashing happens after each endpoint's timing. Both releases use the same test.
CPU sampling is enabled in this pair and may perturb timing.

| Target | Median before → after | P95 before → after |
| --- | ---: | ---: |
| Affine raster | 99.0 → 67.6 ms | 119.5 → 86.8 ms |
| Affine mask | 91.9 → 72.6 ms | 128.8 → 96.0 ms |
| Affine filter mask | 99.9 → 87.5 ms | 174.2 → 116.8 ms |
| Projected raster | 111.1 → 102.7 ms | 172.5 → 135.9 ms |
| Projected mask | 134.4 → 118.7 ms | 164.1 → 147.8 ms |
| Projected filter mask | 143.9 → 124.5 ms | 197.2 → 197.1 ms |

All **72 complete foreground-frame hashes** and **six final PNGs** are identical
between releases. Original PNG bytes, twelve accepted samples per operation,
one Undo restoring the complete prior document, and exact Redo document/PNG
are checked in every case. No long task was observed during these small
profiled gestures. Twelve samples make p95 equal to the maximum; a single pair
is descriptive evidence, not a statistical or general performance guarantee.

These measurements still exceed **33 ms live-input p95**. They do not prove
60 fps, physical presentation, sustained editing, large-brush throughput,
photographic quality, other devices or bounded total process memory. Further
native preparation/preview/render latency work is required. Full F06/F14 and
all other unfinished roadmap requirements remain active.

## Reproduction

Run an ordinary `npm run build`, then:

```sh
npx playwright test --config playwright.wet-feedback.config.ts
```

Set `CANOLI_WET_PROFILE=1` to also capture CPU samples. The dedicated configuration
keeps these checks separate from development and benchmark builds that expose
`window.luma`. Reports retain actual raw timings, long-task entries, frame hashes,
native projects and exported PNGs; there is no absolute latency assertion that
would turn unmet performance targets into a green completion claim.

## Final verification and evidence

The full build passes. The affected browser matrix passes **116 cases across
15 files**, with no retries, skips, failures or flakes. It includes actual 50 MP
source preservation, native working stores/cache/quota failures, masks, private
leases, cancellation, selection authority and shared rendering admission.
All **150 rebuilt release files** retain their production-tested identities
except the corrected generated design-system guide; every runtime byte matches.

The initial complete Node 24 unit run passed 3,176 cases and failed five. Four
HTTP static-content assertions read an ignored `dist` symlink whose target was
missing; restoring it to the current release fixes their prerequisite. The
exhaustive brush texture reference exceeded its unchanged five-second timeout
at 5,107 ms. Aggregating its independent scalar error bound removes 262,144
matcher calls while preserving every exact WASM pixel comparison, source
ownership check, sample and tolerance. All 21 cases in those two files then pass
on Node 24. The original complete failure and corrected focused run remain in
the evidence. No application texture arithmetic or timeout changed.

The corrected complete suite passes **3,181 tests across 309 files** in one run
on Node 26.13.0. The browser matrix and corrected 21-case setup check use Node
24.0.1; all browser runs use Chromium 153.0.8010.12 on this Linux/WSL host.
All **six rebuilt ordinary-production workflows** pass without CPU profiling,
retries, skips or flakes. Their 72 complete foreground hashes and six exported
PNGs still match the pre-change release exactly. After observing higher absolute
latencies than the earlier profiled pair, the unchanged baseline was measured
again without profiling, on the same runner/runtime. This second pair runs
candidate first, baseline second. All medians and p95s improve in that pair too;
variation between pairs limits any general speedup claim. The 33 ms gate remains
unmet for every fixture.

The compact archive retains source reconstruction, release identities, native
reference/generators, CPU/stage traces, complete reports, raw samples and small
artifacts. Full failed/pilot logs remain alongside final acceptance; no accepted
browser run retries or skips a case.

| Unprofiled target | Median before → after | P95 before → after | Long tasks before / after |
| --- | ---: | ---: | ---: |
| Affine layer | 102.9 → 94.9 ms | 136.5 → 111.3 ms | 0 / 0 |
| Affine mask | 120.9 → 87.1 ms | 183.3 → 129.5 ms | 0 / 0 |
| Affine filter-mask | 125.0 → 121.5 ms | 194.5 → 161.0 ms | 0 / 0 |
| Projected layer | 162.5 → 131.3 ms | 229.4 → 180.9 ms | 0 / 0 |
| Projected mask | 162.3 → 143.4 ms | 203.8 → 198.9 ms | 0 / 0 |
| Projected filter-mask | 197.3 → 163.3 ms | 278.6 → 263.5 ms | 0 / 0 |

[Compact evidence archive](wet-feedback-2026-10-31.json.gz):

- Compressed bytes: **2,613,586**.
- SHA-256: `2d7b7dfd4301c06a168ecad7e143b9d7328377f5d9f09b116294184ad4ec67f8`.
- Retained artifacts: **393**; reconstructable changed files: **18**.
