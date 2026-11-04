# Original cross-span native addressing — 2026-11-04

This is an isolated diagnostic of the unresolved colored fallback cohort, not
an implementation or complete native typography acceptance. Main engine, tests,
scripts and release output stayed frozen throughout the passing 243-case affected
source run; these probes did not change the implementation.

The original `AV á fi` context retains its fonts, source-indexed color spans and
normal shaping. The first font lacks the mark; original fallback priority selects
the second font for the complete base/mark cluster. Independent native SVG output
with the fallback stack has identical alpha to the corresponding single-font
control, both with and without the original color boundary.

Native character-query metadata does not retain that equivalence. In the
single-font colored control the space at source index 5 starts at x=236.40625;
the fallback/color control reports x=256.390625 for the same source space and
x=236.40625 for the following fi cluster. The actual native ink has the opposite
placement. Both untracked visual metadata and original caret queries are affected.
Uniform probe fill retains every original span but does not repair the addresses.
Queries on each original tspan independently retain the same incorrect addresses;
changing the query scope also does not resolve this case.
Thus those character APIs are insufficient pose authority for this case.

Private fallback candidate inspection confirms the consequence: the final font
item proposes the space at x=256.390625 and the fi glyph at x=236.40625. The
independently verified whole-line control places them at x=236.390625 and
x=256.390625. This diagnostic records those positions; it does not use their
observed differences as rendering constants or fit candidate displacements.

The grapheme paint ownership rule remains correct. Pinned HarfBuzz cluster level 1
can associate the mark with source character 4 without changing glyph IDs or
advances/offsets, but recoloring that glyph by character fails the complete native
ownership check with maximum weighted error 65025. Original grapheme color
ownership yields zero error across 524,288 comparison samples. No cluster-level
API or recoloring change is admitted.

As a separate feasibility control, verified original-font whole-line glyph poses
retain their exact positions, IDs and original source clusters. Assigning the
required primary font to its supported clusters and the secondary font to the
complete base/mark cluster matches original fallback ink exactly across 262,144
samples and both native color ownership planes exactly across 524,288 samples.
This is possible because these specific fixture fonts share the relevant source
outlines and metrics. It does not justify substituting fonts or reusing another
font's poses in the editor. Document data remains unchanged throughout.

## Source-derived parent allocation prototype

A separate prototype assigns whole supported clusters in original font priority,
shapes original full-source ranges and accumulates retained source font advances
in the parent frame. It uses source layout-unit conversion, not glyph poses from
another font or offsets observed in comparison pixels. Optional calibrated native
metrics retain identical original glyph/cluster identities. All authored spans,
text and grapheme colors remain unchanged.

The complete eight horizontal controls retain both paragraph directions, identity/
affine placement and spacing 0/-30. Parent alignment alone matches both identity
zero-spacing cases. Using the original first-cluster parent anchor also matches
both identity negative-spacing cases: four controls match exact complete ink and
both color ownership planes. All four affine controls still fail those exact
checks. Raw/calibrated advance/offset alternatives are recorded separately; they
are not counted as separate acceptance cases. These are native synthetic-paint
checks, not independent Float32 composition or full original-matrix acceptance.

This prototype stays outside the editor. Affine source/screen parent allocation,
curved/vertical cases, source/font lifetime and complete integration/performance
verification remain necessary before admission. Raw script and all successful/
failed rows are retained in the same diagnostic directory and compact receipt.

The next implementation must recover native item/parent allocation without
trusting the incorrect cross-span caret addresses, preserve original glyph/font/
cluster/color identity and retain complete ink/ownership gates. Original bidi,
script, upright, affine and curved targets remain required. All 384 layouts and
36 independent Float32 references still need to pass the final implementation.

[Compact receipt](native-cross-span-2026-11-04.json.gz) contains complete probes,
native comparisons, candidate poses and source identities. Raw SVG/PNG, logs and
scripts remain in `/tmp/canoli-native-cross-span-2026-11-04/`. The first candidate
inspection used the input span count instead of the normalized count and failed
before inspection; the corrected probe uses the actual normalized spans. No
comparison threshold, authored text or original acceptance target changes.
