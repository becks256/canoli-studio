"""Original geometric fixtures for native vertical metrics and GSUB admission.
Requires FontTools. No third-party font data or language-quality claim.
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
import hashlib,json

root=Path(__file__).parent
order=['.notdef','space','A','B','han','character','comma','comma.vert']
cmap={32:'space',65:'A',66:'B',0x6f22:'han',0x5b57:'character',0x3001:'comma'}
horizontal={'.notdef':600,'space':300,'A':600,'B':700,'han':1000,'character':1000,'comma':1000,'comma.vert':1000}
vertical={'.notdef':1000,'space':1000,'A':1200,'B':1100,'han':900,'character':1000,'comma':1000,'comma.vert':1000}
def build(reference=False):
 fb=FontBuilder(1000,isTTF=True);fb.setupGlyphOrder(order);fb.setupCharacterMap(cmap)
 glyphs={}
 for index,name in enumerate(order):
  pen=TTGlyphPen(None)
  def rect(x,y,w,h):
   pen.moveTo((x,y));pen.lineTo((x+w,y));pen.lineTo((x+w,y+h));pen.lineTo((x,y+h));pen.closePath()
  if name=='A':rect(40,0,400,600)
  elif name=='B':rect(60,-80,520,200);rect(60,420,200,200)
  elif name=='han':rect(100,0,100,700);rect(100,300,650,100)
  elif name=='character':rect(100,550,700,100);rect(400,0,100,650)
  elif name=='comma':rect(100,0,120,160)
  elif name=='comma.vert':rect(650,520,180,100)
  glyphs[name]=pen.glyph()
 fb.setupGlyf(glyphs);fb.setupHorizontalMetrics({n:(horizontal[n],0)for n in order});fb.setupHorizontalHeader(ascent=800,descent=-200)
 fb.setupVerticalMetrics({n:(vertical[n],200)for n in order});fb.setupVerticalHeader(ascent=500,descent=-500)
 family='Canoli Vertical No Substitution'if reference else'Canoli Vertical Fixture'
 fb.setupNameTable({'familyName':family,'styleName':'Regular','uniqueFontIdentifier':family,'fullName':family+' Regular','psName':family.replace(' ','')+'-Regular','version':'Version 1.000'})
 fb.setupOS2(sTypoAscender=800,sTypoDescender=-200,usWinAscent=800,usWinDescent=280,usWeightClass=400,usWidthClass=5,fsType=0);fb.setupPost();fb.setupMaxp()
 if not reference:addOpenTypeFeaturesFromString(fb.font,'languagesystem DFLT dflt; feature vert { sub comma by comma.vert; } vert; feature vrt2 { sub comma by comma.vert; } vrt2;')
 fb.font['head'].created=fb.font['head'].modified=3760185600
 return fb.font
build().save(root/'Vertical.ttf');build(True).save(root/'NoSubstitution.ttf')
manifest={'purpose':'Original geometric fixtures: native vmtx and vert/vrt2 substitution; negative control retains original cmap/outlines/metrics and omits GSUB.','horizontalAdvances':horizontal,'verticalAdvances':vertical,'files':{}}
for name in ['Vertical.ttf','NoSubstitution.ttf']:
 raw=(root/name).read_bytes();manifest['files'][name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest['files']))
