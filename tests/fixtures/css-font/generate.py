"""Original geometric variable axes and independent native reference instances."""
from pathlib import Path
from tempfile import TemporaryDirectory
from itertools import product
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.designspaceLib import AxisDescriptor,SourceDescriptor,DesignSpaceDocument
from fontTools.varLib import build
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.ttLib import TTFont
import json,hashlib
root=Path(__file__).parent
axes=[('wght','Weight',400,400,800),('wdth','Width',75,100,125),('ital','Italic',0,0,1),('slnt','Slant',-14,0,0)]
with TemporaryDirectory(prefix='canoli-css-master-',dir='/tmp')as temporary:
 tmp=Path(temporary);design=DesignSpaceDocument()
 for tag,name,minimum,default,maximum in axes:
  axis=AxisDescriptor();axis.tag=tag;axis.name=name;axis.minimum=minimum;axis.default=default;axis.maximum=maximum;design.addAxis(axis)
 for weight,width,italic,slant in product([400,800],[75,100,125],[0,1],[-14,0]):
  advance=int(600+(weight-400)*4+(width-100)*4+italic*80+slant*4);height=int(500+(weight-400)*2+italic*60);skew=int(italic*80-slant*8)
  fb=FontBuilder(1000,isTTF=True);order=['.notdef','space','A'];fb.setupGlyphOrder(order);fb.setupCharacterMap({32:'space',65:'A'});glyphs={}
  for name in order:
   pen=TTGlyphPen(None)
   if name=='A':pen.moveTo((30,0));pen.lineTo((advance-30,0));pen.lineTo((advance-30+skew,height));pen.lineTo((30+skew,height));pen.closePath()
   glyphs[name]=pen.glyph()
  fb.setupGlyf(glyphs);fb.setupHorizontalMetrics({name:(advance,0)for name in order});fb.setupHorizontalHeader(ascent=1600,descent=-200)
  fb.setupNameTable({'familyName':'Canoli CSS Fixture','styleName':'Regular','uniqueFontIdentifier':'Canoli CSS Fixture 1','fullName':'Canoli CSS Fixture Regular','psName':'CanoliCSSFixture-Regular','version':'Version 1.000'})
  fb.setupOS2(sTypoAscender=1600,sTypoDescender=-200,usWinAscent=1600,usWinDescent=200,usWeightClass=weight,usWidthClass=5,fsType=0);fb.setupPost();fb.setupMaxp();fb.font['head'].created=fb.font['head'].modified=3760185600
  path=tmp/f'{weight}-{width}-{italic}-{slant}.ttf';fb.save(path);source=SourceDescriptor();source.path=str(path);source.name=path.stem;source.familyName='Canoli CSS Fixture';source.styleName='Regular';source.location=dict(zip([a[1]for a in axes],[weight,width,italic,slant]))
  if(weight,width,italic,slant)==(400,100,0,0):source.copyInfo=source.copyLib=source.copyFeatures=True
  design.addSource(source)
 design.write(tmp/'css.designspace');variable,_,_=build(str(tmp/'css.designspace'));variable['head'].created=variable['head'].modified=3760185600;variable.recalcTimestamp=False;variable.save(root/'Css.ttf')
reference=[('weight',{'wght':600,'wdth':100,'ital':0,'slnt':0}),('fraction',{'wght':637.5,'wdth':100,'ital':0,'slnt':0}),('wide-italic',{'wght':700,'wdth':125,'ital':1,'slnt':0}),('wide-upright',{'wght':700,'wdth':125,'ital':0,'slnt':0}),('wide-slant',{'wght':700,'wdth':125,'ital':0,'slnt':-14}),('overridden',{'wght':550,'wdth':87.5,'ital':.5,'slnt':-7})]
for name,coords in reference:
 font=TTFont(root/'Css.ttf',recalcTimestamp=False);static=instantiateVariableFont(font,coords,inplace=False);static['head'].created=static['head'].modified=3760185600;static.recalcTimestamp=False;static.save(root/(name+'.ttf'))
italic=instantiateVariableFont(TTFont(root/'Css.ttf',recalcTimestamp=False),{'slnt':0},inplace=False);italic['head'].created=italic['head'].modified=3760185600;italic.recalcTimestamp=False;italic.save(root/'Css-italic.ttf')
report={'license':'CC0-1.0; original geometric test artwork','axes':{tag:[a,b,c]for tag,_,a,b,c in axes},'references':dict(reference),'files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in sorted(root.glob('*.ttf'))}}
(root/'manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
