"""Build the CC0 independent one-em GPOS calibration font with FontTools."""
from pathlib import Path
from io import BytesIO
from fontTools.ttLib import TTFont
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
import hashlib
import re

root = Path(__file__).resolve().parents[1]
source = (root / 'src/engine/native-size-font.ts').read_text()
original = bytes(map(int, re.search(r'Uint8Array\(\[([\d,]+)\]\)', source)[1].split(',')))
font = TTFont(BytesIO(original), recalcTimestamp=False)
assert font['head'].unitsPerEm == 2048
assert font['hmtx']['A'][0] == 2048
addOpenTypeFeaturesFromString(font, 'feature kern { pos A A 2048; } kern;')
for name in font['name'].names:
    if name.nameID in (1, 4, 6):
        name.string = 'CanoliLayoutScaleProbe'.encode(name.getEncoding())
output = BytesIO()
font.save(output)
data = output.getvalue()
(root / 'src/engine/native-layout-size-font.ts').write_text(
    '/** Original CC0 geometric size probe. A+A GPOS adds exactly one 2048-UPEM em.\n'
    ' * Rebuild: python3 scripts/build-native-layout-size-font.py (FontTools 4.51.0).\n'
    ' * Pair width with kerning minus pair width without kerning measures shaping\n'
    ' * scale independently of native raster advances and source artwork. */\n'
    'export const nativeLayoutSizeFontBytes=()=>new Uint8Array(['
    + ','.join(map(str, data)) + ']);\n')
print(len(data), hashlib.sha256(data).hexdigest())
