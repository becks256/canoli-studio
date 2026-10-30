# Native perspective engine — application integration in progress

This is a private dependency of F03's original-preserving perspective workflow.
It is not a shipped perspective tool. Public layer transforms remain affine;
perspective commands, authoring controls, masks/hit testing, persistence,
interchange and the associated automation still require connected integration.
The complete professional-editor roadmap remains active.

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

This implements raw coverage projection only. Actual mask geometry/bitmap/stroke
field capture, mask offsets/bases, document-space feathering, inversion/density,
linked/unlinked scene selection and public editing remain integration work.
Applying image-quad clipping or source-space feathering to this dependency would
change the established mask semantics.

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
