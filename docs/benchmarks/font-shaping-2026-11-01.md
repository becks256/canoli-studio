# Original-font shaping and native Canvas verification — 2026-11-01

This is an F08/F10 dependency increment toward complete native float text. It
shapes retained original SFNT runs and matches complete uniform Canvas paint;
it does not enable float TextLayer or close the original professional-editor
roadmap. [Contract and remaining scope](../FLOAT_TEXT.md#source-font-shaping-and-whole-canvas-run-matching-private).

| Verification | Result |
| --- | --- |
| Full build and TypeScript | Pass |
| Full unit/API suite | 3,374 pass across 333 files |
| Font-source/native-plan/glyph/shaping browser run | 29 pass across four files |
| Existing variable-font browser workflows | 10 pass |
| Production worker and existing typography regressions | 5 pass |
| Whole native Canvas versus positioned original glyphs | 60 exact matches, alpha error 0 at opacity 1 and 0.5 |
| Independent system-native HarfBuzz 2.7.4 versus full WASM 15.0.0 | Six runs / 12 glyphs: exact IDs, UTF-16 clusters, flags and signed metrics |
| Actual WASM float paint after native matching | Exact per-pixel alpha from independent original-font coverage; signed HDR RGB and alpha 1e-8; exact window words |
| Existing 50 MP RAW/variable text workflow | Original 100,000,672 bytes and SHA retained; 10,000 × 5,000 output; all 480,000 RGBA samples in its complete 600 × 200 independent text reference region match |

The 60 native matches cover original geometric ligatures, AV kerning, combining
marks, contextual Arabic and RTL Hebrew; source TTF, CFF and exact variable
settings; three sizes and identity/affine placement. Negative controls reject
changed glyph poses, mixed bidi, missing glyphs, intrinsic-color requirements
and foreign plans without publishing placements. Worker timeout, cancellation,
corrupt transferred GIDs, release during a blocked request, queued retry and
source retention after model/history removal pass. Host validation yields during
large expanded glyph output and cannot publish after cancellation.

The full pinned runtime is 630,939 WASM bytes. Its source/compiler pins, export
lists, exact compiler invocation and artifact digests are retained in
`src/fonts/codec/build.json`; normal builds verify these inputs and embed the
complete engine in a self-contained lazy shaping worker. Complete applicable
HarfBuzz, wrapper, Microsoft USE-table, Unicode and existing toolchain notices
are retained. Ordinary byte text does not invoke private shaping/matching.

The first packaged HB_TINY probe returned 1,000-unit vertical advances for a
fixture whose actual vmtx is 1,100. The full build returns 1,100 and matches the
independent native library. The initial browser pilot exposed first-message
loss while top-level WASM initialization delayed handler installation. Lazy
initialization after handler installation fixes it; the emitted production
worker now passes on its first message. Another pilot supplied absent V/M
characters to an A-only fixture: its explicit unavailable result was correct.
Corrected native cases retain separate missing-glyph refusal coverage. Raw
failed/corrected pilots are preserved in the compact receipt.

This verifies source shaping and the compared native uniform Canvas runs at
specified transforms/opacities. It does not prove universal browser bidi/script/
fallback layout, implicit CSS variable axes, compressed/missing/intrinsic paint,
native SVG/path/vertical matching, complete float scene/controls/interchange/
persistence, full 50 MP pixel fidelity or float text acceptance. Broader editor
performance, physical-device/photographic and every unfinished roadmap gate
remain required. Existing CSS import-order/chunk-size/directive build warnings
remain; the embedded Emscripten fallback URL warning does not cause a runtime
WASM request in the verified production path.

[Compact source, release, raw run and independent-reference receipt](font-shaping-2026-11-01.json.gz).
Large RAW/project/browser artifacts remain under `/tmp/canoli-shaped-text-2026-11-01`;
no raw benchmark ZIP is added to Git.
