#!/usr/bin/env python3
"""Full unmodified native Lensfun/real-GLib XML semantics, not the app parser."""
from pathlib import Path
import argparse,hashlib,json,subprocess
parser=argparse.ArgumentParser();parser.add_argument('--oracle',type=Path,required=True);args=parser.parse_args()
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/lens-xml';out.mkdir(exist_ok=True)
xml='''<!DOCTYPE lensdatabase SYSTEM "lensfun-database.dtd">
<lensdatabase version="2">
<lens><maker>Canoli Optics</maker><model>Reference 35 mm</model><mount>Canoli Test Mount</mount>
<cropfactor>1.5</cropfactor><aspect-ratio>4:3</aspect-ratio>
<calibration cropfactor="2" aspect-ratio="1.5"><distortion model="poly3" focal="35" k1="-0.02"/></calibration>
<calibration><tca model="linear" focal="35" kr="1.001"/></calibration>
<calibration cropfactor="1.5"><distortion model="poly3" focal="50"/></calibration>
</lens></lensdatabase>
'''
(out/'frame-inheritance.xml').write_text(xml)
command=[str(args.oracle.resolve()),str(out/'frame-inheritance.xml'),str(out/'legacy-collapsed.f32le'),'64','48','43','2.1','5.6','0','1.05','9','0','0','0']
subprocess.run(command,check=True)
reference=xml.replace('<cropfactor>1.5</cropfactor><aspect-ratio>4:3</aspect-ratio>','<focal min="35" max="50"/><cropfactor>2</cropfactor><aspect-ratio>1.5</aspect-ratio>').replace('<calibration cropfactor="1.5"><distortion model="poly3" focal="50"/></calibration>','')
(out/'frame-inheritance-reference.xml').write_text(reference)
command[1]=str(out/'frame-inheritance-reference.xml');command[2]=str(out/'frame-inheritance.f32le')
subprocess.run(command,check=True);body=(out/'frame-inheritance.f32le').read_bytes();assert len(body)==64*48*7*4
manifest={'generator':'Complete unmodified native Lensfun XML database/modifier and real GLib; explicit selected physical cohort avoids upstream legacy AddCalib collapse; no application parser or owned WASM core','lensfunRevision':'b98997f7f1c020d0fac3136c2abbf06126385971','oracleSha256':hashlib.sha256(args.oracle.read_bytes()).hexdigest(),'width':64,'height':48,'focalLength':43,'cropFactor':2.1,'aperture':5.6,'focusDistance':None,'scale':1.05,'sha256':hashlib.sha256(body).hexdigest(),'xmlSha256':hashlib.sha256(xml.encode()).hexdigest(),'selectedCohortReferenceSha256':hashlib.sha256(reference.encode()).hexdigest(),'legacyCollapsedDiagnosticSha256':hashlib.sha256((out/'legacy-collapsed.f32le').read_bytes()).hexdigest()}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
# Explicitly authored independent physical cohorts; native math never imports the
# app's parser, frame selection or C ABI. Global focal range spans all families.
distortion='<distortion model="poly3" focal="14" k1="-0.03"/><distortion model="poly3" focal="80" k1="-0.015"/>'
tca='<tca model="poly3" focal="35" vr="1.001" vb="0.999" cr="0.00005" cb="-0.00004"/>'
vignette=''.join(f'<vignetting model="pa" focal="{focal}" aperture="{aperture}" distance="{distance}" k1="{-0.2+focal*.0005+aperture*.001}" k2="0.02" k3="0.001"/>'for focal in[24,70]for aperture in[4,8]for distance in[1,1000])
prefix='<lensdatabase version="2"><lens><maker>Canoli Optics</maker><model>Independent calibrated family frames</model><mount>Canoli Test Mount</mount><center x="0.015" y="-0.02"/>'
original=prefix+'<cropfactor>1.5</cropfactor><calibration>'+distortion+'</calibration><calibration cropfactor="2">'+tca+'</calibration><calibration cropfactor="1.8">'+vignette+'</calibration></lens></lensdatabase>'
(out/'family-frames.xml').write_text(original+'\n')
for name,crop,points in [('distortion',1.5,distortion),('tca',2,tca),('vignette',1.8,vignette)]:
    body=prefix+f'<focal min="14" max="80"/><cropfactor>{crop}</cropfactor><calibration>'+points+'</calibration></lens></lensdatabase>'
    (out/f'family-{name}-reference.xml').write_text(body+'\n')
command=[str(args.oracle.resolve()),str(out/'family-distortion-reference.xml'),str(out/'family-frames.f32le'),'64','48','43','2.1','5.6','10','1.05','11','0','0','0','64','48',str(out/'family-tca-reference.xml'),str(out/'family-vignette-reference.xml')]
subprocess.run(command,check=True);family_body=(out/'family-frames.f32le').read_bytes();assert len(family_body)==64*48*7*4
manifest['families']={'file':'family-frames.f32le','sourceXml':'family-frames.xml','sha256':hashlib.sha256(family_body).hexdigest(),'focalLength':43,'cropFactor':2.1,'aperture':5.6,'focusDistance':10,'scale':1.05,'distortionCrop':1.5,'tcaCrop':2,'vignetteCrop':1.8,'globalFocalRange':[14,80]}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest))
