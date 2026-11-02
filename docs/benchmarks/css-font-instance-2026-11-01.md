# Native CSS font-instance projection — 2026-11-01

This F08/F10 increment connects original-source shaping to native CSS weight,
width and observed style-axis/default behavior. Full native typography and the
original roadmap remain open. [Private contract](../FLOAT_TEXT.md#css-selected-source-font-instances-private).

| Check                                                                                   | Result                                                                                                                                                |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full build and TypeScript                                                               | Pass                                                                                                                                                  |
| Full unit/API suite                                                                     | 3,379 pass across 334 files                                                                                                                           |
| Complete affected native browser run                                                    | 47 pass across six files                                                                                                                              |
| Production worker and typography regressions                                            | Six pass                                                                                                                                              |
| Independent FontTools static-instance reference matrix                                  | 36 exact full RGBA and advance matches across three sizes and two transforms                                                                          |
| Native relative/fractional weights, descriptor clamps and non-lattice explicit settings | Six exact whole-run matches; unchanged model/source and immutable captured metadata                                                                   |
| CSS-selected glyphs through actual Float32 WASM paint                                   | Exact independently calculated ordered alpha, signed HDR RGB, alpha 1e-8 and complete window-word partitions                                          |
| Existing 50 MP RAW/variable-font workflow                                               | Full original identity and 10,000 × 5,000 output retained; all 480,000 RGBA samples in the complete independent 600 × 200 text reference region match |

The fixture is original geometric artwork with wght, wdth, ital and slnt axes.
Independent static references cover ordinary/fractional weights, wide slant,
explicit ital, a native italic-declared default and explicit tuple overrides.
Only source-supported style/default modes are tested, with no arbitrary axis
fitting and no widening of native ink/advance assertions. The complete native
run remains unchanged; mismatch/unavailable results never provide paint poses.
Caller mutation, native shorthand errors, descriptor/source clamps, source/parent
lifetime, cancellation/timeout/retry, original context and glyph transfer checks
retain the existing boundaries. Public commands, model/source bytes, ordinary
font registrations and appearance, Undo and transport remain unchanged.

The native serialization probe returns a weight of 639 for an authored 639.75,
while actual rendering retains the fraction. Keeping the authored number avoids
that loss. Relative requests use resolved native shorthand. Native probes also
show slnt preference when both style axes exist, and no automatic ital change
for the tested italic-declared source lacking slnt. Exact whole-ink matching
selects among supported axis/default modes, without claiming to fix ordinary
registration or promise all browser mappings. Explicit original tuples override
the CSS-derived values in every mode.

The first independent static pilot rounded nonintegral glyph coordinates during
FontTools instancing and therefore did not provide an exact native pixel oracle.
Reference cases now use representable normalized coordinates and integral
outlines. The original harder 639.75 and 550.25 requests remain in separate native
whole-run cases and pass with zero alpha error. Raw failures/corrections are in
the compact receipt, including the initial missing style-default mode.

Automatic optical sizing, complete native CSS/face/fallback/bidi/script coverage,
compressed source preparation, missing/intrinsic glyphs, native SVG/path/vertical
matching and complete float TextLayer authoring/scenes/export/shared transport/
persistence remain required. Fontkit's WOFF2 transformed glyph objects omit
instruction bytes; reconstructing outlines alone is not an exact native font
decoder. Full compressed table/hint reconstruction still needs implementation.
This does not establish all 50 MP output pixels, float text acceptance, sustained
editor-wide performance, photographic quality or physical-device behavior.

[Compact source/release/raw-run/reference receipt](css-font-instance-2026-11-01.json.gz).
Large local RAW/project/browser evidence stays under
`/tmp/canoli-css-font-instance-2026-11-01`; no raw benchmark ZIP is committed.
