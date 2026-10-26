# Native vertical text preparation

Status: internal F08 rendering/layout dependency. Current public TextLayer, document schema 46, Inspector, isolated scripting/REST commands and editable SVG import/export do not expose vertical-writing properties yet. Their integration remains required by the original roadmap. The dated implementation record distinguishes verified work from pending acceptance.

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

Public writing-mode/orientation properties, reusable paragraph styles, derived frame persistence, shared commands/native script metrics, Inspector controls, vertical resizing, recipes/projects/REST and supported editable SVG return remain required. Richer flow, broader shaping/interchange/device quality and sustained all-tool performance are also open. This internal dependency does not complete vertical authoring, F08 or the original professional-editor roadmap.
