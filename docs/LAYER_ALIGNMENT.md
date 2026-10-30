# Align layers to the canvas or a key object

Status: scoped F03 alignment implementation. See the roadmap for accepted evidence and remaining professional layout gates.

## In the editor

The Layers panel exposes **Align relative to** whenever at least one layer is selected. A single selected root defaults to Canvas; multiple roots default to Selection. Choose left, center, right, top, middle or bottom. These use authored geometric bounds in canvas coordinates, including parent rotation, reflection, scale and shear. Shadow/effect extents are not alignment geometry.

Selection aligns each independent selected root to their combined bounds. Canvas aligns each root separately to the document's canvas; it does not translate the selection as one group. Key object keeps the chosen selected root stationary and aligns every other selected root to it. The key list numbers roots so identical names remain distinguishable. A locked key is a valid read-only reference; locked moving roots disable the action. Reference choices are transient UI state, not artwork/history. Compact alignment rows keep layer-tree space available. Additional transform, flip and component controls use their own bounded scroll region; when that region itself has focus, arrow/page/home/end/space keys scroll it without nudging artwork. Selecting a group and its child moves the group only once.

The command palette offers all six directions for each reference type. Key-object palette actions and custom bindings use the same current key choice as the Layers panel, falling back to the active selected root. These actions have no new default keyboard bindings. Existing typing shortcuts stay native in editable fields.

Alignment reference/key choices and the selection-scale draft belong to the
actual document and complete ordered selection. Changing selection resets those
choices even when imported IDs contain punctuation; reselecting equivalent
ordered IDs retains them. Selection changes also cancel an active Move, mask,
resize, rotation or selection-scale drag before continuation/release. Changing
away and immediately back cannot revive a cancelled drag. Cancellation creates
no artwork edit or Undo entry. Same-owner panning remains available.

## Object-oriented scripting

`document.layerSelection.align(alignment, reference = "selection")` accepts one of the six direction strings and a reference of `"selection"`, `"canvas"`, or an attached `Layer` handle from this document. A foreign/detached handle rejects even if its ID matches a local layer. A key may be outside the selection when supplied explicitly through this API. The key must be independent of all moving roots: neither a moving ancestor nor a descendant can be the stationary reference.

All movement is computed from one captured synchronous snapshot and validated before publication. One call commits one shared `layer.align` command and one ordinary Undo entry when it changes geometry. Already aligned geometry and empty selections are no-ops. Missing geometry, invalid directions/references, locks and unrepresentable coordinates reject without partial edits. Canvas dimensions and original source resolution are not reduced or capped.

Alignment changes only positions. It retains text dimensions and typography instead of reflowing text against the current execution environment's available fonts. Paint/vector contents, source bytes, masks, filters, stacking and parent linear transforms remain intact.

The caller selects the intended layers before running this example in the Scripts panel:

<!-- example: alignment-canvas-script -->
```js
document.layerSelection.align("center", "canvas");
document.layerSelection.align("middle", "canvas");
print("Centered on canvas");
```

The two calls form one isolated host transaction; one human Undo reverses that accepted script. Trusted callers may group synchronous calls with `document.transaction`. Key-object callers pass a real handle, for example `document.layerSelection.align("right", document.layers.at(0))` after ensuring that layer is the intended independent reference.

## REST and extension boundaries

The existing independent REST command endpoint accepts `{type:"layer.align", ids:string[], alignment, target?}`. Omitted target defaults to `{type:"selection"}`; other strict values are `{type:"canvas"}` and `{type:"layer", id:string}`. IDs must name distinct existing layers in this REST document. The endpoint retains expectedRevision checks, atomic commands and Undo. It does not synchronize the browser.

Isolated Scripts/plugins use the same public method, shared validation and host commit. Existing document read/write grants apply; read-only execution cannot mutate geometry. Installation stays inert, and alignment grants no file, renderer, network or asset-source access. No document/project/workspace schema or plugin manifest change is required.

## Portable recipes

The recorder retains relative alignment intent, semantic moving-layer references and a semantic key, including step-result references for created artwork. Replaying against a differently sized canvas recomputes coordinates. No original document/layer ID is a portable target. Missing/ambiguous selectors, duplicate resolved targets, invalid key hierarchies and locked moving roots fail before publishing a partial result. A key may remain locked.

The `layer.align` recipe action owns `targets:SemanticTarget[]`, `alignment` and optional `reference`, defaulting to Selection. A key reference is `{type:"layer",layer:SemanticTarget}`; this action does not accept a separate step `target`. Existing recipe/package/batch preflight and one-transaction acceptance apply. Updated runtimes support this action in recipe versions 1/2; earlier runtimes reject unknown actions.

<!-- example: alignment-key-recipe -->
```json
{"schemaVersion":1,"id":"align-to-key","name":"Align artwork to key","description":"Keep the named key stationary","version":1,"parameters":[],"steps":[{"id":"right","name":"Match right edges","action":{"type":"layer.align","targets":[{"by":"name","pattern":"Artwork","literal":true}],"alignment":"right","reference":{"type":"layer","layer":{"by":"name","pattern":"Key","literal":true}}}}]}
```

## Spacing feedback while moving artwork

The Move tool's **Spacing guides** setting starts enabled. During a layer drag it shows the nearest positive left/right/top/bottom gaps whose authored frames overlap on the other axis. Labels use document pixels, retain their screen size across zoom and show an approximation mark when rounded to three decimal places. Equal values are marked with `=`. Small adjacent labels occupy separate lanes instead of covering one another; line endpoints remain at the measured bounds.

Enable **Snap to canvas and guides → Include artwork → Equal spacing** to attract movement to equal gaps within the existing six-screen-pixel tolerance. Equal spacing starts off. The tool can center a moving selection between two neighbors or repeat the nearest existing gap before/after a stationary pair. It chooses the closest eligible correction independently on each axis. Existing canvas, artwork-edge/center and authored-guide attraction wins equal-distance ties. Both axes must retain their shared orthogonal band after correction. Alt bypasses attraction and spacing feedback while moving.

Feedback uses the final preview geometry after ordinary parent-space conversion and placement clamping, rather than the initial pointer proposal. Affine parents and multiple selected roots use their authored canvas-space union. The target cache excludes moving subtrees, their containing ancestors, hidden and zero-opacity subtrees; locked stationary artwork remains a valid reference. These are geometric gaps, not visible-pixel, mask, shadow, occlusion, design-intent or print-quality measurements. Overlapping/touching/diagonal, empty, nonfinite and numerically unresolved intervals do not invent a gap or an attraction.

**Spacing guides** and **Show guides** can hide this feedback. Snapping remains controlled by the Move snapping settings. All options are local to the current app session, independent of saved artwork. Feedback clears after release, Escape, pointer cancellation/lost capture, tool changes, document/selection/revision replacement and ordinary Undo/Redo. A reopened document with identical persistent IDs and revision is a different gesture owner.

Preview changes no document data, source bytes or history. Pointer release uses the existing shared movement command and one Undo; cancellation publishes no movement. No spacing overlay is saved, exported, or exposed as a public mutation API. Scripts and independent REST sessions continue to use OO/shared movement, alignment and distribution commands; they do not control this transient browser drag state. DOM lines and labels allocate no source-sized bitmap. Real device, sustained performance and broader layout acceptance remain separate gates.

This advances F03. Multiple artboards, broader constraints/warp/layout workflows, real-device/performance acceptance and all other unfinished roadmap requirements remain open.
