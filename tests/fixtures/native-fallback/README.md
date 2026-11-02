# Native fallback font fixtures

Original geometric test artwork, dedicated to the public domain under CC0, as
in the source fixtures. These are test assets, not product fonts.

Run `python3 tests/fixtures/native-fallback/generate.py` with FontTools installed.
The generator reads the committed Shaping, Axes and Vertical fixtures. It retains
all source glyphs, glyph IDs, layout, metrics and hints, changing the primary
Latin Unicode coverage and the fallback A mapping to B. Independent FontTools
partial instancing narrows TEST to 25/50/75 and wght to 400/500/700. Requested
wght minimum 300 is clipped by FontTools to the original minimum 400.

The manifest records original and derived byte identities and effective axes.
Distinct font names allow independent native source-selection observations.
