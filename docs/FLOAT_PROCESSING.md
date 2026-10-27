# Native float pixel processing dependency

The initial connected schema-49 float document workflow is now specified in [FLOAT_DOCUMENTS.md](FLOAT_DOCUMENTS.md). The dependency/legacy byte-mode sections below retain their individual boundaries; they do not describe the new mode as byte editing. Broader F10 and full-roadmap acceptance remain required.

The private native engine now processes straight RGBA float32 windows without
8-bit staging. This is a dependency of F10 precision editing. The initial public
float scene integration is described above; default byte documents retain sRGB8.
This dependency alone does not implement general working-space assignment,
float brush/effect stacks or HDR tone mapping. The broader integrations and the
original professional-editor roadmap remain required.

## Numeric and ownership contract

`FloatPixelProcessor` owns a private instance of the existing compiled pixel
WASM module. A complete call returns owned float32 output or throws; input
samples/masks remain unchanged. Native processing uses float64 intermediate
arithmetic and stores float32 once per operation. Alpha is straight, finite and
in [0,1]. RGB must be finite. Shared, detached and resizable input sample buffers
are rejected. Disposing an owner prevents further calls; its memory becomes
collectable independently of unrelated byte-processing owners.

`composite(source, backdrop, {mode = 'normal', opacity = 1, mask?} = {})`
requires equal RGBA lengths, a current model blend mode, finite opacity in [0,1]
and optional float coverage with one [0,1] value per pixel. Coverage and opacity
multiply source alpha. All 18 model modes are implemented, including the four
nonseparable color modes. Source-over uses straight blend colors and premultiplied
coverage contributions. Normal preserves finite signed/extended RGB. An inert
source retains exact backdrop samples, including hidden transparent RGB.

Artistic modes currently require normalized RGB on both inputs. Their HDR
extension is not inferred from SDR formulas. Blend-color roundoff is bounded
to the mathematical normalized domain before source-over, so chained artistic
operations do not invent tiny negative components at clipping edges. Linear Light and Linear Burn use
the established bounded blend-color definitions, with float source-over rather
than byte rounding. For the other artistic modes, the mathematical definitions
follow [W3C Compositing Level 1](https://www.w3.org/TR/2024/CRD-compositing-1-20240321/).
Caller-selected common blending encoding remains explicit: this kernel performs
no ICC conversion, gamma transfer, gamut mapping or profile assignment.

`affine(pixels, matrix)` takes twelve finite RGB coefficients, row-major 3 × 4,
and leaves original alpha unchanged. It can express gain/exposure, offset and
linear matrix adjustments in a caller-selected encoding. RGB remains unclipped;
an unrepresentable float32 result rejects instead of returning Infinity or
clipped substitutes. Exposure has physical linear-light meaning only when the
caller supplies linear-light pixels. This is not an implemented public adjustment
layer, camera exposure control or arbitrary-ICC matrix approximation.

`tone(pixels, {exposure = 0, contrast = 0, saturation = 0} = {})` uses the
existing model ranges −3…3 and −100…100. It applies exposure, active contrast
around working value 0.5, then active Rec.709 saturation. The connected linear
document pipeline uses this native operation for raster effect stacks before
projection and for adjustment-layer backdrops before mask/opacity interpolation.
Float64 intermediates round once to float32 per tone. Alpha is copied exactly;
signed/extended RGB is retained. Neutral contrast/saturation stages skip their
subtract/add arithmetic so identity and exposure-only values stay exact.
Invalid input/parameters and float32 overflow reject without publishing output.
Worker `PixelProcessor.floatTone` captures samples and all settings before
readiness, transfers private copies and checks complete returned sample geometry.

`transfer(pixels, adjustment)` accepts an existing strict Curves/Levels DTO.
The connected linear document path uses its continuous float64 master/channel
operator with one final float32 store and exact alpha. Four owned control records
replace byte color lookup tables. Identity channels preserve signed/extended RGB;
Curves extend endpoint tangents and active Levels explicitly clip at their input
endpoints. The UI and model use the same normalized controls; worker calls capture
nested points/channels before readiness. Exact equations, limits and errors are
specified in [the document contract](FLOAT_DOCUMENTS.md#continuous-curves-and-levels).
The native private export `transferFloat` rejects invalid controls/samples and
unrepresentable output; caller buffers never transfer. This adds no isolated API.

Native scratch is reused in windows of at most 65,536 pixels. Worker entry points
`PixelProcessor.floatComposite`, `floatAffine`, `floatTone` and `floatTransfer` accept at most 262,144 pixels
per request as a transport-buffer budget; this is independent of original file
or document geometry. They capture complete samples, masks, coefficients and
options before awaiting readiness and transfer only private copies. Replies must
be float32, finite, alpha-valid and dimensionally exact. Shutdown rejects pending
requests. Current worker disposal is cancellation for this internal service;
there is no new isolated-script API or per-call AbortSignal contract.

A private owner validates the native exports `compositeFloat`, `affineFloat`,
`toneFloat` and `transferFloat`. Other pixel exports retain their signatures. Invalid native input,
unsupported artistic numeric domain and nonrepresentable output have distinct
status codes. Failure can leave private scratch changed but publishes no result;
fresh work reuses the owner without changing other byte/float owners.

## Verification and connected work remaining

Independent NumPy float64 references start from original float32 sources with
over 8,000 channel levels. They cover all modes, transparent/opaque/partial alpha,
coverage, source-over and a matrix with negative/above-one output. Normalized
color tolerance is 2^-22, with exact alpha; this separates float32 rounding from
8-bit quantization. Ownership tests cover input capture, private transfers,
malformed replies, arbitrary native-window cuts, nonfinite input/overflow,
interleaved byte work, disposal and retry. Ordinary builds use the existing
AssemblyScript build; fixture generation is explicit and independent of WASM.

The verification-only TIFF pipeline reads actual original float TIFF samples,
converts original ICC to linear-sRGB float32 through native Little CMS, applies
native affine math and masked normal compositing, and writes real float32 TIFF
with the complete linear ICC. A separate native libtiff/Linux CMM/NumPy checker
reads every original/output float sample. It discloses absolute color error,
exact alpha, bit differences/hashes and extended-range samples. It never uses a
canvas or an 8-bit PNG reference. The small and genuine 50 MP paths must pass
before that prototype is accepted. The dated roadmap records observed gates.

The prototype is test infrastructure, not a file service exposed to application
users or a replacement renderer. Next required work includes owned float source
and derived-tile storage, versioned document working-space/precision data and
commands, actual compositor/adjustment/mask/tool integration, source-preserving
persistence/history/recovery, color-managed display/delivery, supported group and
blend semantics, independent REST/isolated/recipe surfaces as scoped, and physical
quality/resource/sustained performance acceptance. No public schema, native
project/workspace container, plugin grant or browser/REST synchronization changes.
