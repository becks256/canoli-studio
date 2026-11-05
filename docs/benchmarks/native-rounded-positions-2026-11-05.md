# Native shaped and nominal position review — 2026-11-05 UTC

An additional private vertical preparation rounds shaped offsets/advances and
nominal offsets/advances together in screen pixels, using Float32 conversion and
ties away from zero. It restores positions with the captured run's units per em.
Original captured runs remain provenance; original fonts, full text, GIDs, axes
and colors remain authoritative. Every fractional preparation remains available.
Complete native ink at both opacity samples and exact color ownership still
decide publication. Public constructors, commands, schemas, scripting/REST
signatures and permissions stay unchanged.

The tested browser's pinned [shaping source](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/platform/fonts/shaping/harfbuzz_shaper.cc#L286)
contains this rounding mode. This motivates an additional preparation; it does
not prove the actual face-level subpixel flag. Reference pixels supply no
displacements or rounding rule.

The isolated review passes:

- Canonical build and current typecheck; all 3,428 unit/API checks in 346 files.
- Two focused tests containing eight earlier styled upright controls and sixteen
  original mark controls, with/without owned fallback, both directions,
  identity/affine placement and zero/negative tracking. Whole alpha and ownership
  match exactly; original source remains unchanged and private probes/faces retire.
- All 45 emitted production workflows, retaining every earlier 37 workflow.
  Eight new mark workflows retain complete fonts, opacity edits, exact Undo and
  original-bearing project reopening without development globals.
- All 48 independent fallback Float32 compositions, retaining every earlier
  42 colored scene and its overlap assertions. Six new single-color references
  exercise rounded positions directly, with signed/HDR RGB, tiny alpha, original
  FontTools glyph coverage, nonempty glyph overlap and exact partition words.
- A final documentation build and no-JavaScript production guide check. Only
  three emitted guide pages differ from the tested release; every other release
  asset remains byte-identical. Worker manifests change only the package hash
  after adding the already-reviewed canonical npm scripts. Worker JavaScript
  outputs remain identical. All six emitted WASM files match main.
- Canonical discovery selects 257 source cases across 46 files, or 264 tests
  across 48 files including every original fallback layout and 48 paint references.
  The original 384-layout matrix file is unchanged.

Retained diagnostics show that rounding shaped positions alone fails. Correlated
rounding matches the four previously failing upright affine mark controls, while
identity controls still require fractional preparations. Sideways diagnostic
combinations still differ and are not acceptance results. The prototype's fixed
fixture units are confined to its retained script; the engine uses captured units.

Failed pilots retain a TypeScript fixture check, a navigation/context loss during
worker regeneration, and an incorrect expected fallback cluster in new fixtures.
A separately passing colored variant did not exercise the new preparation; its
source/report is retained, and the final references preserve the exact original
single-color layout. A temporary external source configuration initially failed
module resolution before running tests; the corrected invocation preserves the
canonical filename selections. No tolerance or original assertion is relaxed.

The complete 257-case source suite and original 384-layout matrix remain required;
no new complete native aggregate is claimed. At review launch, main checkpoint
`0cf724f` remained unchanged while its earlier 256-case canonical source run was
live. Broad native/public/host/device/memory/performance and the complete original
roadmap acceptance gates remain open.

[Raw reports, source/test changes, diagnostic controls, frozen identities and verification script](native-rounded-positions-2026-11-05.json.gz).
