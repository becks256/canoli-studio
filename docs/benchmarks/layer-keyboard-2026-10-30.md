# Layers tree keyboard verification — 2026-10-30

Baseline: `b238970`. This is an F13/T22 increment; the full original roadmap remains active.

## User-visible behavior

Arrow/Home/End and name search move tree focus independently of selection. Right/Left expand/collapse or enter/leave groups. Enter selects, Space toggles, Shift extends ranges, Mod+Shift adds a range, and Mod+A selects visible matches. Filtering keeps ancestor context navigable without including nonmatching context groups in ranges/select-all. Fixed widget keys are defined in `src/ui/shortcuts.ts`; editable fields and external canvas shortcuts retain their existing behavior. Active row buttons remain reachable by Tab, including narrow panels, and keep native activation and shared Undo.

Actual document object identity, visible order and ordered selection own range anchors. Synchronous external selection publication revokes stale anchors, including change-and-restore and delimiter-colliding imported IDs. Identical-ID document replacement rejects old UI events. Removed focus repairs to a parent/nearest row; Undo repopulating an empty tree restores row focus.

## Before/after and discovered failures

The original real-browser ArrowDown reproduction moved the selected artwork's Y from 0 to 1 and increased history from 6 to 7 without changing selection. The candidate instead focuses the next row with identical artwork/history/selection. Early pilot failures exposed native Tab skipping the hidden lock button; keeping active controls visible through tree focus state fixes the focus transition. A later isolated real-browser regression found Undo restoring rows while focus remained on the empty container; explicit container-to-row transfer fixes it. All early results are retained, including the initial probe discovery failure caused by scanning an unrelated restricted temporary directory. A standalone browser probe ended before creating a page and supplied no product evidence.

The first broad regression and production runs were deliberately interrupted (exit 130) after that last defect was reproduced. Later runs caught an old canvas-nudge test pressing arrows while focus was in the new tree, and the large-float helper trying to save while reopening still showed Working. The nudge test now explicitly focuses the viewport; the float test waits for Save to become enabled before checking the reopened frame and saving. Those runs were stopped to correct these test assumptions and remain partial observations. Final validation below uses the corrected frozen source. Application code did not change after the final build/unit run; final TypeScript checking includes all test corrections.

## Final verification

- `npm run build -- --outDir /run/lock/canoli-layer-keyboard-2026-10-30/release --emptyOutDir`: passed, including actual WASM, scripting runtime, docs, site, ChatGPT package, TypeScript and normal production Vite build. Existing browser-externalization/chunk/directive warnings are retained in the archive.
- `npm test -- --maxWorkers=2`: 2,961 tests passed in 290 files after the final application correction.
- Focused keyboard browser suite: 17 passed, zero retries/skips/failures; the final reviewed run repeats these cases and the corrected development text workflow, all 18 passing.
- Affected browser matrix: 95 distinct cases validated. 93 passed initially; all 9 workspace cases passed on a fresh shared-memory rerun, covering both initially empty reloads. The initial suite exited 1 and is retained; this is combined case coverage, not a claim that the first suite was green. Includes keyboard, filter, rows, selection/gesture authority, transforms/alignment, spacing, shortcut rebinding and workspace layout.
- Normal-production coverage: 183 distinct cases validated against the recorded release without developer globals. 181 passed in the full run; the initial 50 MP Photoshop mask browser crash and text-geometry focus assumption were rechecked separately after that run, with shared-memory handling and a 120-second expectation budget for large preflight. Its earlier isolated rerun timed out at the ordinary five-second preflight assertion. The text helper explicitly focuses the canvas before nudging. All original pixel/source/Undo/reopening assertions remain. The initial suite failure and both rerun results are retained; this is combined case coverage.
- New 50 MP keyboard workflow passed in development and production: imported original 10,000×5,000 PNG bytes and dimensions remain exact; navigation preserves complete model and PNG; native Space visibility changes pixels; one Undo restores model/PNG; a distinct replacement marker proves actual saved-project reopening, retaining exact source/model/PNG.

Source identities match before/after every reported browser run, excluding generated benchmark evidence and the work log. Compared with current source, the initial affected/production runs and workspace rerun differ only in the later text-geometry test helper focus correction; application code is identical. The serial production rerun and reviewed development tests match current source exactly. The earlier 17-case focused pass uses the same application code; its only later source differences are the canvas-focus and float-completion test corrections. Final TypeScript checking passed after all test corrections. Production release files match the captured release manifest and the separate mutable runtime copy. Historical releases/source/SDKs were not changed. Root `dist` points to `/run/lock/canoli-layer-keyboard-2026-10-30/runtime-dist-final`. Temporary cache work preserved original parent and IPC endpoints; two actual TSX probes returned 17.

## Evidence and limits

The full initial browser suites exited 1; passing reruns provide explicit combined coverage, not a single clean full-suite result. This limitation is retained in the machine-readable coverage record.

Temporary overrides omitted the repository's shared-memory setting. Isolated reruns restore it; timing/resource failures are retained rather than classified as proven application defects or silently retried. No default product import limit was added.

Git staging subsequently exhausted the root disk. Only three ignored files generated
by this task were preserved in RAM with their original paths retained as symlinks:
the TypeScript incremental cache, generated public plugin ZIP and generated site
bundle. Every byte hash is unchanged, the ZIP matches the verified release, the
compiler still passes, and the original site entry point serves HTTP 200.
Source, SDKs and historical releases were untouched. See the separate
[runtime preservation record](layer-keyboard-runtime-2026-10-30.json).

[Compressed reports, manifests and workflow records](layer-keyboard-2026-10-30.json.gz): 485,628 bytes, SHA-256 `bedf1337b317a0b4c4d3651f9113430919c1e491ba22dc99e297f9aaf4a01481`. This retains terminal results, report metadata, test errors, frozen source identities, release hashes, artifact hashes, exact-source workflow records and build/unit logs. Large inline attachments are represented by exact byte counts/hashes and original-report references; full original reports remain in the task directory. Large generated exports remain in the task directory; original fixtures remain in the repository. No new latency improvement or broad performance acceptance is claimed. Full screen-reader/WCAG, physical-device, hardware WebGPU, sustained editor-wide performance and all other unfinished roadmap gates remain required.
