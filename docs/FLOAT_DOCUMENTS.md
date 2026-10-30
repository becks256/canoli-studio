# Float document editing

Schema 49 adds an explicit `float32` / `linear-srgb` working mode alongside the
default sRGB8 document. Original unsigned 16-bit and float32 TIFF samples, raster
transformations, Normal and normalized artistic composition, groups, masks, linear tone, continuous Curves/Levels, White Balance, HSL, Color Balance, Vibrance, Gradient Map/Color Lookup and editable linear Dodge/Burn adjustments use this
mode. Display
conversion happens at the final SDR canvas boundary. PNG, PDF and TIFF delivery
reads the float scene directly, without reading colors from the display canvas.

This is an initial connected precision workflow. It does not complete F10,
professional color/precision editing, all-tool performance or the full roadmap.

## Native linear Dodge and Burn

Existing `TonalStroke`, `AdjustmentLayer.addTonalStroke(stroke)` and
`document.applyTonalSculpt(path, mode, range, exposure, options?)` also work in
float documents, with unchanged signatures/defaults. Dodge (`O`) and Burn
(`Shift+O`) preview the float scene, create or reuse an editable tonal layer and
commit one Undo per gesture. Existing owner/revision/selection/lock, Escape and
capture-loss cancellation apply. Reset clears strokes while retaining the tonal
type. Byte documents keep their existing roll-off operator.
Converting working precision therefore changes how existing tonal settings are
rendered; precision Undo restores the previous operator and appearance.

Float strokes use direct linear exposure. For straight RGB let
`L = clamp(.2126*r + .7152*g + .0722*b, 0, 1)`. Range weights are `1-L`,
`4*L*(1-L)` and `L` for shadows, midtones and highlights. Gain is
`2 ** ((mode === "dodge" ? 2 : -2) * exposure * coverage * weight)`.
Exposure remains `[0,1]`, up to two stops. Coverage already includes brush
opacity, flow, pressure, tip, texture, symmetry and clip; flow is applied once.
A private numerical flow factor introduces no public stroke field.

`protectTones` defaults to true. Brightening a positive RGB peak `P` caps gain
at `max(1, 1/P)`: normalized colors gain no peak above reference white, and
protection never reduces existing HDR. Turn it off to brighten HDR colors.
Negative components receive the same positive gain. Only the range selector is
clamped; RGB never enters integer staging or gamut clipping. Nonfinite float32
output rejects rendering/delivery; controls and Undo remain available. Native
transparent, uncovered and neutral samples retain their words; alpha is exact.

Strokes operate sequentially on the live backdrop before existing mask/Fill/
opacity/blend interpolation. Affine planes, clipping, proofing and artistic blend
domain checks remain. Tonal layers have no intrinsic shadow silhouette. Coverage
uses the fixed native grid; only its nonzero rectangle enters the color worker.
This is a working-buffer policy, not an image limit. TIFF originals/descriptors
and editable schema-49 metadata retain their existing persistence contracts.

This example requires an open float document. Isolated execution adds one Undo.
The solid brush fully covers its explicit clip without resizing original assets
or the document.

<!-- example: float-tonal -->
```js
const retouch = document.layers.add(new AdjustmentLayer({
  name: "Linear burn",
  adjustment: { kind: "tonal", strokes: [] },
}));
retouch.addTonalStroke(new TonalStroke({
  brush: new BrushStroke({
    points: [{ x: 200, y: 150, pressure: 1 }],
    size: 2048, hardness: 1, flow: 1, opacity: 1,
    clip: new MarqueeSelection({
      shape: "rectangle", x: 0, y: 0, width: 400, height: 300,
    }),
  }),
  mode: "burn", range: "highlights", exposure: 0.5,
  protectTones: true,
}));
document.selectedLayer = retouch;
```

Scripts/plugins gain no worker, pixel, file, profile or network authority. Existing
grants/source/revision checks and shared Undo apply. Independent REST accepts
tonal metadata and [verified original TIFF admission/source windows](REST_TIFF.md),
without a composed float renderer or browser synchronization. Other tools/layers and broader color/device/performance
gates remain required. The dated roadmap records verification status separately.

## Opening and changing precision

The custom TIFF import dialog offers 8-bit sRGB or 32-bit linear sRGB editing for
supported unsigned 16-bit and float32 RGB/grayscale pages. The default remains
8-bit, requiring explicit precision-loss consent. Float editing does not require that consent. Both choices retain
the complete original TIFF, selected page, orientation and color interpretation.
In float mode, an unprofiled file requires an explicit sRGB or linear-sRGB
assumption; an embedded supported RGB ICC profile remains authoritative.

Trusted browser host:

```ts
await editor.openTiff(file, {
  page: 0,
  editingPrecision: 'float32',
  // Required only when the original page has no ICC profile:
  floatColorSpace: 'linear-srgb',
}, {signal, onProgress});
```

`editingPrecision?: 'float32'` is optional. Omission retains the old byte import.
Page defaults to zero; `allowPrecisionLoss` defaults to false. The float choice
accepts original unsigned 16-bit or float32 samples. Other integer depths, RAW
and ordinary byte image admission do not acquire float precision through this flag.
Unsigned samples divide by 65535 in float64, invert white-zero grayscale and
unassociate alpha where declared, then round once to float32 before native ICC
conversion. Normalized float32 can distinguish all 65,536 unsigned levels.
Declared alpha association still determines unassociated colors, and associated
zero-alpha colors become zero. This is float32 working precision.
The existing `floatColorSpace` option supplies the explicit original
interpretation for either supported source type when ICC is absent; embedded ICC
remains authoritative. Default byte-mode unsigned import keeps its existing sRGB
assumption and consent. Float mode never invokes that byte decoder.
Nonfinite color, alpha outside [0,1], unsupported pages/profiles and known PQ/HLG
ICC transfer declarations reject. Finite negative and above-one RGB values are
retained with supported source profiles; no HDR transfer decoding, tone mapping
or HDR display is implied.

An existing eligible byte document can switch using Color Settings → Working
precision. Apply stages the output profile together with the precision choice;
Cancel changes neither. All original sources and the actual float-to-output
transform prepare before publication. Unsupported current layers block this
conversion. A missing high-precision original or source color identity cannot
be reconstructed from byte pixels. For legacy byte-imported unsigned TIFFs,
the trusted host prepares a separate native float asset from the retained
original Blob, verifies its samples, profile and geometry, then rebinds raster
sources together with precision in one command. Repeated raster references
share one prepared asset. The byte bitmap remains available for exact Undo;
original bytes and layer metadata remain unchanged. Unsupported original depths
and unprofiled sources without an explicit `floatColorSpace` still reject.
Trusted host signature:

```ts
await editor.convertDocumentToFloat(
  {signal, onProgress},
  {output: {profile: 'display-p3', intent: 'relative-colorimetric',
            blackPointCompensation: false}, proof: null},
);
```

`control: FloatSourceControl = {}` accepts an optional abort signal and source
preparation progress callback. `settings?: ColorSettings` defaults to the current
output and proof settings. `editor.floatConversionIssue: string | null`
provides the current structural eligibility reason; original sample/color
admission is asynchronous and can still reject. Already-float conversion through this
host preparation service rejects. Replacement preparation, document edit, tab
change, asset disposal, changed preferences, cancellation or preparation failure
reject without applying precision or staged preferences. Output and proof preferences are
workspace settings outside document history; ordinary Undo restores precision
and any replaced raster source references. Failed preparation releases newly
staged asset views. The strict command optionally accepts
`sources: {layerId: string, assetId: string}[]`; replacements must target distinct
existing raster layers and pass the host's ordinary original-source validation.
Attached replacements must retain the same immutable original Blob, TIFF page,
explicit source-color choice and geometry, and are accepted only while changing
from byte to float precision. They cannot substitute unrelated image content,
including through nested transactions or locked layers.
Recipe recording explicitly rejects conversions with prepared source
replacements because recipe assets do not transport those TIFF sources.

## Object model, commands and isolation

`DocumentOptions.precision?: 'uint8' | 'float32'` defaults to `uint8`.
`new Document({precision: 'float32'})` creates an empty linear-sRGB document.
Readonly `document.precision` and `document.workingSpace` expose effective state.
`document.convertToFloat(): void` dispatches the shared strict zero-argument
`{type: 'document.precision.float'}` command. It is idempotent in an existing
float document; it does not expose decoding, files, workers or preference changes.
Source validation at host commit requires retained original high-precision TIFF raster
assets. Synchronous structural construction without an attached asset store
still requires final source admission before rendering or host publication.

For an already-open original high-precision TIFF, an ordinary isolated script can use:

<!-- example: float-exposure -->
```js
document.convertToFloat();
const original = document.layers.at(0);
if (!(original instanceof RasterLayer)) throw new Error('Select a raster original');
original.adjustments.add(new ToneAdjustment({exposure: 1}));
```

Full tone uses the same existing options and properties, with exposure −3…3
and contrast/saturation −100…100. Defaults are zero; `enabled` defaults to true.
In byte documents the existing encoded-sRGB byte operator remains unchanged.
Float documents apply the working-linear definitions above. For example:

<!-- example: float-tone -->
```js
document.convertToFloat();
const original = document.layers.at(0);
if (!(original instanceof RasterLayer)) throw new Error('Select a raster original');
document.selectedLayer = original;
original.adjustments.add(new ToneAdjustment({
  exposure: 0.7, contrast: 37, saturation: -43,
}));
```

The existing isolated execution transaction, expected revision, command limit,
locks, permission checks and Undo boundary remain authoritative. Plugins require
their existing document read/write grants; installation remains inert. No new
file, native or network grant is added. REST accepts the shared structural state
and strict command in its own independent sessions. [Native TIFF admission](REST_TIFF.md)
retains original float sources and provides bounded raw source windows. It does
not render a composed scene or synchronize with a browser document.

The semantic recipe action `{type: 'document.precision.float'}` records/replays
the same command against recipient content. Recipe execution does not import
files or change preferences; unsuitable receiving originals reject at host
commit. Existing source-bearing project/recipe transport retains original TIFF
choices independently of this zero-argument action.

## Supported scene and controls

The initial mode supports original unsigned 16-bit or float32 TIFF raster layers, Normal isolated
groups, pass-through groups, transforms, visibility, opacity, Normal fill
opacity, existing masks and full tone controls in raster effects or Tone
adjustment layers, plus continuous Curves/Levels adjustment layers. Exposure multiplies native linear RGB by `2 ** exposure`.
Active contrast follows with `(value - 0.5) * 2 ** (contrast / 100) + 0.5`.
Active saturation uses `luminance + (value - luminance) * (1 + saturation / 100)`,
with linear-sRGB luminance weights 0.2126, 0.7152 and 0.0722. The contrast pivot
is linear 0.5, rather than a camera middle-gray control. Each tone uses float64
intermediates and rounds once to float32; it preserves alpha and finite signed/
extended RGB without gamut clipping. Neutral stages skip subtract/add arithmetic
to preserve identity and exposure-only precision. Nonfinite input, invalid alpha
or unrepresentable float32 output rejects without publishing a partial result.
Raster tone stacks run in collection order before projection. Adjustment exposure
changes the accumulated backdrop; pass-through group opacity interpolates
premultiplied before/after backdrops rather than source-over compositing a second
copy. Masks use the existing byte coverage rasterizer; color stays float32.

Other layer types, prepared wet raster replacements,
frequency separation and adjustment types other than Tone/Curves/Levels reject
atomically. Pass-through groups require fill opacity 1. The tool rail, shortcuts,
palette and context controls disable unsupported creation/color tools. Move,
Hand, selections, Crop, Artboard and mask drawing retain their existing commands;
Layer Eraser requires an original raster target. Mask brush/pencil/eraser and mask Pen require their corresponding mask target.
Device soft proofing now uses the completed native float scene directly, before
SDR display conversion. Selecting float precision or applying isolated precision
commands retains proof preferences. Saved float workspaces restore complete proof
profiles/settings after native validation. Proof and alarms never affect native
file delivery. See [the precise proof contract](FLOAT_PROOFING.md).

## Linear White Balance

Existing `AdjustmentLayer` records with
`{kind: 'white-balance', temperature, tint}` also operate directly on captured
working-linear float RGB. Both fields are required finite numbers; temperature
accepts 2000–25000 K and tint accepts −100–100, including fractional values.
The neutral default is 6504 K / tint 0. The trusted
`defaultWhiteBalanceAdjustment()` helper returns that record; isolated scripts
use explicit parameters. Unknown/missing/out-of-range fields reject shared edits
atomically. There is no new constructor, convenience setter or command type.

The existing D65-relative Kang/Bradford control model supplies the same
linear-sRGB adaptation matrix used before the byte operator's final clipping.
Float scenes capture that matrix once per layer, multiply RGB in float64 in the
native worker and round once to float32. They perform no input transfer decoding,
gamut clamp, byte conversion or sRGB encoding at this stage. Alpha is copied
exactly. Neutral settings bypass arithmetic and preserve the captured backdrop's
words, including signed zero and subnormals. Existing raster sampling and
transparent-composition canonicalization remain separate.

White Balance changes the accumulated backdrop before mask/fill/opacity
interpolation. Isolated/pass-through groups, sibling clipping and ordinary blend
modes retain their existing ordering and alpha boundaries. Artistic modes still
require normalized RGB for both blend inputs: a White Balance result outside
that range fails explicitly instead of silently clipping. Normal preserves
finite signed/extended results. Nonrepresentable float32 output rejects preview
or delivery; correct the settings or Undo. Failed previews hide stale artwork
until successful rendering, and exports publish no partial file.

The Inspector and command palette use the existing Temperature/Tint controls,
preview cancellation, locks and shared Undo. Original TIFF bytes and geometry
remain unchanged. Native project/workspace/history, isolated scripts/plugins,
semantic recipes and original-bearing portable packages retain the existing
DTO. Default linear float TIFF output can retain extended colors; the SDR preview
and integer deliveries still quantize/clip at their existing output boundary.
This corrects a declared illuminant; it does not estimate illumination, use RAW
camera multipliers, reconstruct clipped data or establish physical/HDR quality.

For an already-open original-bearing float TIFF:

<!-- example: float-white-balance -->
```js
document.convertToFloat();
const balance = document.layers.add(new AdjustmentLayer({
  name: 'Linear white balance',
  adjustment: {kind: 'white-balance', temperature: 10000, tint: 100},
}));
balance.opacity = 0.75;
document.selectedLayer = balance;
print('Linear white balance ready');
```

Schema 49 and all grants remain unchanged. Older implementations that reject
White Balance in their float subset still reject these documents. Independent
REST sessions accept the metadata through shared validation/history; they gain
no high-precision original admission, renderer or browser synchronization.

## Continuous Gradient Map and Color Lookup

Existing `AdjustmentLayer` gradient-map and LUT DTOs also work in float documents.
Use `.adjustment` or existing `AdjustmentLayer.setLut(source, options?)`; no new
public mutation method or command is added. Controls, strict validation, locks,
Undo/Redo, isolated grants/revisions and original-bearing persistence remain
shared. Helpers such as `defaultGradientMapAdjustment()` and
`defaultLutAdjustment()` are trusted module exports, not sandbox globals.

Gradient Map requires `{kind:'gradient-map', stops, reverse}`. There are 2–32
strictly increasing finite stop positions from 0 to 1; each stop has exactly
`{position, color}` with a six-digit RGB hex color. `reverse` is required boolean.
The trusted default is black at zero, white at one, and false reversal. It maps
to grayscale; it is not an identity color transform. Fractional stop positions
remain float64 through the native stage, including positions that collapse in
float32 GPU controls. Source working-linear RGB is encoded continuously using
the reflected extended sRGB transfer. Encoded luma is
`.2126*r + .7152*g + .0722*b`; reversal samples `1-luma`. Adjacent palette RGB
channels interpolate continuously in encoded space, with endpoint colors outside
the first/last stop. Decode to linear RGB and store float32 once. Alpha words
remain exact. Finite negative/above-one inputs are accepted and deliberately map
to palette endpoints; the retained original is never rewritten.

Color Lookup requires `{kind:'lut', lut, amount, interpolation}` with the same
Cube record, finite amount 0–100 (fractions accepted), and required `tetrahedral`
or `trilinear` interpolation. `setLut(cubeText, options = {})` defaults amount to
100 and interpolation to tetrahedral. A Cube contains `title`, dimension 1 or 3,
size, finite three-element `domainMin`/`domainMax`, and canonical packed red-fastest
little-endian RGB float32 `data`. 1D sizes remain 2–65,536; 3D sizes remain 2–256.
Each domain maximum must exceed its minimum by a finite positive span. All table
values must be finite float32. Missing/unknown/invalid controls, malformed table
bytes and unsupported Cube directives reject atomically, including zero amount.
The trusted default is the two-entry 1D identity on domain [0,1].

Float lookup continuously encodes signed working-linear RGB, bounds each encoded
coordinate to its declared table domain, and runs the existing 1D linear or 3D
chosen interpolation. Amount blends the **unclipped encoded table result** with
the encoded input with convex weights `(1 - amount/100)` and `amount/100`, then the reflected transfer decodes to linear
RGB with one float32 store. Signed/above-one table results are retained when the
final float32 value is finite. This is distinct from the byte path, which must
clip mapped colors before byte mixing. Zero amount preserves exact finite input
words, including signed zero, subnormals and extended colors. A mathematically
exact identity table also preserves exact in-domain component words; its declared
domain still bounds out-of-domain components. An approximate float32 ramp is not
silently treated as an exact identity.

The extended transfer reflects the ordinary sRGB power branch around zero:
encode is `12.92*v` for `abs(v)<=.0031308`, otherwise
`sign(v)*(1.055*abs(v)^(1/2.4)-.055)`. Decode is `v/12.92` for
`abs(v)<=.04045`, otherwise `sign(v)*((abs(v)+.055)/1.055)^2.4`.
The [CSS Color 4 conversion example](https://www.w3.org/TR/2026/CRD-css-color-4-20261027/#color-conversion-code)
specifies this reflected extension. Float64 arithmetic is finite-precision; this
is not an arbitrary working-profile, camera-log, ACES or photographic calibration
inference. Use a LUT designed for the declared sRGB encoding. Nonfinite float32
output rejects without a partial preview/file; zero amount can recover a finite
source. SDR preview and integer files can clip extended results. Artistic blends
still require normalized backdrop/result RGB; Normal retains finite extended
colors. An explicitly bounded authored table can support artistic blending.

The host captures controls before worker readiness and prepares a private lookup
handle. The worker validates the complete table, owns a separate native table
cache and applies bounded pixel windows through that handle. Multiple captured
handles coexist; each retains validated decoded values until release, so native
cache switches never decode or rescan the complete table again, even above the
shared byte cache budget. Live handles retain their decoded tables in worker
memory in addition to one active native table. Native cache changes cannot
change their controls. Other float
pixel operations use separate native memory. Preparation failures leave prior
handles usable. Capture failure/disposal releases the handles, including a
cancellation that occurs during preparation. No raw pixel, file, worker or native
permission is exposed to scripts/plugins; installation remains inert. Normal
source/revision/grant checks guard host commits. Headless REST accepts metadata
through the same strict commands and supports [verified TIFF originals/source
windows](REST_TIFF.md), without a composed renderer or browser synchronization.

Masks/fill/opacity, groups, clipping and blend order follow the existing float
scene contract. Complete native adjustment processing precedes frame filtering.
Projects/workspaces/history, recipes and portable batches retain the same table
and stop DTOs, with exact originals. Schema 49 and existing container versions
are unchanged. Older float implementations can reject these newly admitted kinds
rather than flattening them.

Open an original-backed TIFF in float mode first:

<!-- example: float-palette -->
```js
document.convertToFloat();
const one = document.layers.add(new AdjustmentLayer({name:'Float Lookup 1D'}));
one.setLut('TITLE "Float 1D"\nLUT_1D_SIZE 3\n-.1 0 1.1\n.25 .5 .5\n1 .9 -.1',
  {amount:37.25, interpolation:'tetrahedral'});
const three = document.layers.add(new AdjustmentLayer({name:'Float Lookup 3D'}));
three.setLut('TITLE "Float 3D"\nLUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1',
  {amount:62.5, interpolation:'tetrahedral'});
const gradient = document.layers.add(new AdjustmentLayer({
  name:'Float Gradient', opacity:.625,
  adjustment:{kind:'gradient-map', reverse:false, stops:[
    {position:0,color:'#171b46'},
    {position:.45,color:'#b65a74'},
    {position:1,color:'#ffe4a0'},
  ]},
}));
document.selectedLayer = gradient;
print('Float palette controls ready');
```

Independent references use pinned Colour Science 0.4.6 Cube reading and 1D/3D
interpolators, NumPy palette interpolation and reflected transfers; no application
or byte expected pixels supply float colors. Registered RGB tolerance is `2^-22`
times `max(1,abs(reference RGB))` per pixel, integer color error at most one code,
and exact alpha/neutral words. Native, scene, real UI/isolation/persistence/batch,
independent full-file and genuine 50 MP checks remain in verification. This
increment does not complete F04/F10/F14 or the original roadmap.

## Continuous HSL, Color Balance and Vibrance

The existing `AdjustmentLayer` DTOs also work in float documents:

- HSL: `{kind: 'hsl', hue, saturation, lightness}`. Hue is −180…180 degrees;
  saturation/lightness are −100…100. All three fields are required; neutral is
  exactly zero for all three. Trusted `defaultHslAdjustment()` returns that DTO.
- Color Balance: `{kind: 'color-balance', shadows, midtones, highlights,
  preserveLuminosity}`. Each range is exactly `{red, green, blue}` with required
  finite values −100…100; luminosity preservation is a required boolean. Trusted
  `defaultColorBalanceAdjustment()` zeroes the nine channels and enables
  preservation. All-zero channels are neutral with either boolean value.
- Vibrance: `{kind: 'vibrance', vibrance, saturation}`, both required finite
  values −100…100, defaulting to zero in trusted `defaultVibranceAdjustment()`.

Fractional controls are accepted. Use constructors and the ordinary
`layer.adjustment` setter; there are no new public mutation methods or command
types. Unknown/missing/nonfinite/out-of-range controls reject shared edits
atomically. Isolated scripts use explicit DTOs; trusted default helpers are not
sandbox globals. Locks, revisions, ordinary Undo and cancellation remain shared.

These controls retain their existing **encoded-sRGB** meanings. A native worker
encodes normalized working-linear RGB with the continuous sRGB transfer, performs
the control math in float64, fits the existing bounded gamut, decodes to linear
RGB and stores float32 once. It uses no byte LUT, byte canvas or integer RGB
intermediate. Alpha words are copied exactly. Globally neutral settings bypass
the conversion and preserve all finite signed/extended RGB words, including
subnormals and signed zero.

Active settings require the complete captured working RGB input in [0,1],
including hidden colors, before masking/opacity interpolation. Out-of-range
working colors reject rendering/delivery explicitly. Use neutral settings or an
active Levels range to bound those colors deliberately; originals are never
clipped to admit the tool. Disabled/zero-opacity layers retain their existing
render bypass. This bounded control model does not define an HDR HSL/vibrance
model or complete wide-gamut/HDR editing.

HSL rotates hue cyclically. Negative saturation/lightness multiply toward zero;
positive values interpolate toward one. Achromatic input never acquires an
arbitrary hue; hue/saturation-only edits preserve its original words. Equivalent
sum/minimum forms avoid cancellation and zero division for extremely dark
float samples. Color Balance weights the encoded luma
`l=.3*r+.59*g+.11*b` with shadows `max(0,1-2*l)`, highlights `max(0,2*l-1)`
and remaining midtones. Channels receive weighted offsets divided by 100.
Preservation uses the existing SetLum/ClipColor model; without it, the result
clamps to the bounded gamut. Vibrance uses
`max(0,1+(saturation+vibrance*(1-chroma))/100)` as the chroma multiplier,
then SetLum/ClipColor. These are encoded-luma controls, distinct from the linear
Tone saturation operator and from physical luminance/skin detection.

Mask/fill/opacity, artistic blending, isolated/pass-through groups and sibling
clipping apply after the control stage in the established float order. Complete
native processing precedes frame filtering and final SDR/file conversion. Failed
previews hide stale artwork until a current successful frame; failed delivery
publishes no partial file. Native project/workspace/history, semantic recipes and
original-bearing portable packages retain the same DTOs and source bytes.
Schema 49, plugin grants and REST/browser isolation are unchanged. Older float
implementations that reject these kinds continue to reject those documents.

Open a normalized original unsigned-16 TIFF in float editing mode first:

<!-- example: float-color -->
```js
document.convertToFloat();
document.layers.add(new AdjustmentLayer({
  name: 'Float HSL',
  adjustment: {kind: 'hsl', hue: 37.25, saturation: -43.5, lightness: 21.75},
}));
document.layers.add(new AdjustmentLayer({
  name: 'Float Color Balance',
  adjustment: {
    kind: 'color-balance',
    shadows: {red: -37.25, green: 12.5, blue: 71.25},
    midtones: {red: 27.5, green: -41.25, blue: 16.75},
    highlights: {red: 53.5, green: 19.25, blue: -61.5},
    preserveLuminosity: true,
  },
}));
const vibrance = document.layers.add(new AdjustmentLayer({
  name: 'Float Vibrance', opacity: 0.625,
  adjustment: {kind: 'vibrance', vibrance: 37.25, saturation: -41.5},
}));
document.selectedLayer = vibrance;
print('Float color controls ready');
```

Independent references use Python colorsys HLS and a vectorized equivalent
checked against every original scalar word stream, plus NumPy transfers and
encoded-luma helpers. [sRGB conversion definitions](https://www.w3.org/TR/2026/CRD-css-color-4-20261027/#color-conversion-code),
[SetLum/ClipColor](https://www.w3.org/TR/2024/CRD-compositing-1-20240321/#blendingnonseparable)
and [colorsys](https://docs.python.org/3/library/colorsys.html) describe the
reference methods. The registered primitive RGB bound is `2^-22`, scene RGB
uses that bound times the per-pixel maximum of 1/source/reference absolute RGB,
integer file color error is at most one code, and alpha/neutral words are exact.
No older comparison bound is widened. Photographic/device/color/performance
acceptance and the full original roadmap remain required.

## Continuous Curves and Levels

Existing `AdjustmentLayer` Curves/Levels controls now operate on accumulated
working-linear float RGB, followed by existing mask/fill/opacity interpolation.
They support isolated and pass-through groups and sibling clipping. Raster
`ToneAdjustment` remains its existing separate original-space effect stack.

Public control units stay 0..255; divide by 255 to obtain working RGB values.
The RGB master runs before optional red/green/blue channels. All stages use
float64 intermediates and round once to float32 at the end of each adjustment;
alpha is copied exactly. No byte LUT or display canvas supplies adjusted colors.

Curves use continuous cubic Hermite interpolation with averaged interior
secants, sign-safe tangents, zero tangents at flat segments and a radius-three
segment tangent limiter. Values outside the first/last knot use that endpoint's
linear tangent. A curve whose every knot has x=y is an exact identity, including
finite negative/above-one RGB and subnormals. This defines the float operator;
it is not a claim of equivalence to another editor's HDR curve implementation.

Levels normalizes `(value-inputBlack/255)/((inputWhite-inputBlack)/255)`, clips
to 0..1, applies `power(1/gamma)`, then maps to outputBlack..outputWhite divided
by 255. Active channels intentionally clip at their selected input endpoints.
A neutral default channel bypasses math and retains signed/extended RGB exactly.
Omitted per-channel settings are identity. Existing finite control ranges and
strict unknown-field validation apply. Unrepresentable curve knots reject the
shared edit atomically; nonrepresentable native output rejects rendering/export
without publishing a partial result.

Inspector graphs use the continuous curve. Histograms sample the native linear
backdrop on a grid of at most 256×256, exclude zero alpha, bin 0..1 and disclose
RGB samples below/above that range in edge bins. They describe sampled working
colors, rather than SDR preview values or an exact whole-original distribution.

<!-- example: float-transfer -->
```js
document.convertToFloat();
const image = document.layers.at(0);
if (!(image instanceof RasterLayer)) throw new Error('Select an original raster');
const curve = document.layers.add(new AdjustmentLayer({
  name: 'Linear curve',
  adjustment: {kind: 'curves', rgb: [
    {x: 0, y: 0}, {x: 64, y: 48}, {x: 128, y: 168}, {x: 255, y: 255},
  ], red: [{x: 0, y: 0}, {x: 120, y: 160}, {x: 255, y: 255}]},
}));
const levels = document.layers.add(new AdjustmentLayer({
  name: 'Linear levels', opacity: 0.625,
  adjustment: {kind: 'levels', rgb: {
    inputBlack: 12, inputWhite: 244, gamma: 0.85,
    outputBlack: 4, outputWhite: 251,
  }},
}));
levels.mask = new LayerMask({selection: new MarqueeSelection({
  shape: 'rectangle', x: 15, y: 10, width: 90, height: 55,
})});
document.selectedLayer = levels;
```

## Original-preserving raster erasure

`RasterLayer.erase(EraserStroke)` and `RasterLayer.clear(selection = null)` use
existing shared commands, locks, captured layer dimensions and Undo in float
mode. Clear selects layer-local coordinates; omission clears the whole image.
The Eraser tool works on selected original raster layers. Pointer preview uses a
detached scene and leaves history unchanged until commit; cancellation discards it.

Each authored erasure uses the existing brush/selection/texture coverage renderer
in its captured coordinate plane. Its byte coverage is normalized to float32;
only native float alpha is multiplied, once per operation, and rounded to float32.
RGB never passes through that canvas. Coverage is applied after original tone and
projection, before clipping-stack intrinsic shape, layer mask, fill and opacity.
Multiple erasures accumulate float alpha rather than a combined byte alpha mask.
Selection clips, pressure, tips, symmetry and textures retain existing coverage
semantics. These coverage semantics do not imply a float-color paint engine.
Prepared wet replacements and other color painting remain unsupported.

<!-- example: float-erasure -->
```js
document.convertToFloat();
const image = document.layers.at(0);
if (!(image instanceof RasterLayer)) throw new Error('Select an original raster');
document.selectedLayer = image;
for (let i = 0; i < 2; i++) image.clear(new MarqueeSelection({
  shape: 'pixels', x: 15, y: 10, width: 90, height: 55,
  coverage: {width: 1, height: 1, runs: [1, 128]},
}));
image.clear(new MarqueeSelection({
  shape: 'rectangle', x: 140, y: 80, width: 60, height: 100,
}));
```

## Sibling clipping in float documents

The existing `Layer.clipped` boolean now works in float scenes through the same
OO commands, Inspector checkbox, palette and history. Consecutive clipped
siblings share the preceding unclipped pixel-bearing base. Orphans and members
after an adjustment-only base are transparent. Membership never crosses groups;
release/reorder/deletion recomputes the current sibling relationship.

The renderer builds an owned float32 color plane, paints members there, and
restores the base's pre-fill intrinsic alpha once. Repeating soft coverage per
member would darken edges. Base fill changes its own color coverage; zero fill
can still show independently visible members within the original boundary. Base
mask and opacity apply to the completed stack. A pass-through base supplies
isolated child coverage; pass-through members see the stack's color plane.
Normal groups, raster transforms, full tone effects, clipped tone adjustment
layers, member masks/opacity/fill and nested sibling stacks keep their existing
float semantics. All existing normalized artistic modes are described below.
Pass-through fill still requires 1. Unsupported layer types remain
gated; this does not add Photoshop advanced clipping
switches or float SVG/PSD/PSB interchange.

No bitmap/display pixel supplies clipping colors. Working arrays remain bounded
to the existing per-window budget, with checks/yields and owned results. Source
bytes, geometry and outside-base artwork remain editable in native projects,
workspaces/history, copies and portable recipes. REST supports the structural
commands in independent sessions; it still supplies no float raster admission
or browser renderer/synchronization. Existing plugin document read/write grants
suffice; installation is inert.

For an original-bearing float document:

<!-- example: float-clipping -->
```js
const base = document.layers.at(0);
if (!(base instanceof RasterLayer)) throw new Error('Open a float TIFF raster');
base.name = 'Float clipping base';
base.fillOpacity = 0.375;
base.opacity = 0.75;
base.mask = new LayerMask({linked: false, selection: new MarqueeSelection({
  shape: 'rectangle', x: 15, y: 10, width: 90, height: 55,
})});
const member = new RasterLayer({
  name: 'Clipped float tone', assetId: base.assetId,
  width: base.width, height: base.height, opacity: 0.5, clipped: true,
});
member.adjustments.add(new ToneAdjustment({
  exposure: 1, contrast: 25, saturation: -40,
}));
document.layers.add(member);
document.selectedLayer = member;
```

## Artistic blend modes

Float raster layers, isolated groups and supported adjustment layers now accept
all 18 existing `blendMode` values: `normal`, `multiply`, `screen`, `overlay`,
`darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`,
`difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity`,
`linear-light` and `linear-burn`. Raster/adjustment defaults remain `normal`;
groups retain their existing `pass-through` default and can select any isolated
mode. Pass-through groups still require full fill opacity. Inspector choices,
OO constructors/setters, `layer.update`, isolated scripts/plugins and semantic
recipes use the same commands, validation and Undo history. No schema changes.

These operations blend in the document's **linear-sRGB working encoding** using
float64 intermediates and float32 stage results. They do not blend display bytes.
The [native processor contract](FLOAT_PROCESSING.md) defines the normalized
artistic formulas, including bounded Linear Light/Burn. Normal retains finite
signed and extended RGB. All other modes currently require both complete input
RGB windows in [0,1], including hidden-color samples; masks/opacity do not
reinterpret extended colors as normalized. This is normalized SDR float blending,
not an HDR artistic-blend extension, gamut mapping or implicit clipping.

A mode change is an ordinary authored edit. Actual pixel-domain validation runs
when rendering or delivering files, rather than guessing from thumbnails during
a synchronous metadata command. An out-of-range artistic input rejects the
render/export with an explicit instruction to choose Normal. The canvas hides
stale artwork and displays **Preview unavailable** until a current render
succeeds. The authored edit and original bytes remain intact: choose Normal,
Undo, or deliberately bring both inputs into range with suitable adjustments.
Export never substitutes the previous canvas frame for the failed document.

Raster/group modes apply source-over with native mask/fill/opacity coverage.
For clipping stacks, the base mode applies once after members and intrinsic
shape restoration; clipped members use their own modes. An adjustment blends
its computed RGB against the current backdrop, then applies mask/fill/opacity
interpolation while preserving the backdrop alpha exactly. It does not
source-over the backdrop onto itself. Native-first frame sampling happens after
all of these operations. Supported TIFF/PNG/PDF and fitted recipe/batch outputs
read the same float scene; display and byte deliveries retain SDR quantization.

Open a normalized unsigned 16-bit TIFF in float editing mode before running this
isolated example. Its original colors must be in range; the script never reads,
clamps or rewrites original pixels.

<!-- example: float-blends -->
```js
const original = document.layers.at(0);
if (document.precision !== 'float32' || !(original instanceof RasterLayer)) {
  throw new Error('Open a normalized original TIFF in float editing mode first.');
}
const screen = new RasterLayer({
  name: 'Linear screen', assetId: original.assetId,
  width: original.width, height: original.height,
  blendMode: 'screen', opacity: 0.75,
});
screen.adjustments.add(new ToneAdjustment({
  exposure: -0.5, contrast: -20, saturation: -25,
}));
document.layers.add(screen);
const color = new AdjustmentLayer({
  name: 'Linear color', blendMode: 'color', opacity: 0.5,
  adjustment: {kind: 'tone', exposure: 0, contrast: -20, saturation: -25},
});
document.layers.add(color);
document.selectedLayer = color;
print('Linear float blends ready');
```

Independent REST sessions accept the same mode metadata and revision/history
rules for supported float layers. [Native TIFF admission/source windows](REST_TIFF.md)
retain complete originals; composed rendering and live browser synchronization
remain outside the source service.
Internal plugins retain existing document/asset permissions and inert
installation; no file, native-worker, profile or network grant is added.

## Ownership, rendering and persistence

Float assets retain native width/height and exact original Blob bytes. Their
bitmap and thumbnail are bounded 96-pixel display images, explicitly unsuitable
for native color processing. Shared source-role validation rejects use of these
display-only pixels as byte raster artwork, masks, brush textures or other byte
roles. Ordinary native-sized byte assets remain unchanged.

The source service prepares lossless float32 tiles in IndexedDB. Captured scenes
pin original leases and mask sources before callbacks, validate source identity
across awaits and reject stale/disposed owners. All source preparation precedes
display/output ICC acquisition, preventing cold-source work from deadlocking
behind the shared two-owner ICC queue. Each captured scene owns a cancellation
signal and a final identity check. Renderer disposal/cache clearing aborts queued
source and output ICC work without waiting for unrelated owners to close. PNG
checks original ownership again after its last pixel read and final compression.
The renderer retains at most 64 original
source leases, with no full decoded color plane or bitmap ownership in that LRU.

Viewport and explicit float frame reads now filter the completed native artboard.
Raster effects, erasures, masks, adjustment layers, clipping and groups resolve
on native document pixels before final frame resampling. Nonlinear Curves/Levels
therefore have the same native-first interpretation at different zoom levels.
A frame excludes off-artboard content, clamps native border taps, then applies
transformed artboard coverage once. Integer-aligned frames copy native words
exactly, including hidden transparent RGB inside the artboard; filtered fully
transparent samples have zero RGB. Reading a captured scene without a frame
retains the native world plane, including off-artboard layers. These are internal
renderer reads, with no new isolated scripting or REST pixel surface.

Fitted float file delivery already sampled the completed native artboard; its
contract remains. Fitted canvas previews now use that same order and avoid a
second fractional contain-margin clear. Arbitrary affine frame geometry is
captured before asynchronous reads, and partitioning a frame preserves samples.
Wide/tall native reads split coverage work into bounded tiles, independently of
original or artboard geometry. No original-resolution limit is introduced.

Aligned native raster/projection grids use owned direct copies rather than
bilinear arithmetic. Padding stays transparent; the sampler still canonicalizes
transparent colors and signed zeros, checks source identity/cancellation and
yields during larger copies. This sampler behavior is distinct from the aligned
completed-artboard frame contract above, which preserves native hidden words.
Integer differences retain lattice detail even at very large safe world origins.

Projection uses float64 geometry and premultiplied bilinear filtering with
analytic transformed-rectangle coverage, rounding output to float32. Output
windows and adaptive source ROIs are bounded to 262,144 pixels; this is a working
allocation budget, not an original image or document resolution cap. Heavy
minification can read many source windows. No sustained 60fps or whole-process
peak-memory claim is made. The current viewport uses the standard float path;
WebGPU does not silently run the byte compositor for these documents.

The model stores `schemaVersion: 49`, `colorSpace: 'linear-srgb'`,
`precision: 'float32'`. Legacy byte documents omit precision or use `uint8` with
`srgb`; contradictory pairs and precision in older schemas reject. Native
projects, retained history, workspace/recovery and existing original-bearing
transport retain the working state plus `tiff.editingPrecision`. Tile caches are
derived, separate from authoritative original files. Older strict readers reject
the new model/choice rather than reinterpret a thumbnail as original pixels.
Admission validates source roles across the current document, both Undo/Redo
directions, branch forks/tips and saved comparisons before returning a project.
A malformed byte state that references a float thumbnail rejects the complete
load and disposes its privately prepared sources; Undo cannot admit that state.

## Delivery

```ts
await editor.export({format: 'tiff', tiffPrecision: 'float32'});
await editor.export({format: 'tiff', tiffPrecision: 'uint16',
                     color: {profile: 'display-p3'}});
await editor.exportTiffPages(editor.openDocuments,
                            {precision: 'float32', variant: 'auto'});
```

`ExportOptions.tiffPrecision?: 'uint8' | 'uint16' | 'float32'` and multipage
`TiffPagesExportOptions.precision` default to `uint8`. All high-precision pages
must be float documents. Mixed byte/float pages are allowed for uint8 output.
`tiffPrecision` on another format rejects. Classic/BigTIFF choice remains
`auto | classic | big` with `auto` default. Each float page converts directly
from linear float32 to the selected complete RGB ICC profile and file sample
type, with correct integer/float tags and straight alpha. Omitted color defaults
to linear-sRGB for high-precision TIFF and sRGB for byte output. Explicit output
settings override the default. In the Export dialog, high-precision TIFF shows
its actual embedded profile. **Use output RGB profile for high-precision TIFF**
explicitly selects the current output settings, including default sRGB. Leaving
it off keeps linear-sRGB working colors; an existing non-default output preset
starts enabled. This per-export choice does not change document or workspace
preferences. Float output retains finite extended values only
where the selected profile/transform supports them.

PNG/PDF convert directly to target RGB8 and embed the exact target profile.
JPEG/WebP/AVIF retain their existing sRGB SDR delivery. Byte/integer formats
quantize and clip unrepresentable colors without tone mapping; capability reports
disclose this. SVG/PSD/PSB float interchange rejects before producing a file.
Native projects remain the editable interchange path.

Batch variants accept optional `tiffPrecision` only for TIFF. Prepared float
project checkpoints preserve working mode through fitted delivery. Fitting
samples the composed native artboard, excluding outside layers and applying
fractional boundaries once. Explicit profile receipts use version 2 with
`sourceSpace: 'linear-srgb-float32'` and the actual output sample format; byte
receipts retain version 1. Settings, checkpoint precision and profile receipt
must match before accepted-file reuse. Portable delivery presets and manifests
retain the new precision and integrity fields. Direct batch image inputs retain
their existing admission contract; this does not add direct float TIFF batch
source selection.

## Verification and remaining scope

The dated implementation roadmap records actual completed checks and failed
pilots. `scripts/check-float-document.py` reads every delivered channel with
independent native libtiff/Pillow/MuPDF and compares it against independent native
CMM source references, exact power-of-two exposure and native output conversion.
Identity/exposure comparisons retain exact words; no existing numeric bound is
widened. White Balance uses independent Colour Science matrices with
numerical tint tangents: its separately declared float bound is `2^-20` times
the per-pixel maximum of 1, absolute source RGB and absolute reference RGB;
integer color error is at most one code, and alpha words remain exact. These
bounds do not relax any existing identity/exposure/tone/transfer/blend check.
Pure projection tests separately cover affine partitioning,
hidden RGB/alpha, sparse large geometry and cancellation.

Required later work includes broader source/working profiles and conversion,
other integer depths and non-TIFF high-precision admission, all remaining tools/layer types,
blends/styles, float coverage, physical device proof/color quality, HDR transfer/display/tone
mapping, CMYK delivery, interchange, wider photographic/device validation and
sustained all-tool performance. This initial mode is not full F10 acceptance.

Lookup interpolation uses convex weights, including barycentric weights for
tetrahedra, so full-strength mapping and selected table endpoints survive
extreme finite unused inputs/table entries. The reflected transfer preserves
exact signed unit endpoints. Analytical endpoint regressions supplement the
independent Colour Science corpus.

## Float viewport work and display ownership (F14)

Viewport display partitions work by the existing 65,536-output-pixel ceiling,
with each axis at most 2,048 pixels, so small frames avoid repeated narrow-strip
source/worker transactions. Original samples and complete native effects still
precede frame filtering and the actual native ICC conversion. These are working
allocation bounds, not source/document geometry limits; file/native read
partitioning retains its separate contract.

Aligned 100% previews may retain one complete native float appearance for a
single visible, unclipped Normal raster at original dimensions. Eligibility
requires identity geometry, integer placement with exact sampling arithmetic,
no active tone/erasure/overlay/Blend If work, and either no effective mask or a
linked, unfeathered, uninverted hard rectangular selection mask at full density.
The complete source plus finite shadow/bilinear support must fit 262,144 pixels
and 2,048 pixels per axis. These are private cache budgets, not import limits.
The retained plane uses at most 4 MiB; transient evaluation and other caches have
separate budgets. The entire appearance includes outside-artboard pixels, so
moving artwork into view retains entering edges. Every displayed tile clips to
the current artboard and still passes through the native display/proof transform.

Intrinsic/source changes rebuild; unsupported scenes or views use ordinary native
evaluation. Source capture/preparation, ownership/cancellation and proof validation
still run on hits; immutable verified samples avoid repeat derived-tile reads.
Failed/incomplete builds never publish cache entries. Renderer cache clear and
disposal drop the plane. Explicit export/reference `cache:false` and captured
native/file reads bypass it. This adds no document state, public API or privileges,
and does not establish sustained all-tool 60fps or global-memory acceptance.

One idle prepared display transform may be reused across renderers while still
counting against the shared two-native-owner limit. Queued source/profile work
retires idle display ownership instead of waiting behind it. Each active lease
has its own abort/progress scope; release detaches it before idle retention.
Failed, cancelled, pending, oversized-scratch or closed sessions retire, and
renderer clear/disposal retires its own idle state. No artwork, original source
or document capture is retained by the idle transform. Explicit ICC session
disposal still terminates immediately. Source validation, exact output/window
validation, shared commands, Undo, plugin grants and separate REST are unchanged.


## Color Overlay and Blend If

Existing `LayerStyle` and `BlendIf` constructors now work on float rasters,
isolated groups, clipping stacks and supported adjustment layers. Inspector
controls retain their existing defaults, preview/cancel, locks and shared Undo.
Raster/isolated-group drop shadows use the native shadow contract below. Direct
adjustment shadows reject atomically. Pass-through groups still require
disabled group styles and full Fill.

Color Overlay uses the existing six-digit sRGB color and opacity in [0,1]. Its
default is disabled; opacity zero is exact identity, including hidden colors and
signed-zero words. The selected color is decoded continuously to linear sRGB;
`(1-opacity) * workingRGB + opacity * linearOverlayRGB` computes in float64 and
rounds once to float32. Alpha is copied exactly. Finite negative/extended working
RGB remains valid; the original asset and source samples are never rewritten.

Blend If retains `enabled` (default false), `channel` (`luminance`, `red`, `green`
or `blue`) and the ascending four-handle `source` / `underlying` ranges in 0..255.
The default ranges are `[0,0,255,255]`. Fractions are allowed. Selectors encode each
linear channel continuously to sRGB, bounding only that selector to 0..255.
Luminance is 0.2126 R + 0.7152 G + 0.0722 B of these encoded selector channels.
Actual working colors are not bounded or quantized by that calculation. The
inclusive outer cutoffs and linear inner feathers have the same authored units
as byte documents; a zero-width feather is a hard edge. Source and underlying
weights multiply and round once to float32 coverage. Full default ranges retain
all finite extended colors. Overlay is applied before the source selector.

Styles evaluate completed layer/clipping colors against the actual sibling
backdrop. Separate coverage combines with the existing mask, Fill and opacity
at final blending; it does not replace intrinsic clipping shape. Adjustment
styles change adjusted colors while retaining backdrop alpha and interpolating
once. Group isolation, pass-through children and native-first frame filtering
keep their existing order. Final SDR or integer output may clip extended RGB;
linear float TIFF retains the native scene. Source data, history and workspace
proof preferences remain separate from display/output conversion.

For an already-open original high-precision TIFF, this example runs through the
ordinary isolated scripting host with existing document grants:

<!-- example: float-style -->
```js
document.convertToFloat();
const original = document.layers.at(0);
if (!(original instanceof RasterLayer)) throw new Error('Open a TIFF original');
original.styles = new LayerStyle({
  colorOverlay: {enabled: true, color: '#ad3f79', opacity: .375},
  blendIf: new BlendIf({enabled: true, channel: 'red',
    source: [12.25, 67.5, 193.75, 246.5], underlying: [0, 0, 255, 255]})
});
const tone = document.layers.add(new AdjustmentLayer({
  name: 'Float appearance', opacity: .75, fillOpacity: .625,
  adjustment: {kind: 'tone', exposure: .5, contrast: 0, saturation: 0}
}));
tone.styles = new LayerStyle({
  colorOverlay: {enabled: true, color: '#2468ac', opacity: .125},
  blendIf: new BlendIf({enabled: true, channel: 'green',
    source: [8, 32, 224, 252], underlying: [0, 48, 208, 255]})
});
document.selectedLayer = tone;
```

The same strict existing `layer.update` style DTOs, source/revision/lock checks,
one-transaction isolated commit, native project/workspace transport and recipe
commands apply. No public worker, raw pixel, file, native-profile or network
privilege is added. Independent REST sessions retain their existing asset and
renderer limits and do not synchronize with the browser. Malformed native
results, nonfinite colors, changed alpha, coverage outside [0,1] and wrong window
shapes reject before publication; caller buffers remain attached. The dated
roadmap records verified coverage and remaining F10/F14/device/quality gates.


## Native float drop shadows

Existing `LayerStyle.dropShadow` supports float raster layers and isolated artwork
groups, including clipping bases and nested groups. Its unchanged defaults are
`{enabled:false,color:'#000000',opacity:.45,x:8,y:8,blur:12}`. Color is six-digit
sRGB hex, opacity is 0..1, offsets are -256..256 and blur is Gaussian sigma 0..128;
fractions are allowed. Invalid values reject the complete command/transaction.
Direct adjustment shadows reject: an adjustment has no independent silhouette.
Put artwork and its adjustments in an isolated `LayerGroup` and style that group.
Pass-through groups still require disabled own styles and full Fill.

The silhouette is intrinsic raster/group alpha after own erasures and mask, before
own Fill, overlay, Blend If and layer opacity. Clipping-base shape excludes the
clipped members and base Fill. Child appearance contributes to group intrinsic
alpha. Mask coverage retains the existing rasterizer precision; source RGB never
enters a byte canvas. Fill changes foreground coverage while zero Fill can retain
a visible shadow. Layer opacity changes the complete artwork and shadow once.

Blur uses document pixels after affine artwork placement: normalized finite
Gaussian support `ceil(3*blur)` on each axis, ordered float64 sums and one float32
store per axis. Sigma zero copies alpha exactly. Fractional offsets sample the
blurred native field bilinearly. Shadow color is decoded to linear sRGB and rounded
to float32; alpha is the sampled field times shadow opacity. Foreground alpha is
rounded once after mask and Fill, Color Overlay affects foreground RGB, and normal
source-over puts that foreground over the shadow. Blend If evaluates this completed
appearance against its sibling backdrop before the final layer blend/opacity.
The mask is not applied a second time to the shifted shadow. Completed native
appearance precedes viewport/frame filtering and native PNG/TIFF/PDF delivery.
Shadow disabled or zero opacity takes the exact previous no-shadow path.

Each native request stays within 262144 alpha samples. Output block edges adapt
to blur/fractional offset (at most 512), keeping the complete horizontal
intermediate/vertical input within that same alpha budget. Source halo bands
use the existing 262144-pixel working budget; the intermediate contains alpha
only. Native raster alpha is read once for each required band rather than
repeated 32-row reads. The capture-local Gaussian alpha LRU retains at most 16 MiB
and clears on disposal. These are working allocation budgets; source/artboard
resolution is unchanged. Native worker validation, source ownership, cancellation,
revision/grants, shared Undo, project/workspace and recipe contracts remain.
Older float implementations can reject the newly supported style metadata.
Independent REST accepts the metadata but has no browser float renderer or sync.
No new public native/pixel/file capability is exposed to isolated code/plugins.

Open an original-backed TIFF in float mode first. This isolated example is one
ordinary script transaction and leaves a visible shadow at zero Fill:

<!-- example: float-shadow -->
```js
const layer = document.layers.at(0);
layer.fillOpacity = 0;
layer.mask = new LayerMask({linked:false, selection:new MarqueeSelection({
  shape:'rectangle', x:64, y:64, width:128, height:128,
})});
layer.styles = new LayerStyle({dropShadow:{
  enabled:true, color:'#ad3f79', opacity:.625, x:9.25, y:-4.75, blur:2.5,
}});
document.layers.add(new AdjustmentLayer({name:'Float shadow adjustment',
  adjustment:{kind:'tone', exposure:0, contrast:0, saturation:0},
}));
document.selectedLayer = layer;
print('Float shadow example ready');
```

This extends the existing linear-sRGB float scene subset. It does not establish
Photoshop shadow equivalence, all-float layer/tool support, HDR/CMYK delivery,
sustained 60fps or complete editor/device/process-memory performance acceptance.


Native shadow evaluation validates complete returned alpha planes before omitting
zero convolution work. At zero Fill, an unmodified original raster on the native
integer grid can omit unused foreground reads and fully masked halo reads after
original preparation. Groups, active raster effects/erasures and other affine
projections retain intrinsic evaluation and its hidden-color/domain/overflow
failures before own Fill/masks. Artistic blending still validates its required
backdrop even when the shadow is empty. Capture/source lifetime checks guard
these paths, including cancellation after an empty mask read. These are private
execution optimizations, with unchanged public style/history/transport semantics.
