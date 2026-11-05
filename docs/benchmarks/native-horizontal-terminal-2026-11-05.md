# Horizontal complete matrix and source assertion correction — 2026-11-05 UTC

The complete original matrix at review `3c1fcfa` matches 362/384 layouts:
three mismatches and 19 matching-budget errors remain. CJK, marks and axes match
64/64 each, bidi 62/64, joining 62/64 and colored 46/64. Every prior 361 match,
original 352 match and 44 earlier colored match remains. The new exact control
is horizontal RTL affine joining with negative letter tracking.

All 72 independent Float32 references pass in the same seven-spec fallback
invocation. The audit checks 2,302 matched glyph metadata records and 1,398
original full-context requests, retaining font priority, axes, GIDs and colors,
with zero ink/ownership errors. All six cohorts retire probes/private faces
without changing the document. All 4,031 frozen inputs remain unchanged through
the original source and matrix invocations.

The original canonical source run passes 258/259 cases. Its one failure requires
nonzero private `paintLetterSpacing` for a mixed Arabic/Hebrew fixture, although
all nine independent Float32 outputs, HDR/tiny alpha and partitions already
match exactly. Tracking can also be encoded in retained positions. The corrected
test compares actual original-source ink with the otherwise identical zero-tracking
source and retains every numeric, original-font, invalid-input and partition gate.
Its fresh focused invocation passes all nine outputs and shows visible tracking
in every case. All 766 engine/source files remain unchanged. A complete corrected
259-case source invocation and main integration remain required; a combined green
source result is not inferred from separate runs. Twenty-two native layouts and
all unfinished broader roadmap gates remain required.
The isolated core build, 3,428 unit/API tests, 72 native controls and 57 selected
production workflows remain separately recorded in the earlier core receipt.
No new complete main, production, device, memory or performance acceptance is
claimed here. The final documentation build, guide check and unchanged runtime
audit accompany this record. The later rejection-cache development is separate.

[Raw invocations, exact source/test identities and retention audit](native-horizontal-terminal-2026-11-05.json.gz).
