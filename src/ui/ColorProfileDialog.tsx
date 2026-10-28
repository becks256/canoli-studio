import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {Dialog} from './Dialog';
import {Button,IconButton,Select} from './controls';
import {iccTarget,IccProfile,rgbProfileIds,type IccTarget} from '../core/color/profile-source';
import {iccIntents,type IccIntent} from '../core/color/icc-types';
import type {ColorSettings} from '../core/color/color-settings';

export interface ColorProfileDialogProps {
 settings:ColorSettings;
 warnings?:readonly string[];
 precision?:'uint8'|'float32';
 conversionIssue?:string|null;
 onConvert?(settings:ColorSettings,signal:AbortSignal):Promise<void>;
 inspect(source:Blob,name:string,signal:AbortSignal):Promise<IccProfile>;
 onApply(settings:ColorSettings,signal:AbortSignal):Promise<void>;
 onClose():void;
}
export function ColorProfileDialog({settings,warnings=[],precision='uint8',conversionIssue=null,onConvert,inspect,onApply,onClose}:ColorProfileDialogProps){
 const[editingPrecision,setEditingPrecision]=useState(precision);
 const [output,setOutput]=useState(settings.output),[proof,setProof]=useState(settings.proof??{profile:'srgb' as IccTarget,intent:'relative-colorimetric' as IccIntent,proofIntent:'relative-colorimetric' as IccIntent,blackPointCompensation:false,gamutWarning:false,warningColor:'#00ffff'});
 const [enabled,setEnabled]=useState(!!settings.proof),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [profiles,setProfiles]=useState<IccProfile[]>(()=>[...new Map([settings.output.profile,settings.proof?.profile].filter((p):p is IccProfile=>p instanceof IccProfile).map(p=>[p.sha256,p]as const)).values()]);
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 const dismiss=()=>{controller.current?.abort();onClose();};
 const choices:IccTarget[]=[...rgbProfileIds,...profiles];
 const options=(rgbOnly=false)=>choices.filter(p=>!rgbOnly||typeof p==='string'||p.report.colorSpace==='RGB ').map(p=>({value:iccTarget(p).key,label:iccTarget(p).name}));
 const resolve=(key:string)=>choices.find(p=>iccTarget(p).key===key)!;
 const intents=iccIntents.map(value=>({value,label:value.replaceAll('-',' ')}));
 async function run(action:(signal:AbortSignal)=>Promise<void>){
  if(controller.current)return;
  const abort=new AbortController();controller.current=abort;setBusy(true);setError('');
  try{await action(abort.signal);}catch(error){if(!abort.signal.aborted)setError(error instanceof Error?error.message:'Color profile could not be prepared.');}
  finally{if(controller.current===abort){controller.current=null;if(!abort.signal.aborted)setBusy(false);}}
 }
 return <Dialog titleId="color-profile-dialog-title" onClose={dismiss} className="color-profile-dialog">
  <div className="dialog-header"><h2 id="color-profile-dialog-title">Color Settings & ICC Profile</h2><IconButton label="Close" onClick={dismiss}><X size={18}/></IconButton></div>
  <div className="dialog-body color-profile-dialog-body">
   <Select label="Working precision" layout="stacked" value={editingPrecision} disabled={busy||precision==='float32'} options={[{value:'uint8',label:'8-bit sRGB'},{value:'float32',label:'32-bit linear sRGB',disabled:precision!=='float32'&&(!!conversionIssue||!onConvert)}]} onChange={value=>{setEditingPrecision(value as 'uint8'|'float32');if(value==='float32')setEnabled(false);}}/>
   {editingPrecision==='float32'?<p>Original high-precision TIFF colors remain in linear float32 through raster transforms, composition, masks, Tone, Curves, Levels and White Balance. Other color tools and layer types are unavailable. The canvas is an SDR preview. Precision changes use document Undo.</p>:<p>Editing space: sRGB, 8-bit RGBA. Output conversion and canvas proofing leave your original artwork unchanged.</p>}
   {precision==='uint8'&&conversionIssue&&<p>{conversionIssue}</p>}
   <div className="color-section">
    <Select label="Output RGB profile" layout="stacked" value={iccTarget(output.profile).key} options={options(true)} disabled={busy} onChange={key=>setOutput({...output,profile:resolve(key)})}/>
    <p>PNG, TIFF and PDF convert native-resolution RGB samples and embed this profile. Other export formats use sRGB.</p>
    <Select label="Output rendering intent" layout="stacked" value={output.intent} options={intents} disabled={busy} onChange={value=>setOutput({...output,intent:value as IccIntent})}/>
    <label className="checkbox-control"><input type="checkbox" disabled={busy} checked={output.blackPointCompensation} onChange={e=>setOutput({...output,blackPointCompensation:e.target.checked})}/>Output black point compensation</label>
   </div>
   <div className="icc-inspector-box">
    <h4>ICC profile library</h4>
    <p>Import an RGB profile for delivery or an RGB/CMYK device profile for proofing. Profiles are checked before use.</p>
    <label>Import ICC profile<input type="file" accept=".icc,.icm,application/vnd.iccprofile" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void run(async signal=>{const profile=await inspect(file,file.name,signal);signal.throwIfAborted();setProfiles(previous=>[...previous.filter(p=>p.sha256!==profile.sha256),profile]);if(profile.report.colorSpace==='RGB ')setOutput({...output,profile});else{setProof({...proof,profile});setEnabled(editingPrecision!=='float32');}});}}/></label>
    <p>Built-in RGB profiles use XYZ connections. Profile intents can fall back according to the profile’s tables.</p>
    {profiles.map(profile=><p key={profile.sha256}><strong>{profile.name}</strong> · {profile.report.deviceClass.trim()} · {profile.report.colorSpace.trim()} · {profile.report.connectionSpace.trim()} · ICC {profile.report.profileVersion}</p>)}
   </div>
   <div className="soft-proof-section">
    <h4>Canvas soft proof</h4>
    <label className="checkbox-control"><input type="checkbox" checked={enabled} disabled={busy||editingPrecision==='float32'} onChange={e=>setEnabled(e.target.checked)}/>Simulate Output Gamut (Soft Proof)</label>
    {editingPrecision==='float32'&&<p>Device proofing is unavailable in float editing.</p>}
    {enabled&&<div className="soft-proof-controls">
     <Select label="Simulated target profile" layout="stacked" value={iccTarget(proof.profile).key} options={options()} disabled={busy} onChange={key=>setProof({...proof,profile:resolve(key)})}/>
     <Select label="Display rendering intent" layout="stacked" value={proof.intent} options={intents} disabled={busy} onChange={value=>setProof({...proof,intent:value as IccIntent})}/>
     <Select label="Device proof intent" layout="stacked" value={proof.proofIntent} options={intents} disabled={busy} onChange={value=>setProof({...proof,proofIntent:value as IccIntent})}/>
     <label className="checkbox-control"><input type="checkbox" disabled={busy} checked={proof.blackPointCompensation} onChange={e=>setProof({...proof,blackPointCompensation:e.target.checked})}/>Proof black point compensation</label>
     <label className="checkbox-control gamut-warning-checkbox"><input type="checkbox" disabled={busy} checked={proof.gamutWarning} onChange={e=>setProof({...proof,gamutWarning:e.target.checked})}/>Gamut warning</label>
     {proof.gamutWarning&&<label>Warning color<input aria-label="Warning color" type="color" disabled={busy} value={proof.warningColor} onChange={e=>setProof({...proof,warningColor:e.target.value})}/></label>}
     <p>Proofing runs on the standard renderer and displays an sRGB simulation. It retains source alpha and does not affect exports. Physical print and display accuracy require measured device profiles and calibration.</p>
    </div>}
   </div>
   {warnings.map((warning,i)=><p key={i} role="status">{warning}</p>)}
   {busy&&<p role="status">Preparing color profile…</p>}
   {error&&<p role="alert">{error}</p>}
  </div>
  <div className="dialog-footer color-profile-dialog-footer"><Button variant="secondary" onClick={dismiss}>Cancel</Button><Button variant="primary" disabled={busy} onClick={()=>void run(async signal=>{const next={output,proof:enabled?proof:null};if(editingPrecision==='float32'&&precision==='uint8'){if(!onConvert)throw new Error('Float precision preparation is unavailable.');await onConvert(next,signal);}else await onApply(next,signal);signal.throwIfAborted();onClose();})}>Apply Settings</Button></div>
 </Dialog>;
}
