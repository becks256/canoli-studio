# Native font features

Selected text now offers **Capitals**, **Font stretch**, and a numerical **Weight value** in the existing Typography Inspector. These are native font and glyph requests for a complete text layer, preserving the original Unicode string and whole-line browser shaping. They do not replace characters with uppercase or scale the layer horizontally. Point bounds, paragraph wrapping, resizing and retained rendering use the same settings.

Available glyphs and widths depend on the selected font and browser. Capitals may be synthesized, an unavailable width/weight may select a closest face, and intermediate weights only vary continuously when the selected font supports them. Font files are not imported, uploaded, embedded or licensed by this feature. Arbitrary variation axes, character runs, font management, path text and wider shaping/language support remain separate unfinished F08 work.

## Constructor and members

```ts
new TextLayer({
  text?: string,
  fontVariantCaps?: 'normal' | 'small-caps' | 'all-small-caps'
    | 'petite-caps' | 'all-petite-caps' | 'unicase' | 'titling-caps',
  fontStretch?: 'ultra-condensed' | 'extra-condensed' | 'condensed'
    | 'semi-condensed' | 'normal' | 'semi-expanded' | 'expanded'
    | 'extra-expanded' | 'ultra-expanded',
  fontWeight?: string,
  // Other existing TextLayer options remain available.
})
text.fontVariantCaps: FontVariantCaps | undefined
text.fontStretch: FontStretch | undefined
text.resetFontFeatures(): void
```

Omitted feature fields render as `normal`; getters retain `undefined` for absent legacy/unlinked fields. Valid values are exactly the case-sensitive keywords above. Unknown strings, CSS fragments, percentages, numbers and null feature values reject. `fontWeight` retains its existing CSS-string contract; the Inspector's numerical control requests values from 1 to 1000, including typed fractions. It does not promise a font has that weight or introduce a new variable-axis API. Relative/custom weights remain visible in the preset menu and can be explicitly replaced by a numerical request.

Attached assignments use `layer.update`, shared validation, effective ancestor locks and ordinary history. `resetFontFeatures()` requests normal capitals and stretch together in one command, leaving weight, source text, color and paragraph/frame settings intact. It creates explicit local normal overrides on linked text; use `resetParagraphOverrides(['fontVariantCaps', 'fontStretch'])` to resume inheritance instead. An attached setter assigned `undefined` clears that local override; JSON REST clients use explicit normal values or `text.paragraphOverrides.clear` rather than serializing undefined.

## Executable isolated example

<!-- example: native-font-features -->
```js
document.transaction('Native font study', () => {
  const body = document.paragraphStyles.add(new ParagraphStyle({
    name: 'Native caption',
    format: {
      fontFamily: 'serif', fontSize: 36, color: '#315b2a',
      fontWeight: '553.25', fontVariantCaps: 'small-caps',
      fontStretch: 'semi-condensed',
    },
  }));
  const text = document.layers.add(new TextLayer({
    name: 'Native font study', text: 'Canoli Studio — original ß é',
    x: 32, y: 32, wrapWidth: 500,
  }));
  text.paragraphStyle = body;
  document.selectedLayer = text;
});
print('Native font study ready');
```

This is the existing isolated constructor/command boundary, with no font-file, network, credential, account or export capability. Independent REST sessions use the same fields in validated commands; they do not synchronize with the browser:

```json
{
  "expectedRevision": 7,
  "commands": [{
    "type": "layer.update",
    "id": "existing-text-layer",
    "patch": {
      "fontVariantCaps": "all-small-caps",
      "fontStretch": "condensed",
      "fontWeight": "553.25"
    }
  }]
}
```

Send that body to `POST /api/v1/documents/:id/commands` in the independent REST host. Revision 7 and the layer ID are illustrative; read the actual session first. Unknown values, non-text targets, effective locks or invalid style graphs reject the entire batch; stale revisions conflict. Undo/Redo use retained results. Headless text metrics remain approximate without a browser font engine; browser Reflow text uses local native metrics.

## Styles and persistence

Both features participate in document-scoped paragraph styles, based-on inheritance, explicit style/text overrides, reset, detach, source copying and portable recipes. Empty patches/overrides stay empty: default resolution does not pin normal values as accidental local overrides. A base change propagates through unshielded followers atomically and respects effective follower locks. Applying a normal style clears a prior capital/stretch request.

Explicit feature fields require document **schema 42**, including inside style formats, bindings and embedded masters. Valid older roots/history migrate to the current schema without rewriting text or injecting feature fields into legacy unlinked layers. Missing fields resolve as normal; relabeling new fields with an older schema rejects before defaults are normalized. Older readers that support only schema 41 must reject the new root. Native project envelopes 3/4, workspace 2 and retained-history 4 remain separate unchanged versions. Original raster/TIFF/AVIF/RAW sources are unaffected.

## Native rendering and export

The shared text state configures capital variants/stretch for measurement, ink bounds, full-line rendering, wrapping/justification, caches and exports, and resets absent values on reused contexts. Stretch participates in native font matching and font-readiness checks. Referenced registered fonts retain the existing snapshot/lifetime guards; an unavailable/pending required face cannot silently become another generation during export. A new family load may require explicit Reflow text to refresh authored bounds.

Nondefault feature requests reject before native drawing if the browser lacks the corresponding Canvas property. Inspector selectors disclose unsupported controls and Reset font features remains available when editing is permitted. Default normal settings still render in older browsers. This capability check does not prove a font contains every requested OpenType table or that all browsers shape identically.

PNG now captures an immutable model and referenced source/font generations before the first progress callback, and validates them around native tiles, compression and final assembly. Pending requested faces, relevant source/font loss, selected-store disposal, cancellation and callback errors produce no file and release returned surfaces; later live model edits cannot change captured pixels. This closes a reproduced gap where a pending width face could load during an unguarded PNG export. PNG, TIFF, PDF and AVIF retain their separately documented native export contracts. Native raster outputs contain the rendered glyphs. Editable SVG text emits the corresponding `font-variant-caps` and `font-stretch` requests, including in its private measurement probes; default legacy SVG markup stays unchanged. Source text remains literal editable text. SVG does not embed fonts or guarantee cross-viewer glyph placement; supported import remains the separately reported SVG subset, not a new rich-text importer. Native projects retain source text, style links and requested settings.

Primary references: [Canvas text styles and native font requests](https://html.spec.whatwg.org/multipage/canvas.html#text-styles), [CSS font capital variants](https://www.w3.org/TR/css-fonts-4/#font-variant-caps-prop), [CSS font width selection](https://www.w3.org/TR/css-fonts-4/#font-stretch-prop). The dated implementation roadmap records acceptance and remaining scope; this guide does not establish complete F08, F11, F14 or roadmap completion.
