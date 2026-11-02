# Native float mask editing and portable ownership — 2026-10-31

Status: verified implementation increment from `e1dc85e`; the complete original
implementation-roadmap goal remains active.

Brush and Pencil were unreachable from their default Layer target in float
documents even when the selected layer had an editable ordinary mask. Tool
selection now admits that workflow and switches an incompatible target to Mask
Hide. Existing Mask Hide/Reveal choices remain selected. The gesture guard still
rejects byte color painting on float artwork. Rail, shortcuts and command palette
share this behavior. Vector-mask Pen retains its existing target behavior.

## Verification

| Check                                   | Result                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Full unit/API/native suite, two workers | 3,216 passed, 0 failed, 312 files                                                        |
| Complete affected browser matrix        | 52 passed across 5 files; no skips, retries, flakes or runner errors                     |
| Normal production workflows             | 2 passed; no debug globals                                                               |
| Production build and typecheck          | Passed; final application assets compared against the tested build                       |
| Default test discovery                  | Source suite excludes production specs; production suite includes all 16 dedicated files |

The full Vitest suite reused the actual WASM produced by `npm test`/the build.
The sandboxed `npm test` run failed on blocked loopback listens and subprocesses;
the complete same suite passed with the required permissions. The first affected
browser matrix passed 51/52 cases; the remaining case lacked PyMuPDF in its Python
environment. The complete corrected 52-case run uses the existing verified PDF
reader environment. Earlier reports remain in the receipt.

The 17 new source cases verify:

- Every native float word through both initial linkage states across all five
  mask kinds, including HDR RGB, fractional alpha, Undo/Redo and project reopening.
- Actual Brush/Pen input on independent and linked retained masks: detached
  preview, Escape cancellation, committed native samples, unchanged visible RGB,
  rational cubic control positions and exact 17x11-window partitions. Complete
  before/preview/committed/reopened float32 buffers are retained.
- Brush/Pencil reachability through the rail, B/N and palette, retained Reveal
  choice and atomic rejection of direct color painting.
- Copying geometry-only float originals through receiving ID collisions and
  source-tab closure, preserving geometry while assigning fresh stroke/source
  identities. Workspace reload retains originals referenced only by redo history.
- Recorded recipe packaging/remapping after source closure, exact receiving
  artwork, one Undo and original-bearing project reopening.

The geometry original is all **190,816 TIFF bytes**, with native **131x79**
dimensions and a separate **96x58** display thumbnail. It is never sampled as a
byte artwork proxy. Existing affected cases include the genuine 50 MP retained
mask original, byte wet editing, prior mask tools and float-erasure regressions.

Production exports actual float TIFFs. Independent native libtiff verifies the
linear-sRGB profile, float32 unassociated samples, preserved visible HDR RGB,
fractional alpha and every reopened output word. Brush changes **157** alpha
samples; Pencil independently changes **10** more. The final sample hash is
`d86e4810a05428f66f88015e5298249068a86d81b0631e5667e198f25c09b0ae`.
The production assertion was strengthened after the 52-case run; only that test
and its independent reader changed, and the complete two-case production run
passed again. Product code and native-matrix test sources stayed unchanged.

The first pointer pilot reproduced the disabled Brush. Fixture corrections
preserve the existing empty-tab reuse, explicit selection, facade lifetime after
Undo, deliberate copied stroke IDs and actual palette label. No pixel tolerance,
tool default or timeout was increased to obtain acceptance.

[Compact receipt, raw output, earlier failures and source fingerprints](mask-plane-float-2026-10-31.json.gz).
The receipt deduplicates identical payloads. Full-page documentation screenshots
stay local with their hashes indexed; native mask buffers, TIFFs, projects and
failure reports are embedded.

## Remaining scope

This is not complete F03/F06/F10/F14 acceptance. Actual source swapping, broader
nested/cross-document transport, owner/master/pose changes, all-kind mapped tool
editing, native float wet tools, general warp, wider horizon/cache/lifetime
behavior and photographic/physical-device/sustained process-memory quality
remain required. The original <=33 ms live-input p95 / <50 ms routine-task targets
and every unfinished professional, AI, workflow, ChatGPT/live identity,
commercial, specialist and motion gate remain active. No speedup, continuous
60fps, paid operation, upload or REST/browser synchronization is claimed.
