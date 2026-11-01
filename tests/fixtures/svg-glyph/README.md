The complete reference font is independently prepared with FontTools 4.51.0
from pinned `@fontsource-variable/manrope@5.3.0`. It retains original glyph order,
outlines, composites, variation, hint and layout data, adding one supplementary
Unicode selector per nonzero glyph. Original mappings remain. GPOS/GSUB are
equivalently recompiled by FontTools. `manifest.json` binds both source/reference
identities. The original SIL OFL is retained in `LICENSE`.

Rebuild with `python3 tests/fixtures/svg-glyph/generate.py` using FontTools and
Brotli. This is verification data, not a bundled application font or project
source conversion. Source geometry is verified separately against complete
original native SVG runs; this reference checks independent per-glyph coverage
and Float32 composition at the verified poses.
