# Captured projected wet editing — 2026-10-31

This verifies a schema-55 byte Smudge/Mixer increment within F03/F06. The full
roadmap, native float wet painting, projective relinking, linked selection/path
capture, general warp, broad photographic/interchange quality and sustained
all-tool/device/process-memory acceptance remain open.

## Behavior and invariants

Prepared tiles retain their placed native grid, full brush/clip/pressure/tip/
texture/symmetry metadata, original sources and captured image/mask mapping.
Replay composes ordered premultiplied replacement RGB, replacement alpha and
independent removal coverage before projective transport into original content.
It applies removal and already masked replacement once, followed by one
operation-opacity envelope. Current perspective/size changes preserve the edit.
Unlinked masks retain their local plane; mask-wide settings apply afterward.

Finite artwork rejects inverse-horizon support before publication. Unbounded
mask coverage streams real distant native ROIs, including a sample one million
pixels from the origin, without clipping to the original image quad. Extended
wet raster conversion uses containing masters so off-image pixels and editable
mask/source metadata survive conversion and rasterization.

## Verification

- Full build and **3,176 unit/API/native tests across 309 files** pass on Node 26.
- **123 unique browser workflows** pass: 95 unchanged existing regressions,
  22 new projected-wet workflows and six normal-production workflows.
- The native five-channel kernel matches **13 independent NumPy DLT/bilinear
  references**, comparing **202,620 float32 words**. Maximum channel
  error is **5.960464478e-08** (bound 2e-7); complete/bounded and
  irregular row partitions are bit-identical, with unchanged source words.
- Actual API authoring matches independent flat/native controls with pressure,
  tilt/tip, texture, symmetry and explicit selection clipping. Reflected real
  pointer gestures cover nonuniform source sizes, parents and mask bases/offsets;
  visible target placement, untouched clipped pixels, exact preview/commit RGBA,
  final input, one Undo/Redo and private assets are checked.
- Escape, pointer cancellation, revision and ordered-selection-away-and-back
  cancel. Equivalent selection stays valid. Removed originals/abort/disposal
  prevent publication; retained frame leases remain readable until release.
- Prepared PNG validation, malformed worker replies, version ages, constructor
  ownership, embedded/history values, independent REST revisions/locks/Undo,
  isolated guide execution and invalid-result rollback are checked.
- Native projects, recorded source-bearing recipe replay and actual workspace
  redo-only recovery retain fields, output pixels and original bytes. SVG,
  layered PSD and conversion/rasterization check the tested visible pixels.
- A real **10,000 × 5,000** original is edited at a distant native window. Its
  SHA-256 stays `b457af22024ac92524b87f06ada74fd652484835edbaafbb20470a8a9bb3897f`;
  document/source dimensions stay native, Undo/Redo is exact, and observed new
  working canvases stay at most four million pixels and 4096 pixels per edge.

The broad browser run initially passed 116/117 cases. A new reflected-pixel
probe incorrectly required opaque alpha despite retained transported pigment
alpha (actual green alpha 247). The assertion now checks the intended new
foreground location/color and nonzero pigment, while whole-frame RGBA equality,
selection clipping and source/history checks stay exact. All 22 projected cases
then pass on identical application runtime bytes. The 95 existing cases are
unchanged and passed in the broad run. The first unit run similarly exposed a
new test's assumption about outer masks after expanded-master conversion; the
contract/test now explicitly cover editable containing-master masks and the
complete suite passes. Initial failures and other pilot/setup diagnostics are
retained; no accepted run uses automatic retries, skips or flakes.

A final documentation rebuild changes five developer pages only. The release still contains
**145 files**; all non-developer files match the production-tested release byte-for-byte.

## Measured pointer feedback

Twelve actual captured pointer events per target are timed to matching new
foreground pixels in the displayed artwork canvas, sampled on animation frames.
Probes are separated by more than three brush diameters, check pre-event pixels
and retain actual transported alpha. Readback instrumentation is included.
Long-task observation covers the gesture. This is headless Chromium on this
host, not physical display/OS presentation or device acceptance.

| Target | Median | P95 / maximum | Long tasks | Longest task |
| --- | ---: | ---: | ---: | ---: |
| Raster pixels | 149.1 ms | 268.0 ms | 5 | 76 ms |
| Ordinary mask | 148.4 ms | 279.2 ms | 6 | 111 ms |
| Filter mask | 212.0 ms | 348.6 ms | 6 | 98 ms |

These measurements **do not meet a 60 fps claim**. Incremental input latency,
long tasks and the full sustained editor-wide performance goal remain required
work; functional/source-preservation acceptance does not waive them.

## Compact evidence

[projected-wet-2026-10-31.json.gz](projected-wet-2026-10-31.json.gz) contains full commands/reports/
logs, source reconstruction and hashes, release identities, independent native
actual fields, source/reference pins, small browser/native-project/PNG artifacts,
all pilot diagnostics and raw latency samples.

- Compressed bytes: **948,506**.
- Archive SHA-256: `75231245edb093bf5a2367ce12ee613ba2bc1fe8da98ac892e2d24b1666511c0`.
- Retained small artifacts: **77**.
- Runtime identities: **145 files**.

Large originals and full historical archives are referenced by source path and
hash instead of duplicated. New raw ZIPs remain local under the repository's
benchmark storage policy. The prior history cleanup is documented in the
[benchmark index](README.md); preserved old commit identities have a public map.
