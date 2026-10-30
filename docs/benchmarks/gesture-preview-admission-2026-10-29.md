# Direct pointer preview admission — 2026-10-29

Baseline: `902cb47924bb6fc3244d7c968f5c8d5c79916a69`. This is measured progress
within F14. The full professional-editor/AI/provider/workflow/installed ChatGPT/
live identity/commercial roadmap remains active.

## Result and mechanism

The existing shared-command path now prepares one detached pointer preview before
React updates the controls/overlays. A private channel pins the actual Document
owner, immutable source revision, ordered selection and gesture token. React and
the canvas use the same validated snapshot, avoiding repeated validation or a
duplicate frame after layout. The single-active drain coalesces later inputs at
the existing per-gesture frame boundary. A first warm preview with a stable,
already-presented context can start without another frame wait.

Detached previews never change attached artwork/history or retarget a different
owner/source/selection. Clearing and changed authority reject stale frames even
before the next React target. Equivalent ordered selections remain valid. New
owners and view-only work retain normal admission. Actual OO commit, one Undo,
source resolution, native rendering, proof/source/asset/font/backend checks,
paint/wet lifetimes, API/schema and isolated/REST grants remain unchanged.
[Architecture](../ARCHITECTURE.md#direct-pointer-preview-admission).

## Normal-production measurements

Three sequential baseline/candidate pairs use fresh normal-production contexts
without developer globals. The unchanged scenario checks 12 real pointer inputs
against complete independent alpha frames, the following animation-frame
opportunity, native TIFF originals, zero Fill, a linked hard mask, fractional
Gaussian shadow placement, and one Undo/Redo. Heavy functional verification
finishes before these timing runs begin.

| Pair | Baseline p95 | Candidate p95 | Drag long tasks, baseline / candidate |
| --- | ---: | ---: | ---: |
| 1 | 50.7 ms | 30.1 ms | 0 / 0 |
| 2 | 38.5 ms | 28.5 ms | 0 / 0 |
| 3 | 50.7 ms | 30.3 ms | 0 / 0 |

Across 36 inputs per build, nearest-rank p95 changes from **50.7 ms to
30.1 ms**. The candidate meets the unchanged 33 ms measurement target for this warm fixture.
No drag-period long tasks were recorded in these six runs. These are local observations, not a statistically powered,
physical-display, continuous-60fps, cold, large-layer or all-tool/device guarantee.
Import remains about 120 seconds; other graphs, sizes and tools still require
broader F14 work. No threshold or deadline was widened.

Separate diagnostic production-mode builds use the existing benchmark flag for
stage instrumentation. They are excluded from the normal-production timing
comparison. Over the 12 actual inputs, median input-to-preparation changes from
9.3 ms to 0.5 ms; median preparation itself is
15.0 ms and 14.1 ms respectively. The final diagnostic build pins its
source and served-distribution hashes. The remaining preparation cost is not
claimed solved by this UI admission change.

## Verification

- Full build and final full rebuild pass. All 2,961 unit/API tests across 290 files
  pass, including detached-history preservation and atomic failure of a partially
  invalid shared preview transaction. A final frozen-source unit/API run also
  passes after the fixture/layout correction, with exact unchanged WASM bytes.
- All 44 affected browser cases across 11 files pass without skips, retries,
  flakes or failures. Exact complete pixels, paused-frame immediate admission,
  later-input coalescing and pending-input commit/Undo/Redo pass. Held previews
  respect selection changes and replacement owners; equivalent selection remains
  valid. Existing move/resize/rotation, cancellation/commit/switch/zoom/revision,
  committed-font/view/owner scheduling, float display/proof/source behavior,
  dense text cancellation, paint and wet-prefix/ownership checks pass.
- All 180 normal-production workflows pass, including original-native 50 MP
  Photoshop/PSD/ZIP/project comparisons, standalone interchange, source/mask,
  typography, rendering, history, isolation and float workflows. These functional
  checks do not establish latency for every tool or sustained use.
- Six additional normal-production pointer sessions pass independent pixel,
  original and single-Undo checks. One final diagnostic pointer session also
  retains all independent frames and exact Undo/originals.
- Source identities remain fixed across the affected UI matrix and final
  build/production/timing driver. Every production run retains complete served
  release hashes. Actual baseline UI/float source hashes are checked against
  `902cb47`. Renderer/native processing files are unchanged by this increment.

The earlier four focused cases passed before the pending-input commit assertion
was strengthened. The final UI matrix includes that stronger assertion. Early
candidate stage profiling informed the implementation; final acceptance uses the
frozen implementation and separate normal-production comparisons. The original
33 ms input and routine <50 ms main-thread targets remain unchanged.

The first complete production attempt passed 178 cases and failed the two account
browser cases before the editor loaded. Their identity host used the preserved
root distribution, whose individual external asset links correctly failed its
realpath containment check. The browser fixture now takes the explicit tested
distribution. Both account cases pass separately, followed by a complete fresh
180-case run. The generated root was also atomically changed to one complete,
mutable RAM runtime directory; all 143 public file hashes stay exact and the
historical reference copy remains untouched. Root output is ignored for both
ordinary directories and this generated pointer. Host security, application
identity behavior, source artwork and test deadlines were unchanged.

Builds and raw evidence use task RAM because workspace disk space is low. This
increment removes no source, toolchain, original or historical evidence and adds
no import limit. The ignored root distribution retains its previously preserved
content; accepted candidate builds are in the task's RAM release directory.

[Compact verification record](gesture-preview-admission-2026-10-29.json.gz):
520,897 bytes; SHA-256 `2083b8673d78badd735f3f7eb5d330bd6e242c5c197a1992cbdb6a611c93eee0`. Complete hash maps are
content-addressed to avoid duplicate storage. The record contains individual case
outcomes, build/unit terminals, source/release identities, per-input measurements,
independent reader receipts, raw-artifact hashes and exact task scripts/configs.
Full raw evidence is under `/run/lock/canoli-gesture-latency-2026-10-29`;
RAM storage is temporary. Reproduction requires the repository's pinned browser
and native readers: run the full build, `npm test`, the recorded UI matrix and
all production tests, followed by three sequential pairs of the production
`float shadow pointer` case. Diagnostic runs are separate.

The broader editor-wide/sustained/cold/import/device/process-memory F14 gates,
other float/HDR/color/interchange/layer/tool requirements and every unfinished
original professional-editor/AI/provider/workflow/installed ChatGPT/live identity/
commercial requirement remain active. The complete original roadmap remains active.
