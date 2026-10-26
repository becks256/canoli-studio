# SVG fonts and editable text

Status: scoped F08/F11 font-source and horizontal-text implementation. See the implementation roadmap for accepted evidence and remaining gates. This extends trusted SVG file import; it does not claim general SVG or professional typography parity.

## Choosing an import

The image picker/drop preflight retains **Import editable**, **Import flattened** and **Cancel**. Editable import reconstructs supported geometry and horizontal text and keeps supplied font bytes in the native project. Flattened import explicitly captures the browser SVG image decoder's pixels, losing text/font editability. Existing edited tabs stay open. Source errors, cancellation and stale owners publish no partial document.

`editor.inspectSvg(file:File,control:SvgImportControl={}):Promise<SvgImportReport>` remains read-only structural inspection. Version-1 reports add `fonts:number` (parsed embedded font declarations) and `texts:number` (planned native text layers) to the existing counts and findings. These counts do not certify font/image decoding or native layout. `editor.openSvg(file:File,options:{mode?:'editable'|'flatten'}={},control:SvgImportControl={}):Promise<SvgImportReport>` defaults to editable and rejects unsupported reconstruction; it never silently switches to flattened output. Unknown options/modes reject.

Controls retain `signal` and `onProgress({phase,fraction})`, with reading/inspecting/decoding/rendering phases and a fraction from 0 to 1 or null. Font preparation uses decoding progress, the existing disposable parser and its 60000ms active default deadline, excluding queue wait. Native faces load unregistered. Temporary registration surrounds only synchronous layout; no await or progress callback runs with newly registered preparation faces. Cancellation, callback failure, document revision/session changes and source-store disposal reject before publication. Temporary stores, fonts, workers, canvases and image surfaces release on failure.

## Font files

Top-level `@font-face` rules in inert SVG style elements may supply complete base64 data-URL TTF, OTF, WOFF or WOFF2 files, including URI-encoded base64 payloads. The source parser validates actual original bytes and prepares the native face; neither MIME declarations nor CSS metadata prove font validity. Ordered embedded source alternatives are tried without fetching URLs. Unsupported format/technology hints, local() references, unicode-range restrictions, arbitrary font-face descriptor overrides and conditional/selector rules require explicit flattened import where the browser can render them. All external URLs, imports, animation, executable SVG/HTML and entity processing remain rejected before either mode.

CSS is parsed with pinned [CSSTree](https://github.com/csstree/csstree), including escaped tokens, custom-property values and string URLs in image/image-set functions. Computed image references are rejected instead of resolving a CSS variable into an unreviewed URL. CSS geometry and transforms, including escaped property names, require explicit flattened import. Inline CSS `dx`/`dy` must never act as XML text-position attributes; these declarations also require explicit flattening, while actual `dx`/`dy` attributes retain supported native positioning. The supported parser-only entry points omit unused validation dictionaries; [distributed parser notices](/svg-parser-notices.txt) identify the actual browser dependency graph. Styles are never inserted into the live editor page. Inline declaration priority and quoted family names containing semicolons are preserved. Family/style/stretch/weight selection uses the declared faces and the [CSS Fonts matching order](https://www.w3.org/TR/css-fonts-4/#font-matching-algorithm), then remaps selected families to independently owned native face identities. Editable source matching descriptors must agree with the parsed face's canonical descriptors; unsupported synthesis/matching overrides fail with an explicit flattened-import message. Malformed embedded font files fail admission rather than silently publishing fallback typography.

Native projects retain the exact supplied font originals and selected native bytes under the existing FontFile ownership/history contract. Reimporting a standalone selected face from an exported collection creates an identity for those delivered bytes and remaps its old SVG family request. It cannot reconstruct an omitted original TTC or other source file that the SVG never contained. Unused supplied faces are not attached to the editable document. Ordinary installed/system font requests stay external references with possible substitution. Missing generated Canoli family bytes fail instead of becoming fallback text.

## Text and placement

Supported horizontal text includes inherited family, size, weight, normal/italic style, capital variants, native stretch, kerning, letter/word spacing, literal solid fill/alpha, physical start/middle/end anchors, LTR/RTL direction and alphabetic baselines. Absolute and font-relative lengths resolve in the authored user plane; font-size percentages use the inherited size. Full root viewBox and local/parent affine transforms stay separate from text geometry. Native loaded-font metrics determine final bounds and top-to-alphabetic placement before the clean revision-zero baseline is published.

Default whitespace collapses ASCII spaces/tabs/newlines; supported xml:space preserve and white-space pre retain literal spaces. Uniform unstyled tspans retain their existing whole-line path. Supported nested inline character styles now become native character ranges after private source matching and whole-line native baseline/anchor measurement; see [SVG_CHARACTER_IMPORT.md](SVG_CHARACTER_IMPORT.md). Explicitly positioned outer tspan lines may contain styled descendants and become independent text layers; their shared DOM/paragraph identity is reported lost. Individual inline position lists, arbitrary baseline shifts, vertical/path text, textLength, text strokes/paint servers, unsupported tab stops/preserved unpositioned line breaks and richer CSS flow require flattened import. Percentage positions/spacing are not approximated. SVG and Canvas shaping, hinting, whitespace and edge sampling can differ; no general pixel-exact interchange is promised.

## Trusted read-only example

The caller supplies a selected SVG File as `svgFile`. This code performs no chooser, fetch, native source installation or edit. It belongs to trusted application code, not the isolated Scripts panel.

<!-- example: svg-font-inspection-trusted -->
```js
const report = await editor.inspectSvg(svgFile);
return {
  canImportEditable: report.canImportEditable,
  fonts: report.fonts,
  texts: report.texts,
  unsupported: report.unsupportedFeatures,
};
```

File services remain unavailable in isolated Scripts/plugins and independent headless REST. No new document schema, plugin permission, account, paid operation, cloud upload or arbitrary source-image/font size limit is introduced. Broader SVG graph/identity fidelity, richer character/paragraph flow, path/vertical text, multilingual/device/viewer/mixed-source acceptance and sustained editor-wide performance remain required.
