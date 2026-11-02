# Native float text development checkpoint — 2026-11-02

The existing OO TextLayer now connects to native Float32 scene paint through
owned original fonts, complete native ink/color ownership checks, shared commands
and history. Schema 60 explicitly versions the text/float combination. This is a
development checkpoint; broader typography and the entire original roadmap remain
unfinished. [Public contract and limits](../FLOAT_TEXT.md).

## Current evidence

| Check                        | Terminal result                      | Scope                                                                                |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| `npm run build`              | Pass                                 | WASM, isolated runtime/workers, typecheck, production assets/docs                    |
| `npm test -- --maxWorkers=2` | 3,427 pass / 346 files               | Complete unit/API suite, actual WASM and separate REST                               |
| Focused native browser run   | 11 pass                              | Connected tool/Inspector/scenes/transport/ownership/file/50 MP window                |
| Production browser run       | 21 pass, no skips/flakes             | Actual UI and native output without development globals; emitted native dependencies |
| Complete affected source run | 240 pass / 38 files, no skips/flakes | Previous 225 native cases, 11 connected workflows, 4 legacy isolated refusal cases   |

The complete source run takes 28.7 minutes on this host. A hash audit confirms no
engine/test/script drift during it. It includes ordinary byte 50 MP text/RAW
regressions as well as the new native-float edit-window case. The older pre-public
native-span checkpoint separately passed build, 3,424 units, seventeen production
and 225 source cases; it is dependency evidence, not the current result.

The trusted Text tool retains the exact bundled Manrope WOFF2 source in its
layer transaction, selects after commit, and supports whole-layer and selected-
character signed/HDR colors. Tests cover Undo/Redo, project reopen, actual guide
execution, inert plugins/denied writes, semantic recipes, redo-only workspace,
affine groups, masks, sibling clipping, overlays and shadows. Independent native
Canvas glyph coverage and Float32 composition match every RGBA word in a delivered
128×96 TIFF read by native libtiff. The production UI test independently reads
both complete 131×79 outputs with libtiff and verifies source/model/history and
reopened word identity. It does not independently rediscover all native layout.

The genuine 50 MP case retains 10000×5000 document/source geometry and every original
file byte. All 16,384 edit-window words match original-font native coverage composed
over the native base, with visible ink and exact Undo/Redo. This is a 64×64 window,
not full 50 MP rendered-output or process-memory acceptance. Existing source-font
and RAW regressions retain their separate original/reference checks.

Cache checks cover caller-owned output copies, wrapper-only reuse, private font
mutation rejection on pixel hits, restored-registration retry, cancelled waiter
reuse, owner retirement, exact window partitions and no leaked private fonts.
Warm isolated 64×48 cell reads measure 1–1.4 ms on this host after removing redundant
synchronous per-row checks. Cold preparation, movement, dense text, editor-wide
latency/long tasks, total process memory and device/GPU acceptance remain open.

## Failures and corrections retained

The first UI experiment selected inside a pending synchronous transaction;
selection now follows commit. Its harness also assumed Redo restored selection
and clicked outside the centered artboard; corrected interactions explicitly
select the restored layer and click inside the document. An independent Canvas
reference hardcoded a baseline; original-font measurement fixes that reference.
The corrected native alpha comparison has zero error. One earlier run recorded
two one-byte overlap differences and different ink counts; those diagnostics are
retained rather than accepted as precision behavior.

The first full unit integration run passed 3,426 and failed one obsolete blanket-
text-rejection error assertion. Corrected assertions retain atomic refusal for
missing original fonts; the complete 3,427-case rerun passes. A temporary Playwright
configuration resolved its relative testDir under /tmp and ran no cases; absolute
paths corrected discovery. The first production run passed 20 and failed the old
no-JavaScript guide assertion that float text was unavailable. The updated test
checks schema 60, original sources, linear paint, explicit remaining 384/36 gates
and separate headless REST; all 21 production cases then pass. Raw logs remain.

## Curved original-span work remains unaccepted

An isolated source override retains original raw fragment advances before
whole-span rounding on curves and complete-source assembly for multiple original
spans. Six of the original eight direction/affine/font-stack controls match exact
native ink and color ownership. Both transformed RTL controls remain unresolved;
retaining authored spans separately still hits the real 60-second matching budget.
No experiment is ported into this checkpoint.

Native span-opacity diagnostics preserve text, original font choices and complete
layout. The remaining single-font error is in the first `AV ` span; combining-mark
and final spans match independently. Independent native paint-command recordings
show different internal paint origins. They are diagnostic-only; CDP adds no
runtime dependency or placement authority. No coordinate is fitted from pixels.
Plain/positive-spacing source controls do not yet establish the correct parent
rule. Chromium's [text painter](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/paint/text_fragment_painter.cc),
[fragment transforms](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/layout/inline/fragment_item.cc)
and [SVG layout source](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/layout/svg/svg_text_layout_algorithm.cc)
were consulted as primary implementation context. These current source snapshots
are not proven identical to the tested Chromium 153.0.8010.12 binary. The candidate
parent model remains an inference requiring native verification.

## Retained artifacts and remaining scope

[Compact receipt](native-float-text-2026-11-02.json.gz) binds source hashes, tests,
compiled preview, raw run reports, independent output checks and failed/corrected
experiments. Raw artifacts stay local; no benchmark ZIP is added to Git. Current
raw results are under `/tmp/canoli-float-text-integration-2026-11-02/`; isolated
curved experiments are under `/tmp/canoli-native-curved-spans-2026-11-02/`.

All 384 fallback layouts/36 independent references, cross-span/default-ignorable/
split-mark/missing/intrinsic/native/legacy/optical/host cases, complete public
paragraph/path/vertical/reflow/proof/transport/delivery acceptance, sustained
editor-wide/device/GPU/process-memory performance and all remaining professional-
editor, photographic, precision/workflow, provider/installed ChatGPT/live identity/
commercial and original roadmap gates remain required. No complete typography,
release or full-roadmap acceptance is claimed. Original-resolution policy,
isolated/plugin grants and independent REST/browser sessions are retained.
