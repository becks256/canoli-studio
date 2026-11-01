from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from pathlib import Path
from io import BytesIO
fb=FontBuilder(2048,isTTF=True);order=['.notdef','A'];fb.setupGlyphOrder(order);fb.setupCharacterMap({65:'A'});glyphs={}
for name in order:
 pen=TTGlyphPen(None)
 if name=='A':
  pen.moveTo((0,0));pen.lineTo((1024,0));pen.lineTo((1024,1024));pen.lineTo((0,1024));pen.closePath()
 glyphs[name]=pen.glyph()
fb.setupGlyf(glyphs);fb.setupHorizontalMetrics({name:(2048,0)for name in order});fb.setupHorizontalHeader(ascent=1536,descent=-512);fb.setupNameTable({'familyName':'Canoli Size Probe','styleName':'Regular','uniqueFontIdentifier':'CanoliSizeProbe1','fullName':'Canoli Size Probe','psName':'CanoliSizeProbe','version':'Version 1.000'});fb.setupOS2(sTypoAscender=1536,sTypoDescender=-512,usWinAscent=1536,usWinDescent=512,usWeightClass=400,usWidthClass=5,fsType=0);fb.setupPost();fb.setupMaxp();fb.font['head'].created=fb.font['head'].modified=3760185600;fb.font.recalcTimestamp=False;out=BytesIO();fb.font.save(out);b=out.getvalue();(Path(__file__).resolve().parents[1]/'src/engine/native-size-font.ts').write_text('/** Original CC0 geometric native size probe. A advance equals its 2048 UPEM.\n * Rebuild: python3 scripts/build-native-size-font.py (FontTools 4.51.0).\n * Measurement only: no source artwork, glyph coverage or paint is read. */\nexport const nativeSizeFontBytes=()=>new Uint8Array(['+','.join(str(n)for n in b)+']);\n');print(len(b))
