import {useEffect,useState} from 'react';
import {ParagraphStyle,type TextLayer,type ParagraphFormat} from '../dom';
import {Button,Select,TextInput} from './controls';
import {InspectorSection} from './InspectorSection';

const formatLabels:Record<keyof ParagraphFormat,string>={
  fontSize:'Font size',fontFamily:'Font family',color:'Color',align:'Alignment',lineHeight:'Line height',
  letterSpacing:'Letter spacing',wordSpacing:'Word spacing',fontKerning:'Kerning',fontWeight:'Weight',fontStyle:'Style',
  direction:'Direction',paragraphJustify:'Justification',paragraphSpacing:'Paragraph spacing',firstLineIndent:'First-line indent',
};

export function ParagraphStylesPanel({layer,disabled,onAction}:{layer:TextLayer;disabled:boolean;onAction(action:()=>void):void}){
  const document=layer.document!,styles=document.paragraphStyles.items,linked=layer.paragraphStyle;
  const [name,setName]=useState('Body'),[choice,setChoice]=useState(linked?.id??'');
  const chosen=styles.find(style=>style.id===choice),[rename,setRename]=useState(chosen?.name??'');
  useEffect(()=>{setChoice(linked?.id??'');},[document,layer.id,linked?.id]);
  useEffect(()=>{setRename(chosen?.name??'');},[chosen?.id,chosen?.name]);
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
  </InspectorSection>;
}
