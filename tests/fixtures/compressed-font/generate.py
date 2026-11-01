"""Original complete-table, hint, composite, layout and variable compression fixtures."""
from pathlib import Path
from fontTools.ttLib import TTFont,newTable
from fontTools.ttLib.tables.ttProgram import Program
from fontTools.ttLib.woff2 import WOFF2FlavorData
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from array import array
import json,hashlib
root=Path(__file__).parent
font=TTFont(root.parent/'fonts/Regular.ttf',recalcTimestamp=False)
fpgm=newTable('fpgm');fpgm.program=Program();fpgm.program.fromAssembly(['PUSHB[ ]','0','FDEF[ ]','SVTCA[0]','ENDF[ ]']);font['fpgm']=fpgm
prep=newTable('prep');prep.program=Program();prep.program.fromAssembly(['PUSHB[ ]','0','CALL[ ]']);font['prep']=prep
cvt=newTable('cvt ');cvt.values=array('h',[40,500]);font['cvt ']=cvt
gasp=newTable('gasp');gasp.gaspRange={65535:3};font['gasp']=gasp
font['glyf']['A'].program=Program();font['glyf']['A'].program.fromAssembly(['SVTCA[0]','PUSHB[ ]','2','MDAP[1]'])
pen=TTGlyphPen(font.getGlyphSet());pen.addComponent('A',(1,0,0,1,40,0));font['glyf']['compositeA']=pen.glyph();font['hmtx']['compositeA']=(640,90);font['hmtx']['A']=(600,50);font.setGlyphOrder(list(dict.fromkeys(font.getGlyphOrder())));font['maxp'].numGlyphs=4;font['maxp'].maxFunctionDefs=1;font['maxp'].maxStackElements=8;font['maxp'].maxSizeOfInstructions=8
for table in font['cmap'].tables:
 if table.isUnicode():table.cmap[66]='compositeA'
font['head'].created=font['head'].modified=3760185600;font.recalcTimestamp=False;font.save(root/'Hinted.ttf')
inputs=[('Hinted',root/'Hinted.ttf'),('Shaping',root.parent/'shaping-font/Shaping.ttf'),('Variable',root.parent/'css-font/Css.ttf'),('CFF',root.parent/'fonts/CFF.otf')]
references={}
for name,path in inputs:
 for flavor in ['woff','woff2']:
  source=TTFont(path,recalcTimestamp=False);source.flavor=flavor;source.save(root/(name+'.'+flavor))
 references[name]=str(path.relative_to(root.parent))
for name,transforms in [('Hinted-hmtx',{'glyf','loca','hmtx'}),('Hinted-null',set())]:
 source=TTFont(root/'Hinted.ttf',recalcTimestamp=False);source.flavor='woff2';source.flavorData=WOFF2FlavorData(transformedTables=transforms);source.save(root/(name+'.woff2'));references[name]='compressed-font/Hinted.ttf'
guard=TTFont(root/'Hinted.ttf',recalcTimestamp=False);addOpenTypeFeaturesFromString(guard,'languagesystem DFLT dflt; feature liga {sub A by compositeA;} liga;');guard.flavor='woff2';guard.save(root/'FeatureGuard.woff2')
report={'license':'CC0-1.0; original geometric artwork and hint programs','references':references,'files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in sorted(root.iterdir())if p.suffix in ['.ttf','.woff','.woff2']}}
(root/'manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
