# Document fonts

**Inspect font files** now offers local source metadata, explicit collection-face selection and private native preview within this dialog. Inspection and private preview preserve complete originals without attaching fonts or changing artwork. **Embed selected face** is a separate explicit, undoable operation; [FONT_FILES.md](FONT_FILES.md) describes its source ownership, native persistence, APIs and remaining acceptance work. Closing cancels pending inspection/embedding work. Source signatures, host APIs, scheduling, native validation and current limits: [FONT_SOURCES.md](FONT_SOURCES.md).

Open **Document fonts** from command search (`Mod+K`) or **Manage document fonts…** in the Typography Inspector. There is no default shortcut. The dialog lists exact authored family requests, including complete fallback lists, across all ordinary and hidden text, paragraph styles and every stored embedded document, including unused definitions. Search and 30-row pages retain the complete inventory.

Select a request to inspect text/style/override counts and a local availability probe. Choose a replacement preset or type a family/fallback list. Installed-font discovery is an explicit permission-controlled action shared with the Typography picker; denial is recoverable and manual entry remains available. Unavailable or unknown replacement requests require **Allow browser fallback for this replacement**. Availability is a family probe at the time of inspection; it does not prove glyph coverage, weight/width support or cross-device fidelity. Refresh to check again after fonts change.

**Replace font** changes the selected exact request throughout the captured document. Text content, position, transformations, authored paragraph width, all other typography, selections and original image assets remain unchanged. Point/paragraph bounds reflow. Inherited styles retain their links, inherited values stay inherited, and explicit font overrides remain explicit. Hidden layers and unused styles/masters are included. Changed locked text/ancestors or affected locked component instances reject the complete operation. A locked follower shielded by a different font override need not change. Close the dialog to use ordinary one-step Undo/Redo.

A changed document revision disables replacement until an explicit refresh. A closed/switched document rejects; reopen the manager for the current document. Search and availability results never retarget a pending replacement. Closing/canceling does not edit the document. Installed fonts are not embedded automatically; another environment may use different installed fonts or fallback. Explicit embedded faces retain selected native bytes and complete original sources in native project 5. Complete font-file transport/removal acceptance, arbitrary axes, character runs and path text remain unfinished F08 requirements.

## OO API

```ts
document.fonts: DocumentFonts
document.fonts.items: DocumentFontUsage[]
document.fonts.replace(from: string, to: string): void

interface DocumentFontUsage {
  family: string;
  textLayers: number;
  paragraphStyles: number;
  overrides: number;
  embeddedScopes: number;
  lockedTextLayers: number;
}
```

`items` returns owned metadata, locale-sorted by the exact stored request. No arguments or selection/visibility filter apply. Each physical stored embedded scope contributes its own text/style occurrences, even when scoped IDs collide. `paragraphStyles` counts resolved style records; `overrides` counts explicit font-family overrides on text and based-on styles. `embeddedScopes` counts embedded scopes containing that request. `lockedTextLayers` counts effective text/ancestor locks in the owning scope; component-instance locks can additionally block replacement. This is metadata, not a count of rendered glyphs or repeated instances.

`replace` requires both strings, each 1–240 UTF-16 units, with no normalization or case folding. The complete string is matched; replacing `serif` does not replace `Serif`, `'serif'`, or `serif, monospace`. A missing request or equal strings is a no-op with no history/revision. Unknown command fields, invalid arguments, lock failures, invalid font-dependent layout or failed enclosing transactions reject atomically before publication. As with other commands, observer errors after accepted publication retain the accepted result and report that boundary. Native browser measurement and headless estimates retain the existing typography contract. The command reflows affected text through the same native typography path as attached TextLayer setters.

## Executable isolated example

<!-- example: document-font-management -->
```js
const body = document.paragraphStyles.add(new ParagraphStyle({
  name: 'Font management study',
  format: { fontFamily: 'serif', fontSize: 30, color: '#315b2a' },
}));
const caption = document.layers.add(new TextLayer({
  name: 'Font management caption', text: 'Canoli Studio — é العربية',
  x: 32, y: 32,
}));
caption.paragraphStyle = body;
document.selectedLayer = caption;
const before = document.fonts.items;
document.fonts.replace('serif', 'sans-serif');
if (caption.fontFamily !== 'sans-serif') throw new Error('Font replacement failed');
print('Document font replacement ready');
```

The provided `document` shares the ordinary isolated command boundary. All edits in one successful script commit together. Internal plugins need granted `document:read` to inspect and `document:write` to replace, with host permission/revision checks before commit. Installation stays inert; no font/file/network privilege is added. Original sources and already accepted undo history retain their normal ownership.

## Independent REST

`GET /api/v1/documents/:id/fonts` returns `{ id, revision, fonts: DocumentFontUsage[] }` for that headless session. It does not inspect browser-installed fonts or synchronize with a browser document.

Submit the same strict command through the existing command endpoint:

```json
{
  "expectedRevision": 4,
  "commands": [
    { "type": "document.font.replace", "from": "serif", "to": "sans-serif" }
  ]
}
```

Use `POST /api/v1/documents/:id/commands`. The example revision must be replaced with the current revision. Existing revision conflict (409), validation/lock error (400), command-batch rollback and Undo/Redo behavior apply. Headless geometry is estimated, not native-browser font measurement.

## Recipes and persistence

The semantic recorder emits one `document.font.replace` action without a layer target. Recorded steps keep `from` and `to` literal with the existing `literalValues:true` step flag, including strings containing parameter syntax. Authored steps may omit that flag (default false) and bind `${parameter}` values. Dry-run executes shared validation/locks against a private model, reports changed text frames across scoped IDs and adds no spend/AI operation. Existing recipe packs and batch execution use that same plan and one atomic apply.

Native projects, retained history, workspace recovery and copied embedded/style data already retain the resulting font strings and inheritance; their format versions do not change. Font availability, permission results and the dialog draft remain browser-session state.
