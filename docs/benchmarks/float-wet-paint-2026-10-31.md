# Native wet PaintLayers — 2026-10-31

Started 2026-10-31; completed 2026-11-01. This is an F03/F10 increment from
`bc8a302`, not full milestone or roadmap acceptance.

Explicit schema-57 HDR prepared pairs now append to float PaintLayers. Active
wet strokes reconstruct ordered dry/wet/eraser/clear content locally before
current layer/ancestor affine placement, matching the byte wet reconstruction
rule. This rerasterizes earlier dry edges locally; inert wet metadata retains
the established dry document-lattice path. Source roles remain tied to actual
reference objects. Trusted retained authoring and Smudge/Mixer support paint
layers and empty selections through native reads, TIFF staging, private prefix
leases and one-Undo publication. New targets attach before their HDR append
inside that transaction. Masks retain their byte coverage contract. See the
[public contract](../FLOAT_PAINT.md#native-wet-paint).

Verified scope:

- **3,298 unit/API/native tests across 321 files**, after the attachment fix.
  Shared OO locks/history/schema ages/source roles, actual WASM equations and
  independent REST valid/invalid native pairs, revisions, source-bearing
  projects and Undo/Redo pass. REST sessions remain independent.
- **52 accepted source-browser cases across 8 files**: 51 matrix passes plus one
  successful explicit-target guard recheck. The raw matrix's stale no-selection
  rejection remains disclosed below. There are no skipped/flaky cases or runner
  errors. Three legacy 50 MP controls passed in the preceding 54-case matrix;
  the final selected matrix retains the new wet PaintLayer 50 MP case.
- **10 final production cases across 4 files**, with no failures, skips, retries,
  flakes or runner errors. Normal Scripts, actual empty-target Mixer creation,
  native files, Undo/Redo, source-preserving reopen and the mobile guide work
  without developer globals. Existing dry paint and raster HDR delivery pass.
- Independent **libtiff and NumPy** compare every **41,396 Float32 words** in
  each complete native, reflected/scaled and reopened 131x79 production TIFF;
  every word and the complete pinned linear-sRGB ICC match. Source-browser
  references compare complete native/affine windows, negative/off-layer support,
  once-only envelopes and partition parity. No display canvas supplies color.
- A genuine **10,000x5,000 original** retains exact source bytes and geometry.
  Every word in the disclosed **64x48 native edit window** matches separate
  source-over/load/envelope equations, with one Undo/Redo. This is bounded-window
  verification, not full-image wet-paint performance or photographic acceptance.
- Private prefix ownership through retirement, append/one-shot equality,
  cancellation, signed/HDR color, fresh-layer native values, exact float/byte
  Undo, byte recipe pixels, complete isolated/plugin pair rejection and
  source-bearing recipe/redo-only workspace recovery pass.
- Final build/typecheck pass; **3,423 product/test inputs** match the amended
  frozen manifest. All **149 sealed build files** remain exact, and the native
  WASM identity matches the unit/source-browser backend and production release.

The initial six-case source pilot had four passes and two failures: a first dab
that made no change correctly returned no preview, and the generated isolated
runtime still carried the older gate. The reservoir fixture was made changing
and the runtime rebuilt. The next 54-case matrix exposed a real new-target bug:
appending HDR to a detached PaintLayer invoked its temporary byte-document
validation. Attaching before append fixes it inside the same transaction.
Fresh float native values/history and byte recipe replay now pass, including a
real normal-production gesture. The post-fix 52-case matrix then retained an
old expectation that no selection rejects; it now checks a nonexistent explicit
`targetId`, preserving rejection, atomicity, source and storage cleanup. That
focused recheck passes. All raw reports and input amendments remain in the
receipt; these failures are not hidden as retries.

Compact evidence: [receipt](float-wet-paint-2026-10-31.json.gz),
2,121,289 bytes, SHA-256 `2166d6ec2630d7b61ab4edf0044218ffb21b4effdef5eb79c8c945f7aac3ef6a`. It includes raw reports, accepted-case provenance,
input/build manifests, logs, original native outputs and independent results.
The sealed release, raw screenshots and working reports remain at
`/tmp/canoli-float-wet-paint-2026-10-31/`; no ZIP or upload is required.

The full original goal remains active. Float clone, wider layer/tool/working
spaces, general warp/master coverage, photographic/device quality, sustained
F14 and every unfinished professional/AI/workflow/ChatGPT/live identity/
commercial/specialist/motion gate remain required. No complete F03/F10/F14,
continuous-60fps, physical pigment or all-roadmap claim is inferred.
