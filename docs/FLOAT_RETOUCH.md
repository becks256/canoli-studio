# Native linear Patch and Spot Healing

Status: verified native source-bearing increment, schema 59. This extends the existing
local repair workflow to float32/linear-sRGB documents. Full F05/F10/F14,
photographic quality, physical devices and sustained performance remain open.

## Existing tools and prepared values

Patch (J) and Spot Healing (Shift+J) use the existing rail, keyboard registry,
Source/Destination, sampling and brush controls. They prepare a separate
correction layer and commit one Undo. The footprint/donor outline is a geometric
preview; it does not show solved pixels while the pointer is held. Escape,
revision/ordered-selection changes, source interpretation changes and cancellation
reject pending work without publishing private assets.

`new PatchAdjustment({assetId, width, height, precision: 'float32'})` captures an
immutable prepared correction. The existing positive safe-integer logical
dimensions and required nonempty asset ID remain; `.precision` is read-only.
Omission retains the byte contract. Native corrections require schema 59 and a
float document, including hidden or inert values. Detached native corrections
can be constructed and grouped before attachment; actual destination validation
still applies. `new AdjustmentLayer({adjustment: correction})` and
`layer.setPatch(correction)` use shared commands, ancestor locks and Undo.

The source must be a complete single-page, orientation-1, chunky, straight
RGBA32 TIFF with the exact pinned linear-sRGB ICC. RGB is finite signed/HDR
corrected color; **source alpha is correction coverage**, not target opacity.
Logical width/height may resize independently of the original native grid.
Every original sample and source identity validates, including hidden tails,
before external commit, persistence admission or scene publication. Reusing an
asset ID as a bitmap mask or brush texture still requires that role's byte
contract. Synchronous trusted constructors do not decode originals.

Replay samples the correction on its retained grid through current affine
placement and mixes RGB once by its coverage while preserving backdrop alpha.
Transparent and uncovered targets keep their hidden words. Current masks,
clipping, styles, Fill, opacity and blend follow ordinary adjustment behavior;
native correction alpha never source-overs the backdrop onto itself. Saved
corrected RGB is a snapshot, not a live recomputed Poisson operation. Source
artwork remains unchanged.

## Preparation and numerical contract

Trusted host `editor.applyPatch(offset, sampling = {mode:'all-layers'},
options = {}, signal?)` and `editor.healStroke(brush, sampling =
{mode:'all-layers'}, options = {}, searchRadius = 64, signal?)` retain their
signatures. All-layers/current-layer/current-and-below sampling captures original
float scene samples before SDR display or proofing. It preserves captured
ancestry, transforms, masks and appearance. Out-of-artboard sampling is
transparent. No display thumbnail or color Canvas supplies native RGB.

The existing four-neighbor Dirichlet solver uses Float64 equation/scratch
arithmetic in the actual WASM kernel, then stores finite Float32 output without
RGB clipping or integer rounding. `mode:'source'` transfers donor gradients;
`mode:'mixed'` chooses the larger absolute gradient per channel. Missing donor
alpha uses target guidance; zero-alpha targets are inactive. Defaults are
`tolerance:1e-7` in **linear RGB equation units** and `maxIterations:500` per
channel. Byte repairs retain default tolerance 0.001 in byte RGB units.
Tolerance must be positive finite; native iteration limits are positive integers
at most 2,147,483,647 (the kernel ABI). Residual describes the Float64 equation
before Float32 storage. Nonconvergence and nonfinite output reject publication.

The solver uses binary selected support; canonical selection/brush coverage
feathers the correction once afterward. Native Healing preserves unquantized
global stroke opacity in Float32 coverage, separate from canonical byte scalar
geometry/flow/pressure coverage. Texture, tip, symmetry and selection clipping
affect coverage only. Deterministic local donor scoring excludes damaged
interior RGB and requires intact donor support/alpha. This is not semantic
healing or a guarantee of photographic quality.

Native sampling uses fixed bounded tiles; a correction can span many tiles and
streams through TIFF encoding. Solver/search arrays still scale with their
actual selected/search region. Browser allocation, time and native ABI limits
remain; no original image megapixel or file-size cap is added.

## Isolated preparation

`document.patchRegion(region, offset, options = {})` and
`layer.healSpot(center, radius, options = {})` retain their existing signatures,
defaults and coordinate contracts. They select the numerical path from the
captured document precision; native tolerance defaults as above. Source and
Destination use safe integer document offsets; layer sampling requires a valid
source. Healing radius is 0.05–1024 document pixels; `searchRadius` is a positive
safe integer, default 64. Healing defaults: current-layer sampling, hardness
0.7, opacity/flow 1, current selection clipping, constant pressure. Other solver
options match Patch. Missing/locked targets, empty coverage, unavailable intact
donors, stale originals, cancellation and solver failure reject atomically.

Open the independently generated damaged float fixture, then run:

<!-- example: float-retouch-patch -->

```js
const region = new MarqueeSelection({
  shape: "rectangle",
  x: 122,
  y: 90,
  width: 13,
  height: 13,
});
const repair = await document.patchRegion(region, { x: 16, y: 0 });
repair.name = "Native Patch repair";
print("Native Patch prepared");
```

Alternatively, on the same unrepaired source:

<!-- example: float-retouch-heal -->

```js
const source = document.layers.at(0);
if (!source) throw new Error("Import the damaged native source first");
const repair = await source.healSpot({ x: 128.5, y: 96.5 }, 6, {
  hardness: 1,
  searchRadius: 24,
});
repair.name = "Native Healing repair";
print("Native Healing prepared");
```

Await repairs sequentially outside synchronous transactions. Earlier private
edits/repairs are available to later operations. The existing 32-repair,
five-second execution and 256-command limits remain. A late error discards all
private edits/assets; a successful script publishes one Undo. Installed plugins
remain inert and need current document read/write and assets read/write grants
through preparation and final publication. Original TIFF identity/interpretation
pins survive through transfer.

Independent REST sessions accept validated prepared native correction commands,
strict revisions, history and original-bearing projects. They gain no composed
repair solver and do not synchronize with browser documents. Source-bearing
recipe/workspace/project remapping uses existing asset references and validation;
no new grants, account, upload or paid operation is introduced.

## Verification

The complete unit/API suite passes **3,355 cases across 330 files** against the
actual emitted WASM. The build/typecheck pass with 50 developer guides. Independent
NumPy/SciPy fixtures verify source/mixed Poisson equations, mask holes/disconnected
support and deterministic donor scoring. Worker tests verify ownership, alpha,
convergence, geometry, result kinds, cancellation and malformed donor replies.

All **61 distinct source-browser cases across 16 files** and **eight distinct
production cases across three files** pass across the complete matrix and
focused rechecks. Native checks cover both isolated examples, Source/Destination
parity, precise Healing opacity, cancellation/source/selection guards, inert
plugins, late-error rollback, independent REST and source-bearing recipe/project/
redo-only workspace replay. Rotated and reflected corrections with masks, Color
Overlay, Fill and pass-through opacity match a separate staged scalar reference
exactly, including partitioned reads and every alpha word.

Independent complete TIFF decoding checks all 198,404 values per production
output: Patch matches the clean reference exactly, and Healing/reopened RGB
error is at most 5.960464477539063e-8, with exact alpha and untouched pixels.
The genuine 50 MP source retains its complete original bytes and geometry; all
12,288 values in a 64x48 edit window match an independent Dirichlet solve within
its equation/storage bound. Existing full-image 50 MP float32/uint16 clipping,
exposure and full-tone delivery regressions also pass their independent readers.
This is bounded repair evidence, not full-image Poisson performance or photographic
quality acceptance.

The initial broad matrix passed 56/60 cases; four failed because the system
Python lacked the PDF reader. All four pass unchanged with the established PDF
Python environment. Other pilots exposed source-selection, toolbar-coordinate,
full-transform, recorded-rename and unrelated-worker-count fixture assumptions;
those corrections retain the original pixel/ownership/cancellation checks and
numerical bounds. Full professional, photographic, physical-device and sustained
editor-wide performance gates remain required. [Findings and retained failures](../docs/benchmarks/float-retouch-2026-11-01.md)
and [compact receipt](../docs/benchmarks/float-retouch-2026-11-01.json.gz).
