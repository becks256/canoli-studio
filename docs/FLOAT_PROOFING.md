# Device soft proofing for float documents

Float soft proofing sends the completed working-linear float32 scene directly to
Little CMS 2.19.1 with an explicit linear-sRGB input profile, sRGB display profile
and independent RGB or CMYK proof device. Native composition, adjustments,
coverage and frame filtering finish before this display transform. The proof
never reads an sRGB8 editing thumbnail or an already-quantized display canvas.
The final canvas remains SDR sRGB8; this does not implement HDR display,
working-space assignment/conversion, CMYK delivery or physical calibration.

## Ordinary controls and persistence

Open **Color**, enable **Simulate Output Gamut (Soft Proof)**, then choose the
simulated target, display/device intents, optional black point compensation and
optional gamut warning color. Import complete RGB or CMYK ICC files through the
existing profile library. CMYK devices are proof choices, not RGB output choices.
Changing working precision no longer disables the proof checkbox. Apply
prepares the complete output/proof draft before publishing preferences; Cancel
or preparation failure leaves prior artwork and settings intact.

Already-float settings and conversion from eligible original-bearing byte TIFF
artwork use the same native preflight. `editor.convertDocumentToFloat(control = {},
settings = editor.colorSettings)` retains existing proof preferences by default.
An explicitly supplied null proof still disables it. Its existing source,
revision, session, preference, cancellation and failure guards remain. A bare
`document.convertToFloat()` command in a trusted/isolated edit also retains host
proof preferences; it exposes no ICC/profile/native service to scripts.

Proof settings remain per-tab workspace preferences, outside document/history.
Undo/Redo edits the original scene or working precision while retaining current
proof preferences. Complete custom profile sources and settings survive workspace
save/restore with native validation before publication. Native project files
retain their existing document/source contract and do not acquire workspace
preferences. The footer reports actual pending/applied/failed proof presentation;
a failed/stale frame cannot be relabeled Ready.

PNG/TIFF/PDF delivery continues to read the native float scene and its selected
RGB output transform, excluding proof and gamut alarms. The high-precision TIFF dialog labels the actual embedded profile and offers
**Use output RGB profile for high-precision TIFF**. An unset output override
retains its documented linear-sRGB native default; explicit conversion can
choose the current sRGB or custom RGB output settings. Proof is excluded in both
cases. This choice affects file delivery only.

Original image samples,
source bytes and document history remain unchanged by proof selection. Turning
proof off uses the ordinary linear-float-to-sRGB display path.

## Private native/worker contract

The internal trusted `IccSession.prepareProof(source, display, device, options = {},
control = {})` takes three complete profile Blobs. Source/display must be usable
RGB profiles; the device must be a usable RGB or CMYK input/display/output/color
space profile. Device links, malformed/incomplete sources and incompatible
classes/spaces reject. No file/network/native privilege is added to isolated
Scripts, plugins, recipes or independent headless REST.

Strict options:

- `inputFormat`: `rgba8`, `rgba16` or `rgba-float32`; default `rgba-float32`.
- `outputFormat`: the same three formats; default `rgba8` independently of input.
- `intent` and `proofIntent`: ICC perceptual, relative-colorimetric, saturation or
  absolute-colorimetric; both default relative-colorimetric.
- `blackPointCompensation` and `gamutWarning`: booleans, both default false.
- `warningColor`: six-digit hex display RGB, default `#00ffff`, normalized lowercase.

Returned `{session, prepared}` includes independent owned source/display/device
reports, normalized settings, table-fallback status and warnings. The native CMM
compiles the proof/gamut pipeline directly over the selected input sample type.
Actual preparation determines usability; missing requested profile tables disclose
CMM intent fallback. No fourth CMYK device channel is dropped or exposed as RGB.

Use `session.applyWindow(samples)` sequentially and dispose in `finally`. It returns
an owned complete output window. Caller buffers stay attached and unchanged.
Wrong types/shapes, shared buffers, nonfinite colors, invalid float alpha,
overlapping requests and native/protocol failures reject. Same-format alpha is
bit-preserved; cross-format alpha follows native normalized quantization. Finite
negative/above-one input RGB is accepted, but profile curves/device simulation
and final SDR encoding may map or clip it. This changes only displayed samples.

Preparation and processing share the existing two-owner queue, callback handling,
revocation/cancellation and strict response ID/kind/settings/format checks. A bad
response closes the owner. Private display reuse is keyed by exact device
fingerprint, intents, BPC and alarm settings and keeps one idle owner. Ordinary
and proof displays cannot reuse each other's transforms. Idle owners yield to
queued source/profile work; active scene sources prepare before acquiring the
display owner. Captures bind actual document/source ownership and cancel stale
or disposed work before complete-frame publication.

## Verification boundary

Dated counts, failures and accepted verification scope are recorded in the
[roadmap](IMPLEMENTATION_ROADMAP.md). The independent proof corpus uses direct
Linux Little CMS calls without the Canoli
wrapper; it includes all native sample formats, RGB/CMYK devices, different
intents, BPC, custom gamut alarms, extended colors and a witness distinguishing
actual float proofing from an sRGB8 proxy. Browser/production, source/history,
workspace, cancellation, native-output and 50 MP checks are required acceptance
gates; source-only success does not satisfy them. Synthetic devices establish software
behavior, not photographic/physical print or display quality.

The implementation uses the pinned upstream
[proof transform API](https://github.com/mm2/Little-CMS/blob/21c582a594fe5279f90c0b93437c398f93bf62b0/include/lcms2.h)
and [native float transform/gamut path](https://github.com/mm2/Little-CMS/blob/21c582a594fe5279f90c0b93437c398f93bf62b0/src/cmsxform.c).
