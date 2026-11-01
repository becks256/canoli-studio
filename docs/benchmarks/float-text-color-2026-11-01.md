# Native text CSS color dependency — 2026-11-01

This private dependency advances F08/F10. Native glyph painting and float
TextLayer/tool integration remain unimplemented and gated. The complete original
roadmap stays active. [Contract and remaining work](../FLOAT_TEXT.md),
[compact receipt](float-text-color-2026-11-01.json.gz).

Implemented authored CSS-to-linear Float32 color capture without reading Canvas
pixels or a composed document. Exact hex transfer and encoded sRGB aliases use
the shared transfer function. Native CSS handles wider colors. Separate residual
reads retain precision omitted by ordinary computed-style strings, including
alpha through an unclamped color channel. Source lists/results are immutable;
private probe/Canvas ownership, cancellation, reentrant cleanup and retry are
checked. Dark/forced-color UI settings cannot substitute authored colors.

Verified on Node 26.13.0 and Chrome for Testing 153.0.8010.12:

- Full build/typecheck with 51 guides; 3,357 unit/API cases across 331 files pass.
- Four source-browser cases pass. Direct linear source values, including
  +/-3e38 and alpha 1e-8, match exact Float32 values. Named/hex/RGB sRGB aliases,
  wide-gamut signed channels, no Canvas readback, snapshot ownership and cleanup
  retain their explicit assertions.
- The 390px production guide works without JavaScript and states that text
  rendering remains in progress. Application executable/CSS/WASM/index resources
  match accepted parent 544cf9d; this module is not yet in the rendering graph.

The first browser pilot passed one of two cases and exposed tiny cross-channel
residues for named red after the browser's sRGB-to-XYZ-to-linear conversion.
Keeping declared sRGB encoded until the existing transfer fixes the result;
the exact [1,0,0,1] expectation was retained. The successful later runs add forced
color and extreme finite-component checks. Raw reports and source values remain
in the receipt.

Native glyph probes reject enabling an approximate text path. Overlapping
half-alpha M glyphs reach native alpha 192/255, which a single opaque mask times
0.5 cannot reproduce. Selective per-character fill-opacity, opacity or visibility
also changes tightly tracked Latin/combining ink in the tested browser. An
all-visible split can look unchanged while its isolated masks are wrong. Color
emoji additionally retain intrinsic font paint colors. The host exposes neither
getTextClusters nor fillTextCluster. These observations guide the required native
shaping/paint owner; no feature flag or byte flatten is treated as a completed
solution.

No glyph/render/export, 50 MP text integration, physical typography quality or
sustained performance acceptance is claimed. The dependency does not modify
image dimensions, original assets, document schema, public scripting methods,
plugin grants or REST/browser isolation. No paid call, upload or account action
is added. Larger original professional/AI/workflow/device/commercial/specialist/
motion gates remain required.
