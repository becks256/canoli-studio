# Native perspective engine — application integration in progress

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

Interactive erasing/wet painting on the projected image, interactive mask
painting/path editing, linked-mask dragging, preserving-position mask relinking,
and capturing document selections/paths as linked masks currently require
resetting perspective. Those operations reject with an explicit message instead
of writing an affine approximation. Local-coordinate constructor/API operations
remain available. Correct projective pointer, clip, symmetry and cursor mapping
are required follow-up work, not waived acceptance criteria. Numeric authoring
and direct corner handles are available; general warp and photographic resampling
quality/performance/device acceptance remain required.

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
