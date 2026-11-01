"""Independent FontTools glyph-ID reference; preserve all source payload tables.
Reference font remains under its original SIL OFL; see LICENSE.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
import hashlib,json,fontTools,shutil
root=Path(__file__).parent;repo=root.parents[2];package=repo/'node_modules/@fontsource-variable/manrope';source=package/'files/manrope-latin-wght-normal.woff2'
font=TTFont(source,recalcTimestamp=False);original=font.getBestCmap();mapping=dict(original)
for i,name in enumerate(font.getGlyphOrder()):
 if i:
  code=0x100000+i;assert code not in mapping;mapping[code]=name
font['cmap'].tables=[t for t in font['cmap'].tables if(t.platformID,t.platEncID)not in[(0,4),(3,10)]]
for platform,encoding in [(0,4),(3,10)]:
 table=CmapSubtable.newSubtable(12);table.platformID=platform;table.platEncID=encoding;table.language=0;table.cmap=mapping;font['cmap'].tables.append(table)
features=sorted({r.FeatureTag for tag in ['GSUB','GPOS']if tag in font for r in font[tag].table.FeatureList.FeatureRecord})
font.flavor=None;font.recalcTimestamp=False;font.save(root/'Manrope-glyphs.ttf');shutil.copyfile(package/'LICENSE',root/'LICENSE')
report={'fontTools':fontTools.__version__,'license':'SIL OFL 1.1; original license retained in LICENSE','sourcePackage':'@fontsource-variable/manrope@5.3.0','source':str(source.relative_to(repo)),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sourceGlyphCount':len(font.getGlyphOrder()),'referenceSelectorBase':0x100000,'featuresDisabled':features,'reference':{'file':'Manrope-glyphs.ttf','bytes':(root/'Manrope-glyphs.ttf').stat().st_size,'sha256':hashlib.sha256((root/'Manrope-glyphs.ttf').read_bytes()).hexdigest()},'originalMappings':len(original),'allOriginalTablesRetained':True};(root/'manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
