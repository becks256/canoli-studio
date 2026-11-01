# Independent vertical glyph reference

`Shaping-glyphs.ttf` derives from this repository's original purpose-built
geometric `shaping-font/Shaping.ttf`, with FontTools 4.51.0. No external font is
bundled. Original glyph order, cmap, outlines, metrics and layout remain;
supplementary private selectors independently address original nonzero GIDs.
Tests disable original resolved-glyph features explicitly. This fixture verifies
coverage/composition using separately verified poses, not independent native
glyph-position discovery. Run `generate.py` to reproduce the file and manifest.
