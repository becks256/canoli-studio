import {useEffect,useState} from 'react';
import type {Document} from '../dom';
import type {LayerData} from '../core/model';
import {preflightOptionsSchema,type PreflightSettings} from '../core/preflight';
import type {LayerAlignment} from '../core/layer-alignment-schema';
import {Button,NumberField,Select,TextInput} from './controls';

const alignmentNames:Record<LayerAlignment,string>={left:'Left edges',center:'Horizontal centers',right:'Right edges',top:'Top edges',middle:'Vertical centers',bottom:'Bottom edges'};
function choices(nodes:readonly LayerData[],names:string[]=[],ancestors:string[]=[]):{id:string;name:string;ancestors:string[]}[]{return nodes.flatMap(node=>[{id:node.id,name:[...names,node.name].join(' / '),ancestors},...(node.kind==='group'?choices(node.children,[...names,node.name],[...ancestors,node.id]):[])]);}
export function PreflightAlignmentPolicy({owner,options,disabled,onChange}:{owner:Document;options:PreflightSettings;disabled:boolean;onChange(options:PreflightSettings):void}){
  const layers=choices(owner.getSnapshot().document.children),[ids,setIds]=useState(()=>owner.layerSelection.rootLayers.map(layer=>layer.id)),[alignment,setAlignment]=useState<LayerAlignment>('left'),[target,setTarget]=useState('canvas'),[tolerance,setTolerance]=useState(.5),[name,setName]=useState(''),[error,setError]=useState('');
  useEffect(()=>{setIds(owner.layerSelection.rootLayers.map(layer=>layer.id));setTarget('canvas');setError('');},[owner]);
  const key=target.startsWith('layer:')?target.slice(6):undefined,selected=layers.filter(layer=>ids.includes(layer.id)&&layer.id!==key),reference=key?layers.find(layer=>layer.id===key):undefined;
  const related=!!reference&&selected.some(layer=>layer.ancestors.includes(reference.id)||reference.ancestors.includes(layer.id)),rules=options.alignments??[];
  const toggle=(id:string,checked:boolean)=>{const layer=layers.find(item=>item.id===id)!;setIds(before=>checked?[...before.filter(other=>other!==id&&!layer.ancestors.includes(other)&&!layers.find(item=>item.id===other)?.ancestors.includes(id)),id]:before.filter(other=>other!==id));};
  const add=()=>{
    try{if(!selected.length)throw new Error('Choose at least one layer to check.');if(related)throw new Error('The reference must be independent of the checked layers.');
      onChange(preflightOptionsSchema.parse({...options,alignments:[...rules,{...(name.trim()?{name:name.trim()}:{}),layerIds:selected.map(layer=>layer.id),alignment,target:key?{type:'layer',id:key}:{type:'canvas'},tolerance}]}));setError('');
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
  };
  const remove=(index:number)=>{const next=rules.filter((_,i)=>i!==index);if(next.length)onChange(preflightOptionsSchema.parse({...options,alignments:next}));else{const{alignments:_removed,...legacy}=options;onChange(preflightOptionsSchema.parse(legacy));}};
  return <details className="preflight-alignment-policy">
    <summary>Alignment checks{rules.length?` (${rules.length} rule${rules.length===1?'':'s'})`:''}</summary>
    <p>Declare the alignment you expect. Checks compare authored canvas-space frames; they do not move artwork or infer design intent.</p>
    <div className="preflight-alignment-fields">
      <TextInput label="Alignment rule name" layout="stacked" value={name} disabled={disabled} onCommit={setName}/>
      <Select label="Expected alignment" layout="stacked" value={alignment} disabled={disabled} options={[{value:'left',label:'Left edges'},{value:'center',label:'Horizontal centers'},{value:'right',label:'Right edges'},{value:'top',label:'Top edges'},{value:'middle',label:'Vertical centers'},{value:'bottom',label:'Bottom edges'}]} onChange={value=>setAlignment(value as LayerAlignment)}/>
      <Select label="Alignment reference" layout="stacked" value={target} disabled={disabled} options={[{value:'canvas',label:'Canvas'},...layers.map(layer=>({value:'layer:'+layer.id,label:layer.name}))]} onChange={value=>{setTarget(value);setError('');}}/>
      <NumberField label="Alignment tolerance" layout="stacked" value={tolerance} min={0} max={Number.MAX_SAFE_INTEGER} step={.1} suffix="px" disabled={disabled} onChange={setTolerance}/>
    </div>
    <fieldset disabled={disabled}><legend>Layers to check</legend><div className="preflight-alignment-layers">{layers.map(layer=><label key={layer.id}><input type="checkbox" aria-label={`Check alignment of ${layer.name}`} checked={ids.includes(layer.id)&&layer.id!==key} disabled={layer.id===key} onChange={event=>toggle(layer.id,event.target.checked)}/><span>{layer.name}</span></label>)}</div></fieldset>
    {related&&<p role="status">Choose a reference outside the checked layers and their groups.</p>}
    {error&&<p role="alert">{error}</p>}
    <Button variant="subtle" disabled={disabled||!selected.length||related||rules.length>=32} onClick={add}>Add alignment rule</Button>
    {!selected.length&&<p>Choose one or more layers above. A key reference is excluded from the checked layers.</p>}
    {rules.length>=32&&<p role="status">The inspection policy supports 32 alignment rules. Remove a rule before adding another.</p>}
    {!!rules.length&&<ol className="preflight-alignment-rules" aria-label="Alignment rules">{rules.map((rule,index)=><li key={index}><div><strong>{rule.name??`Alignment rule ${index+1}`}</strong><p>{alignmentNames[rule.alignment]} · {rule.layerIds.length} layer{rule.layerIds.length===1?'':'s'} · {rule.target.type==='canvas'?'Canvas':layers.find(layer=>rule.target.type==='layer'&&layer.id===rule.target.id)?.name??'Missing reference'} · {rule.tolerance} px tolerance</p><details><summary>Checked layers</summary><ul>{rule.layerIds.map(id=><li key={id}>{layers.find(layer=>layer.id===id)?.name??'Missing layer'}</li>)}</ul></details></div><Button variant="subtle" disabled={disabled} onClick={()=>remove(index)}>Remove alignment rule {index+1}</Button></li>)}</ol>}
  </details>;
}
