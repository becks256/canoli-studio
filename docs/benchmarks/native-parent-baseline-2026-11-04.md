# Native fallback parent and baseline implementation — 2026-11-04

This is a developing implementation in isolated application copies, based on
main `919f2f6`. The current main engine remains the verified curved-span release.
The complete professional-editor roadmap remains active; these results do not
complete F08/F10 or the original 384-layout/36-reference acceptance requirement.

## Implemented preparations

The private source-parent preparation retains original font priority and full
source text, selects original owned font ranges, and accumulates source advances
on the native layout grid. It uses the original first-cluster anchor rather than
incorrect character addresses after a cross-span combining mark. It offers a
complete candidate only after source coverage and lifetime checks succeed.

An interleaved preparation also selects original authored span boundaries without
adding DOM nodes or changing the shaping text. In the affine cross-span case the
native mark can be a distinct original span item, retaining its original glyph
ID and font while using that item's source cluster and color. The earlier
identity-control grapheme result is retained; it was not a universal affine
itemization rule. Neither preparation fits offsets from comparison pixels.

The combined candidate also retains the separate visual-span and script-aware
vertical spacing work. Complete original ink at both opacity samples, original
font/axis identity and per-color ownership remain publication gates. Original
preparations stay available. No schema, OO mutation, scripting/REST permission,
source text, font priority or comparison tolerance changes.

A subsequent baseline preparation reads native font bounding metrics at the
actual screen font size. The native vertical line inherits its primary font's
central baseline; a fallback glyph's own central baseline can differ. The source
font metrics account for this cross-axis difference, including under affine
placement. The raw source-size correction fails the affine control; screen-size
metrics match it exactly. Source/candidate pixel differences supply no constants.

Actual production colored CJK exposed an additional allocation requirement:
original-span preparation must also run for zero-tracked straight vertical text.
The latest copy enables that existing preparation and now passes both previously
failing production workflows, including exact Undo and original-bearing reopening.

## Verified scope and failures

- Parent/authored implementation: all eight original horizontal direction,
  transform and tracking controls match full native ink and color ownership.
- All sixteen corrected focused tests pass, including 48 independent horizontal
  Float32 references. Every RGB, alpha and partition word matches; deliberate
  negative word spacing supplies genuine colored overlap. Original font/GID/
  context/source checks remain. The reference uses separately generated original
  glyph sources at the verified candidate poses; it does not discover poses.
- Seven new parent/authored cancellation/lifetime checks and existing span guards
  pass. Three baseline interruption/nonfinite checks reject, clean up and permit
  healthy original-source retry.
- Both developing implementations pass all 36 original independent paint
  references, including the vertical Arabic cases.
- The initial 24-reference harness produced exact numerical words in all rows but
  incorrectly required overlap in non-overlapping layouts. Its failure is kept.
  The corrected 48-reference test retains those rows and adds overlapping cases.
- The first combined 384-layout run is terminal: 2 tests pass and 5 fail, zero
  skipped/flaky. Matched statuses are marks 57/64, bidi 61/64, joining 61/64,
  CJK 30/64, axes 64/64 and cross-span colors 28/64. These counts are statuses,
  not a passing full matrix. Its diagnostic match deadline is 12 seconds.
- With baseline preparation, the original CJK matrix reaches 62/64 at the same
  12-second deadline. All 36 paint references still pass. This run has one
  passing and one failing test; it is not full CJK acceptance.
- The complete 64-layout CJK run at the ordinary 60-second deadline reaches
  63/64. Transformed RTL horizontal curve text with tracking -30 still times out.
  That real ordinary-deadline failure remains required work.
- Clean combined build/typecheck passes. All 21 existing production cases pass.
  Four new horizontal production workflows and the two earlier curved workflows
  pass with real source capture, native PNG, isolated opacity edits, exact Undo,
  complete document geometry and original fonts through reopening.
- The first baseline production attempt fails both colored CJK exports at the
  ordinary matching deadline. The zero-tracking span correction fixes both:
  LTR and RTL production workflows pass in 14.9 and 14.6 seconds. These are
  functional observations under shared load, not controlled performance claims.
- Full unit/API verification in isolated copies first exposed duplicate error
  classes from fixture-module symlinks, then a missing static build in the unit
  copy. Locally resolving fixture modules fix the first issue; supplying the
  verified build fixes all fourteen account HTTP checks. The unchanged 750-file
  source inventory binds these copies. Failed logs remain retained.

## Verification still active

The latest original-span correction builds successfully. All 3,427 unit/API
cases across 346 files and all 29 distinct production cases pass with zero skipped
or flaky production cases. Production coverage is the 27-case run plus the two
previously passing baseline cases, against the same unchanged source/release.
All 1,167 frozen engine/build/release identities remain unchanged. The complete
243-case affected source matrix is still active and unconfirmed. The preceding
baseline copy's 243-case source run is separately active; its eventual result
cannot replace verification of the latest correction. No active run is reported
as passed.

The original 384 layouts/36 references must all pass the final implementation.
Upright marks, transformed bidi/joining and remaining colored/curved fallback
placement still require work. Full public typography and transport, large-original,
quality/host/device/memory/performance and every other unfinished professional,
AI/provider/evaluation, installed ChatGPT/live identity, workflow/collaboration/
commercial and specialist roadmap gate remain required.

[Compact source and evidence receipt](native-parent-baseline-2026-11-04.json.gz)
retains complete changed engine/test source, diagnostic scripts/results, failed
and passing reports, original matrices and frozen source/release identities.
Raw artifacts remain in `/tmp/canoli-native-parent-implementation-2026-11-04/`,
`/tmp/canoli-native-baseline-implementation-2026-11-04/`,
`/tmp/canoli-native-source-integration-2026-11-04/`,
`/tmp/canoli-native-unit-verification-2026-11-04/` and
`/tmp/canoli-native-baseline-spans-2026-11-04/`. Engine changes remain isolated
until their appropriate integration checks are complete; the receipt makes the
implementation durable and reviewable in the meantime.

A by-value copy of the latest source and tested release is also retained under
`.canoli/checkpoints/native-parent-baseline-2026-11-04/`. Its 959-file inventory
binds the source, release and terminal unit/production reports; the checkpoint
explicitly records that main-engine admission and full source acceptance are
pending. The compressed repository receipt remains the durable source/evidence
artifact.
