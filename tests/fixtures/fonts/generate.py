"""Original geometric test fonts. Requires fontTools (and Brotli for WOFF2)."""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.ttLib import TTFont, TTCollection, newTable
import struct,json,hashlib

root=Path(__file__).parent
def build(style='Regular',cff=False):
 fb=FontBuilder(1000,isTTF=not cff);order=['.notdef','space','A'];fb.setupGlyphOrder(order);fb.setupCharacterMap({32:'space',65:'A'})
 width=700 if style=='Bold'else 600
 if cff:
  glyphs={}
  for name in order:
   pen=T2CharStringPen(width,None)
   if name=='A':pen.moveTo((50,0));pen.lineTo((width//2,700));pen.lineTo((width-50,0));pen.closePath()
   glyphs[name]=pen.getCharString()
  fb.setupCFF('CanoliSourceCFF-Regular',{'FullName':'Canoli Source CFF Regular','FamilyName':'Canoli Source CFF','Weight':'Regular'},glyphs,{})
 else:
  glyphs={}
  for name in order:
   pen=TTGlyphPen(None)
   if name=='A':pen.moveTo((50,0));pen.lineTo((width-50,0));pen.lineTo((width-50,700 if style=='Bold'else 500));pen.lineTo((50,700 if style=='Bold'else 500));pen.closePath()
   glyphs[name]=pen.glyph()
  fb.setupGlyf(glyphs)
 fb.setupHorizontalMetrics({name:(width,0)for name in order});fb.setupHorizontalHeader(ascent=800,descent=-200)
 family='Canoli Source CFF'if cff else'Canoli Source'
 fb.setupNameTable({'familyName':family,'styleName':style,'uniqueFontIdentifier':family+' '+style,'fullName':family+' '+style,'psName':family.replace(' ','')+'-'+style,'version':'Version 1.000'})
 fb.setupOS2(sTypoAscender=800,sTypoDescender=-200,usWinAscent=800,usWinDescent=200,usWeightClass=700 if style=='Bold'else 400,usWidthClass=5,fsType=0)
 fb.setupPost();fb.setupMaxp();fb.font['head'].created=fb.font['head'].modified=3760185600
 return fb.font
for style in ['Regular','Bold']:build(style).save(root/f'{style}.ttf')
build(cff=True).save(root/'CFF.otf')
for flavor in ['woff','woff2']:
 font=TTFont(root/'Regular.ttf',recalcTimestamp=False);font.flavor=flavor;font.save(root/f'Regular.{flavor}')
collection=TTCollection();collection.fonts=[TTFont(root/'Regular.ttf',recalcTimestamp=False),TTFont(root/'Bold.ttf',recalcTimestamp=False)];collection.save(root/'Collection.ttc')
dsig=newTable('DSIG');dsig.ulVersion=1;dsig.usFlag=0;dsig.usNumSigs=0;dsig.signatureRecords=[]
collection.fonts[0]['DSIG']=dsig;collection.save(root/'DsigCollection.ttc')
# Classic Macintosh resource fork, containing the two unmodified SFNT files.
data=bytearray();refs=[]
for i,name in enumerate(['Regular.ttf','Bold.ttf']):
 body=(root/name).read_bytes();refs.append(struct.pack('>Hh',128+i,-1)+len(data).to_bytes(4,'big')+bytes(4));data.extend(struct.pack('>I',len(body))+body)
data_offset=256;map_offset=data_offset+len(data);map_length=38+12*len(refs)
header=struct.pack('>IIII',data_offset,map_offset,len(data),map_length)
resource_map=header+bytes(8)+struct.pack('>HH',28,map_length)+struct.pack('>H4sHH',0,b'sfnt',len(refs)-1,10)+b''.join(refs)
assert len(resource_map)==map_length
(root/'Collection.dfont').write_bytes(header+bytes(data_offset-16)+data+resource_map)
assert TTFont(root/'Collection.dfont',res_name_or_index=1)['maxp'].numGlyphs==3
assert TTFont(root/'Collection.dfont',res_name_or_index=2)['OS/2'].usWeightClass==700
manifest={}
for p in sorted(root.iterdir()):
 if p.suffix not in ['.ttf','.otf','.woff','.woff2','.ttc','.dfont']:continue
 body=p.read_bytes();manifest[p.name]={'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Generated',len(manifest),'original fixtures with independent fontTools verification.')
