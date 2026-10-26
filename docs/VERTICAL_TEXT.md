# Vertical text

Status: public schema-47 authoring is connected. TextLayer/paragraph commands, native script metrics, custom Inspector, vertical resizing, persistence/recipes, independent REST and supported SVG output/reimport are implemented. The dated roadmap records completed checks separately from remaining acceptance. This does not complete F08 or the original professional-editor roadmap.

## Native writing and logical source

Private character-layout input and styled render lines accept `writing: {mode, orientation}`. Mode is `horizontal-tb`, `vertical-rl` or `vertical-lr`; orientation is `mixed`, `upright` or `sideways`. Missing members default to horizontal and mixed. Unknown values/keys reject; captured settings, styles and logical Unicode source remain owned/frozen before asynchronous work.

The native SVG engine shapes complete logical lines using owned fonts, vertical metrics and automatic font substitutions. This follows the [CSS Writing Modes](https://www.w3.org/TR/css-writing-modes-3/) and [SVG text](https://www.w3.org/TR/SVG2/text.html) model. It does not rotate a horizontal bitmap or position individual glyphs. Native host shaping, fallback and bidirectional behavior remain the rendering authority; broad language/font/viewer conformance still needs its own acceptance. Unsupported native writing-mode/orientation capability rejects explicitly and releases preparation resources.

## Columns, frames and caller windows

The existing source-aware line breaker supplies logical inline positions, soft/forced breaks, indentation, inter-word justification and paragraph spacing. Its private `wrapWidth` is the inline extent: physical height for vertical text. Each complete native line is measured vertically; vertical-rl stacks columns to the left and vertical-lr to the right. Mixed character sizes determine each column's block extent. Line/paragraph gaps remain independent of authored text.

The private result includes physical width/height, a separate local frame origin, source-indexed lines and native ink/advance metrics. Empty columns retain a valid frame. Vertical frames include native ink overhang plus logical inline/column extent; authoring and placement are not rewritten. Without a DOM, the synchronous core marks its provisional geometry `estimated`; browser rendering/preparation requires native measurement.

Caller-selected bitmap windows and affine transforms remain independent of source/document resolution. Work windows can cross processing boundaries without downsampling the original. Vertical text on an existing cubic baseline uses native textPath layout and signed start/normal offsets; the normal displacement uses SVG `dx` in a vertical flow. Baseline traversal does not reverse source Unicode.

Font captures, native instance validation, input snapshots, cancellation/stale-work checks, probe/URL cleanup and explicit bitmap release retain the existing styled-text ownership boundary. Preparation does not mutate documents/history or publish source bytes. No new source limit, paid call, account, upload, plugin grant or isolated import capability is introduced.

## Independent checks and remaining integration

Original geometric test fonts include explicit `vhea`/`vmtx` data and vertical GSUB features. Literal SVG references use the complete original font and separately authored numeric column grids. A second font with the same original cmap/outlines/metrics but no GSUB provides an independent substitution control. These fixtures verify mechanics, not representative Japanese language quality.

An initial reference manually remapped alternate glyphs through a cmap. Direct SVG-only rendering reproduced its 50-channel mismatch outside the editor, even with matching advances and line bounds. The final pixel oracle uses original-font native shaping; no tolerance or renderer correction replaces exact pixel equality. Initial/corrected fixtures, probes and artifacts are retained with the dated evidence.

Public writing-mode/orientation properties now share OO commands/history and inherited paragraph formats. Derived `textFrameOrigin` and `textInlineExtent` are distinct from authored x/y and physical width/height. A mixed-size 40/56px native line can have a 138px logical inline extent and a 139px physical frame; rendering/SVG center against 138px, avoiding a half-pixel shift. These caches cannot be supplied through layer-update patches. Path frames retain `textPathOrigin`. Schema 47 gates field presence; legacy 46 remains readable, and native project 5/workspace 2 envelopes are unchanged.

Paragraph formats resolve horizontal/mixed semantic defaults without opting ordinary horizontal text into native rendering. First native writing retains an empty character-range marker, so switching back to horizontal keeps native shaping. Captured default writing overrides survive JSON and later base-style edits. Strict host/native metric handoffs own nested origins and retain logical inline extent separately. Existing grant/deadline/revision/cancellation/source checks apply to awaited `setWriting` and native reflow; scripts/plugins gain no file, source-byte or network access.

Inspector writing/orientation controls and top/center/bottom labels use the custom system. In vertical paragraphs `wrapWidth` is height, shown as Paragraph height; corner handles change that inline extent while retaining fonts and the opposite frame corner. Point-text resizing scales fonts/ranges and compensates the new origin under affine parents. Returning to horizontal permits recovery on unsupported browsers.

SVG exports native CSS writing/orientation, automatic vertical baselines and `dx` path normal offsets. Supported inert import retains writing outside the placeholder model until owned source preparation and actual native placement. Exported columns become independent editable text layers; shared paragraph flow and style relationships are not reconstructed. Inline writing/direction/anchor changes, explicit incompatible vertical baselines, sideways writing modes and unsupported CSS/positioning still require explicit flattened import. Native host shaping/fallback remains authoritative; this is not universal CSS, Japanese language, browser or viewer conformance.

Public API signatures, defaults, errors and the executable isolated example are in [SCRIPTING_API.md](SCRIPTING_API.md#vertical-text). Native project/workspace/recipe transport preserves accepted fields and complete image/font originals. Independent REST uses shared commands with estimated headless frames and no live browser synchronization. The dated roadmap records the exact Inspector, native-reference, 50 MP public save/reopen, unit/build and production checks and their tested environments; it is the authority for completed acceptance. Richer flow, broader shaping/interchange/device quality and sustained all-tool performance remain open.
