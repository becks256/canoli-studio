# Private native glyph paint — 2026-11-01

This advances the full F08/F10 objective with actual private glyph painting.
Captured text plans now own glyph-selector font resources and ordered native
Float32 fields. They consume explicitly resolved glyph IDs and poses; full
native text shaping/fallback matching and float TextLayer integration remain
required and gated. [Contract and limits](../FLOAT_TEXT.md#owned-glyph-selection-and-native-float-paint-private),
[compact evidence](glyph-paint-2026-11-01.json.gz).

Verified on Node 26.13.0 and Chrome for Testing 153.0.8010.12:

- Full build/typecheck passes with 51 guides and a separate 6,913-byte glyph
  worker with no external imports. The existing parser remains separately
  compiled; glyph work uses the same single active font-job queue.
- All 3,366 unit/API cases across 332 files pass against rebuilt WASM. The nine
  new unit cases verify original glyph outlines/advances/maps, table/result
  rejection, collision-free existing PUA preservation, actual native ordered
  HDR/alpha composition, request snapshots and invalid/cancelled publication.
- One final complete source-browser run passes 37 cases across four files,
  including six new glyph cases, retained font/text regressions and the existing
  inspector failure/cancellation/recovery checks. No retries, skips or flaky
  cases. TTF, CFF and exact variable instances match original native glyph pixels
  at 13/40/80px in ordinary/affine placement (18 exact comparisons). Parent/model/
  history retirement, private face collection, worker timeout and retry pass.
- Real WASM glyph fields retain [4,-0.25,1.5] RGB. Two overlapping opaque-coveraged
  glyphs produce alpha 0.75 at source alpha 0.5, 0.8712841868400574 at source
  alpha 0.64123012345, and 1.999999987845058e-8 at source alpha 1e-8. Work-window
  partitions retain exact Float32 words. Native source alpha never becomes a
  union-mask opacity or passes through a byte color field.
- Four ordinary production typography/guide checks pass. These are regression
  checks, not a claim of production float TextLayer support.
- An independent FontTools reader confirms unchanged original glyph order,
  every retained table byte (apart from head checksum adjustment), original
  character mappings and correct added selectors for regular/CFF/variable/
  vertical sources. Original source files remain byte-identical.

Raw design probes are retained. Replacing the original cmap changed native serif
pixels in ordinary placement; augmenting original mappings instead matched all
24 prototype comparisons. Those probes use FontTools-derived fonts and a local
system font; they are design evidence, not universal product/font acceptance.
The actual product compiler is separately checked against FontTools and native
browser pixels. A first 36/37 run found the existing inspector route assumed a
non-symlink generated-worker URL. Matching the same worker basename covers the
workspace's real generated-directory URL; all failure/count/recovery assertions
are unchanged. Both the corrected run and final integrated 37-case run pass.

The current private selector compiler requires selected uncompressed SFNT and
supported Unicode cmap formats. Glyph zero, compressed glyph-source preparation,
intrinsic color-font float painting, exhausted private-selector space and broader
native glyph/hint/fallback matching remain explicit unfinished work. Existing
imports and byte text rendering are not restricted. Complete native shaped-run
identification, source color glyphs, connected scene/tool/export/shared APIs/
persistence and large-original float text acceptance remain required. The broad
original professional/AI/provider/workflow/device/performance/commercial roadmap
stays active. No new public document method/schema, plugin grant, account, upload,
paid operation or REST/browser synchronization is added.
