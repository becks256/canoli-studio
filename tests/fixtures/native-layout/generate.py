"""Independent FontTools mark-ink reference; original CC0 geometric artwork."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
import hashlib
import json

out = Path(__file__).resolve().parent
source = out.parent / 'shaping-font/Shaping.ttf'
font = TTFont(source, recalcTimestamp=False, recalcBBoxes=False)
original = TTFont(source, recalcTimestamp=False)
glyph = 'acutecomb'
glyph_id = font.getGlyphID(glyph)
for name in font.getGlyphOrder():
    if name != glyph:
        font['glyf'][name] = TTGlyphPen(None).glyph()
for name in font['name'].names:
    if name.nameID in (1, 4, 6):
        name.string = 'CanoliMarkMetricProbe'.encode(name.getEncoding())
path = out / 'Mark-only.ttf'
font.save(path, reorderTables=False)
reference = TTFont(path, recalcTimestamp=False)
assert reference.getGlyphOrder() == original.getGlyphOrder()
retained = ['cmap', 'hmtx', 'GSUB', 'GPOS', 'GDEF', 'vmtx', 'vhea']
for tag in retained:
    assert reference.getTableData(tag) == original.getTableData(tag), tag
def identity(path):
    data = path.read_bytes()
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
(out / 'manifest.json').write_text(json.dumps({
    'purpose': 'Original GID8 mark ink; all source character mappings, metrics and positioning tables unchanged. Independent native mark placement reference, not a product font.',
    'source': identity(source), 'probe': identity(path),
    'glyphId': glyph_id, 'glyphName': glyph, 'retainedTables': retained,
}, indent=2) + '\n')
