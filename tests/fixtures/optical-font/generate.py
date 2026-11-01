"""Original CC0 optical-size artwork and independent complete static instances."""
from pathlib import Path
from tempfile import TemporaryDirectory
from itertools import product
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.designspaceLib import AxisDescriptor,SourceDescriptor,DesignSpaceDocument
from fontTools.varLib import build
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.ttLib import TTFont,newTable
import hashlib,json
root=Path(__file__).parent
axes=[('opsz','Optical',8,8,72),('wght','Weight',400,400,800)]
with TemporaryDirectory(prefix='canoli-optical-master-',dir='/tmp')as temporary:
 tmp=Path(temporary);design=DesignSpaceDocument()
 for tag,name,minimum,default,maximum in axes:
  axis=AxisDescriptor();axis.tag=tag;axis.name=name;axis.minimum=minimum;axis.default=default;axis.maximum=maximum;design.addAxis(axis)
 for optical,weight in product([8,72],[400,800]):
  advance=640+(optical-8)*16+(weight-400);height=768+(optical-8)*8;fb=FontBuilder(2048,isTTF=True);order=['.notdef','space','A'];fb.setupGlyphOrder(order);fb.setupCharacterMap({32:'space',65:'A'});glyphs={}
  for name in order:
   pen=TTGlyphPen(None)
   if name=='A':
    pen.moveTo((32,0));pen.lineTo((advance-32,0));pen.lineTo((advance-32,height));pen.lineTo((32,height));pen.closePath()
   glyphs[name]=pen.glyph()
  fb.setupGlyf(glyphs);fb.setupHorizontalMetrics({name:(advance,0)for name in order});fb.setupHorizontalHeader(ascent=1536,descent=-512)
  fb.setupNameTable({'familyName':'Canoli Optical Fixture','styleName':'Regular','uniqueFontIdentifier':'Canoli Optical Fixture 1','fullName':'Canoli Optical Fixture Regular','psName':'CanoliOpticalFixture-Regular','version':'Version 1.000'})
  fb.setupOS2(sTypoAscender=1536,sTypoDescender=-512,usWinAscent=1536,usWinDescent=512,usWeightClass=weight,usWidthClass=5,fsType=0);fb.setupPost();fb.setupMaxp();fb.font['head'].created=fb.font['head'].modified=3760185600
  path=tmp/f'{optical}-{weight}.ttf';fb.save(path);source=SourceDescriptor();source.path=str(path);source.name=path.stem;source.familyName='Canoli Optical Fixture';source.styleName='Regular';source.location={'Optical':optical,'Weight':weight}
  if(optical,weight)==(8,400):source.copyInfo=source.copyLib=source.copyFeatures=True
  design.addSource(source)
 design.write(tmp/'optical.designspace');font,_,_=build(str(tmp/'optical.designspace'));font['head'].created=font['head'].modified=3760185600;font.recalcTimestamp=False
 # Non-identity optical mapping makes a size-only affine outline shortcut fail.
 avar=newTable('avar');avar.segments={'opsz':{-1:-1,0:0,.5:.75,1:1},'wght':{-1:-1,0:0,1:1}};font['avar']=avar;font.save(root/'Optical.ttf');font.flavor='woff2';font.save(root/'Optical.woff2')
references={}
for optical,weight in product([8,12,13,13.5,16,24,40,72],[400,600]):
 name=f'opsz-{optical}-wght-{weight}.ttf';font=TTFont(root/'Optical.ttf',recalcTimestamp=False);static=instantiateVariableFont(font,{'opsz':optical,'wght':weight},inplace=False);static.recalcTimestamp=False;static.save(root/name);assert'fvar'not in static;references[name]={'opsz':optical,'wght':weight}
report={'license':'CC0-1.0; original geometric test artwork','axes':{tag:[a,b,c]for tag,_,a,b,c in axes},'avar':{'opsz':{'0':0,'0.5':0.75,'1':1}},'references':references,'files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in sorted(root.iterdir())if p.suffix in ['.ttf','.woff2']}}
(root/'manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
