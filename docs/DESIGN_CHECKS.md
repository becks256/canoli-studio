# Design checks

Design checks inspect a captured document without changing artwork, selection, history or source assets. The custom dialog, `Document.preflight`, isolated Scripts/plugins and independent REST sessions share the same policies and validation. The dated implementation roadmap records completed verification; the complete A12 and professional-editor roadmap remain open.

## Policies and report versions

Existing font-family, authored-bounds and original raster sampling checks retain their defaults and strict version-1 reports when `alignments` is omitted or undefined. An explicit alignment policy, including an empty array, requests a version-2 report. Old readers can reject that new report rather than silently ignoring new findings. Reports and policies are transient data, not document mutations or a new project/workspace format.

`alignments?: PreflightAlignmentInput[]` accepts at most 32 rules:

| Field | Contract |
| --- | --- |
| `name?` | Optional trimmed label, 1–80 characters. Missing labels display Alignment rule N. |
| `layerIds` | 1–64 distinct root-document layer IDs, including nested group children; no selected parent/descendant pairs. |
| `alignment` | `left`, `center`, `right`, `top`, `middle` or `bottom`; center means horizontal center and middle means vertical center. |
| `target` | `{type: "canvas"}` or `{type: "layer", id}`. A key must exist in this document, differ from every checked layer and be outside their ancestor/descendant relationships. |
| `tolerance` | Optional nonnegative finite document-pixel tolerance up to Number.MAX_SAFE_INTEGER; default 0.5. |

Unknown fields, unsupported values, duplicate/missing targets, nonexistent keys or related target graphs reject the entire inspection. Selection membership does not retarget a saved rule: rules carry explicit IDs. These IDs refer only to the current root document; embedded-master IDs belong to independent scopes. Locked layers can be inspected and used as stationary references.

Rules compare authored axis-aligned canvas-space frames using the editor's shared geometry and complete affine placement. Text frames include path/vertical origins. Groups include hidden child geometry as the existing alignment tools do; smart instances use their authored outer frames. Active wet-paint tiles and raster replacements retain their native geometric extents without transferring color/coverage bytes. Brush clips, ordinary clone pixels, image sources, effects, selections and masks are not inspection geometry.

`includeHidden: false` excludes checked layers in hidden/zero-opacity subtrees, with explicit unverified findings and coverage counts. A hidden key remains a usable authored reference, like the editor's alignment tools. `includeHidden: true` measures all declared targets. Empty frames, invalid numerical geometry and unresolved precision report unverified evidence rather than an aligned result.

Comparison includes a 1e-7 document-pixel numerical floor and eight machine epsilons at the coordinate/extent scale. If that uncertainty exceeds the requested tolerance and overlaps a possible match, the check is unverified. JSON retains full computed values; displayed messages round for readability. This is a floating-point authored-geometry check, not a measurement of visible pixels or physical print accuracy.

## Evidence and coverage

Version 2 adds an `alignment` summary: `rules`, `requested`, `matched`, `mismatched`, `unavailable` and `excluded`. The final four counts sum to requested layer/rule assignments; the same layer in different rules counts once per rule. `alignment-mismatch` is a warning with rule index, alignment/reference, configured tolerance, full actual/expected anchor coordinates, signed `delta = expected - actual`, numerical tolerance and the reference/target bounds. `alignment-unchecked` is information with a hidden, geometry or precision reason and no invented coordinates.

The existing 512 retained-findings limit applies. Full severity and alignment coverage counts include omitted findings; `truncated` remains explicit. Report validation checks severity totals, coverage, policy/target binding, duplicate findings and measured-coordinate consistency. A no-findings report only covers enabled policies; it is not a readiness certificate.

Browser geometry work runs in a disposable worker. Alignment-only payloads retain geometry for the declared targets/keys and descendants of requested groups. Unrelated dense paths, clones, selections, masks, effects and source buffers are omitted. Geometry is measured once per required node within a report. The existing 4,096-node/64-level inspection budgets and cancellation/stale-source/session checks remain. They are inspection/output budgets, never image import or source-resolution limits.

## Public and isolated use

`await document.preflight(options = {}, control = {}): Promise<PreflightReport>` and trusted `editor.preflight(...)` retain their signatures. Run outside synchronous transactions. Trusted code may pass `control.signal`; isolated scripts use panel cancellation and the existing five-second deadline. Installation remains inert. Plugins need current `document:read` and `assets:read`, including when the document has no raster source, because the shared inspection service reads source metadata. No source bytes, native font availability, network, inference or new plugin capability is exposed.

<!-- example: alignment-checks -->
```js
const targets = document.layerSelection.rootLayers;
if (!targets.length) throw new Error("Select layers to check first.");
const report = await document.preflight({
  checkBounds: false,
  checkFonts: false,
  alignments: [{
    name: "Canvas left edge",
    layerIds: targets.map(layer => layer.id),
    alignment: "left",
    target: {type: "canvas"},
    tolerance: 0.5
  }]
});
print("Alignment checks ready", report.alignment);
```

A later script error still rolls back other staged edits. Inspection itself submits no commands. To correct a declared mismatch, use the existing explicit editing API separately, for example `document.layerSelection.align("left", "canvas")` or `document.layerSelection.align("left", keyLayer)` with an attached `Layer` handle. Those edits retain normal write permissions, locks, validation and Undo.

Independent `POST /api/v1/documents/:id/preflight` accepts the same `options.alignments` with `expectedRevision`. It uses its own terminable worker and source dimensions. REST does not synchronize with a browser; text measurements are the authored frames in that session and may originate from estimated headless layout. Genuine 50 MP originals require no image-sized inspection buffer.

## Dialog behavior and remaining work

Design checks → Alignment checks offers expected edge/center, canvas/key reference, tolerance and explicit layer checkboxes. Add alignment rule commits the draft only to the inspection policy. Selecting a parent or descendant updates the draft checkboxes to keep targets independent. The reference is excluded from checked targets; related references require a different choice. Rule labels, checked-layer disclosure and Remove controls make the scope reviewable.

Run checks leaves artwork/history/selection intact. Download report includes only the captured policy and metadata evidence. Select layer explicitly navigates to a finding. Policy/artwork/font changes mark reports stale. Removing every rule restores version-1 reporting. Changing document instances clears captured rules/results even when the reopened document has identical persistent IDs and revision; it never retargets old rules automatically. Closing the dialog discards its transient policy.

No inference of alignment intent, automatic repair, rendered visibility/occlusion analysis, bleed conformance, text contrast/legibility or print-ready badge is supplied by these rules. Those A12 requirements, broader delivery integration and the full original roadmap remain required. No account, paid operation or cloud upload was added.
