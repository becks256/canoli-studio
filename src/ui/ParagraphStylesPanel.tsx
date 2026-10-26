import {useEffect,useState} from 'react';
import {ParagraphStyle,type TextLayer,type ParagraphFormat} from '../dom';
import {Button,Select,TextInput} from './controls';
import {InspectorSection} from './InspectorSection';

const formatLabels:Record<keyof ParagraphFormat,string>={
  fontSize:'Font size',fontFamily:'Font family',color:'Color',align:'Alignment',lineHeight:'Line height',
  letterSpacing:'Letter spacing',wordSpacing:'Word spacing',fontKerning:'Kerning',fontWeight:'Weight',fontStyle:'Style',fontVariantCaps:'Capitals',fontStretch:'Font stretch',fontVariationSettings:'Variable axes',
  direction:'Direction',paragraphJustify:'Justification',paragraphSpacing:'Paragraph spacing',firstLineIndent:'First-line indent',
};

export function ParagraphStylesPanel({layer,disabled,onAction}:{layer:TextLayer;disabled:boolean;onAction(action:()=>void):void}){
  const document=layer.document!,styles=document.paragraphStyles.items,linked=layer.paragraphStyle;
  const [name,setName]=useState('Body'),[choice,setChoice]=useState(linked?.id??'');
  const chosen=styles.find(style=>style.id===choice),[rename,setRename]=useState(chosen?.name??'');
  const currentBase=chosen?.basedOn,[baseChoice,setBaseChoice]=useState(currentBase?.id??'');
  const children=new Map<string,string[]>();
  for(const style of styles){const parent=style.toJSON().basedOn?.id;if(parent)children.set(parent,[...(children.get(parent)??[]),style.id]);}
  const excluded=new Set<string>(),pending=chosen?[chosen.id]:[];
  for(let index=0;index<pending.length;index++){
    const id=pending[index];if(excluded.has(id))continue;excluded.add(id);pending.push(...children.get(id)??[]);
  }
  const availableBases=styles.filter(candidate=>!excluded.has(candidate.id));
  useEffect(()=>{setChoice(linked?.id??'');},[document,layer.id,linked?.id]);
  useEffect(()=>{setRename(chosen?.name??'');},[chosen?.id,chosen?.name]);
  useEffect(()=>{setBaseChoice(currentBase?.id??'');},[chosen?.id,currentBase?.id]);
  const overrideKeys=Object.keys(layer.paragraphOverrides);
  return <InspectorSection title="Paragraph styles" badge={styles.length||undefined}>
    <p className="section-description">Linked styles update text together. Local formatting stays as overrides. Frame width and content stay independent.</p>
    <Select label="Paragraph style" value={chosen?.id??''} disabled={disabled}
      options={[{value:'',label:'Choose a style'},...styles.map(style=>({value:style.id,label:style.name}))]}
      onChange={setChoice}/>
    <Button size="sm" disabled={disabled||!chosen} onClick={()=>onAction(()=>{layer.paragraphStyle=chosen!;})}>Apply paragraph style</Button>
    {linked&&<>
      <p className="section-description" role="status">Linked to {linked.name}. {overrideKeys.length?`${overrideKeys.length} local override${overrideKeys.length===1?'':'s'}: ${overrideKeys.map(key=>formatLabels[key as keyof ParagraphFormat]).join(', ')}.`:'Follows all style settings.'}</p>
      <Button size="sm" disabled={disabled||!overrideKeys.length} onClick={()=>onAction(()=>layer.resetParagraphOverrides())}>Reset style overrides</Button>
      <Button size="sm" disabled={disabled} onClick={()=>onAction(()=>{layer.paragraphStyle=null;})}>Detach paragraph style</Button>
    </>}
    {chosen&&<>
      <Select label="Base paragraph style" value={baseChoice} disabled={disabled}
        options={[{value:'',label:'Independent style'},...availableBases.map(style=>({value:style.id,label:style.name}))]} onChange={setBaseChoice}/>
      <Button size="sm" disabled={disabled||baseChoice===(currentBase?.id??'')} onClick={()=>onAction(()=>{
        chosen.basedOn=styles.find(style=>style.id===baseChoice)??null;
      })}>Set style base</Button>
      {currentBase&&<>
        <p className="section-description" role="status">Based on {currentBase.name}. {Object.keys(chosen.overrides).length} style overrides. Setting a new base inherits all its settings; detaching keeps the current format.</p>
        <Button size="sm" disabled={disabled||!Object.keys(chosen.overrides).length} onClick={()=>onAction(()=>chosen.resetOverrides())}>Reset inherited style overrides</Button>
        <p className="section-description">Update style from text captures all text settings as style overrides.</p>
      </>}
      <Button size="sm" disabled={disabled} onClick={()=>onAction(()=>{chosen.captureFrom(layer);})}>Update style from text</Button>
      <TextInput label="Style name" value={rename} maxLength={80} disabled={disabled} onChange={setRename}/>
      <Button size="sm" disabled={disabled||!rename.trim()||rename.trim()===chosen.name} onClick={()=>onAction(()=>{chosen.name=rename;})}>Rename paragraph style</Button>
      <Button size="sm" disabled={disabled} onClick={()=>onAction(()=>chosen.remove())}>Delete paragraph style</Button>
    </>}
    <TextInput label="New paragraph style name" value={name} maxLength={80} disabled={disabled||styles.length>=128} onChange={setName}/>
    <Button size="sm" disabled={disabled||!name.trim()||styles.length>=128}
      onClick={()=>onAction(()=>document.transaction('Create paragraph style',()=>{
        const style=document.paragraphStyles.add(new ParagraphStyle({name,format:layer.paragraphFormat}));layer.paragraphStyle=style;
      }))}>Create style from text</Button>
    <Button size="sm" disabled={disabled||!chosen||!name.trim()||styles.length>=128} onClick={()=>onAction(()=>document.transaction('Create based-on paragraph style',()=>{
      const style=document.paragraphStyles.add(new ParagraphStyle({name,basedOn:chosen!}));layer.paragraphStyle=style;
    }))}>Create style based on selected</Button>
  </InspectorSection>;
}
