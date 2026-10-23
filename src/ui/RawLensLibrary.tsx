import {useEffect,useMemo,useRef,useState} from 'react';
import type {EditorApplication} from '../editor';
import {LensProfile,type LensCorrection} from '../dom';
import type {LensCorrectionData} from '../core/interchange/raw/lens';
import type {RawImportReport} from '../core/interchange/raw/types';
import type {LensLibraryEntry} from '../core/interchange/lens/library';
import {catalogRecordId,lensIdentity,matchingCameras,suggestedLenses} from '../core/interchange/lens/matching';
import {Button,Select,TextInput} from './controls';
import {download} from './utils';

export function RawLensLibrary({editor,report,lens,disabled,onSelect,onBusyChange}:{editor:EditorApplication;report:Readonly<RawImportReport>;lens:LensCorrectionData|undefined;disabled:boolean;onSelect(value:LensCorrection):void;onBusyChange(value:boolean):void}){
  const [entries,setEntries]=useState<readonly LensLibraryEntry[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [databaseId,setDatabaseId]=useState(lens?.profile?.definition.source?.sha256??''),[profileId,setProfileId]=useState(''),[cameraId,setCameraId]=useState(''),[search,setSearch]=useState('');
  const [focal,setFocal]=useState(String(lens?.profile?.focalLength??report.shooting?.focalLength??'')),[crop,setCrop]=useState(String(lens?.profile?.cropFactor??''));
  const pending=useRef<AbortController|null>(null),alive=useRef(true),input=useRef<HTMLInputElement>(null),busyCallback=useRef(onBusyChange);busyCallback.current=onBusyChange;
  const catalogs=useMemo(()=>entries.flatMap(entry=>entry.catalog?[entry.catalog]:[]),[entries]),database=catalogs.find(catalog=>catalog.source.sha256===databaseId),cameras=useMemo(()=>catalogs.flatMap(catalog=>catalog.cameras.filter(camera=>!camera.issues.length&&camera.cropFactor!==null).map(camera=>({id:catalogRecordId(catalog,camera.index),catalog,camera}))),[catalogs]);
  const camera=cameras.find(candidate=>candidate.id===cameraId),matches=useMemo(()=>matchingCameras(catalogs,report),[catalogs,report]),suggestions=useMemo(()=>suggestedLenses(catalogs,report,camera),[catalogs,report,camera]),selected=database?.lenses.find(candidate=>catalogRecordId(database,candidate.index)===profileId);
  const selectedEntry=entries.find(entry=>entry.catalog===database),query=lensIdentity(search),visible=database?.lenses.filter(candidate=>!query||lensIdentity([candidate.maker,candidate.model,...candidate.modelAliases].join(' ')).includes(query))??[];
  const suggestion=suggestions.find(candidate=>candidate.id===profileId),compatibility=(value:boolean|null)=>value===null?'unknown':value?'compatible':'not matched';
  // Preserve an explicit selection when filtering; never let a native select
  // silently display a different first result for the selected resource.
  if(selected&&!visible.includes(selected))visible.unshift(selected);
  useEffect(()=>{
    alive.current=true;const abort=new AbortController();pending.current=abort;setLoading(true);
    void editor.lensProfiles.list({signal:abort.signal}).then(value=>{if(!abort.signal.aborted&&alive.current){setEntries(value);setLoading(false);}},cause=>{if(!abort.signal.aborted&&alive.current){setError(cause instanceof Error?cause.message:String(cause));setLoading(false);}});
    return()=>{alive.current=false;pending.current?.abort();};
  },[editor]);
  const run=async(work:(signal:AbortSignal)=>Promise<void>,refresh=true)=>{
    pending.current?.abort();const abort=new AbortController();pending.current=abort;setBusy(true);setError('');busyCallback.current(true);
    try{await work(abort.signal);if(refresh){const value=await editor.lensProfiles.list({signal:abort.signal});if(!abort.signal.aborted&&alive.current)setEntries(value);}}
    catch(cause){if(!abort.signal.aborted&&alive.current)setError(cause instanceof Error?cause.message:String(cause));}
    finally{if(alive.current){setBusy(false);setLoading(false);busyCallback.current(false);}if(pending.current===abort)pending.current=null;}
  };
  const importFiles=(files:File[])=>run(async signal=>{
    for(const file of files){signal.throwIfAborted();const installed=await editor.lensProfiles.install(file,file.name,{signal});if(alive.current&&!signal.aborted){setEntries(previous=>[...previous.filter(entry=>entry.key!==installed.source.sha256),Object.freeze({key:installed.source.sha256,source:installed.source,catalog:installed,error:'',recoverable:true})]);setDatabaseId(installed.source.sha256);setProfileId('');setSearch('');}}
  });
  const chooseCamera=(id:string)=>{setCameraId(id);const entry=cameras.find(candidate=>candidate.id===id);setCrop(entry?String(entry.camera.cropFactor):'');};
  let selectionIssue='';
  if(selected?.definition){
    if(![focal,crop].every(text=>text.trim()&&Number.isFinite(Number(text))&&Number.isFinite(Math.fround(Number(text)))&&Math.fround(Number(text))>0))selectionIssue='Enter a positive focal length and a calibrated or measured camera crop factor.';
  }
  const useProfile=()=>run(async signal=>{
    if(!selected?.definition||!selectedEntry||!database)throw new Error('Choose an available lens profile.');
    const id=selected.index,expected=database.source.sha256,focalLength=Number(focal),cropFactor=Number(crop),scale=lens?.scale??1;
    const definition=await editor.lensProfiles.profile(selectedEntry.key,id,{signal});signal.throwIfAborted();
    if(definition.source?.sha256!==expected)throw new Error('The selected lens database changed. Refresh and retry.');
    onSelect(new LensProfile(definition).correction({focalLength,cropFactor,scale,chromatic:report.channels!==1&&definition.calibrations.some(frame=>frame.chromatic.some(point=>point.model!=='none')),aperture:report.shooting?.aperture??null}));
  },false);
  return <details><summary>Local lens profile library</summary>
    <p>Add Lensfun XML files stored on your device. Library imports persist independently of this RAW draft; Cancel discards image choices. Choosing a profile never changes pixels until you preview or apply development.</p>
    <input ref={input} type="file" accept=".xml,application/xml,text/xml" multiple hidden disabled={disabled||busy} aria-label="Import lens databases" onChange={event=>{const files=[...(event.target.files??[])];event.target.value='';if(files.length&&!disabled&&!busy)void importFiles(files);}}/>
    <div className="dialog-actions"><Button disabled={disabled||busy} onClick={()=>input.current?.click()}>Add local lens database…</Button><Button disabled={disabled||busy} onClick={()=>void run(async()=>{})}>Refresh lens library</Button>{busy&&<Button onClick={()=>pending.current?.abort()}>Cancel library operation</Button>}</div>
    {(loading||busy)&&<p role="status">{busy?'Preparing lens library…':'Reading local lens databases…'}</p>}
    {error&&<p role="alert">{error}</p>}
    <Select layout="stacked" label="Lens database" value={databaseId} disabled={disabled||busy} options={[{value:'',label:'Choose a database'},...catalogs.map(catalog=>({value:catalog.source.sha256,label:`${catalog.source.name} · ${catalog.source.sha256.slice(0,8)}`}))]} onChange={id=>{setDatabaseId(id);setProfileId('');setSearch('');}}/>
    {!!entries.length&&<details><summary>Installed databases and recovery</summary><ul>{entries.map((entry,index)=><li key={index}>
      <p><strong>{entry.source?.name??'Unrecognized database record'}</strong>{entry.source&&<> · {entry.source.byteLength.toLocaleString()} bytes<br/><code>{entry.source.sha256}</code></>}{entry.error&&<> · {entry.error}</>}</p>
      <Button disabled={disabled||busy||!entry.recoverable} onClick={()=>void run(async signal=>{const original=await editor.lensProfiles.original(entry.key,{signal});signal.throwIfAborted();download(original.blob,original.name);if(!original.verified&&alive.current)setError(original.error||'Downloaded available recovery bytes; source identity is unverified.');},false)}>Download original {entry.source?.name??'database'}</Button>
      <Button variant="danger" disabled={disabled||busy} onClick={()=>void run(async signal=>{await editor.lensProfiles.remove(entry.key,{signal});if(entry.source?.sha256===databaseId){setDatabaseId('');setProfileId('');}})}>Remove {entry.source?.name??'database record'}</Button>
    </li>)}</ul><Button variant="danger" disabled={disabled||busy} onClick={()=>void run(async signal=>{await editor.lensProfiles.clear({signal});setDatabaseId('');setProfileId('');setCameraId('');})}>Clear lens library</Button></details>}
    {database&&<>
      <p>Original: {database.source.name} · {database.lenses.filter(candidate=>candidate.definition).length} available profiles, {database.lenses.filter(candidate=>!candidate.definition).length} unavailable. <code>{database.source.sha256}</code></p>
      <TextInput layout="stacked" label="Search local lenses" value={search} disabled={disabled||busy} onChange={setSearch}/>
      <Select layout="stacked" label="Lens profile" value={profileId} disabled={disabled||busy} options={[{value:'',label:'Choose a lens explicitly'},...visible.map(candidate=>({value:catalogRecordId(database,candidate.index),label:`${candidate.maker} ${candidate.model}${candidate.definition?' · calibration crop '+[...new Set(candidate.definition.calibrations.map(frame=>frame.cropFactor))].join('/') :''}${suggestions.some(suggestion=>suggestion.id===catalogRecordId(database,candidate.index)&&suggestion.exact)?' · metadata match':''}${candidate.definition?'':' · unavailable'}`,disabled:!candidate.definition}))]} onChange={setProfileId}/>
      {database.lenses.some(candidate=>candidate.issues.length>0)&&<details><summary>Unavailable profiles</summary><ul>{database.lenses.filter(candidate=>candidate.issues.length>0).map(candidate=><li key={candidate.index}><strong>{candidate.maker} {candidate.model}</strong>: {candidate.issues.join(' ')}</li>)}</ul></details>}
      <Select layout="stacked" label="Camera calibration" value={cameraId} disabled={disabled||busy} options={[{value:'',label:'Enter camera crop factor manually'},...cameras.map(candidate=>({value:candidate.id,label:`${candidate.camera.maker} ${candidate.camera.model}${candidate.camera.variant?' · '+candidate.camera.variant:''} · ${candidate.camera.cropFactor} · ${candidate.catalog.source.name}`}))]} onChange={chooseCamera}/>
      {matches.length===1&&<Button disabled={disabled||busy} onClick={()=>chooseCamera(matches[0].id)}>Use matched camera calibration</Button>}
      {matches.length>1&&<p>Multiple camera declarations match the recorded metadata. Review and choose the calibrated camera explicitly.</p>}
      <TextInput layout="stacked" label="Lens selection focal length" type="number" step="any" value={focal} disabled={disabled||busy} onChange={setFocal} suffix="mm"/>
      <TextInput layout="stacked" label="Lens selection camera crop factor" type="number" step="any" value={crop} disabled={disabled||busy} onChange={value=>{setCameraId('');setCrop(value);}}/>
      <p>Use recorded focal length or enter a measured value. Camera crop must come from a reviewed camera declaration or your measurement; the calibration lens crop and rounded 35 mm-equivalent focal length are separate.</p>
      {selected?.definition&&<p>Selected: {selected.definition.maker} {selected.definition.model}. Vignetting starts off; review aperture and focus distance in the profile controls after choosing it.</p>}
      {suggestion&&<p>{suggestion.exact?'Recorded lens identity matches.':'Recorded lens identity shares terms; review the model.'} Mount: {compatibility(suggestion.mountCompatible)}. Calibration crop: {compatibility(suggestion.cropCompatible)}. Recorded focal range: {compatibility(suggestion.focalCompatible)}. These declarations guide review; native validation still checks the requested correction.</p>}
      {selected&&selectionIssue&&<p role="alert">{selectionIssue}</p>}
      <Button disabled={disabled||busy||!selected?.definition||!!selectionIssue} onClick={()=>void useProfile()}>Use selected lens profile</Button>
    </>}
  </details>;
}
