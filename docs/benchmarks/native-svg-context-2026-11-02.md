# Native SVG scale and path allocation investigation — 2026-11-02

The curved, colored, negatively tracked vertical text requirement remains open.
This investigation rules out a transformed font-scale or tracking-scale mismatch
on the current host; it does not resolve the two transformed RTL controls or
grant native text acceptance.

The new `tests/native-svg-context.e2e.ts` uses an independent one-em calibration
font with a one-em GPOS adjustment per adjacent pair. Long native SVG runs measure
shaping scale, raster advances and tracking separately. Canvas calibration uses
the existing private font leases. Measurements cover 40, 33.333 and 64.5 px under
identity and `[1.25, .125, -.25, .9, 15, 14]` transforms. Five tracking values include
the original failing case's −30 px. No artwork pixels or fitted coordinates
determine these values. Documents remain identical and temporary fonts retire.

| Source size | Transform | Native shaping em | Native raster em |
| --- | --- | ---: | ---: |
| 40 | Identity | 40 | 40 |
| 33.333 | Identity | 33.330001831 | 33.328125 |
| 64.5 | Identity | 64.5 | 64.5 |
| 40 | Affine | 44.269989014 | 44.265625 |
| 33.333 | Affine | 36.889999390 | 36.875 |
| 64.5 | Affine | 71.389999390 | 71.375 |

SVG/Canvas shaping differences are below 0.000009 physical pixels; raster-em
differences are below 0.000002. Measured tracking differs from the requested
physical tracking by less than 0.000017. The regression's 0.0001 metric allowance
accounts for complete-run SVG length quantization and Float32 geometry. It does
not alter the separate zero-error artwork/color-ownership gates. These are
measurements on this host, not a claim about every browser or device.

## Path candidate remains unaccepted

The earlier raw whole-span path candidate is retained separately. A subsequent
isolated candidate sums the original per-cluster signed layout sizes for each
authored span on a path, preserving full text/font contexts and existing ink and
color checks. Its original eight controls still produce six exact matches, a
single-font transformed RTL mismatch with maximum alpha error 48, and a fallback
transformed RTL matching deadline. The diagnostic uses 12 seconds; the preceding
whole-span/authored-span preparations separately failed at the real 60-second
budget. This is no evidence that increasing the budget resolves the case.

The candidate changes remain outside main. Runtime source, public APIs, schema,
permissions and exact matching tolerances are unchanged. The new permanent test
guards the now-verified scale assumptions while parent allocation still needs
correction. A simple choice between whole-span and per-cluster accumulation is
insufficient for the remaining original cases.

Chromium's current [SVG segmentation implementation](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/layout/inline/line_breaker.cc)
and [physical text-paint rounding](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/paint/text_fragment_painter.cc)
were consulted as primary implementation context. Their source revision is not
proven identical to the tested Chromium binary; the proposed parent model remains
an inference requiring native verification.

## Verification and retained evidence

- Typecheck: `node node_modules/typescript/bin/tsc -b --pretty false`, pass.
- Calibration units: four pass across `native-layout-size.test.ts` and
  `native-text-size.test.ts`, including actual shaping WASM.
- Current main browser tests: six pass, zero skipped/flaky, including the new
  scale regression, original mark placement, abort/timeout/registration cleanup,
  and all eight existing single-span mixed vertical controls.
- Isolated multi-span path experiment: six of eight controls match; the two
  transformed RTL failures remain required. This failed experiment is not counted
  among the six passing main browser tests.

[Compact receipt](native-svg-context-2026-11-02.json.gz) retains the measurements,
test/report identities, failed candidate rows and its isolated source differences.
Raw local evidence is under `/tmp/canoli-native-layout-context-2026-11-02/` and
`/tmp/canoli-native-curved-spans-2026-11-02/`. No raw ZIP is added to Git.

All 384 fallback layouts and 36 independent references, complete public typography,
original-resolution delivery, photographic/color/workflow/device/performance,
provider/installed ChatGPT/live identity/commercial and every other unfinished
original roadmap requirement remain required. The existing connected development
checkpoint and its acceptance boundaries remain as recorded in
[native-float-text-2026-11-02.md](native-float-text-2026-11-02.md).
