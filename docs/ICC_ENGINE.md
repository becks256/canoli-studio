# Native ICC engine dependency

The native Little CMS engine now connects to trusted browser color settings,
viewport proofing and RGB8 PNG/TIFF/PDF output. Original ICC sources and per-tab
preferences survive workspace checkpoints. The scene still composites sRGB8;
working-space assignment/conversion, high precision, CMYK delivery and HDR remain
open F10 gates. REST sessions remain independent and headless; isolated scripts
and plugin commands receive no file/profile/native service.

## Application workflow and ownership

Open **Color** to choose an output RGB profile and an optional device proof.
Built-in choices are sRGB, Display P3, Adobe RGB and linear sRGB. Import ICC
accepts complete `.icc`/`.icm` files through real native inspection. RGB sources
can be delivery targets; CMYK sources can be proof devices. No fourth channel is
discarded to invent RGB delivery. Native preparation can reject an inspectable
profile whose class/tables do not support the requested transform.

Draft controls do not affect the canvas. Apply preflights output and proof in
private workers, reports intent-table fallback and commits preferences together.
Cancel aborts pending native work. A superseding apply, settings change, tab/I/O
change or disposal rejects stale publication. Artwork commands, revision and Undo
are unchanged; these are workspace/view/output preferences.

Soft proof runs after final sRGB viewport composition on a private Canvas2D
surface. The standard-renderer status is accurate while proofing. Pixel windows
are bounded to approximately 4 MB (at least one complete row), and a whole current
frame must finish before presentation. Prepared transforms are keyed by immutable
profile fingerprint and settings, never filenames. Changing proof invalidates
old stroke/gesture/wet-paint frames. Pending, applied and failed proof statuses
refer to actual presentation. Failed proof leaves the last displayed frame in
place and exposes an error; it does not label unproofed pixels as applied.
A failed removal retains the failure badge while the prior proofed frame remains
visible. Reapplying the same disabled proof setting queues a fresh frame.

Proof warning colors retain source alpha. Proof output is an sRGB display
simulation, including a CMYK device simulation, not a physical print/display
accuracy guarantee. Measured profiles, calibration and device checks remain
required. The source cache and file output remain unproofed.

PNG, single/multipage TIFF and raster PDF can convert the final unassociated
RGBA8 readback directly to the selected RGB target. Conversion precedes encoding,
without a second premultiplying canvas. Alpha is copied exactly. PNG embeds the
original target in iCCP instead of an sRGB chunk; TIFF stores the original ICC
tag on every page; PDF uses the original ICCBased RGB color space for its image
and transparency group. Export reports describe converted RGB samples and intent
fallback limitations. JPEG/WebP/AVIF/SVG/PSD/PSB remain sRGB; explicit `color`
requests for these formats reject before rendering. Format-specific precision,
flattening, metadata and editability limitations still apply.

The UI uses the saved output preset for supported formats and quick PNG. The
default sRGB/relative/no-BPC preset retains the previous sRGB output path. Trusted
host calls remain explicit: omitting `color` preserves existing export defaults
regardless of workspace preferences. Proof is never included in delivery.

## Trusted browser contract

```ts
const profile = await editor.inspectColorProfile(file, file.name, {signal});
// IccProfile owns an immutable Blob, SHA-256, name and cloned native report.
const warnings = await editor.setColorSettings({
  output: {profile, intent: 'relative-colorimetric', blackPointCompensation: false},
  proof: {
    profile, intent: 'relative-colorimetric', proofIntent: 'relative-colorimetric',
    blackPointCompensation: false, gamutWarning: true, warningColor: '#00ffff',
  },
}, {signal});
const result = await editor.export({format: 'png', color: editor.colorSettings.output}, {signal});
const pages = await editor.exportTiffPages(editor.openDocuments,
  {variant: 'auto', color: editor.colorSettings.output}, {signal});
```

`ColorOutput.profile` accepts the four built-in IDs or an inspected host
`IccProfile`. Intent defaults to relative-colorimetric, BPC to false. Proof
requires a profile and its normalized settings; the internal normalizer defaults
display/device intents to relative, BPC/gamut warning to false and the warning to
`#00ffff`. Unknown fields/intents, forged profiles, non-RGB output and malformed
warning colors reject. `unclipped` is not an ICC intent. `setColorSettings` returns
native preparation warnings and exposes a stable, immutable `colorSettings`
snapshot plus `colorWarnings`. Control supports AbortSignal and native progress
phases waiting/preparing/processing; throwing callbacks reject and clean up.

Legacy `setColorProfile(id)` now explicitly means output preset, never working
space assignment. `setSoftProof(options|null)` maps built-in proof settings;
unsupported `unclipped` rejects. These compatibility setters validate preferences
synchronously; actual viewport preparation remains asynchronous. Use guarded
`setColorSettings` when native preflight is required.

SavedWorkspace version 3 requires a complete version-1 color-settings record per
document. A custom target stores its name, SHA-256 and immutable original Blob
inline; restore re-inspects native metadata, verifies the hash and preflights
custom output/proof before any restored tab is published. A bad source/settings
or project leaves current tabs/preferences unchanged. Version 1/2 workspaces
still read; legacy `unclipped` proof is disabled with a visible Color notice
rather than silently reinterpreted. Component-owner links remain valid from v2.
Standalone native projects retain original artwork and existing document schema
48; view/delivery presets belong to workspaces, not artwork/history.

This is a trusted browser host service, not a document constructor, new command,
recipe operation, REST rendering endpoint or isolated scripting/plugin service.
[Profile-aware browser batches and recipe packages](COLOR_DELIVERY.md) now own
complete output sources and checked delivery contracts. Independent REST jobs, other format color
output, assign/convert working spaces, true high precision/CMYK/HDR and physical
device/performance acceptance remain open in the full roadmap.

## Implemented boundary

The pinned MIT Little CMS 2.19.1 core runs in a memory-only WASM module inside
a private worker. The release's public version macro is 2190. There is no
filesystem, network, external native plugin, thread or shared-memory service.
Normal application builds do not download or compile external dependencies.
The maintained wrapper and generated JS/WASM identities are recorded in
`src/core/color/codec/build.json`; the license is distributed under
`public/licenses/lcms-2.19.1-LICENSE.txt`.

Complete source ICC bytes remain independent of converted pixels. Inert native
inspection returns actual device class, color/connection spaces, channel count,
version and bounded description/copyright/manufacturer/model labels. Matrix
and native intent-table support are reported separately from the CMM's valid
fallback behavior. A valid profile with missing requested tables can prepare
through the native fallback, with an explicit preparation warning.

Transforms consume straight RGBA8 windows in the existing sRGB editing space.
RGB delivery converts to an actual RGB output profile; a CMYK target cannot be
silently reduced to three channels. Device proofing simulates a supported
profile back to display sRGB. Native rendering/display and proofing intents,
black-point compensation and optional RGB gamut alarms are explicit. Alpha is
copied exactly. Returned reports/pixels own their storage and cannot borrow
Emscripten memory. Failed preparation cannot retain an earlier active transform.

`IccSession` admits at most two live worker owners. Queued owners retain immutable
profile Blobs, not decoded pixel planes. A prepared owner processes one window
at a time; closing/aborting terminates its worker, rejects pending work and
releases its slot. Strict reply IDs, result kinds, normalized settings and exact
RGBA window geometry reject mismatched or stale native messages. Original
caller pixels remain attached and unchanged. No document command, history,
asset, schema or plugin permission is introduced by this dependency.

## Verification and remaining integration

The maintained tests execute the actual checked-in WASM. Twenty-three color-cube
references cover five RGB devices and a synthetic CMYK LUT device, multiple
intents and black-point behavior. Most references use independent Pillow
10.3.0 / Little CMS 2.16. The deliberately coarse v2 CMYK perceptual/BPC fixture
exposes a substantial cross-version black-point heuristic difference. An
independent native Linux build of the pinned CMM reproduces the WASM result;
that one reference requires exact pinned-version bytes, while the old reader
result remains retained. The original failure is not hidden by a larger
threshold. These are synthetic, unmeasured profiles, not printer calibration.

Real browser checks cover the same reference windows, input ownership, queued
cancellation, malformed profiles, in-flight abort and recovery. Protocol tests
cover failed worker launch, mismatched settings/results, callback errors and
resource release. See the dated roadmap and sealed reports for observed counts.
Reproduction instructions are in [the native build README](../scripts/icc-engine/README.md)
and [fixture provenance](../tests/fixtures/icc-native/README.md).

The connected application increment above covers browser preview, RGB delivery,
settings and complete workspace profile ownership. Full portable job transport,
working-space assignment and
conversion, original high-precision input/16-bit/float scene processing,
CMYK/HDR delivery, wider profile coverage, physical device/color quality and
sustained performance remain required by the full original roadmap.
