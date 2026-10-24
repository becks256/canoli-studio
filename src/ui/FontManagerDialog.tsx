import {useEffect,useId,useState,useSyncExternalStore} from 'react';
import {X} from 'lucide-react';
import type {Document} from '../dom';
import {Dialog} from './Dialog';
import {Button,IconButton,Select,TextInput} from './controls';
import {fontAvailability,type FontAvailability} from './font-availability';
import {FONT_FAMILIES} from './TypographyPanel';
import {getSystemFonts,subscribeSystemFonts,systemFonts} from './system-fonts';

export function FontManagerDialog({document:owner,onReplace,onClose}:{document:Document;onReplace(from:string,to:string,revision:number):void;onClose():void}){
  const title=useId(),live=useSyncExternalStore(owner.subscribe,owner.getSnapshot);
  const [captured,setCaptured]=useState(()=>({revision:live.revision,items:owner.fonts.items}));
  const [from,setFrom]=useState(''),[to,setTo]=useState('sans-serif'),[search,setSearch]=useState(''),[page,setPage]=useState(0);
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[allowFallback,setAllowFallback]=useState(false);
  const [availability,setAvailability]=useState<{request:string;value:FontAvailability|'checking'}>({request:'',value:'checking'});
  const [sourceAvailability,setSourceAvailability]=useState<{request:string;value:FontAvailability|'checking'}>({request:'',value:'checking'});
  const localFonts=useSyncExternalStore(subscribeSystemFonts,getSystemFonts);
  const [loadingFonts,setLoadingFonts]=useState(false);
  useEffect(()=>{
    let active=true;
    setAvailability({request:to,value:'checking'});setAllowFallback(false);
    // Avoid probing the local font service on every typed character.
    const timer=setTimeout(()=>{void fontAvailability(to).then(value=>{if(active)setAvailability({request:to,value});},()=>{if(active)setAvailability({request:to,value:'unknown'});});},120);
    return()=>{active=false;clearTimeout(timer);};
  },[to,captured]);
  useEffect(()=>{
    let active=true;setSourceAvailability({request:from,value:'checking'});
    if(from)void fontAvailability(from).then(value=>{if(active)setSourceAvailability({request:from,value});},()=>{if(active)setSourceAvailability({request:from,value:'unknown'});});
    return()=>{active=false;};
  },[from,captured]);
  const filtered=captured.items.filter(item=>item.family.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const pages=Math.max(1,Math.ceil(filtered.length/30)),currentPage=Math.min(page,pages-1),selected=captured.items.find(item=>item.family===from);
  const stale=live.revision!==captured.revision,checking=availability.request!==to||availability.value==='checking';
  const fallback=!checking&&availability.value!=='available';
  const count=(value:number,label:string)=>`${value} ${label}${value===1?'':'s'}`;
  const refresh=()=>{setCaptured({revision:owner.getSnapshot().revision,items:owner.fonts.items});setFrom('');setPage(0);setError('');setMessage('Font list refreshed. Select a request to replace.');};
  const replace=()=>{
    try{
      if(stale||owner.getSnapshot().revision!==captured.revision)throw new Error('The document changed. Refresh the font list before replacing.');
      if(!selected||!to.trim()||checking||fallback&&!allowFallback)throw new Error('Choose a font request and review its replacement availability.');
      onReplace(from,to,captured.revision);
      setCaptured({revision:owner.getSnapshot().revision,items:owner.fonts.items});setFrom('');setError('');setMessage('Font replaced. Close this dialog to use Undo.');
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));setMessage('');}
  };
  return <Dialog titleId={title} onClose={onClose} className="font-manager-dialog" localEscape>
    <div className="dialog-heading"><h2 id={title}>Document fonts</h2><IconButton label="Close document fonts" autoFocus onClick={onClose}><X size={19}/></IconButton></div>
    <p>Review exact font family requests, including fallback lists. Replacement includes hidden text, paragraph styles and every stored embedded document.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {stale&&<p role="alert">The document changed. Refresh the font list before replacing.</p>}
    <TextInput label="Search document fonts" layout="stacked" value={search} onChange={value=>{setSearch(value);setPage(0);}}/>
    <div className="font-manager-list" aria-label="Document font requests">
      {filtered.slice(currentPage*30,currentPage*30+30).map(item=><Button key={item.family} variant={from===item.family?'primary':'secondary'} aria-pressed={from===item.family} onClick={()=>{setFrom(item.family);setError('');setMessage('');}}>{item.family}</Button>)}
      {!filtered.length&&<p>{captured.items.length?'No font requests match this search.':'This document has no text or paragraph styles.'}</p>}
    </div>
    <div className="dialog-actions"><Button variant="subtle" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Previous fonts</Button><span>{filtered.length} request{filtered.length===1?'':'s'} · Page {currentPage+1} of {pages}</span><Button variant="subtle" disabled={currentPage+1>=pages} onClick={()=>setPage(currentPage+1)}>Next fonts</Button></div>
    {selected&&<p className="font-manager-summary">{selected.family}: {count(selected.textLayers,'text layer')}, {count(selected.paragraphStyles,'paragraph style')}, {count(selected.overrides,'explicit font override')}, {count(selected.embeddedScopes,'embedded document')}. {count(selected.lockedTextLayers,'locked text layer')}.</p>}
    {selected&&<p role="status">{sourceAvailability.request!==from||sourceAvailability.value==='checking'?'Checking selected font…':sourceAvailability.value==='available'?'Selected font is available in this browser.':sourceAvailability.value==='unavailable'?'Selected font is unavailable in this browser.':'Selected font availability is unknown.'}</p>}
    <Select label="Replacement font preset" layout="stacked" value={[...FONT_FAMILIES,...localFonts].includes(to)?to:''}
      options={[{value:'',label:'Custom family or fallback list'},...[...new Set([...FONT_FAMILIES,...localFonts])].map(value=>({value,label:value}))]}
      onChange={value=>{if(value)setTo(value);}}/>
    <TextInput label="Replacement font family" layout="stacked" maxLength={240} value={to} onChange={setTo}/>
    <p role="status">{checking?'Checking replacement font…':availability.value==='available'?'Replacement font is available in this browser.':availability.value==='unavailable'?'Replacement font is unavailable; the browser would use a fallback.':'Replacement availability is unknown; the browser may use fallback fonts.'}</p>
    {fallback&&<label className="checkbox-field"><input type="checkbox" checked={allowFallback} onChange={event=>setAllowFallback(event.target.checked)}/>Allow browser fallback for this replacement</label>}
    <p>Only the exact selected request changes. Inheritance and overrides are preserved. Locked text or component instances can prevent the whole replacement. Font files are not embedded.</p>
    <div className="dialog-actions"><Button variant="subtle" onClick={refresh}>Refresh font list</Button>
      <Button variant="subtle" disabled={loadingFonts||typeof(window as unknown as {queryLocalFonts?:unknown}).queryLocalFonts!=='function'} onClick={()=>{
        setLoadingFonts(true);setError('');void systemFonts().catch(cause=>setError(`Installed fonts could not be listed: ${String(cause)}`)).finally(()=>setLoadingFonts(false));
      }}>{loadingFonts?'Listing installed fonts…':'List installed fonts'}</Button>
    </div>
    <div className="dialog-actions"><Button variant="subtle" onClick={onClose}>Done</Button><Button variant="primary" disabled={!selected||!to.trim()||from===to||stale||checking||fallback&&!allowFallback} onClick={replace}>Replace font</Button></div>
  </Dialog>;
}
