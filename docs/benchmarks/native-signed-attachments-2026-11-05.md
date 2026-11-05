# Native upright attachment review — 2026-11-05 UTC

Review commit `bd15104` on `codex/native-signed-attachments-20261105` adds a
private preparation for zero-advance glyphs with negative native allocation.
Main's engine remains at `0a36bb8` while its original matrix runs. This is an
isolated implementation and verification checkpoint, not complete typography
or roadmap acceptance.

The preparation retains an attachment's original captured pose while advancing
glyphs use the existing span frame. It applies after source-span and visual-span
placement. Source runs identify zero advances; retained signed allocations
identify negative cells. Original glyph objects retain their fonts, GIDs, axes,
colors and full shaping context. No comparison pixels determine positions.
Every previous preparation and both complete opacity samples/per-color ownership
checks remain; the ordinary match deadline stays sixty seconds.

## Completed checks

The complete canonical isolated checkout passes build/typecheck and all 3,428
unit/API tests across 346 files. It also passes, without skipped or flaky cases:

- One browser test containing all eight original colored, straight upright
  controls: LTR/RTL, identity/affine placement, and tracking zero/minus thirty.
  This includes both previously failing affine negative-tracking controls.
  Complete original ink, color ownership, source families/context, unchanged
  document and zero retained probes/private faces pass.
- All 37 selected emitted-production workflows. The eight upright workflows
  retain actual native PNG output, isolated opacity edits, exact Undo and
  original-bearing project reopening without development globals. Four extend
  the prior identity workflows to affine placement.
- All 42 independent paint references. The original 36 scene keys remain, with
  six added affine upright controls covering both directions at alpha 0.5,
  0.64123012345 and 1e-8. Independent FontTools glyph coverage and source colors
  preserve every Float32 sample; full/partition output retains every word exactly.
  Each case has colored overlap, unchanged documents and signed/HDR RGB.

All 3,956 final frozen source/test/original/release identities remain unchanged
at capture. Only three of the 751 non-generated source files differ from main.
All six emitted WASM files match main. The complete seven-entry marketplace
package matches its manifest byte count and SHA-256; this is local packaging
verification rather than live installation acceptance.

## Diagnostics and initial correction

An extended-budget diagnostic on unchanged main exhausts both affine
negative-tracking searches with mismatches, rather than finding a later exact
candidate. That longer diagnostic budget does not change the product or tests.
The best rejected preparation matches full-opacity ink but fails half-opacity
and ownership where the mark overlaps later text. Retaining its captured pose
passes both checks. Alternate placements derived from negative fragment widths
fail; they are not integrated.

The first isolated implementation passes seven upright controls but misses the
RTL visual-frame preparation. Its production and independent runs are deliberately
interrupted before the correction: their partial results are not acceptance.
The corrected source passes all completed checks above. Initial sources, emitted
release and reports remain retained. One generated initial script runtime is
reconstructed from retained source and verified against its original frozen
SHA-256 without changing the active tested tree.

The browser revision and matching upstream source identities are retained as
diagnostic context. They do not establish a complete causal model of the browser
painter; exact runtime controls provide the acceptance evidence here.

## Required work still running or open

At this checkpoint, main's complete original 384-layout/36-reference matrix,
the isolated complete 256-case affected source suite and all 64 original colored
layouts remain active. Their captured logs are partial snapshots. No new complete
384-layout aggregate or full colored-cohort retention claim is made.

Uncolored affine marks, other fallback layouts, public/host/device/memory/
performance acceptance and every unfinished professional-editor, AI/provider/
evaluation, live ChatGPT/identity, workflow and commercial roadmap gate remain
required. Public constructors, commands/history, document schema, isolated grants,
independent REST and source-resolution boundaries are unchanged.

The [compressed receipt](native-signed-attachments-2026-11-05.json.gz) preserves
exact review sources, configs, frozen manifests, terminal reports, independent
audits, corrected/failed diagnostics and active-run snapshots. Earlier receipts
remain unchanged.
