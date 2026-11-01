# Shared HDR wet host assets — 2026-10-31

Status: verified private F03/F10 dependency from `da983fe`. Classification:
progress. The full original implementation-roadmap goal remains active.

`captureHdrWetAssets` captures all ordered native references and source
identities before asynchronous work. Browser and independent headless adapters
validate complete TIFF originals through one pair validator. Blob-pair proofs
never bypass current geometry, source identity, cancellation or store lifetime.
`captureHdrWetAssetField` connects that owner to native Float64 field reads.
Disposal releases owned pins/provider callbacks; returned arrays remain owned.
[Exact signatures, invariants and limits](../HDR_WET_FIELDS.md#shared-host-asset-capture).

## Acceptance

Passed: **3,276 unit/API/native tests across 316 files; 75 source-browser cases across 9 files; 11 selected production cases across 6 files**. These complete runs have zero failures, skips, retries,
flakes or runner errors. `npm run build` and typecheck pass; all 3,438 frozen
product/test/fixture/build-input identities remain unchanged through acceptance.
The final build retains every tested runtime resource and developer page exactly.

New focused tests cover complete original pairs, ordered overlapping replacement,
signed/HDR and minus-zero samples, metadata ownership before awaits, geometry,
all five source-identity fields, missing/truncated sources, invalid later/offscreen
pairs, cached-proof reuse, cancellation/retry, disposal and reentrant retirement.
Final ownership review removed a closure reference to the original provider.
A separate forced-GC Node diagnostic keeps disposed owners alive: the fixed
provider collects while an otherwise identical old-closure control remains
retained. The entire acceptance matrix repeats after this correction; earlier
passing reports and the diagnostic setup log remain in the receipt.
Actual headless encoded TIFF asset records replay without accessing a fabricated
ImageBitmap or PNG decoder. This does not enable a REST command or server renderer.

A real browser imports complete 131x79 prepared TIFFs through the float asset
store and validates its 96x58 display surfaces. Replacing the color thumbnail
with an unrelated opaque white ImageBitmap does not change a single field word.
Independent native libtiff checks both complete originals and their full ICC:
**82,792 Float32 sample words** match the fixture/coverage reference. NumPy checks
all **51,745 Float64 field words**, including an independent returned retry.
Stale bitmap identity, cancelled preparation, store closure and offscreen alpha
violations reject. The legacy byte path still requires native PNG dimensions and
RGB8/RGBA8 encoding.

Affected regressions retain HDR native/worker sampling and composition, retained
float preparation, masks, projected/mapped byte wet painting and source precision.
Existing source tests independently read 16 prepared TIFFs from real 131x79 and
10000x5000 originals; each wet replay uses a disclosed **64x48 window**. The separate
full 50 MP float pipeline retains its 200 million exact samples. These are distinct
checks; neither establishes full-image HDR wet document editing, sustained 60fps,
photographic/device quality or all-production acceptance. Eleven selected normal
production cases retain current worker, byte editing, tool guards and mobile guide
behavior; private HDR host capture is exercised in the source browser and headless
tests rather than exposed as a production user API.

## Evidence

[Compact SHA-addressed receipt](hdr-wet-host-assets-2026-10-31.json.gz) retains complete test
reports, source/fixture identities, the new original TIFFs and field words, three
independent native reader reports, other HDR fixture outputs and build/runtime
comparisons. Receipt SHA-256: `9d2ac9b444c5db714f41d01bec485073bb871d1be7e159680281528b98c02b71` (2,230,942 bytes).
Large existing pipeline artifacts remain local with hashes. No new ZIP is tracked.

Reproduce using `npm test -- --maxWorkers=2`, `npm run build`, the source/production
specs listed in `/tmp/canoli-hdr-wet-host-2026-10-31/` configs, and
`python3 scripts/check-hdr-wet-host-assets.py <browser-artifact-directory>` with
native libtiff and NumPy. Browser and headless validation use original TIFF rows;
extreme native row widths remain dependent on available memory. There is no new
original image, file-size or tile-count limit.

## Still required

Versioned public HDR wet metadata, connecting guarded asset validation to shared
OO/isolated/REST commits, ordered FloatScene replay/projection/resize and
original-bearing history/project/workspace/recipe transport remain required,
followed by trusted authoring previews/commit and actual float tools. Schema 56,
public byte wet constructors and plugin permissions remain unchanged; float
Smudge/Mixer remain disabled. Every other unfinished original professional, AI,
workflow, live ChatGPT identity/plugin, commercial, specialist and motion gate
remains required. No paid operation, upload or browser/REST synchronization follows.
