# Native perspective engine — application integration in progress

## Smart-master mask planes

Group/selection conversion retains unlinked ordinary/filter masks in the new
containing master frame instead of linking them to projected child artwork.
Nested instances carry that frame independently through placement/scaling and
renderer reference transforms. Full-frame projected raster masters retain their
perspective and avoid redundant clipping only when their complete intrinsic
support stays within the artboard. Child movement leaves its unlinked mask
fixed in master coordinates. Existing native geometry/settings, commands,
Undo, original sources and persistence remain authoritative; no schema or
public projective-relink capability is added.


Raster and smart-object instances now carry optional schema-50 normalized
perspective corners through `PerspectiveTransform`, shared commands and Undo.
The Inspector authors their eight pixel coordinates, enables direct corner
editing on the canvas, and resets the placement.
Affine transforms remain a separate parent-placement matrix. Original assets,
adjustments and intrinsic operations remain retained. This connected placement
increment does not complete F03 or the professional-editor roadmap.

## Public placement and current editing boundary

`new PerspectiveTransform({corners})` accepts TL, TR, BR, BL normalized boundary
coordinates; omission means identity. `fromPixels(width,height,corners)` converts
layer-pixel corners, `toPixels` converts back, `withCorner(0..3,point)` returns a
new normalized value, and `toJSON` returns an owned DTO. Finite strictly convex
quads, including reflection, are accepted; folds, unresolved singularity and
image/content-crossing horizons reject. Assign `layer.perspective` a constructor
value or `null`; RasterLayer and SmartObjectLayer constructor options accept the
same values. Attached edits share validation, locks, atomic revision and Undo.
Layer comps capture perspective as position; legacy image poses clear it.
Native project/workspace/recipe transport retains the state and original assets.
Independent REST sessions accept the same `layer.update` DTO; they do not
synchronize with the browser or provide a composed renderer.

Byte rendering reconstructs intrinsic pixels in bounded original-resolution
windows, then projects them. Existing tone, erasure and prepared-wet operations
remain ordered before projection; wet support outside the frame is retained
when its complete bounds remain on one finite side of the horizon. Float scenes
project original-derived float pixels without a byte intermediary. Smart filters
execute in the native master plane; unlinked filter masks mix the projected
filtered/original planes in document coordinates. Linked layer masks project
before native document-pixel feathering; unlinked masks retain their document
plane. Completed coverage is subsequently sampled onto the viewport. Bounds,
hit testing and selection outlines use projected geometry. Active perspective
uses the standard Canvas/float path instead of the affine WebGPU compositor.

Smudge/Mixer support projected byte raster pixels and linked ordinary/filter
masks through captured prepared fields, as described below. Preserving-position
projective mask relinking and capturing document selections/paths as linked
masks still require resetting perspective; those operations reject explicitly.
Local constructor/API operations remain available. Native float wet painting,
general warp and photographic resampling/performance/device acceptance remain
required. Numeric authoring and direct corner handles are available.

## Direct corner editing

Select one visible, unlocked raster or smart-object instance and choose **Edit
perspective corners** in the Inspector or command search. Four focusable corner
buttons replace ordinary resize/rotation handles. Dragging changes only the
chosen normalized corner. Grab offset is retained, and displacement passes
through the captured inverse affine parent/layer basis, so rotation, shear and
reflection do not change canvas-space pointer motion. The overlay follows the
validated temporary document without mutating the attached model or originals.

Pointer-up samples its final endpoint and commits one shared perspective edit;
a click without motion creates no Undo entry. Folded/nonfinite/unsupported
content-horizon placements show a correction message and do not commit on
release. Returning to a valid placement allows the same drag to continue.
Escape, pointer cancellation/lost capture, window blur, actual owner/revision/
ordered-selection changes (including change-and-restore), tool changes and
modal opening cancel the gesture. The ordinary lock and command validation
remain authoritative. Idle corner-edit mode survives saving/quick PNG delivery;
starting busy work cancels any active drag and temporarily hides the handles.
**Done editing corners** restores the ordinary Move handles.

Focus a corner and use Arrow keys to move it by **1 canvas pixel**, or
Shift+Arrow for **10**; each key operation is one Undo. These keys affect only
the focused corner and do not intercept editable fields. Buttons have fixed
28-pixel hit areas, focus rings and labels; mouse, pen and touch use the same
captured pointer path. No new default global shortcut, schema, scripting
signature, permission, source replacement or renderer service is introduced.
The command can be rebound through the existing shortcut editor.

SVG uses a native composition prefix; Photoshop delivery bakes projected image
appearance and its own mask into layer pixels. Explicit smart rasterization
bakes perspective and linked masks, clears the perspective state, and preserves
outer compositing and independent document masks. These deliveries retain the
rendered appearance rather than an editable projective mesh; save a native
project for original placement and mask editability.

## Geometry and numeric contract

`core/projective.ts` supplies immutable internal homogeneous column-vector
geometry: composition applies the child first, inverse rejects singular maps at
working precision, and source-rectangle preflight rejects a zero/sign-changing
homogeneous denominator. Four ordered source-boundary corners map TL, TR, BR, BL
to a strictly convex target quadrilateral. Reflections are valid; crossed,
collinear, concave or numerically unresolved corners reject.

The sampler's authoritative input is the four exact target corners, rather than
corners reconstructed from serialized coefficients. Otherwise tiny matrix
roundoff can create unintended coverage beyond an authored boundary. Inversion
uses a frame relative to the first corner, keeping world placement out of large
cofactor subtraction. Coordinates, weights and polygon moments use float64.
Unrepresentable pixel centers and numeric horizons fail explicitly.

The geometric model follows inverse destination-to-source sampling, as described
in [OpenCV's primary transformation reference](https://docs.opencv.org/4.13.0/da/d54/group__imgproc__transform.html).
The following coverage/color choices are Canoli's own explicit contract:

- Intersect each output pixel with the complete target quadrilateral. Its area
  gives alpha coverage; its centroid gives the source sampling position.
- Clamp bilinear source neighbors at the original image boundary. Filter
  premultiplied float64 RGB/alpha and return straight float32 RGBA. Finite signed
  and extended colors remain valid; no sRGB8 intermediary is used.
- Zero final alpha produces transparent zero. Hidden source RGB remains intact
  in the immutable original but contributes no coverage. Input/output buffers
  never alias and sampling does not alter document state or history.
- Output support is the authored quadrilateral, independent of native source
  dimensions. This is bilinear reconstruction, not an anisotropic or full
  pixel-area reduction filter and not a claim of final photographic quality.

## Native worker and bounded originals

`assembly/projective-sampling.ts` runs the actual pixel operation in the existing
WASM kernel. `FloatPixelProcessor.projective` checks complete private settings and
captures source pixels before native memory growth. The actual pixel worker and
`PixelProcessor.floatProjective` capture settings/pixels before readiness,
transfer only private copies and validate owned finite output geometry. Invalid
input, missing source coverage, malformed worker replies and disposal reject.
No failed partial result is returned.

`engine/projective-projection.ts` reads original-derived float windows through a
pinned `FloatWindowSource`, recursively splitting sparse inverse footprints.
Each source/output window contains at most 262,144 pixels; this is a working
allocation budget, not an original-image or file-size limit. A one-pixel
minification reads its actual bilinear neighborhood, not the entire image.
Reads and processor calls are sequential, intermediate results remain private,
and cancellation/current-owner checks guard every awaited operation. Callers
must retain the original-source lease and supply their operation's lifetime
control. These local window budgets do not bound whole-process memory.

## Linked-mask scalar-field dependency

`core/projective-field.ts`, `assembly/projective-field.ts` and
`engine/projective-field.ts` supply a separate private scalar sampler. A mask is
a finite rectangle of coverage deviations over a constant infinite background.
The original/reference dimensions define the same homography as the image;
they do not clip mask support. Negative support coordinates and support outside
the image remain valid. Bilinear neighbors beyond that finite rectangle use the
declared background rather than clamping edge coverage. Output sampling uses
pixel centers, without image-quad area coverage. Raw coverage is finite float32
in `[0,1]`, with float64 geometry/weights and owned inputs/outputs.

Inverse-horizon crossings split output regions until a constant-sign inverse
footprint can be bounded. A pixel center exactly on the horizon has the constant
background, the limit of a finite-support deviation at infinity. Finite support
on either side remains sampleable. Native coverage reads/output requests obey
the same 262,144-sample working budget; a 50 MP reference/support extent is valid
without allocating the whole plane. Unknown settings, missing ROI neighbors,
malformed worker replies, cancelled/disposed work and changed source geometry
reject. Callers must pin their mask assets and supply lifetime controls.

## Bidirectional coverage transport

The private scalar protocol accepts optional `direction: "quad-to-source" |
"source-to-quad"`. Omission retains the existing quad-to-source pull sampling.
If H maps the native reference rectangle to the authored quadrilateral:

- `quad-to-source` samples an original-plane field at H inverse of each placed
  output pixel center. This remains ordinary linked-mask rendering.
- `source-to-quad` samples a placed-plane field at H of each original-grid output
  pixel center. This is the required opposite transport for complete brush
  coverage, including selection clips, symmetry and tip geometry. It does not
  approximate a stroke by transforming only its points.

Both modes use the same authoritative valid reference corners and unchanged
scalar WASM ABI, infinite constant background, bilinear reconstruction, native
window budgets, owned inputs/outputs, horizon handling and cancellation rules.
The second mode separates the original-grid input origin from the coverage-field
origin. Its source lattice is rebased around the fixed finite-field center,
never around an individual read ROI; large placements retain fractional weights
and partitioned reads remain word-identical. Source metadata/reads are restored
to their original coordinates at the host boundary. A changed sampling direction
invalidates an in-flight source just like changed geometry.

`capturePerspectiveMask` admits the same optional private direction for linked
coverage. It still validates/pins complete mask assets and applies feather and
settings after sampling, in output-pixel units. Unlinked masks retain their
independent plane. No document/schema/command, public scripting signature,
plugin permission or REST route is added. Interactive projected erasing, wet
painting and mask editing remain gated until their captured authoring-space
metadata and preview/commit replay are connected. This is a necessary sampling
dependency, not completion of that editing workflow or F03.

## Captured renderer masks

The trusted `CanvasRenderer.capturePerspectiveMask` read adapter now captures
existing selection, vector, bitmap, painted and raster-erasure masks, including
ordered brush/prepared-wet refinements. This is an internal read-only renderer
surface, rather than a document mutation or isolated scripting binding. It
requires original/reference dimensions, placed layer dimensions and exact
world-space target corners. Linked mask offsets/bases map into the original
pixel plane; unlinked masks retain document coordinates independently of those
corners. Control-point/selection/stroke hulls and native bitmap dimensions bound
finite deviations, with source-grid antialias padding. Raster-erasure capture
dimensions retain their existing nonuniform-resize semantics.
Prepared-wet reconstruction receives sampling padding in the native mask plane
before the layer-to-original mapping, retaining its tails at large native scale.

Raw coverage comes from the established mask rasterizer in bounded source-grid
canvases. Its byte alpha becomes float32 coverage. Infinite paint-base coverage
uses the rasterizer's actual alpha word, avoiding a seam between finite support
and its background. This preserves the current byte-mask source role: float
display thumbnails are rejected as bitmap/texture/prepared-tile sources.
Captured mask values are immutable; bitmap identities/geometry, asset-store
lifetime, renderer epoch and operation controls guard every awaited read.
Closing a capture, retiring its renderer or losing a source rejects pending
output. Captures own temporary texture caches only when no host cache is lent.

Projection precedes the established feather shape: three horizontal/vertical
fractional-box pass pairs with radius `feather / 3`. Complete halos and float32
intermediates preserve partition identity. Inversion and density apply once,
after feathering, in document-pixel space. Disabled/zero-density masks produce
full coverage after normal source/geometry validation. Source, convolution and
output windows each retain the 262,144-sample working budget; support and
original dimensions are not capped. This is native document-plane coverage;
viewport resampling remains a separate renderer responsibility.

The connected scene uses this captured coverage without image-quad clipping or
source-space feathering. The interactive mapping and broader acceptance work
listed above remain open.

There is no document schema migration, new public DOM constructor, mutation
command, REST route, isolated script binding, plugin grant, account or upload in
this dependency. Plugin installation remains inert. The API server's source
windows and browser document sessions retain their existing separate contracts.

## Verification boundary

Independent fixtures use a NumPy eight-equation solve, line-arrangement
half-plane intersections and SciPy premultiplied float64 interpolation. They
cover reflection, strong perspective, large placement, pixel-corner contacts,
transparent padding and minification. Actual WASM/source-window checks retain
exact partition identity and source ownership with the declared float32 numeric
gate. Browser worker, original 50 MP source, lifecycle and final regression
verification is recorded separately in the dated implementation roadmap.

The public perspective workflow and general warp, all native document/export/
mask/automation integration, sustained performance and physical-device/quality
acceptance remain required. A passing private sampler is not full F03 acceptance.

## Connected placed eraser workflow (schema 51)

The earlier private sampling dependency is now connected to public `RasterLayer.erase(stroke,{space:"placed"})` and the raster Eraser tool. Points, selection clip, tip/tilt, texture and symmetry remain in the affine layer plane after perspective. A strict erasure record captures normalized perspective and finite existing intrinsic content bounds; its width/height retain the authored size. A fixed `ceil(width)` × `ceil(height)` layer-pixel lattice defines coverage independently of source geometry and without source access in isolated scripts. The complete field is sampled forward through captured H onto original coordinates, then through current size/affine placement. Both stages use bounded native scalar windows. Captured-grid interpolation neighbors are padded before mask resizing, preserving enlarged erasure-mask tails outside the image frame. This grid is coverage authoring geometry, not a resized copy of the image.

Native byte replay and original float-window composition apply captured erasures in order even after current perspective reset/change. Float RGB stays original-derived; byte coverage is quantized only after transport, while float alpha rounds per operation. Preview captures identical metadata; final commit uses shared validation/Undo. Captures are request/scene-owned, retain coverage-source leases and reject cancellation/source loss. Raster-erasure mask constructors/getters/refinements and frequency-separation coverage preserve the metadata. Schema 51 gates it everywhere, including saved history/embedded documents; project v3/workspace v2 and plugin grants are unchanged.

Default `.erase(stroke)` and `.clear(selection)` retain original/local semantics. Placed selection clearing is now connected at schema 52; wet/mask tool mapping, mask relinking, general warp and full sustained/device quality acceptance remain required. This increment does not close F03 or the implementation roadmap.

## Connected selection clearing (schema 52)

Delete on selected projected raster pixels now converts document selection through the affine layer/parent inverse and calls `RasterLayer.clear(selection,{space:"placed"})`. The selection stays in the affine layer plane after perspective, preserving transformed rectangle/ellipse/pixel/Boolean coverage. The clear captures perspective, dimensions and finite existing intrinsic support. An erased fill covers the placed footprint plus native interpolation neighbors, including when the complete projected image is smaller than one pixel. The existing clear rasterizer supplies raw remaining coverage; captured forward and current size/affine scalar transport retain the original-plane edit through subsequent corner edits/reset. Byte/float/mask replay share this path.

Default/local calls remain compatible, omitted/null selection clears all captured intrinsic content in placed mode, and neither API mode implicitly reads document selection. Schema 52 gates placed clear fills (`erase:true`), while schema-51 placed erasers remain valid. Invalid options/geometry, non-clear fills, unsupported wet placement and locked ancestry reject through shared validation. Existing Undo, isolated scripting, project/workspace/history/embedded transport, source preservation and independent REST contracts remain. This does not close mask/wet input, relinking, general warp or full F03 acceptance.

## Placed mask brushes (schema 53)

Ordinary and smart-filter mask Brush/Pencil/Eraser gestures now author complete coverage in the affine image plane after perspective. `Layer.paintMask` captures image dimensions, normalized perspective and mask-local-to-image basis; filter masks include master-to-instance scaling. `LayerMask.paint` accepts the corresponding explicit immutable placement value. Current image corner edits/reset and mask offset/basis edits retain that field. Unlinked/identity cases keep their existing local behavior.

Private forward scalar sampling precomposes a strict affine mapping after subtracting an explicit input origin. Raw brush fields remain on their fixed captured ceil-sized image-pixel lattice. Existing mask geometry is not resampled onto a new mask grid. Conservative inverse bounds include raster/interpolation support; if a support rectangle crosses the inverse horizon, the mask capture marks `unbounded:true` and streams original-mask windows. Its `bounds` then describes only finite diagnostic/base support, not a clip. Unknown-support sources use inverse sampling and per-packet finite neighborhoods with fixed matrix origins, preserving partition identity without allocating an infinite grid. Exact horizon samples keep the existing background convention; image artwork itself retains its finite, validated support.

Captures pin byte mask/texture sources, own copied metadata and release request/scene resources on cancellation/disposal. Mask-wide feather/inversion/density follow complete ordered composition. Preview and commit share placement; actual revision/ordered-selection changes retire mask gestures synchronously, with equivalent selection allowed. Schema 53 gates placement on Hide/Reveal brush/pencil entries in all mask/history/embedded contexts. Public constructors, existing commands/Undo, project/workspace formats and plugin grants remain. No pixel WASM ABI or REST route is added. Projected Wet input, mask Pen/preserving-position relinking, general warp and full photographic/performance/device acceptance remain required.


## Perspective Bézier mask paths

Pen → Mask paths now edits linked vector masks through the complete mask basis,
image perspective and layer/ancestor affine placement. Native anchors and cubic
handles stay in mask coordinates. Dragging preserves the canvas grab offset;
anchor moves translate native handles, handle moves mirror their native opposite
unless Alt/Option is held. Arrow/Shift+Arrow moves the selected anchor by 1/10
canvas pixels using a positional inverse, rather than an affine vector. Unlinked
masks retain document-plane behavior. In float documents, choosing Pen on a
vector-masked layer selects Mask paths; unsupported layer-path creation stays
unavailable. Existing contour drafting, closure,
midpoint/curve insertion, deletion, mask refinements and one-command Undo remain.

The projected outline is a rational cubic. Private homogeneous De Casteljau
subdivision bounds its display error to 0.2 CSS pixels and clips to the padded
visible viewport. It never rewrites native path values or substitutes transformed
polynomial controls. The same rational geometry supplies the seven-CSS-pixel
curve hit test and its original native parameter for exact subdivision. Both
sides of an off-image horizon remain separate; finite controls stay editable and
controls exactly at infinity have no finite canvas target. Explicit display/hit
work budgets and unresolved numeric precision report an error instead of silently
changing geometry. Pointer inverse-horizon failures cancel the active drag.

Projected anchor gestures and multi-click contour drafts observe actual revision
and ordered-selection changes synchronously, including away/back changes;
equivalent selection values remain valid. Escape, tool/owner changes and existing
pointer cancellation discard previews. The same existing mask updates preserve
locks, native project/workspace/history, originals, isolation and REST contracts.
No schema, public constructor signature, worker ABI or plugin grant is added.
Wet input, preserving-position mask relinking, document-selection/path capture, general warp
and full photographic/performance/device acceptance remain required.


## Ordinary mask movement after perspective (schema 54)

`LayerMask.placedX/Y` retain a separate post-perspective translation in the
ordinary linked image plane before layer/ancestor affine placement. Native
`x/y/basis`, geometry and ordered refinements remain unchanged. `Layer.translateMask`
and Move → Mask convert containing-document displacement through the inverse
linear layer world transform and update placement once. Other mask movement
retains existing affine/document coordinates. Resetting image perspective keeps
the offset. Fixed affine relinking/rebasing folds it once; generic projective
relinking remains unfinished. Linked filter offsets retain their native-master
compositing plane, consistent with their existing native filter-mask semantics.

`capturePerspectiveMask` captures the original mask and a private optional
`postTransform` affine value (default identity). For linked ordinary masks it
removes placement from the raw affine/native field and translates authoritative
target corners through that transform's linear part. Native raw capture, full
finite/unbounded support, resource ownership, document-pixel feather/settings and
scalar working budgets remain. Byte and float renderers supply the actual world
transform; no native WASM ABI change is needed. Paint capture includes placement
in its authored perspective corners, while native mask basis excludes it. Pen
uses the same outer translation and unchanged native cubics. Existing affine
mask readers include placement once, including image resize, SVG, smart
conversion/rasterization and wet neutral-source preparation.

Actual owner/revision/ordered-selection authority still retires Move previews
synchronously. Pointer-up consumes its endpoint, commits once, and zero motion
creates no history. Placement fields use existing custom NumberFields; editable
fields keep their normal keys. This does not complete projected wet input,
preserving-position projective relinking, document selection/path capture,
general warp, full photographic/interchange quality, sustained editor-wide
performance, process-memory or physical-device acceptance.

## Captured projected wet editing (schema 55)

Smudge/Mixer author the complete brush/selection/tip/pressure/texture/symmetry
field after image H and before parent/layer affine placement. Raster sampling
uses the original bitmap grid; linked ordinary/filter masks sample raw neutral
coverage on original image/master reference grids. Ordinary-mask placed offsets
enter captured H, while mask x/y/basis and filter master scaling enter captured
basis. Unlinked masks retain existing local behavior. The trusted preparation
option `space:"placed"` selects this path; default/local calls sample intrinsic
content before H. Identity/absent H produces no new placement metadata.

`WetPaintStroke.placement` retains width/height, normalized H and invertible
owner-local-to-image basis B. Native prepared pixels map into placed image
coordinates through N (`nativeTransform`), then pull back by `B^-1 H^-1 N`.
Ordered tiles first compose a native coupled field of premultiplied replacement
RGB, replacement alpha and independent removal coverage. Native five-channel
sampling uses the scalar engine's exact homography/origin/ROI contract, a zero
outside field, and bounded copied worker windows. Independent NumPy fixtures
cover reflection, strong perspective, large placement, both directions,
horizons and affine origins. Output applies removal then already premasked
replacement; operation opacity applies once. Explicit overlaps round at the
new native-field reconstruction boundary; legacy unplaced records retain their
existing per-tile replay.

Current corner edits/reset, image resize, mask movement and source-preserving
persistence keep the captured edit. Finite image/paint support rejects inverse
horizons before publication. Mask support can be unbounded and streams distant
ROIs without a guessed image clip; feather, inversion, density and enabled
settings remain separate. Extended raster wet support converts through the
existing containing-master path, retaining off-image pixels and mask planes.

Real tools use private retained native previews and drain final input before
one shared command/Undo. Actual revision or full ordered-selection changes,
including away-and-back, synchronously cancel; equivalent selection remains
valid. Source replacement/disposal and cancellation reject stale work. Prepared
constructors/JSON/getters preserve owned values through every schema-55 owner,
embedded master and retained-history context. Isolated scripts/plugins use
existing prepared assets and permissions; REST sessions remain separate.

Functional verification is tracked in the dated roadmap. This does not close F03/F06,
float wet painting, projective relinking, selection/path capture, general warp,
photographic/interchange breadth, sustained all-tool performance or physical
input/display/device gates.

When raster wet pixels extend beyond the original image bounds,
`convertToSmartObject()` uses the existing containing-master conversion. The
original raster, its mask and appearance remain editable inside `editContents()`;
the containing instance includes the artboard and extended content. This differs
from the compact original-image conversion, which retains an outer mask on the
instance. It prevents trimming off-image paint while preserving source metadata,
independent mask planes and Undo. Native projects retain both forms.
