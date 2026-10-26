"""Original geometric variable-font fixture and independently instanced reference.
Requires fontTools. Masters stay in a caller-selected temporary directory.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.designspaceLib import DesignSpaceDocument,AxisDescriptor,SourceDescriptor
from fontTools.varLib import build
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.ttLib import TTFont
import hashlib,json,os

root=Path(__file__).parent
with TemporaryDirectory(prefix='canoli-axis-masters-',dir=os.environ.get('TMPDIR'))as temporary:
 temporary=Path(temporary);design=DesignSpaceDocument()
 for tag,name,minimum,default,maximum in [('TEST','Shape',0,0,100),('wght','Weight',400,400,800)]:
  axis=AxisDescriptor();axis.tag=tag;axis.name=name;axis.minimum=minimum;axis.default=default;axis.maximum=maximum;design.addAxis(axis)
 for shape,weight in [(0,400),(0,800),(100,400),(100,800)]:
  fb=FontBuilder(1000,isTTF=True);order=['.notdef','space','A'];fb.setupGlyphOrder(order);fb.setupCharacterMap({32:'space',65:'A'});glyphs={};width=600+shape*2+(weight-400)//4;height=500+(weight-400)//2
  for name in order:
   pen=TTGlyphPen(None)
   if name=='A':pen.moveTo((50,0));pen.lineTo((width-50,0));pen.lineTo((width-50,height));pen.lineTo((50,height));pen.closePath()
   glyphs[name]=pen.glyph()
  fb.setupGlyf(glyphs);fb.setupHorizontalMetrics({name:(width,0)for name in order});fb.setupHorizontalHeader(ascent=800,descent=-200)
  fb.setupNameTable({'familyName':'Canoli Axis Fixture','styleName':'Regular','uniqueFontIdentifier':'CanoliAxisFixture','fullName':'Canoli Axis Fixture','psName':'CanoliAxisFixture','version':'Version 1.000'})
  fb.setupOS2(sTypoAscender=800,sTypoDescender=-200,usWinAscent=800,usWinDescent=200,usWeightClass=weight,usWidthClass=5,fsType=0);fb.setupPost();fb.setupMaxp();fb.font['head'].created=fb.font['head'].modified=3760185600
  path=temporary/f'{shape}-{weight}.ttf';fb.save(path);source=SourceDescriptor();source.path=str(path);source.name=path.stem;source.familyName='Canoli Axis Fixture';source.styleName='Regular';source.location={'Shape':shape,'Weight':weight}
  if(shape,weight)==(0,400):source.copyInfo=source.copyLib=source.copyFeatures=True
  design.addSource(source)
 design.write(temporary/'axis.designspace');variable,_,_=build(str(temporary/'axis.designspace'));variable['head'].created=variable['head'].modified=3760185600;variable.recalcTimestamp=False;variable.save(root/'Axes.ttf')
 variable=TTFont(root/'Axes.ttf',recalcTimestamp=False);reference=instantiateVariableFont(variable,{'TEST':50,'wght':600},inplace=False);reference['head'].created=reference['head'].modified=3760185600;reference.save(root/'Axes-mid.ttf')
 assert'fvar'not in reference and len(variable['fvar'].axes)==2
 fallback=TTFont(root/'Axes.ttf',recalcTimestamp=False)
 for table in fallback['cmap'].tables:
  if table.isUnicode():table.cmap={code if code!=65 else 66:glyph for code,glyph in table.cmap.items()}
 for axis in fallback['fvar'].axes:
  if axis.axisTag=='TEST':axis.maxValue=25
 for name_id,value in [(1,'Canoli Axis Fallback'),(4,'Canoli Axis Fallback'),(6,'CanoliAxisFallback')]:
  for platform,encoding,language in [(3,1,0x409),(1,0,0)]:fallback['name'].setName(value,name_id,platform,encoding,language)
 fallback.save(root/'Axes-fallback.ttf');fallback_reference=instantiateVariableFont(fallback,{'TEST':25,'wght':600},inplace=False);fallback_reference.save(root/'Axes-fallback-mid.ttf')
 report={'license':'CC0-1.0; original geometric test artwork','axes':{'TEST':[0,0,100],'wght':[400,400,800]},'reference':{'TEST':50,'wght':600},'fallback':{'unicode':66,'TESTRange':[0,0,25],'reference':{'TEST':25,'wght':600}},'files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in sorted(root.glob('*.ttf'))}}
 (root/'manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
