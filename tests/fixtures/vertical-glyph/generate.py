"""Independent selectors for original source-owned geometric shaping fixtures."""
from pathlib import Path
import hashlib,json
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
from fontTools import version
root=Path(__file__).parent;source=root.parent/'shaping-font/Shaping.ttf';font=TTFont(source,recalcTimestamp=False);original=dict(font.getBestCmap());order=font.getGlyphOrder();base=0x100000
cmap=CmapSubtable.newSubtable(12);cmap.platformID=3;cmap.platEncID=10;cmap.language=0;cmap.cmap={**original,**{base+i:name for i,name in enumerate(order)if i}};font['cmap'].tables=[t for t in font['cmap'].tables if(t.platformID,t.platEncID)!=(3,10)]+[cmap];target=root/'Shaping-glyphs.ttf';font.save(target)
manifest={'fontTools':version,'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'referenceSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'glyphs':len(order),'originalMappings':len(original),'referenceSelectorBase':base,'featuresDisabled':sorted({r.FeatureTag for tag in ['GSUB','GPOS']if tag in font for r in font[tag].table.FeatureList.FeatureRecord})};(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))
