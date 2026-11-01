"""Original geometric OpenType shaping fixture, generated with FontTools."""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
import json,hashlib
root=Path(__file__).parent
order=['.notdef','space','A','V','f','i','fi','a','acutecomb','lam','alef','lam_alef','beh','beh.init','beh.medi','beh.fina','hebrewAlef','hebrewBet']
fb=FontBuilder(1000,isTTF=True);fb.setupGlyphOrder(order);fb.setupCharacterMap({32:'space',65:'A',86:'V',102:'f',105:'i',97:'a',0x301:'acutecomb',0x644:'lam',0x627:'alef',0x628:'beh',0x5d0:'hebrewAlef',0x5d1:'hebrewBet'})
glyphs={};metrics={}
for index,name in enumerate(order):
 pen=TTGlyphPen(None);width=900 if name in ['fi','lam_alef'] else 500 if name=='space' else 0 if name=='acutecomb' else 600
 if name not in ['.notdef','space']:
  if name=='acutecomb':pen.moveTo((-40,0));pen.lineTo((40,0));pen.lineTo((90,120));pen.lineTo((10,120))
  else:pen.moveTo((30,0));pen.lineTo((width-30,0));pen.lineTo((width-30,350+index*13));pen.lineTo((80,530+index*7))
  pen.closePath()
 glyphs[name]=pen.glyph();metrics[name]=(width,0 if name!='acutecomb' else -40)
fb.setupGlyf(glyphs);fb.setupHorizontalMetrics(metrics);fb.setupHorizontalHeader(ascent=900,descent=-250)
fb.setupVerticalMetrics({name:(1100,150) for name in order});fb.setupVerticalHeader(ascent=500,descent=-500)
fb.setupNameTable({'familyName':'Canoli Shaping Fixture','styleName':'Regular','uniqueFontIdentifier':'Canoli Shaping Fixture 1','fullName':'Canoli Shaping Fixture Regular','psName':'CanoliShapingFixture-Regular','version':'Version 1.000'})
fb.setupOS2(sTypoAscender=900,sTypoDescender=-250,usWinAscent=1000,usWinDescent=300,fsType=0);fb.setupPost();fb.setupMaxp();fb.font['head'].created=fb.font['head'].modified=3760185600
addOpenTypeFeaturesFromString(fb.font,'''languagesystem DFLT dflt;
languagesystem latn dflt;
languagesystem arab dflt;
languagesystem hebr dflt;
feature liga {sub f i by fi;} liga;
feature rlig {sub lam alef by lam_alef;} rlig;
feature init {sub beh by beh.init;} init;
feature medi {sub beh by beh.medi;} medi;
feature fina {sub beh by beh.fina;} fina;
feature kern {pos A V -80;} kern;
markClass acutecomb <anchor 0 0> @TOP;
feature mark {pos base a <anchor 280 700> mark @TOP;} mark;
''')
p=root/'Shaping.ttf';fb.font.save(p);data=p.read_bytes();(root/'manifest.json').write_text(json.dumps({'purpose':'Original glyphs and explicit ligature, kerning, mark and Arabic positional substitution rules. No third-party font data.','glyphOrder':order,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()},indent=2)+'\n');print(p,len(data))
