# Native linear vectors and recorded path appends

Accepted increment from `e7e88a1`, 2026-11-01. The complete original implementation
roadmap remains active. This does not close F03/F07/F10/F14 or the wider product.

## Delivered behavior

- Existing VectorLayer/VectorPath constructors, Pen/shape/Boolean controls and
  editable solid/linear/radial paint now work in float documents. Scalar geometry
  reuses the existing Canvas path rules; RGB, stop alpha and ordered native WASM
  source-over retain linear float precision. Native cells preserve crop parity,
  including affine paint coordinates and half-pixel samples at `2**52 + 32`.
- Ordinary float masks now sample feather/density/inversion on fixed native
  cells. A capture-local 16-cell cache owns at most 4 MiB, reuses only immutable
  values with current-source/pose checks, returns owned windows and clears on
  scene disposal. Retained planes/perspective samplers retain their contracts.
- Recipe `path.add` records semantic created/selected targets, validates complete
  paint/geometry, generates fresh path/contour IDs, packages editable values and
  retains atomic Undo/locks. Update/remove/Boolean recording remains unsupported.
- Existing masks, clipping, Fill, styles, groups, source ownership, isolation,
  independent REST revisions, projects and redo-only workspaces stay connected.
  Schema 58 and existing package/permission boundaries remain unchanged.

## Verification

- `npm run build` and typecheck pass. Final `npm test -- --maxWorkers=2` passes
  **3,325 tests in 327 files**, including actual native WASM and independent REST.
- **111 distinct source-browser cases in 13 files** are accepted: **70 affected
  rechecks** plus **41 unchanged passing cases** from the broader matrix. The
  seven-file precision/fixture amendment is explicit in the receipt. Only two
  runtime files changed after the broad matrix: private vector gradient sampling
  and its vector caller; every vector case was rerun. The other 41 cases exercise
  unchanged float paint/Clone, color, palette, transfer, blend and shadow paths.
- **10 production cases in three files** pass on the corrected release without
  developer globals. Real Pen input, private anchor/gradient cancellation,
  Inspector edits, shape controls, Undo/Redo, original-bearing saves and reopening
  run through ordinary controls. Existing paint and Clone production cases pass.
- All **720,000 Float32 words in each** complete 600x300 linear/radial reference
  scene match separate analytic color/alpha equations. Awkward partitions match
  exactly. Additional reflected/sheared ancestry and paint transforms, compound
  curves, holes, dashed strokes, feathered masks, clipping and shadows retain
  exact crop/project replay. Private Pen preview and commit words match.
- Independent native **libtiff plus NumPy** decodes both complete production
  131x79 float TIFFs. **41,396 words per file match exactly**, including continuous
  stop alpha and once-only layer Fill/opacity; the complete pinned linear-sRGB
  ICC bytes match. Original and reopened outputs have native pixel SHA-256
  `605a0509cee0a26a6abf8b66c5ed5c40aed1311bc287bdc2b581bdf8d7b13bd0`.
- A genuine **10000x5000 original** retains exact original bytes and geometry.
  All **12,288 words** in its 64x48 vector edit window matches separate
  source-over equations using the captured native original. This is a bounded
  edit-window check, not full-image vector export/performance acceptance.
- Existing byte vector Canvas/SVG/project, gradient/stroke controls, zero-length
  caps and native curve/dash checks pass with their original numeric assertions.
- The final release seals 151 files. Its 54 executable/CSS/WASM/index resources
  match the corrected production run exactly. Only the vector guide's evidence
  text changes; its code example remains exact. The final guide passes a separate
  390-pixel, JavaScript-disabled browser check.

## Disclosed failures and repairs

The four-case initial source pilot passed continuous colors and 50 MP ownership
but failed recorded appends and complex crop parity. `path.add` recording was
missing. Feathered selection coordinates depended on each requested ROI origin.
Both product gaps were repaired; the exact-word assertions remain. The fixture
also now uses its intended complete affine translation `(330, 8)`; the previous
transform setter reset that translation. Coverage minimums were retained.

The initial broad matrix had 60 passes and 50 failures: 49 legacy vector artifact
writes followed dangling `/tmp` symlinks into a missing `/run/lock` directory;
one fixture still expected the newly supported Pen to be disabled. Artifact
destinations now use each test's output directory. Pen is enabled and Text
remains disabled. All 50 failures are covered by successful affected rechecks;
no color/alpha/geometry tolerance was relaxed.

An extra native probe exposed lost half-pixel placement before acceptance:
`[.75,0,.25,.375]` instead of `[.6875,0,.3125,.40625]`. Gradient sampling now
removes large placement before adding a pixel-center offset on a fixed cell.
The actual native worker and browser geometry path return the exact expected
result, with affine partition equality. The final full unit and affected browser
runs include this repair. Earlier test-only constructor/type errors and the
initial full unit run that overlapped a cache cleanup edit remain preliminary
evidence; the final full run is separate and authoritative.

## Retained evidence and remaining scope

The compact [receipt](float-vectors-2026-11-01.json.gz) retains reports, failure
details, native coordinate probes, frozen input/release hashes, amendments,
complete new production TIFF/project data and artifact hashes. Raw work lives in
`/tmp/canoli-float-vector-2026-11-01`; no raw benchmark ZIP is added to Git.
The receipt is 496,586 bytes, SHA-256
`0d4814691be794279a6ff7d25546d7dbede6fa7267708c3a00979b80d7a76ff4`.

Coverage uses the canonical browser geometry engine, not independent vector
tessellation or analytic area integration. No physical-device accuracy,
photographic quality, full-process memory bound or sustained editor-wide 60fps
acceptance is inferred. Broader float text/smart/filter/healing/working-space/
HDR/CMYK, warp/master, professional/AI/workflow/collaboration, live ChatGPT/
identity, commercial/specialist/motion and every other unfinished original
roadmap gate remain required. No paid call, account action, upload or push occurs.
