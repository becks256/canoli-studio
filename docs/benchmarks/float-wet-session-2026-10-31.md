# Retained linear float wet preparation — 2026-10-31

Status: verified private implementation increment from `c7b222f`; the full
original implementation-roadmap goal remains active.

The retained session lifecycle now supports Float32 source/destination tiles and
signed/HDR premultiplied spatial pigment. Byte sessions use the same lifecycle
with their previous encoded/clamped/rounded math. The new private float format
uses actual native linear load/deposit/pickup/final-envelope worker operations.
No source or destination RGB goes through an 8-bit canvas or PNG replacement.

[Exact private contract, defaults, coverage precision and ownership](../FLOAT_PROCESSING.md#retained-linear-float-wet-sessions).

## Checks

Passed: **3,246 unit/API/native tests across 314 files; 76 source-browser cases across 11 files; 11 selected normal-production cases across 4 files**. There are zero failed/skipped cases, retries, flakes or
runner errors in those complete browser runs. Both the build and typecheck pass.
The product/test/fixture freeze covers 1,647 files throughout acceptance.

Independent scalar NumPy references check every output word for three retained
prefixes of a signed/HDR stroke, across three native tile sizes and two real
IndexedDB/cache configurations. Six dabs retain first-prefix data without replay,
read each original tile once and apply selection/opacity once. Tiny custom
coverage is 1/4096. A 2,048-byte real resident budget peaks at 1,568 bytes; zero
cache peaks at zero, with exact output in both. Three independent dyadic affine
frames verify every bilinear pigment word through dense and compact cells.
Additional compact sampling checks cover copied metadata, incomplete support
and zero-alpha canonicalization after minimum-positive-float alpha underflow.

Real worker/browser checks retain textured, tilted, reflected/sheared symmetry
across tile partitions and source closure. Original-derived replay opens both
131x79 and genuine 10000x5000 float TIFFs. Each compares a 64x48 original window
against independent native libtiff/Linux-CMM linear samples, matches retained
and one-shot output, keeps the read-only document unchanged and owns results
after closing the source. **This is bounded-window source/replay acceptance, not
an every-pixel 50 MP stroke or full HDR document-edit/delivery acceptance.**

Cancellation, source/processor/storage errors and quota failure delete private
unpublished work while previously owned prefixes remain readable. Initial
capture/storage failure now releases the supplied source callback exactly once.
Snapshots yield fresh Float32 arrays; cropping and delta reuse do not crop the
simulation. Wrong precision, extents, nonfinite values and invalid coverage
reject before a completed result can publish.

The full affected source matrix retains existing byte authored output, rail/
pointer gestures, mask/filter-mask input, partial-prefix rendering, resident
cache epochs, atomic storage rollback, cancellation, project persistence and
original 50 MP behavior. Normal production repeats built HDR numerical/gating
checks, float-mask delivery, projected byte Mixer controls and six affine/
projected layer/ordinary-mask/filter-mask prefix workflows with original bytes
and one Undo. These are selected affected production tests; no full-production,
physical-device or continuous-60fps claim follows. Source and production
workflows may overlap in this run; collected latency traces are not a controlled
performance comparison.

Early TypeScript output retains a new test-only unused import and reducer
annotation correction. Earlier focused pilots are preserved. No numerical,
ownership or behavioral assertion was weakened, and no product timeout or
quality threshold changed.

## Evidence

[Compact SHA-addressed receipt](float-wet-session-2026-10-31.json.gz) retains full
unit/browser/production reports, exact new native output buffers, fixture and
source identities, original-window checks, artifact inventory, build logs and
final application-asset comparison. Large existing workflow images/containers
stay in the local task directory with hashes in the receipt. No new ZIP is
tracked. The independent generator is
`scripts/generate-float-wet-session-fixtures.py`; compressed/raw identities and
generator source are checked by tests.

Reproduction uses `npm run build`, `npm test -- --maxWorkers=2`, the eleven source
specs named in the receipt configuration and these production specs:
`float-wet-production.e2e.ts`, `mask-plane-float-production.e2e.ts`,
`projected-wet-production.e2e.ts`, `wet-feedback-production.e2e.ts`.
`/tmp/canoli-float-session-2026-10-31/` retains the exact Chromium/server configs,
frozen release, raw samples and reports. Original native reference fixtures
require the existing libtiff/Little CMS/NumPy environment.

## Still required

Private job databases are not a document HDR wet replacement format. Versioned
HDR assets/fields, native composed replay/projection, source-bearing history/
project/workspace/recipe transport and guarded authoring previews/commit remain
required before actual float Smudge/Mixer and automation surfaces are enabled.
Default brush/texture and selection scalar coverage retains its existing byte
rasterization; custom private dab coverage can retain Float32. No new schema,
public constructor, script/REST service, plugin authority, paid call or cloud
upload is added. All other unfinished original roadmap gates remain active.

Receipt: **523783 bytes**, SHA-256
`a0760bacdf4cd885972f9f1cc185448b321680d8452b69423941b30772549e16`. Independent unpacking validates every stored object
identity/length and all six new prefix comparisons. All **101 final runtime
resources match the tested build byte-for-byte**; the final float-documents
guide page contains the updated integration boundary.
