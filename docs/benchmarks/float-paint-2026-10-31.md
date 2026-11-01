# Editable native linear paint — 2026-10-31

Status: verified F03/F10 increment from `6c48365`; classification: progress.
The full original implementation-roadmap goal remains active.

Float PaintLayers now replay existing Brush, Pencil, Eraser and solid Fill
values as editable operations. Hex sRGB color converts to native linear Float32;
Canvas contributes only existing canonical scalar coverage. Flow/pressure/tip/
symmetry/texture and clips retain their rasterizer behavior. Stroke opacity
applies once outside byte coverage, and eraser/clear preserve surviving RGB while
rounding alpha once per operation. Group/clipping/mask/appearance and native frame
sampling use the existing scene pipeline. Brush/Pencil color, paint Eraser/Fill,
New layer/shortcut and blank/supported-paint conversion are enabled.
[Current contract, defaults, errors and exact example](../FLOAT_PAINT.md).

Actual paint recording also needed existing `paint.add` and `layer.place`
commands to be represented by recipes. Literal stroke appends now preserve
existing destination content, create fresh operation identities, and target
created step outputs independently of names. Semantic placement retains native
affine/topology/lock behavior. Portable packages collect/remap original coverage,
clone and applicable wet pairs. Asynchronous recipe admission pins prospective
sources, including interpretation choices, validates complete wet pairs before
publication and keeps native font activation inside synchronous scopes.
Synchronous trusted OO/executor calls retain their prevalidated-pair contract.

Passed: **3,294 unit/API/native tests across 321 files; 53 source-browser cases across 11 files; 17 selected production cases across 6 files**. Final acceptance has zero failures, skips,
automatic retries, flakes or runner errors. Build/typecheck passes. Product,
fixtures and source-browser inputs remain fixed throughout final acceptance;
3,396 input identities include a disclosed production-only test
addition and fixture selection correction. All 101 application runtime files
match the tested release exactly. The final build updates one developer page
with an evidence link; all developer code examples remain identical. The complete
selected production matrix repeats on the final release.

Independent native libtiff and NumPy decode complete tiled float TIFF exports
and the complete linear-sRGB profile. Independent sRGB decoding, integer Pencil
geometry and precise opacity match **all 41,396 Float32 words** in both production
paint and reopened delivery. Source tests verify native ordered source-over,
once-only opacity, eraser/clear, project reopening, exact crop partitions under
reflected/sheared parents, texture/pressure/symmetry/clip/mask behavior, Fill,
Color Overlay, independent shadow opacity and paint clipping silhouettes.

Real Brush and Pencil pointer prefixes remain private, match committed display
pixels, cancel cleanly and commit editable values through one Undo. Existing
Color settings converts blank/supported paint documents, retaining exact
precision Undo/Redo. New layer keyboard/button access and Fill/Eraser tool
publication pass. Isolated scripting and inert plugins preserve permissions and
Undo. Independent REST commands retain float paint, stale-revision conflicts,
atomic rejection and original project/history data without adding a renderer or
browser synchronization.

Native recipe packages retain exact float window replay, texture originals,
source remapping and redo-only workspace recovery. Invalid byte wet alpha pairs
reject a portable append before document/asset publication; healthy prepared
appends retain one Undo. Destination locks, created-layer/group identities and
affine-preserving placement are checked. Existing native font package preflight,
private cancellation, source closure, batch retry and font-free package behavior
pass after the source/pixel validation extension.

Normal production uses real import, Brush/Pencil controls, canvas input,
Save Project, Undo/Redo, project reopen and native float TIFF delivery without
developer globals. It also records an actual new float gesture through Action
Recorder, exports the three concrete actions, explicitly selects that saved
recipe, replays byte-identical native PNG output, and undoes once. Existing
float-mask TIFF/physical-word controls, HDR prepared scripting/delivery and six
affine/projected layer/ordinary-mask/filter-mask feedback workflows remain green.

A genuine 10000x5000 original retains native geometry and original bytes while
every word in a disclosed **64x48 native paint window** matches independent
source-over equations, with exact Undo/Redo. This is a bounded paint edit, not a
full-image paint performance measurement. Separate existing source controls read
and independently verify complete 50 MP float32/uint16 tone exports and retained
workspace originals with their own scopes. Concurrent verification is not a
controlled latency comparison. Physical-device/photographic quality and sustained
all-tool F14 acceptance remain required.

[Content-addressed evidence](float-paint-2026-10-31.json.gz) retains raw reports, input/
runtime identities, native reader results, new float buffers/TIFFs/projects/
recipe JSON/PNGs, and hashes for larger existing controls. The receipt is
2,148,087 bytes, SHA-256 `affb816d8d5526b1c5dfc34f19ac00e666ba5bd9810837b5f4c1498a7b793192`. Local raw artifacts, configs and
sealed tested/final releases remain under `/tmp/canoli-float-paint-2026-10-31/`.
New ZIP archives remain ignored.

Earlier preflight failures exposed the two recorder gaps above, both now
implemented. Harness corrections use explicit package export for source-free
recipes, native tiled TIFF decoding, and explicit recorded-recipe selection when
reopening the library (which defaults to its first preset). Earlier reports stay
sealed. Existing rollback fixtures now use unsupported VectorLayer rather than
newly supported PaintLayer. Pixel, alpha, permission and rollback assertions are
retained; the final production addition checks the actual UI workflow.

Reproduce using `npm run build`, `npm test -- --maxWorkers=2`, and the source/
production configs in the receipt. Chromium, loopback servers and NumPy/libtiff
are used; the existing PDF-check Python environment supplies PyMuPDF for those
reference controls. The runtime remains local, with no paid inference or upload.

The full original goal remains active: float clone/wet PaintLayers, other float
layers/tools/working spaces and wider format/color/HDR/CMYK behavior; general
warp/master/projective coverage; photographic/device and sustained all-tool
performance; and every unfinished professional, AI/provider/evaluation/production,
workflow/collaboration, installed/model-driven ChatGPT and eligible live identity,
commercial, specialist and motion requirement. Basic linear paint and literal
recipes do not establish completion of that broader scope.
