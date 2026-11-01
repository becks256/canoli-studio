# Trusted HDR wet authoring — 2026-10-31

Status: verified F03/F10 increment from `4070680`; classification: progress.
The full original implementation-roadmap goal remains active.

Smudge/Mixer now use the existing retained authoring lifecycle for native float
raster artwork. A captured neutral original FloatScene supplies bounded Float32
windows; retained sessions preserve signed/HDR color and stage lossless straight
TIFF pigment/removal pairs. Private prefix assets, append reuse, leases, source
interpretation/geometry checks and ordered-selection/revision/cancellation guards
remain in the shared preview and single-transaction publication path. Ordinary
masks in float documents keep byte scalar coverage and PNG pairs. The rail and
registry support valid float targets and preserve a valid mask choice.
[Exact signatures, defaults, errors, limits and trusted example](../HDR_WET_DOCUMENTS.md#trusted-native-authoring-and-tools).

Passed: **3,285 unit/API/native tests across 318 files; 80 source-browser cases across 9 files; 14 selected production cases across 5 files**. The final unit/source/production runs have zero failures,
skips, retries, flakes or runner errors. Build and typecheck pass. All
3,389 indexed product, engine, server, test, fixture and script
inputs remain fixed during acceptance. Final application runtime resources match
the tested release exactly. Developer documentation receives status updates;
all executable examples remain exact, and the selected production matrix runs
again on the final build.

Independent native libtiff and NumPy read every staged sample and complete
linear-sRGB profile, compare a 64x48 original window against the native fixture,
compute a known full-coverage signed/HDR load/mix and once-only opacity result,
and match all 12,288 Float32 words in each committed/reopened window. Retained
prefixes match one-shot native output and own files after cancellation. Stale
original interpretation, document edits, changed selection, cancellation,
invalid alpha, missing targets and locks reject without publishing output or
leaking private job databases. Native mask edits change scalar coverage while
preserving surviving RGB exactly.

Real Smudge and Mixer pointer workflows keep the document/assets/history private
while previewing, commit identical native window words once, Undo/Redo exactly,
and cancel a second gesture cleanly with Escape. Projected authored output
matches its private native preview under reflected affine placement and original
resize. Source-bearing recipe packages and workspace recovery retain exact
replay; perspective reset, further resizing and project reopening preserve it.
The tested trusted code example is extracted from the guide and executed.

Normal production opens an original float TIFF, uses actual Mixer controls and
canvas input, cancels, commits, saves, undoes/redoes and reopens the project with
no developer globals. Saved operations retain explicit float precision, linear
load, native TIFF pairs and exact original bytes. Existing production independent
HDR numerical/TIFF-delivery checks, isolated prepared edits and six affine/
projected layer/ordinary-mask/filter-mask feedback workflows remain green.
REST remains independent, and no new simulation service or plugin permission
is exposed. Full unit/API regressions retain the existing shared command gates.

A genuine 10000x5000 original retains bytes, dimensions and one reversible HDR
stroke. The authoring verification covers a disclosed **64x48 native window**
and an independently computed center result; it does not establish every-pixel
50 MP wet editing or delivery performance. Existing source/session/public-edit
and byte 50 MP regressions retain their own scopes. Concurrent test execution
is not a controlled latency comparison. No full-production, sustained 60fps,
physical/photographic/device or all-roadmap acceptance is inferred.

[Compact content-addressed evidence](hdr-wet-authoring-2026-10-31.json.gz) retains raw reports,
build logs, input/runtime identities, native results/reader reports, selected
actual TIFFs/projects/screenshots and a hash inventory for larger existing
artifacts. Local raw artifacts and exact Chromium/server configs remain in
`/tmp/canoli-hdr-wet-authoring-2026-10-31/`. The receipt is 3,002,636 bytes,
SHA-256 `6e3821a14e70923265f967d30201a70ccb6d164680b7f9c8fadd03f29898691b`. New ZIP archives remain ignored.

Earlier pilots are retained: the first trusted fixtures had no selected raster;
a tool fixture used a nonexistent mask constructor, then configured a mask in
the same turn as a model change before React's target reset. The final test uses
the actual target selector after mask controls appear. No pixel, lifecycle,
rollback, permission or numerical threshold was weakened.

Reproduce with `npm run build`, `npm test -- --maxWorkers=2`, and the source/
production specs in the receipt configs. Chromium, the local loopback servers,
NumPy/libtiff and the existing PDF-check Python environment are used. The final
release is kept separately from the working preview.

Remaining work includes broader float tools/layers/working spaces, mask/master/
nested-projective and general warp coverage, photographic/device quality,
sustained F14 performance, and every unfinished original professional, AI,
provider/evaluation/production, workflow, installed/model-driven ChatGPT/live
identity, commercial, specialist and motion gate. This increment does not narrow
the original objective.
