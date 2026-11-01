# Complete private font decoding and native hinting — 2026-11-01

This F08/F10 increment prepares complete selected WOFF/WOFF2 SFNT sources for
native glyph selection and cached source shaping. It also preserves OpenType
layout data required for correct native hinting of unencoded glyphs. Public
compressed files, model/IDs, registrations/appearance and transport stay unchanged.
Full native typography and the original roadmap remain open.
[Contract and remaining scope](../FLOAT_TEXT.md#complete-compressed-font-preparation-private).

| Verification | Result |
| --- | --- |
| Full build and TypeScript | Pass |
| Full unit/API suite | 3,392 pass across 335 files |
| One complete affected native-browser run | 66 pass across seven files |
| Production decoder, shaping and typography run | Seven pass |
| Independent FontTools 4.51.0 / Brotli 1.2.1 references | 17 sources pass, including four emitted production outputs |
| Complete outline/composite/instruction comparison | 587 glyphs, 140 composites and 9,810 glyph-instruction bytes match |
| Untransformed tables / cmap / horizontal metrics | Exact across every independent case |
| Native selected-font matrix | 72 exact complete-run matches across geometric and full pinned fonts |
| Resolved substitution control | Original A→composite substitution applies in source shaping; disabled resolved GID paint matches independently disabled original pixels at three sizes |
| Actual WASM Float32 paint after compressed preparation | Exact independently computed ordered alpha, signed HDR RGB, alpha 1e-8 and all window words |
| Existing 50 MP RAW/variable text regression | Original identity/dimensions retained; every RGBA sample in the complete 600 × 200 independent text reference region matches; full PNG bytes match the preceding accepted release |

Original generated fixtures retain glyph/composite hints, fpgm/prep/cvt/gasp,
GSUB/GPOS/vertical layout, CFF and variable data. WOFF2 checks include ordinary
glyf/loca, optional hmtx and null transforms. Full pinned Manrope and DM Mono
exercise actual production fonts. Host checks validate source/output fingerprints,
complete table-directory correspondence/checksums, original units/glyph count
and unregistered native loading. Captured owners retain checked complete SFNT
for shaping without another decoder job or source reread. Cancellation, timeout,
corrupt fingerprints/table bytes, queue recovery, source/model/history removal,
private feature-capability refusal and complete cleanup pass. No private font
is published after a failed operation.

The first full-font pilot exposed 24 differing pixels (maximum alpha error 44)
in Manrope's unencoded fi ligature at 13 px without an affine transform. Isolated
original clusters matched the full native line; private selected glyph paint did
not. Finer shaping precision and optional-ligature trials did not fix it and are
reverted. Keeping original GSUB/GPOS/GDEF bytes and disabling their declared
features on private faces fixes exact native pixels without widening assertions.
This is consistent with FreeType's documented use of OpenType data to classify
unencoded glyphs for auto-hinting; the rasterizer internals were not instrumented.
The explicit substitution control verifies source shaping cannot reapply in
already-resolved paint. All earlier glyph/native/font workflows still pass.

The compiled complete WOFF2/Brotli WASM is 191,608 bytes. Source revisions,
compiler/bridge, complete C/C++ commands and artifact hashes are pinned in
`src/fonts/decode-codec/build.json`; normal builds verify those inputs and embed
all decoder bytes in the disposable worker. There is no extra WASM fetch or
filesystem. WOFF1 uses native Deflate. The streaming writer removes its default
output cap without trusting WOFF2's advisory original size. Existing upstream
format/compression-ratio checks and actual WASM/browser/native memory remain.
Original font/image/document geometry and existing import behavior are unchanged.
Complete upstream notices are retained in the public font notice artifact.

Full compressed collection selection, every native/legacy font/host, native
bidi/script/fallback/optical selection, missing/intrinsic glyph paint, SVG/path/
vertical matching and complete float TextLayer authoring/scenes/export/shared
transport/persistence remain required. This does not establish full 50 MP pixel
or float typography acceptance, photographic/device quality or sustained
editor-wide responsiveness. Every unfinished original roadmap gate remains.

[Compact source/release/raw-run/independent-reference receipt](font-decode-2026-11-01.json.gz).
Large local browser/project/source evidence stays under
`/tmp/canoli-font-decode-2026-11-01`; no raw benchmark ZIP is committed.
