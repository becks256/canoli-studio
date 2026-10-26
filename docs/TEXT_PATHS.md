# Editable text on a path

Schema 46 adds an authored cubic baseline and a measured frame origin to native text. Geometry stays in the text layer's local plane. Changing text or fonts changes its measured frame without translating the baseline anchors or moving the layer. Existing document commands, locks, revision checks and Undo apply. Verification status and remaining work are recorded in the dated implementation roadmap.

## Object-oriented authoring

`new TextPath(options)` creates an immutable baseline value. `options.points` is required and uses existing vector anchors: each point has finite `x`, `y`, `in: {x,y}` and `out: {x,y}`. `closed` and `reverse` default to false. Signed `startOffset` and `baselineOffset` default to zero in local pixels. The existing 20,000-anchor vector budget applies; zero-length geometry rejects. Original document/image resolution has no new cap.

`path.points` and `path.toJSON()` return owned copies. `path.with(changes)` returns another validated value. Reversal changes cubic geometry/handles while retaining a closed path's seam; it never reverses the Unicode source. `TextLayer.textPath: TextPath | null` reads an owned value and assigns through shared commands. `new TextLayer({textPath?: TextPath | null})` accepts the same value. Plain serialized objects belong to snapshots/REST transport, not the public OO setter.

`await text.setTextPath(path: TextPath | null, control = {})` prepares native bounds before one shared update. Attaching clears paragraph wrapping, paragraph spacing, first-line indent and justification in that same update. The constructor requires those properties to be compatible already. Text must use one logical line; newline/Unicode line separators reject atomically. Literal tab/CR/form-feed normalization follows native styled text. Attaching/detaching retains text and character formatting. An explicit null baseline retains native straight-text rendering; older omitted fields keep the legacy Canvas path. Geometry-only recipe actions preserve the receiving text and formats.

`control` is `{signal?: AbortSignal}` in trusted host code. Prepare outside synchronous `Document.transaction`. Native preparation captures the text owner/revision/font sources and rejects cancellation, changed work, locks, missing native capability or invalid geometry without partial edits. Isolated scripts use panel cancellation, the existing read/write grants, five-second deadline and 32-native-preparation/256-command limits. The broker returns finite bounds/origin only; final host commands revalidate/recompute accepted changes. No font source bytes, renderer, file chooser, import service or network grant is exposed.

<!-- example: text-on-path -->
```js
const title = document.layers.add(new TextLayer({
  name: "Curved title", text: "Canoli Studio", fontFamily: "serif",
  fontSize: 32, color: "#2468ac"
}));
await title.setTextPath(new TextPath({points: [
  {x: 24, y: 160, in: {x: 24, y: 160}, out: {x: 100, y: 24}},
  {x: 420, y: 160, in: {x: 340, y: 24}, out: {x: 420, y: 160}}
]}));
await title.formatRange(0, 6, {color: "#a43e29"});
document.selectedLayer = title;
print("Curved title ready");
```

## Metrics, rendering and persistence

The serialized `textPath` contains authored geometry. `textPathOrigin` and ordinary `width`/`height` retain the measured local frame; commands derive them, and `layer.update` does not accept a caller-written origin. The layer's x/y and affine transform keep their existing meaning. Selection/alignment/preflight bounds include the measured origin. Moving and appearance edits preserve the frame; content/metrics/path edits remeasure it. Corner resizing scales the baseline, offsets, default/explicit character sizes and anchors the opposite frame corner under the parent basis.

Browser hosts measure actual native `textPath` advances and ink using complete owned fonts and logical styled spans. They render those same baselines in caller-selected viewport/export windows. Empty/overrunning text follows the native renderer; source is not truncated or stretched to fit. Native projects/workspaces preserve path data and original font/image bytes through ordinary undo, reopening and recovery. Portable recipe actions use the same geometry commands and existing font-resource transport.

Synchronous worker and separate Node REST metrics are conservative estimates without a browser SVG host. Await `setTextPath` or `reflowNative` in a browser script before querying native rich-text geometry. Headless REST sessions do not synchronize with browser documents. A saved frame reflects its authoring environment; changed system fonts can require explicit native reflow.

## Inspector and curve editing

Open **Text on a path** in Typography. Choose a vector and **Use vector path** to copy its single-contour geometry into the text's local plane, including group/affine placement. The source vector remains independent. The source list is paginated without evicting paths. Start/baseline offsets support preview/commit/cancel; direction, open/closed contour and Remove text path use ordinary Undo.

**Baseline anchors** exposes one indexed anchor and its incoming/outgoing handles with precision inputs. Moving an anchor translates its handles. Splitting uses exact cubic subdivision; removing an anchor changes the curve. Existing keyboard typing rules, themes, Inspector scrolling, lock and error behavior remain. New interactive canvas handles for text baselines are still required; current baseline editing uses these precision controls and copied vector geometry.

## SVG interchange

SVG output emits real local baseline definitions and native textPath/tspan content with embedded selected font bytes. Supported editable reimport privately resolves a local single cubic path and character sources before publishing a clean document. Shared SVG path references become independent native baselines; reverse traversal is represented by the resulting anchors, not the original flag. DOM/CSS identity is not retained.

Percentage/calibrated path lengths, multiple contours, repositioned/mixed text chunks, text stretching/automatic spacing, alternate side, unsupported baseline-reference ancestry, vertical/path paragraph flow and wider SVG/CSS/layout graphs require explicit flattened import or further implementation. Imported elliptical arc baselines may require cubic approximation and are reported. Broader viewer/language/device quality, live canvas baseline handles and sustained editor-wide performance remain open. This is not arbitrary SVG equivalence or completion of the professional typography roadmap.
