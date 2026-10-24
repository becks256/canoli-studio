# Font-file inspection and private preview

Open **Document fonts** from command search or **Manage document fonts…** in the Typography Inspector. Expand **Inspect font files** and choose a local TTF, OTF, WOFF, WOFF2, TTC or SFNT datafork (`.dfont`). The source is read locally in a disposable worker. Choosing a font does not install it, change document text or add an Undo entry.

The inspector shows source size/container, face count, declared family/style/PostScript names, glyph count, units per em, OS/2 weight/width classes, raw embedding flags, declared copyright and variable-axis ranges. Names and flags are file declarations, not verification of authorship, licensing rights, glyph coverage or native rendering quality. Missing values stay unknown. Unsupported or malformed sources reject with a recoverable error.

Single-face files select their only face. Collections require an explicit choice. File faces and axes have separate 16-row pages; pagination retains access to the complete source. **Preview selected face** prepares only the chosen face, asks the browser to validate it and shapes a sample in a private iframe font set, then copies only its pixels to the visible preview canvas. The editor's font set and artwork remain unchanged. Characters absent from the selected face use browser fallback. The sample is limited to 512 UTF-16 units; this is a UI budget, not a font-file or source-image limit. Closing the disclosure/dialog or replacing the source cancels its pending operation and discards late results.

This is the source-admission foundation for F08. Installing/document binding, font embedding, project/workspace/history persistence of font files, relinking and portable font-library workflows remain unfinished. Ordinary projects currently retain font requests and styles, not these inspected source files.

## Trusted browser API

```ts
editor.inspectFont(
  file: Blob,
  options: { offset?: number; limit?: number } = {},
  control: FontSourceControl = {},
): Promise<FontInspection>

editor.prepareFontSource(
  file: Blob,
  options: { faceIndex?: number } = {},
  control: FontSourceControl = {},
): Promise<PreparedFontSource>

interface FontSourceControl {
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?(value: {
    phase: 'reading' | 'inspecting' | 'extracting' | 'validating';
    fraction: number | null;
  }): void;
}
```

The required source is a nonempty `Blob` (a browser `File` is accepted). File extensions and the caller's MIME type do not choose the parser: actual bytes determine the container. There is no application file-size cutoff. The source and derived face must fit browser memory and supported native font formats; this is not streaming or constant-memory parsing.

`inspectFont` defaults to offset **0**, limit **32**. Offset is a safe nonnegative integer; limit is an integer **1–128** and bounds only returned face metadata. An offset at or beyond the actual face count rejects. Results contain consecutive indices from the requested page and retain the complete collection count.

`prepareFontSource` defaults to face index **0** only for single-face sources. A collection with more than one face requires an explicit safe nonnegative `faceIndex`, within its actual count. Its report contains exactly the selected face and sets `offset` to that index. Unknown option fields, invalid numbers or unsupported metadata reject.

Both APIs are trusted `EditorApplication` services. They are not constructors, `Document.fonts` mutations, isolated Scripts globals, internal-plugin capabilities or independent REST endpoints. Preparation is independent of the active document and does not capture or retarget artwork. Disposing the application aborts its pending font operations and future calls reject. Existing isolated `document.fonts.items/replace` continues to operate on family requests with shared validation, locks and history.

## Result ownership

`FontInspection` is an owned recursively frozen version-1 DTO:

| Field | Meaning |
| --- | --- |
| `version`, `parser` | `1`, `fontkit-2.0.4`; pinned parser identity. |
| `format` | `ttf`, `otf`, `woff`, `woff2`, `ttc` or `dfont`, from source bytes. |
| `byteLength`, `sha256` | Exact complete original source length and lowercase SHA-256. |
| `faceCount`, `offset`, `faces` | Complete count and the requested consecutive page. |

Each face contains `index`, `id`, `cssFamily`, nullable `family/subfamily/fullName/postscriptName/copyright`, `unitsPerEm`, `glyphCount`, nullable raw `weightClass/widthClass/embeddingFlags`, `axes` and `descriptors`. Axis records contain a four-ASCII-character `tag`, nullable declared `name` and finite ordered `min/default/max`. Native descriptors contain `style`, `weight` and `stretch`; supported `wght`/`wdth` ranges map to native CSS descriptors, and a variable `ital` axis spanning 0–1 produces normal and italic faces. This does not add arbitrary-axis editing, shaping, script coverage or closest-face guarantees.

The stable face ID is SHA-256 of UTF-8 `canoli-font-face-v1\0` followed by the original source SHA-256, `\0`, and the decimal index. Its CSS alias is `CanoliFont_${id}`. Declared font names are never interpolated into CSS identifiers. Identical source/face inputs share an identity; different collection indices remain distinct.

`PreparedFontSource` is a frozen wrapper with:

| Field | Meaning |
| --- | --- |
| `original` | The exact caller-owned original Blob, unchanged. |
| `report`, `faceIndex` | Frozen selected-face metadata and source index. |
| `renderBlob`, `renderSha256`, `renderFormat` | Complete browser-loadable face bytes, independently hashed; native MIME/format is `font/ttf`, `font/otf`, `font/woff` or `font/woff2`. |
| `extracted`, `repacked`, `omittedTables` | Explicit source transformations described below. |
| `fontFaces` | Frozen array of caller-owned, mutable native `FontFace` handles with status `loaded`. They have **not** been registered in the editor's or any other font set. |

The host validates strict response metadata, source and derived lengths/digests, face identities, selected page/index, native signature/MIME and transformation consistency before returning. These hashes describe integrity and identity, not trusted provenance. No result enters the image AssetStore, document model, history or persistent library.

Standalone TTF/OTF/WOFF/WOFF2 render bytes remain byte-identical to the original. TTC preparation copies every table of the selected face without subsetting, rebuilds its standalone directory/alignment/checksums and omits its `DSIG` table if present. `extracted/repacked` are both true; `omittedTables` explicitly lists `DSIG`. The original TTC, including any signature bytes, is retained unchanged. A datafork returns the selected complete original SFNT resource byte-for-byte, with `extracted:true`, `repacked:false`. Repacked bytes are not represented as preserving a digital signature.

## Example: inspect and prepare a local collection

This is trusted application integration code, outside the isolated Scripts panel. `editor` is an existing `EditorApplication` and `source` is a `File` selected by the user:

```ts
const abort = new AbortController();
const page = await editor.inspectFont(source, { offset: 0, limit: 16 }, {
  signal: abort.signal,
});
// Present page.faces and require an explicit selection for multi-face files.
const selectedIndex = page.faces[0].index;
const prepared = await editor.prepareFontSource(source, {
  faceIndex: selectedIndex,
}, { signal: abort.signal });
console.log(prepared.original === source); // true
console.log(prepared.fontFaces.every(face => face.status === 'loaded')); // true
console.log(prepared.fontFaces.every(face => !document.fonts.has(face))); // true
```

The example's index is illustrative: the product explicitly asks the user to choose a collection face. The DOM `document` here is the browser document, not Canoli's public OO `Document`. Trusted consumers choose where to register returned handles and must remove their own registrations. The built-in preview uses only its private, script-disabled iframe's `FontFaceSet`, blits its pixels to the visible parent canvas and removes registrations on replacement/unmount; it never installs globally. Script-disabled iframe canvas fallback content is not used as the visible preview.

## Scheduling, errors and cancellation

The inspector module loads only when Document fonts opens, and the font client loads only when a trusted source operation is requested. Ordinary editor startup does not request either module or the font-parser worker. `npm run build:font-worker` (included in the normal build/development engine prerequisite) compiles a self-contained browser worker and source-digest manifest in `src/generated`; it rejects external runtime imports. The parser does not share the editor's dependency optimizer. Host jobs use a FIFO with one active parser worker. Waiting jobs hold immutable source Blobs and allocate no parser workers. Each operation creates a fresh module worker, reads/hashes/parses its source off the UI thread and terminates that worker on response, error, cancellation or timeout. Host integrity validation and native loading remain asynchronous browser work.

The active timeout defaults to **60,000 ms** and must be a positive integer no greater than **2,147,483,647**. Queue waiting time is excluded. The same deadline covers worker parsing, host result validation and native loading. Progress fractions are currently `null`; phase changes are not precise percentages. A throwing progress callback rejects and releases the active host job.

An already aborted signal rejects before work. Aborting a queued job removes it from the queue; aborting an active job terminates its parser and prevents publication. Native `FontFace.load()` and browser Blob/hash operations cannot be forcibly cancelled after they start: their late results are discarded, remain unregistered and cannot publish a successful result. Thus cancellation is not a guarantee of immediate native-memory reclamation or that an abandoned native load cannot overlap a following job.

Worker construction/load/protocol failures, unsupported/truncated font data, corrupt collection ranges/tables, invalid metadata/options, fingerprint/selection mismatches, native font rejection, timeout, disposal and cancellation all reject. No synthetic font or silent editor installation substitutes for failure. Worker errors mention source/memory checking; native rejection identifies browser validation without implying a network download failed. Retry with a valid file starts a new worker. Retaining returned Blobs/FontFaces retains their browser resources; discard references when finished.

## Dependency notices

The production build generates the installed parser dependency closure's [license notices](/font-parser-notices.txt). Original geometric test fixtures are repository-generated; the separate variable-font check uses the existing pinned Manrope dependency. No commercial font outlines are bundled by this feature.
