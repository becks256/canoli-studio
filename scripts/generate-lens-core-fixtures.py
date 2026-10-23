"""Independent native Lensfun XML/parser/modifier fixtures; no app code used."""
from pathlib import Path
import argparse,hashlib,json,subprocess,xml.etree.ElementTree as ET

parser=argparse.ArgumentParser();parser.add_argument('--oracle',type=Path,required=True);args=parser.parse_args()
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/lens-core';out.mkdir(exist_ok=True)
profiles={}
for model in ['poly3','poly5','ptlens']:
    profile={'version':1,'maker':'Canoli Optics','model':'Canoli Reference 24-70mm F2.8','type':'rectilinear','mounts':['Canoli Test Mount'],'center':{'x':.02,'y':-.01},'focalRange':{'min':24,'max':70},'calibrations':[]}
    elements=['<!DOCTYPE lensdatabase SYSTEM "lensfun-database.dtd">','<lensdatabase version="2">','<mount><name>Canoli Test Mount</name></mount>','<camera><maker>Canoli synthetic</maker><model>Independent DNG fixture</model><mount>Canoli Test Mount</mount><cropfactor>1.5</cropfactor></camera>','<lens><maker>Canoli Optics</maker><model>Canoli Reference 24-70mm F2.8</model><mount>Canoli Test Mount</mount><cropfactor>1.5</cropfactor><aspect-ratio>1.5</aspect-ratio><center x="0.02" y="-0.01"/><focal min="24" max="70"/>']
    for crop in [1.5,2]:
        frame={'cropFactor':crop,'aspectRatio':1.5,'distortion':[],'chromatic':[],'vignette':[]};elements.append(f'<calibration cropfactor="{crop}" aspect-ratio="1.5">')
        for index,focal in enumerate([24,35,50,70]):
            terms=[-.05+index*.009]if model=='poly3'else[-.04+index*.007,.003]if model=='poly5'else[.012-index*.002,-.045+index*.008,.015-index*.002]
            if crop==2:terms=[term*.7 for term in terms]
            frame['distortion'].append({'model':model,'focalLength':focal,'terms':terms});names=['k1']if model=='poly3'else['k1','k2']if model=='poly5'else['a','b','c'];attributes=' '.join(f'{name}="{value}"'for name,value in zip(names,terms));elements.append(f'<distortion model="{model}" focal="{focal}" {attributes}/>')
            tca=[1.001+index*.00003,.999-index*.00002,.00005,-.00004,.00001,-.00002]
            if crop==2:tca=[1+(value-1)*.6 if i<2 else value*.6 for i,value in enumerate(tca)]
            frame['chromatic'].append({'model':'poly3','focalLength':focal,'terms':tca});attributes=' '.join(f'{name}="{value}"'for name,value in zip(['vr','vb','cr','cb','br','bb'],tca));elements.append(f'<tca model="poly3" focal="{focal}" {attributes}/>')
            for aperture in [4,8]:
                for distance in [1,1000]:
                    vignette=[-.18+index*.009+(aperture-4)*.003,.02,.001]
                    if crop==2:vignette=[value*.5 for value in vignette]
                    frame['vignette'].append({'model':'pa','focalLength':focal,'aperture':aperture,'focusDistance':distance,'terms':vignette});attributes=' '.join(f'{name}="{value}"'for name,value in zip(['k1','k2','k3'],vignette));elements.append(f'<vignetting model="pa" focal="{focal}" aperture="{aperture}" distance="{distance}" {attributes}/>')
        elements.append('</calibration>');profile['calibrations'].append(frame)
    elements.append('</lens></lensdatabase>');xml=out/(model+'.xml');xml.write_text('\n'.join(elements)+'\n');profiles[model]=profile
    # The pinned complete library's AddCalib path collapses all frames for
    # legacy compatibility. Reference each declared physical cohort separately,
    # preserving the global explicitly declared focal range. No app code is used.
    for crop in [1.5,2]:
        tree=ET.fromstring(xml.read_text());lens=tree.find('lens');lens.find('cropfactor').text=str(crop)
        for frame in list(lens.findall('calibration')):
            if float(frame.get('cropfactor'))!=crop:lens.remove(frame)
        ET.indent(tree);ET.ElementTree(tree).write(out/f'native-reference-{model}-{crop}.xml',encoding='utf-8',xml_declaration=True)
cases=[]
for model in profiles:
    for name,focal,crop,aperture,distance,flip,geometry,left,top in [
        ('exact',35,1.5,4,1,0,(64,48),0,0),('interpolated',43,1.5,5.6,10,0,(64,48),0,0),('crop',43,2.1,5.6,0,0,(64,48),0,0),('oriented',43,1.5,5.6,10,6,(48,64),0,0),('native-50mp',43,1.5,5.6,10,0,(10000,5000),8192,3072)]:
        # Oriented small cases still request a valid 64x48 ROI: use 96x128.
        if flip:geometry=(96,128)
        file=f'{model}-{name}.f32le';width,height=geometry
        cohort=2 if crop==2.1 else 1.5
        reference_xml=out/f'native-reference-{model}-{cohort}.xml'
        command=[str(args.oracle.resolve()),str(reference_xml),str(out/file),str(width),str(height),str(focal),str(crop),str(aperture),str(distance),'1.05','11',str(flip),str(left),str(top)];subprocess.run(command,check=True)
        body=(out/file).read_bytes();assert len(body)==64*48*7*4
        cases.append({'file':file,'model':model,'width':width,'height':height,'left':left,'top':top,'focalLength':focal,'cropFactor':crop,'aperture':aperture,'focusDistance':None if distance==0 else distance,'scale':1.05,'flip':flip,'referenceXml':reference_xml.name,'calibrationCropFactor':cohort,'sha256':hashlib.sha256(body).hexdigest()})
(out/'manifest.json').write_text(json.dumps({'generator':'Complete native Lensfun XML database/modifier plus real GLib; no owned core or application parser','profiles':profiles,'cases':cases},indent=2)+'\n');print(json.dumps({'fixtures':len(cases),'directory':str(out)}))
