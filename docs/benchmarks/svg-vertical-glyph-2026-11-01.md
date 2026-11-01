# Native vertical source-glyph paint — 2026-11-01

Status: private vertical glyph dependency verified. The complete original
implementation-roadmap goal remains active.

Uniform vertical SVG lines now retain original source glyph IDs and complete
text contexts through private Float32 glyph painting. Native orientation and
resolved caret direction define TTB/BTT/LTR/RTL shaping items. Original vertical
substitutions and GPOS survive; explicit central/alphabetic baselines, nominal
vertical origins and independently captured native metrics retain placement.
Straight and curved native baselines use the same complete original/candidate
union-ink gate at alpha 1 and 0.5. A mismatch supplies no paint primitives.

## Evidence and corrections

The first five-font pilot exposed central versus alphabetic baseline differences,
upright discretionary ligature behavior and screen/user font-size projection.
Native callback metrics fixed combining marks and equivalent matrix/origin
representations fixed remaining fractional sideways placement. Original baseline
replay plus whole-source unfolded native vertical metadata retained curves.

The expanded pilot matched 576 lines across eight original fonts but failed
twelve upright Arabic cases. Native start/end carets proved the resolved BTT
item; original BTT source shaping preserves the native required substitutions
that differ from TTB. The corrected 108-case direction matrix passes. No pixel
tolerance was widened and no coordinates were fitted from reference pixels.

All 3,405 unit/API tests across 337 files and all fourteen production cases pass.
The production component harness initially expected an unminified direct export;
new dependencies caused a namespace export. It now resolves the actual emitted
namespace, while retaining exact native coverage and partition checks. The failed
run and corrected complete run are retained. Production component tests use a
prepared fixture adapter; full ownership/itemization/matching runs in the source
browser matrix.

Independent FontTools 4.51.0 checks preserve eighteen original geometric glyphs,
twelve mappings, original outlines/metrics and all retained tables; seventeen
selectors are added without external fonts. Six actual WASM cases compare those
independent glyph sources at separately verified poses. Eighteen further runs use
original-font single-glyph coverage with known placement and ordered overlap.
All retain exact alpha, signed/HDR RGB, alpha 1e-8 and every Float32 partition word.
These coverage references do not independently discover native positions.

The complete affected browser run passes all 190 cases across eighteen files,
with zero retries, failures, skips or flaky results. It includes 576 complete
font/layout matches, 108 direction/reflection/path variants and twenty-four
independent Float32 coverage/composition runs. Native metric abort/release/
nonfinite faults and origin abort/host-removal/nonfinite faults reject without
publication, retire probes and permit a healthy retry. Original model data stays
unchanged. Full build/typecheck also pass.

Independent Pillow decoding compares all 200,000,000 RGBA samples in each of
the complete ordinary 10,000 × 5,000 curved and vertical outputs against complete
independently authored native SVG references. Both have zero channel error and
identical complete PNG files. The separate 50 MP RAW/variable-font workflow keeps
its exact 100,000,672-byte original, matches its complete independent 600 × 200
reference region and retains the preceding accepted full PNG bytes. These are
ordinary byte workflows, not admitted Float32 TextLayer or universal native-host
acceptance.

The [compact receipt](svg-vertical-glyph-2026-11-01.json.gz) binds changed source,
full release/generated manifests, all ten tested production artifact identities,
raw complete runs, retained failed/corrected pilots, independent reference code
and large-output identities. Raw benchmark ZIPs remain local/ignored.

## Remaining required scope

This is a private renderer dependency. Public Float32 TextLayer/tool admission,
scene/export/shared transport/persistence and broad styled/script/bidi/font-
fallback/missing/intrinsic paint remain required. Native callback conventions and
reported SVG geometry do not establish all legacy/optical hosts or universal
ink extents. VORG table-reader unit coverage is not native CFF/VORG interop proof.
Original byte rendering remains independently verified; no new document schema,
public mutation/grant, paid operation, upload, account or REST/browser session
synchronization is introduced. All unfinished original professional-editor,
quality/device/performance and other roadmap requirements remain active.
