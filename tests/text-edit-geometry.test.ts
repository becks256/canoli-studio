import {expect,it} from 'vitest';
import {Document,TextLayer,ParagraphStyle,AffineTransform,LayerStyle} from '../src/dom';
import type {LayerPatch} from '../src/core/commands';
import legacy from './fixtures/typography/schema-41-linked.json';
import {RecipeRecorder,executeRecipe} from '../src/ai/recipes';

function imported(){
 const data=new Document({width:300,height:200}).toJSON();
 data.children=[0,40,150].map((x,index)=>({...new TextLayer({name:'Imported '+index,text:'A',x,y:20}).toJSON(),width:20,height:20}));
 return Document.fromJSON(data);
}
for(const [name,patch]of Object.entries({move:{x:75,y:45},rename:{name:'Renamed'},opacity:{opacity:.5,fillOpacity:.7},visibility:{visible:false},lock:{locked:true},blend:{blendMode:'multiply'},color:{color:'#2050a0'},alignment:{align:'right'},transform:{transform:new AffineTransform(0,1,-1,0).toJSON()},style:{styles:new LayerStyle().toJSON()},empty:{}})as [string,LayerPatch][]){
 it(`preserves imported authored text geometry during ${name} and restores it exactly through undo`,()=>{
  const document=imported(),text=document.layers.at(1)as TextLayer,before=document.toJSON();text.update(patch);
  expect(text.width).toBe(20);expect(text.height).toBe(20);expect(text.text).toBe('A');
  expect(text.toJSON()).toEqual({...before.children[1],...patch});
  if(JSON.stringify(document.toJSON())!==JSON.stringify(before)){document.undo();expect(document.toJSON()).toEqual(before);}
 });
}
for(const operation of ['distribute','flip']as const)it(`preserves every imported text frame during ${operation}`,()=>{
 const document=imported(),before=document.toJSON();document.selectLayers([...document.layers]);
 if(operation==='distribute')document.layerSelection.distribute('horizontal','gaps');else document.layerSelection.flip('horizontal');
 for(const layer of document.layers){expect((layer as TextLayer).width).toBe(20);expect((layer as TextLayer).height).toBe(20);}
 if(operation==='distribute')expect(document.layers.at(1)!.x).toBe(75);
 document.undo();expect(document.toJSON()).toEqual(before);
});
it('retains legacy cached style fields and sparse overrides during unrelated edits',()=>{
 const document=Document.fromJSON(legacy),text=document.layers.at(0)as TextLayer,before=text.toJSON();
 text.name='Renamed';expect(text.toJSON()).toEqual({...before,name:'Renamed'});document.undo();expect(text.toJSON()).toEqual(before);
});
it('updates color/alignment overrides without measuring text and still resolves cleared metric overrides',()=>{
 const document=imported(),text=document.layers.at(1)as TextLayer,style=document.paragraphStyles.add(new ParagraphStyle({format:{fontSize:18}}));text.paragraphStyle=style;
 const data=document.toJSON();if(data.children[1].kind!=='text')throw Error('Missing text');data.children[1].width=20;data.children[1].height=20;
 const restored=Document.fromJSON(data),copy=restored.layers.at(1)as TextLayer;
 copy.color='#2050a0';copy.align='right';expect([copy.width,copy.height]).toEqual([20,20]);expect(copy.paragraphOverrides).toEqual({color:'#2050a0',align:'right'});
 copy.fontSize=27;expect(copy.fontSize).toBe(27);copy.update({fontSize:undefined});expect(copy.fontSize).toBe(18);expect(copy.paragraphOverrides).toEqual({color:'#2050a0',align:'right'});expect(copy.height).not.toBe(20);
});
for(const patch of [{text:'A'},{fontSize:48},{fontFamily:'monospace'},{lineHeight:2},{letterSpacing:4},{wordSpacing:4},{fontKerning:'none'},{fontVariantCaps:'normal'},{fontStretch:'normal'},{fontWeight:'600'},{fontStyle:'italic'},{direction:'rtl'},{wrapWidth:64},{paragraphSpacing:8},{firstLineIndent:4},{paragraphJustify:'inter-word'},{width:200,height:100}]as LayerPatch[]){
 it(`continues explicit text reflow for ${Object.keys(patch).join('/')}`,()=>{
  const document=imported(),text=document.layers.at(1)as TextLayer;text.update(patch);expect([text.width,text.height]).not.toEqual([20,20]);
  if('wrapWidth'in patch)expect(text.width).toBe(64);
 });
}
it('keeps same-text reflow explicit and preserves atomic rollback of invalid typography',()=>{
 const document=imported(),text=document.layers.at(1)as TextLayer,before=document.toJSON();text.reflow();expect([text.width,text.height]).not.toEqual([20,20]);document.undo();expect(document.toJSON()).toEqual(before);
 expect(()=>document.transaction('Rejected typography',()=>{text.opacity=.5;text.fontSize=0;})).toThrow();expect(document.toJSON()).toEqual(before);
});
it('replays ordinary appearance edits through semantic recipes without remeasuring recipient text',()=>{
 const document=imported(),text=document.layers.at(1)as TextLayer,recorder=new RecipeRecorder();recorder.start();const stop=document.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));text.opacity=.5;stop();
 const recipe=recorder.stop(),recipient=imported(),before=recipient.toJSON();expect(executeRecipe(recipe,recipient).success).toBe(true);expect(recipient.layers.at(1)!.toJSON()).toEqual({...before.children[1],opacity:.5});recipient.undo();expect(recipient.toJSON()).toEqual(before);
});
