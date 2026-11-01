# Complete styled native bidi paint order — 2026-11-01

Status: private original-cluster ordering and native positional-range anchoring
verified for the current corpus. The full implementation-roadmap goal remains
active. Public Float32 TextLayer authoring and the text tool remain unavailable.

Private SVG glyph primitives retain original UTF-16 source-cluster provenance
through horizontal/path/vertical projections. Complete horizontal styled lines
rank original clusters using captured native visual metadata while preserving
shaped order within a cluster and ties. This metadata supplies no glyph poses,
IDs or source colors. Original spans, full text contexts, fonts/axis tuples and
source-linear colors remain. Missing/out-of-range source addresses or malformed
ordering reject before publication. Exact per-item and complete-line native ink
at opacity 1 and 0.5 plus per-color ownership remain mandatory.

A native positional-range anchor candidate handles negative fragments whose
summed measured advances differ from their actual native extent. Immutable
unfolded native metadata supplies that range, retaining original allocation,
source GPOS, metrics and hinting. A mixed-font RTL curve reports measured advance
68 but an unfolded native extent of 62. Using the original extent resolves the
last case exactly. This follows the native anchor rule in
[Chromium SVG layout](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/layout/svg/svg_text_layout_algorithm.cc).
No inverse path search or reference pixels supply paint coordinates.

The complete matrix matches all 64 Latin/Hebrew/Arabic/CJK layouts with original
color/font/size boundaries, both paragraph directions, straight/curved baselines,
identity/affine transforms and ordinary/negative tracking. Original source
contexts, colors/clusters, model identity and probe/private-face cleanup remain
verified. Nine independently authored FontTools/native SVG Float32 references
retain every alpha/RGB value and 137-pixel partition word, signed/HDR colors,
colored overlap and alpha 1e-8. Overlap counts are 223, 607 and 530 pixels for the
three numerical scenarios. These references verify coverage and composition at
separately verified poses; they do not independently discover native poses.

The initial diagnostic matched 40/64 layouts, rejecting twenty-four negative
cases. Complete-line ordering improved this to 63/64. The final case was already
a per-span geometry rejection in the baseline: matrix/origin error 66, previous
path variants error 255. Temporary Vite-only instrumentation recorded native
metadata and candidates without changing production source or publication
rules. The native-range candidate has error zero. Geometry-only inverse-path
queries were investigated and not shipped; their native path-query precision
is not a new positioning contract. An SVGPoint.toJSON harness error was corrected
in a separate retained run. A generic Object.freeze test inference error was
corrected without changing runtime behavior or assertions. No target, exact
ink assertion, color gate or tolerance was removed or relaxed.

Full build/typecheck and all 3,415 unit/API tests across 341 files pass. One
complete affected source run passes 203 cases across 24 files. Fifteen production
cases pass; all browser runs have no retries/skips/flakes. The production styled
test retains the Latin case and adds overlapping Hebrew through actual emitted
ordering/matcher/shaping-worker/coverage/ownership code. It verifies source
clusters [0,1] and [1,0] respectively and exact native color ownership. These use
prepared original-font adapters; full source capture and lifetime run separately
in the source browser matrix. All prior original-script, styled, vertical/path,
numerical and ownership/fault targets remain included. The complete shaping
worker source remains unchanged: 1,398,165 bytes with no external imports.

Independent readers compare every RGBA sample in both complete ordinary
10,000 × 5,000 curve and vertical outputs against independently authored complete
native SVG references: 200 million samples each, zero error and identical PNGs.
The separate RAW case retains its exact 100,000,672-byte original, complete
independent 600 × 200 text-reference region and preceding accepted full PNG bytes.
These are ordinary byte regressions, not public Float32 TextLayer acceptance.

The [compact receipt](native-styled-bidi-2026-11-01.json.gz) binds changed source,
immutable release/generated manifests, twelve production artifact checks, full
raw runs, failed/corrected diagnostics and independent reference code. Raw ZIPs
remain local and ignored.

Owned font fallback, missing/intrinsic paint, broader scripts, native/legacy/
optical/vertical itemization/layouts/extents/hosts, connected public Float32 text
editing/tools/scenes/export/shared transport/persistence and every unfinished
original professional-editor, photographic, precision/workflow, sustained all-
tool/device/GPU/process-memory performance, provider/installed ChatGPT/live
registered identity/commercial and other roadmap gate remain required. The
current corpus does not prove universal native itemization or performance.
Public model/schema/history/grants, original-resolution policy and separate
REST/browser sessions are unchanged.
