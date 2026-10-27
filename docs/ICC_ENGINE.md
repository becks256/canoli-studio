# Native ICC engine dependency

The native color engine is an implemented private dependency for F10/F11. It is
not yet connected to application color settings, viewport presentation, file
exports, profile persistence, independent REST or isolated scripting. The
current editor still composites sRGB8. Its existing Color dialog currently
changes session labels/settings; those controls do not establish actual
assignment, conversion or soft-proof pixels. Integration remains in progress
in the implementation roadmap.

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

Actual preview/delivery/settings/transport integration is required before
claiming this as an application color feature. Working-space assignment and
conversion, original high-precision input/16-bit/float scene processing,
CMYK/HDR delivery, wider profile coverage, physical device/color quality and
sustained performance remain required by the full original roadmap.
