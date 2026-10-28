# Pen viewport performance — 2026-10-28

This is a bounded T01/F14 improvement from `048926c`. Pen controls retain every
authored point, anchor, handle, line, DOM element and index. A control group
suppresses browser paint only when its entire finite footprint misses the
visible document plane plus 32 CSS pixels of overscan. The plane includes space
outside the artboard. Crossing handles remain visible; pan, zoom, resize and
edits invalidate the presentation bounds. Uncertain SVG coordinate precision
retains complete presentation. Visible marks keep their original paint order.

The public model, shared commands, undo, source resolution, exports, isolation,
permissions, schema and separate REST sessions have no contract change.

The observed bottleneck was Chromium's SVG layer construction rather than the
canvas renderer alone. A dense Pen trace spent 36,062.320 ms in 64 `Layerize`
events, with a 631.794 ms maximum. The final trace records 64.453 ms across 89
events, with a 1.720 ms maximum. These are separate instrumented runs, not a
physical display measurement or an all-editor speedup claim.

Three alternating comparisons used immutable compiled releases, one worker,
Chromium 153 and Node 24.0.1 on the same host. The wrapper checked all 142 release
file hashes before and after each phase and checked the served entry HTML.
The order was before/after, after/before, before/after. Actual reported rendering
backends were Canvas2D. No other heavy verification ran during these comparisons
or the full performance sweeps.

| Fixture | Pair | Canvas-copy p95 before / after, ms | Long-task count before / after | Worst task before / after, ms |
| --- | --- | --- | --- | --- |
| 1 path, 8,000 anchors | 1 | 61.7 / 46.4 | 33 / 2 | 685 / 61 |
| 1 path, 8,000 anchors | 2 | 52.5 / 44.3 | 34 / 2 | 663 / 53 |
| 1 path, 8,000 anchors | 3 | 63.5 / 51.3 | 34 / 5 | 669 / 66 |
| 2,000 paths, 4 anchors each | 1 | 65.3 / 74.7 | 34 / 30 | 210 / 102 |
| 2,000 paths, 4 anchors each | 2 | 70.7 / 62.3 | 35 / 28 | 212 / 108 |
| 2,000 paths, 4 anchors each | 3 | 59.0 / 67.4 | 33 / 30 | 241 / 97 |

The existing dense fixtures place many controls outside the viewport. Fully
visible high-density controls remain a separate stress case. Canvas-copy p95
does not consistently improve for 2,000 paths, and neither fixture meets every
33 ms live-input / 50 ms routine-task target. A copy timestamp also misses some
browser work after the copy; the original severe stalls demonstrate why the
long-task and trace evidence must accompany it.

The bounded implementation is accepted: the normal production build, all 2,862
tests in 285 unit files, all 175 normal-production browser cases, three additional
Pen-mask editing regressions, the 21-case focused candidate pilot and all
functional guards in the final 77-case, 31-file performance inventory passed.
Accepted phases have no skips, retries, flakies or unexpected failures. The
unchanged baseline inventory passed 75 cases in 30 files. Passing these guards
does not mean numeric latency budgets passed.

Ten actual compiled before/after viewport comparisons cover dense anchors,
reflection/shear, linked masks, reversed text baselines and off-artboard controls
at DPR 1 and 2, using fractional viewport origins. Browser decoding and an
independent Pillow reader agree on all 63,461,040 RGBA channels exactly. The
reader also checks that the known artwork background occupies the expected
image. Existing affine checks retain their original one-code bound. The new
artwork/mask UI checks retain all 131 anchors and 262 handles, revive a crossing
handle, verify real dragging and Escape cancellation, undo, off-artboard marker
pixels, pan, zoom and resize without changing accepted model geometry.

The inventory now includes real float Gradient Map and LUT inputs. Each records
20 paced keyboard/checkbox edits, requires the prepared model to match the input,
and checks actual canvas pixels against the independent palette corpus within
one RGB code, with exact alpha. Original SHA/dimensions and 20 undo operations
remain exact. Final copy p95 is 200.8 ms for LUT and 240.2 ms for Gradient Map;
verified readback p95 is 202.4 / 241.7 ms and includes verification/flush overhead.
These controls remain above target. The same final sweep also records a 190 ms
font-replacement task, 113 ms multi-path Pen task and 90 ms 50 MP clone task.
Async preparation, script initialization/transport, canvas copies, readback and
main-thread long tasks remain separate metrics in the raw reports.

The baseline and final complete performance sweeps sampled maximum descendant
PSS of 2,133,192,704 and 2,204,653,568 bytes respectively. This is not a measured
memory improvement. Samples include browser, renderer, worker, test and local
server overhead. RSS double-counts shared pages; 500 ms PSS samples can miss
transients, escaped processes and physical GPU allocations. They do not establish
a global peak-memory or physical-device budget.

Both complete performance sweeps have zero sampled nonzero-RSS processes with
unavailable PSS. The separate normal-production suite records two such sampling
gaps; both process identities are absent from the next sampled subtree. The raw
samples and qualification are retained, including the initial audit assertion
that exposed them. Production memory is not accepted as an exact peak.

Exploration is retained with its original results. CSS isolation and transform
hints did not remove the stalls. An explicit SVG clipping effect improved timing
but introduced two 2–5-code affine discrepancies in an 18/21 pilot; the unchanged
baseline passes all seven affine checks. The accepted approach removes that
effect and keeps the original paint hierarchy. A mask assertion was corrected
to the selected marker color after explicit selection, without changing app
behavior. Two early fractional studies served the wrong release and are excluded
from acceptance; corrected frozen-release studies and their earlier fixture
failure remain preserved. No failed or invalid phase is relabeled as a pass.

Pixel WASM remains byte-identical at SHA-256
`bd6a519864eb8c8893e1ff8ef23ce5da6b8910c39532467fae9828ba9b305311`;
the four tracked ICC, RAW, AVIF and lens binaries are unchanged.

The [sealed evidence](pen-viewport-performance-2026-10-28.zip) retains the source
overlay, baseline identity, final normal release, immutable comparison releases,
generated inputs, raw reports, traces, CPU profiles, memory samples, pixels,
failures, invalid-study receipts and verification scripts. Its version-2 manifest
maps logical file paths to SHA-256 payload chunks, byte counts and modes.

Full F14 and the original implementation roadmap remain open: remaining slow
paths, sustained whole-editor/all-tool responsiveness, fully visible control
density, physical GPU/display/tablet/device behavior and global memory acceptance
still need work, alongside every other unfinished roadmap milestone.
