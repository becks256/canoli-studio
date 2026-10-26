# Editable SVG character formatting

Trusted SVG import reconstructs supported inline character formatting as native `TextLayer.characterRanges`. It retains logical text, resolved UTF-16 ranges, effective font faces/sizes, solid colors/alpha, weight/slant, kerning, tracking/word spacing, capitals/stretch and declared variable axes. Nested inline presentation attributes and parsed inline CSS inherit through their parent styles. This uses document schema 45; no new document/project or plugin format is introduced.

## Inspection and publication

Inspection stays inert and read-only. The isolated parser returns uniform placeholder text layers plus private text-placement records containing optional character ranges. It does not put unresolved embedded aliases into public character data, load/register fonts, or change current artwork/history. The host validates the strict transport, ordered intervals, Unicode boundaries and layer ownership before accepting a preparation record. Prepared character ranges cannot arrive hidden inside the placeholder document.

Private source preparation parses complete supplied font files. Within the existing synchronous native reconstruction scope, each effective range resolves its own weight/slant/stretch matching and authored fallback order. Selected faces receive canonical owned identities; declarations are installed before the shared character update. Native whole-line SVG measurement determines the common alphabetic baseline and anchor before applying the original local/parent affine placement. No glyph-by-glyph placement, font stretching or estimated host geometry substitutes for native shaping.

The caller publishes only the complete prepared document with revision zero and empty history. Cancellation, source/decoder errors, changed revisions/owners and unsupported native settings publish nothing. Preparation callbacks see no temporary native registrations; failed/successful temporary stores release their registrations independently of the accepted asset store. Ordinary later Inspector, script/plugin, recipe and separate REST text edits use the existing shared command/Undo contract. File services remain trusted-host operations.

## Supported text graphs

- Nested inline tspans retain character formats and source order, including formatting boundaries inside complex-script text. Boundaries use UTF-16 offsets and never split a surrogate pair.
- Font-size relative lengths and inherited typography resolve in the original user plane. Matching multiple supplied faces for one SVG family is performed separately for each range. Complete selected SVG font payloads remain original-bearing native resources.
- Solid paint alpha and inherited fill opacity become character color alpha. The text element's opacity remains a layer property. A parent with no fill can still have painted descendants; invisible characters keep their advances.
- Supported `white-space: normal` collapses ASCII whitespace across span boundaries, retaining the first surviving space's format. `white-space: pre` retains literal spaces. Legacy `xml:space="preserve"` normalizes its tabs/newlines into preserved spaces; mixed supported whitespace modes retain their character styles. Explicit CSS whitespace takes precedence over inherited XML spacing.
- Existing explicitly positioned outer tspan lines can contain styled inline descendants. They become independent native text layers, retaining visual placement while losing the original shared XML/paragraph identity.

SVG can supply only delivered face bytes, not a discarded source collection. Native projects retain those complete supplied bytes; they cannot recover an original TTC omitted from the SVG. CSS family/face matching becomes explicit native face references, so the original CSS family graph is not retained. Empty XML formatting elements and the complete original XML/DOM graph are not preserved as editable objects.

## Explicit flattening boundaries

Individual inline x/y/dx/dy/rotate/textLength/transform graphs, arbitrary baseline shifts, vertical/path text, independent inline opacity groups, inline visibility changes/strokes, paint servers and unsupported CSS flow/selectors still require explicit flattened import. Preserved unpositioned line breaks/tab stops that need layout absent from the model are reported. Unsupported authoring values, including SVG spacing outside the current character field contract, are never silently clamped. Source validation can reject font matching/axis settings during import even when structural inspection was initially editable.

Flattening remains an explicit user choice and discards text editability. Supported native character import is not a promise of arbitrary SVG/CSS/font/viewer/device equivalence. Native SVG and Canvas can differ in transformed glyph edge coverage; visual import acceptance compares against the source SVG renderer and retains independent font-byte/metric/Canvas references separately.

## Trusted host use

The caller supplies a selected `File` as `svgFile`. No chooser, network request or script permission is implied:

<!-- example: svg-character-import-trusted -->
```js
const report = await editor.inspectSvg(svgFile);
if (!report.canImportEditable) {
  throw new Error("Review the unsupported features before choosing flattened import.");
}
await editor.openSvg(svgFile, {mode: "editable"});
return editor.document.toJSON().schemaVersion;
```

Imported layers use the existing [character-formatting methods](CHARACTER_TEXT.md) after publication. Independent headless REST sessions do not synchronize with browser documents, and isolated scripts/plugins do not acquire a file chooser or source-import service. No paid call, account, upload, new permission or original-resolution import cap is introduced. Verification evidence and remaining F08/F11/F14 work are recorded in the dated implementation roadmap.
