# Character formatting

Character ranges store sparse overrides of a text layer's paragraph defaults. Source text stays literal; offsets count UTF-16 code units, as JavaScript strings and textarea selections do. Ranges are ordered, nonempty and nonoverlapping. Adjacent equal overrides merge; gaps inherit the layer's current defaults. A boundary cannot split a surrogate pair. Combining-character boundaries remain explicit authored choices.

## Inspector

Select text in **Text content**, then open **Character formatting**. The selection remains available while using the range controls. Change its family, size, color, weight, slant or letter spacing, or choose **Clear selected character formatting**. Existing typography controls continue to change paragraph defaults; explicit character overrides remain independent. Mixed selections display the values at the first selected character. The panel reports preparation errors and disables range controls while preparing native layout. Undo restores the complete prior text and ranges.

Typing, pasting and deleting use the browser's `beforeinput` interval when available, including repeated characters. Composition or programmatic changes without a matching captured interval use a scalar-safe unchanged-prefix/suffix comparison. An insertion inherits the preceding character by default; replacing a selection inherits its first character. Exact automation positions use `replaceText` instead of whole-string assignment.

Point-text corner resizing scales the default and explicitly overridden font sizes together. Existing pixel-based letter/word spacing retains its authored value. Paragraph corners change wrap width and recompute mixed-character height without changing font sizes. Both preserve the opposite corner and commit one Undo step.

## Public object API

`new TextLayer({text, characterRanges?})` optionally accepts initialization ranges. `TextLayer.characterRanges` returns an owned readonly snapshot; mutate through methods:

| Method | Contract |
| --- | --- |
| `await text.formatRange(start, end, format, control?)` | Overlay character properties on a nonempty interval. `format: null` clears its overrides. |
| `await text.clearCharacterFormatting(start = 0, end = text.text.length, control?)` | Restore inheritance in the interval; empty whole text is a no-op. |
| `text.replaceText(start, end, replacement, {affinity?} = {})` | Replace exactly this interval; `before`/`after` chooses the inherited side. Default is `after` for a selected interval and `before` for an insertion. |
| `await text.reflowNative(control?)` | Prepare current native paragraph geometry and commit an ordinary text update. |

`format` supports `fontFamily`, `fontSize`, `color`, `fontWeight`, `fontStyle`, `letterSpacing`, `wordSpacing`, `fontKerning`, `fontVariantCaps`, `fontStretch` and `fontVariationSettings`. Paragraph alignment/direction, wrapping, line height, indent and spacing belong to the frame. Omitted patch keys retain selected overrides; `null` clears all selected properties. `undefined` property values are omitted. No public mutation accepts measured geometry from a script.

`control` is `{signal?: AbortSignal}` for trusted code. Isolated scripts use Scripts-panel cancellation and must await each native preparation. Asynchronous methods reject inside synchronous `Document.transaction` callbacks. They capture source/ranges, owner, source store and revision; cancellation, changed owners/revisions, invalid results, locks or missing sources publish no character edits. Attached changes share `layer.update`, validation, history and the usual plugin permissions. Detached objects remain constructible before collection attachment.

```js
const title = document.layers.add(new TextLayer({
  name: "Title", text: "Canoli Studio", fontSize: 32,
  fontFamily: "serif", color: "#123456"
}));
await title.formatRange(0, 6, {fontSize: 48, color: "#a43e29"});
title.replaceText(7, 13, "Design");
await title.reflowNative();
```

## Geometry and sources

The source-aware line breaker uses native SVG advances for complete logical lines; each line uses a shared baseline and a height derived from its largest font size. Literal source offsets survive whitespace consumption and discretionary hyphens. Derived justification spacing never overwrites authored formats. Native preparation retains font sources before yielding, checks registrations and ownership, and releases probes, URLs and leases on success/cancellation/failure.

In browser scripts, `formatRange` and `reflowNative` request native host metrics through the private broker. The provisional worker receives finite bounds only; final host commands independently remeasure and recheck revision, source ownership and existing grants. The existing five-second script deadline, 32 native preparations and 256 submitted commands remain. Installation is inert; no font chooser, source bytes or network permission is exposed.

Synchronous setters and `replaceText` use metrics available in their execution environment. Node REST and provisional worker commands use explicit estimates when native SVG is unavailable; await `reflowNative` in a browser script before querying native rich-text bounds after synchronous content/metric edits. Independent headless REST documents do not synchronize with browser artwork.

## Persistence and output

Optional `characterRanges` requires document schema 45, including explicit `[]`. Earlier documents remain readable without injected fields. Once explicitly present, even empty ranges retain the native paragraph layout/rendering path. Native projects/history/workspaces retain authored ranges and complete declared font resources. Private variation aliases cannot be persisted; embedded character families require their declared sources. Font usage/replacement and portable recipe dependency scans include character families.

Raster output uses the native paragraph surface and captures every effective font dependency before callbacks. SVG emits whole-line native positions with styled tspans and complete selected embedded font sources. Supported inline character styles and explicitly positioned outer lines now reimport as editable ranges with privately resolved owned fonts and native baseline/anchor placement. Individual inline positioning and richer graphs still require explicit flattening. See [SVG_CHARACTER_IMPORT.md](SVG_CHARACTER_IMPORT.md). No round-trip claim covers arbitrary SVG/CSS, text on a path, vertical text, or every font/shaping/viewer/device combination. No sustained 60fps or editor-wide F14 completion is claimed.

Verification status and remaining F08/F11/F14 work are recorded in the dated implementation roadmap.
