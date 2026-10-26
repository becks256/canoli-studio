import {RecipeRecorder} from '../src/ai/recipes/recorder';
import {executeRecipe} from '../src/ai/recipes/executor';
import {preflightDocumentView} from '../src/core/preflight-view';
import {expect,it} from 'vitest';
import {Document,TextLayer,TextPath,LayerGroup} from '../src/dom';
import {SCHEMA_VERSION,validateDocument} from '../src/core/model';
import {localBounds} from '../src/core/spatial';
import {parseCommands} from '../src/core/validation';

const baseline=()=>new TextPath({points:[{x:24,y:150,in:{x:24,y:150},out:{x:100,y:30}},{x:420,y:150,in:{x:340,y:30},out:{x:420,y:150}}]});
it('owns an immutable baseline value and attaches it through one shared history command',()=>{
 const doc=new Document(),layer=doc.layers.add(new TextLayer({text:'AAAA',fontSize:36})),before=doc.toJSON(),path=baseline(),data=path.toJSON();data.points[0].x=999;expect(path.points[0].x).toBe(24);expect(Object.isFrozen(path)).toBe(true);
 layer.textPath=path;const attached=layer.toJSON();expect(attached.kind).toBe('text');if(attached.kind!=='text')throw new Error('Missing text');expect(attached.textPath).toEqual(path.toJSON());expect(attached.textPathOrigin).toBeDefined();expect(localBounds(attached)).toEqual({...attached.textPathOrigin,width:attached.width,height:attached.height});
 doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(layer.textPath?.toJSON()).toEqual(path.toJSON());
});
it('retains authored coordinates and canvas placement when text metrics change',()=>{
 const doc=new Document(),layer=doc.layers.add(new TextLayer({text:'AAAA',fontSize:36,textPath:baseline(),x:100,y:120})),path=layer.textPath!.toJSON(),before=layer.toJSON();layer.fontSize=72;expect(layer.textPath!.toJSON()).toEqual(path);expect(layer.x).toBe(100);expect(layer.y).toBe(120);expect(layer.toJSON()).not.toEqual(before);doc.undo();expect(layer.toJSON()).toEqual(before);
});
it('retains an owned baseline through detached values, copy-on-read and serialization',()=>{
 const doc=new Document(),layer=doc.layers.add(new TextLayer({text:'AB',textPath:baseline()})),snapshot=doc.toJSON(),copy=Document.fromJSON(snapshot).getLayer(layer.id)as TextLayer;
 const points=copy.textPath!.points;points[0].x=999;expect(copy.textPath!.points[0].x).toBe(24);expect(copy.textPath!.with({reverse:true,startOffset:-12}).toJSON()).toMatchObject({reverse:true,startOffset:-12});expect(layer.textPath!.reverse).toBe(false);expect(doc.toJSON().schemaVersion).toBe(SCHEMA_VERSION);
});
it('gates both path and derived-origin fields at schema 46 while preserving older text',()=>{
 const old=new Document();old.layers.add(new TextLayer({text:'Legacy'}));const legacy=old.toJSON();legacy.schemaVersion=45;expect(()=>validateDocument(legacy)).not.toThrow();
 const doc=new Document();doc.layers.add(new TextLayer({text:'Path',textPath:baseline()}));const input=doc.toJSON();input.schemaVersion=45;expect(()=>validateDocument(input)).toThrow('46');
 const absent=doc.toJSON();const text=absent.children[0];if(text.kind!=='text')throw new Error('Missing text');delete text.textPathOrigin;expect(()=>validateDocument(absent)).toThrow('frame origin');
});
it('clears incompatible paragraph layout atomically and rejects invalid source/locks without edits',()=>{
 const doc=new Document(),layer=doc.layers.add(new TextLayer({text:'AA AA',wrapWidth:80,paragraphSpacing:20,firstLineIndent:5,paragraphJustify:'inter-word'})),before=doc.toJSON();layer.textPath=baseline();expect(layer.wrapWidth).toBeUndefined();expect(layer.paragraphSpacing).toBe(0);doc.undo();expect(doc.toJSON()).toEqual(before);
 layer.locked=true;const locked=doc.toJSON();expect(()=>{layer.textPath=baseline();}).toThrow();expect(doc.toJSON()).toEqual(locked);
 const plain=new TextLayer({text:'A\nB'});expect(()=>{plain.textPath=baseline();}).toThrow('logical line');expect(plain.textPath).toBeNull();
});
it('accepts only geometry through external commands, never client-authored frame caches',()=>{
 const doc=new Document(),text=doc.layers.add(new TextLayer({text:'AA'}));const command=parseCommands([{type:'layer.update',id:text.id,patch:{textPath:baseline().toJSON()}}])[0];doc._dispatch(command);expect(text.textPath).not.toBeNull();
 expect(()=>parseCommands([{type:'layer.update',id:text.id,patch:{textPathOrigin:{x:0,y:0}}}])).toThrow();const group=doc.layers.add(new LayerGroup());expect(()=>group.update({textPath:baseline().toJSON()})).toThrow('text layer');
});
it('native preparation remains outside synchronous transactions and stale edits never retarget text',async()=>{
 const doc=new Document(),text=doc.layers.add(new TextLayer({text:'AAAA'}));let resume!:(value:{width:number;height:number;origin:{x:number;y:number}})=>void;
 doc._prepareTextLayout=()=>new Promise(resolve=>{resume=resolve;});const pending=text.setTextPath(baseline());doc.name='Newer edit';resume({width:100,height:50,origin:{x:24,y:30}});await expect(pending).rejects.toThrow('changed');expect(text.textPath).toBeNull();
 let rejected!:Promise<void>;doc.transaction('Invalid preparation',()=>{rejected=text.setTextPath(baseline());});await expect(rejected).rejects.toThrow('outside synchronous');
});

it('records geometry without copying text, formatting or mutable frame caches onto semantic receiving text',async()=>{
 const source=new Document(),text=source.layers.add(new TextLayer({name:'Recipe title',text:'AAAA'})),recorder=new RecipeRecorder();recorder.start();const stop=source.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));await text.setTextPath(baseline());stop();const recipe=recorder.stop({name:'Native path recipe'}),target=new Document(),copy=target.layers.add(new TextLayer({name:'Recipe title',text:'Receiving copy',characterRanges:[{start:0,end:3,format:{color:'red'}}]})),before=target.toJSON();expect(executeRecipe(recipe,target).success).toBe(true);expect(copy.textPath!.toJSON()).toEqual(text.textPath!.toJSON());expect(copy.text).toBe('Receiving copy');expect(copy.characterRanges).toEqual([{start:0,end:3,format:{color:'red'}}]);expect(copy.toJSON()).toMatchObject({textPathOrigin:expect.any(Object)});target.undo();expect(target.toJSON()).toEqual(before);
});
it('keeps measured origins in compact design checks without posting baseline geometry to the worker',()=>{
 const doc=new Document(),text=doc.layers.add(new TextLayer({text:'AAAA',textPath:baseline()})),view=preflightDocumentView(doc.toJSON());expect(view.children[0]).toMatchObject({textPathOrigin:(text.toJSON()as import('../src/core/model').TextLayerData).textPathOrigin});expect(view.children[0]).not.toHaveProperty('textPath');
});

it('rejects XML controls and unpaired surrogates in explicitly native straight text at admission',()=>{
 for(const value of ['A\0B','\ud800','\ufffe']){const doc=new Document();doc.layers.add(new TextLayer({text:'A'}));const input=doc.toJSON(),text=input.children[0];if(text.kind!=='text')throw new Error('Missing text');text.text=value;const legacy=structuredClone(input);legacy.schemaVersion=45;expect(()=>validateDocument(legacy)).not.toThrow();text.textPath=null;expect(()=>validateDocument(input)).toThrow('XML controls or unpaired surrogates');}
});
