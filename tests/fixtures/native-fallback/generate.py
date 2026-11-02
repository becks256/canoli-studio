from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
import json,hashlib
out=Path(__file__).resolve().parent;root=out.parents[2]
def identity(p):
 b=p.read_bytes();return {'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def rename(font,family,postscript):
 values={1:family,4:family+' Regular',6:postscript,16:family,25:postscript}
 for name in font['name'].names:
  if name.nameID in values:name.string=values[name.nameID].encode(name.getEncoding())
source=root/'tests/fixtures/shaping-font/Shaping.ttf';font=TTFont(source,recalcTimestamp=False)
# Retain every glyph, layout table, hint and metric. Only declared Unicode
# coverage and diagnostic font names change, forcing native fallback while preserving original GIDs.
latin={0x20,0x41,0x56,0x66,0x69,0x61}
for table in font['cmap'].tables:
 if table.isUnicode():table.cmap={cp:name for cp,name in table.cmap.items()if cp in latin}
rename(font,'Canoli Primary Latin','CanoliPrimaryLatin-Regular')
p=out/'Latin-no-mark.ttf';font.save(p,reorderTables=False)
axes=root/'tests/fixtures/font-variations/Axes.ttf';font=instantiateVariableFont(TTFont(axes,recalcTimestamp=False),{'TEST':(25,50,75),'wght':(300,500,700)},inplace=True)
for table in font['cmap'].tables:
 if table.isUnicode():
  glyph=table.cmap.get(0x41)
  if glyph:table.cmap[0x42]=glyph;del table.cmap[0x41]
rename(font,'Canoli Fallback Axes B','CanoliFallbackAxesB-Regular')
p=out/'Fallback-axes-B.ttf';font.save(p,reorderTables=False)
record={'purpose':'Native owned fallback fixtures; original glyph data/layout retained, complementary cmap coverage and independently reduced variable axes force observable fallback sources. Original CC0 fixture artwork; test assets only.','originals':{str(p.relative_to(root)):identity(p)for p in [source,axes,root/'tests/fixtures/vertical-font/Vertical.ttf']},'derived':{p.name:identity(p)for p in sorted(out.glob('*.ttf'))},'latinCoverage':sorted(latin),'variableFallback':{'coverageChange':'A becomes B, source GID retained','requestedAxes':{'TEST':[25,50,75],'wght':[300,500,700]},'effectiveAxes':{axis.axisTag:[axis.minValue,axis.defaultValue,axis.maxValue]for axis in font['fvar'].axes}}}
(out/'manifest.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record,indent=2))
