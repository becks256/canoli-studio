# Native verification cache and vertical parent — 2026-11-05 UTC

Two isolated implementations extend main `ea27ff2`. The main engine is unchanged
at this checkpoint; both implementations, tests and their passing/failed evidence
are preserved in the [source receipt](native-verification-continuation-2026-11-05.json.gz).
The complete original goal and every unfinished roadmap requirement remain active.

## Reference-plane reuse

`/tmp/canoli-native-verification-cache-2026-11-05/` caches at most sixteen native
reference alpha planes inside one fallback matching operation. The source root,
coordinates, original fonts, palette and two opacity samples remain the same.
Every candidate still receives every exact pixel comparison and the final
per-color ownership check. Cache hits check cancellation and source/font
lifetimes; eviction only affects working storage. The cache clears on exit and
never supplies document RGB, glyph positions or a document/image import limit.

This implementation passes build/typecheck, all 3,428 unit/API checks, all 29
production workflows, all 64 CJK layouts and all 36 original independent Float32
references. Its complete 255-case source suite and original 384-layout matrix
are still active. All 3,967 frozen input identities remain unchanged at capture.
An upright colored control that previously timed out now finishes with a genuine
mismatch in 42.2 seconds; a sideways control still times out at the ordinary
60-second deadline. This does not close either layout or establish a speedup
across devices or workloads.

## Vertical source parent

`/tmp/canoli-native-vertical-parent-2026-11-05/` additionally derives a vertical
parent stream from retained original-font advances and the first native source
anchor. Native caret reads after a mark crossing a style boundary can address
later cells incorrectly; the prototype records those reads directly. Chromium's
platform-font inspection attributes the base/mark run to the first original span
and confirms both embedded source fonts, without an extra system-font fallback.
That inspection alone does not prove paint ownership; the exact ownership gate
still decides acceptance.

The implementation offers an additional preparation for straight upright Latin
runs with uniform metric styling and an authored boundary inside a grapheme.
It retains complete source text, font priority, GIDs, axes, colors and existing
preparations. The additional preparation skips scalar-splitting boundaries, mixed/bidi source
and unsupported item allocations. It computes each cluster anchor once, avoiding
a repeated source-range scan for every combining glyph. Positions come
from source advances and native geometry, never from reference alpha values.
Complete original ink at alpha 1 and 0.5 plus per-color ownership remain required.

Build/typecheck, all 3,428 unit/API checks and all 33 actual production workflows
pass. A focused browser test passes all four original upright identity controls:
both paragraph directions at zero and negative tracking. Each ordinary match
completes in approximately 12–14 seconds under shared load. The four new
production workflows retain source capture, visible native PNGs, isolated opacity
edits, exact Undo, exact original-bearing project reopening and no development
globals. All 3,971 frozen inputs remain unchanged at capture.

The expanded 256-case affected source suite and the original 64-case colored
cohort plus 36 independent paint references are still active. Affine prototype
controls still fail. No complete native typography, public transport, performance,
professional-editor, AI/provider/evaluation, live ChatGPT/identity, workflow or
commercial roadmap acceptance is claimed.

## Rejected diagnostics and preservation

Standalone horizontal-paint conversion, alternate metric domains and transformed
SVG-size proposals fail exact native ink. Splitting a base and mark into new
measurement spans changes the original ink; keeping the cluster together still
does not preserve the original complete affine result. None of those altered
measurement poses enter either implementation. Failed harness attempts and
corrected probes remain alongside their results in the receipt.

Source and tested releases are preserved by value under
`.canoli/checkpoints/native-verification-continuation-2026-11-05/`. The receipt
binds source, inputs, configs, reports and ongoing-run snapshots to their hashes;
its active-run logs are snapshots rather than terminal results. Earlier immutable
receipts remain unchanged. The [terminal main-baseline matrix](native-fallback-matrix-2026-11-05.md)
continues to record 346/384 exact layouts and the remaining 38 failures.
