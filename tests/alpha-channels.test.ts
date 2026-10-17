import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {Document,AlphaChannel,MarqueeSelection,AffineTransform,AdjustmentLayer,defaultLutAdjustment} from '../src/dom';
import {validateDocument,createDocument,SCHEMA_VERSION} from '../src/core/model';
import {parseCommands} from '../src/core/validation';
import {execute} from '../src/core/commands';
import {composeChannelSelection} from '../src/engine/channel-selection';
import {instantiateKernel,renderSelection,type PixelKernel} from '../src/engine/wasm';
import {RecipeRecorder,executeRecipe} from '../src/ai/recipes';
import {getExportCapabilityReport} from '../src/engine/export';
let kernel:PixelKernel;
beforeAll(async()=>{kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));});
const rectangle=(x=0,width=4)=>new MarqueeSelection({shape:'rectangle',x,y:0,width,height:1});
const fractional=()=>new MarqueeSelection({shape:'pixels',x:0,y:0,width:4,height:1,coverage:{width:4,height:1,runs:[4,128]}});
const alpha=(selection:any,width=4,height=1)=>Array.from(renderSelection(kernel,{selection,width,height,x:0,y:0,stepX:1,stepY:1})).filter((_,i)=>i%4===3);
function bind(doc:Document){doc._prepareChannelLoad=(settings,control)=>composeChannelSelection(kernel,{operation:settings.operation,invert:settings.invert,selection:doc.alphaChannels.getById(settings.id)!.selection.toJSON(),base:doc.selection?.toJSON()??null,width:doc.width,height:doc.height},control.onProgress);}

it('alpha channels retain independent constructor data, stable owned handles, history and transaction rollback',()=>{
  const doc=new Document({width:4,height:1}),other=new Document(),initial=rectangle(),channel=new AlphaChannel({name:'Saved',selection:initial});
  expect(()=>doc.alphaChannels.capture()).toThrow(/selection/);expect(()=>doc.alphaChannels.add({} as any)).toThrow(/constructor/);
  const before=doc.toJSON();doc.alphaChannels.add(channel);expect(doc.alphaChannels.length).toBe(1);
  expect(()=>other.alphaChannels.add(channel)).toThrow(/attached/);const saved=channel.toJSON();saved.selection.regions.length=0;expect(channel.selection.regions).toHaveLength(1);
  channel.name='Renamed';expect(doc.alphaChannels.getById(channel.id)!.name).toBe('Renamed');doc.undo();expect(channel.name).toBe('Saved');
  channel.remove();expect(()=>channel.name).toThrow(/no longer/);doc.undo();expect(channel.name).toBe('Saved');
  doc.undo();expect(doc.toJSON()).toEqual(before);doc.redo();expect(channel.name).toBe('Saved');
  const checkpoint=doc.toJSON();expect(()=>doc.transaction('Discard',()=>{channel.name='Discard';channel.name='';})).toThrow();expect(doc.toJSON()).toEqual(checkpoint);
  expect(()=>new AlphaChannel({selection:{} as any})).toThrow(/MarqueeSelection/);
});

it('capture, update, duplicate and reorder isolate saved coverage from current selection and each other',()=>{
  const doc=new Document({width:4,height:1});doc.selection=fractional();const a=doc.alphaChannels.capture('Soft');doc.selection=rectangle(1,2);
  expect(a.selection.toJSON()).toEqual(fractional().toJSON());const b=a.duplicate();expect(b.id).not.toBe(a.id);expect(b.name).toBe('Soft copy');
  b.captureSelection();expect(b.selection.toJSON()).toEqual(rectangle(1,2).toJSON());expect(a.selection.toJSON()).toEqual(fractional().toJSON());
  b.move('up');expect(doc.alphaChannels.at(0)!.id).toBe(b.id);doc.undo();expect(doc.alphaChannels.at(0)!.id).toBe(a.id);
  const checkpoint=doc.toJSON();expect(()=>b.move('sideways' as any)).toThrow(/direction/);expect(doc.toJSON()).toEqual(checkpoint);
  doc.deselect();expect(()=>b.captureSelection()).toThrow(/selection/);
});

it('strict commands reject malformed, duplicate, excessive and older-schema channels before changing state',()=>{
  const doc=new Document(),channel=doc.alphaChannels.add(new AlphaChannel());const stored=doc.toJSON();
  expect(()=>validateDocument({...stored,schemaVersion:20})).toThrow(/version 21/);
  expect(()=>validateDocument({...stored,alphaChannels:[channel.toJSON(),channel.toJSON()]})).toThrow(/Duplicate/);
  expect(()=>validateDocument({...stored,alphaChannels:Array.from({length:65},(_,i)=>({...channel.toJSON(),id:String(i)}))})).toThrow(/64/);
  for(const command of [{type:'alphaChannel.set',channel:{...channel.toJSON(),unknown:true}},{type:'alphaChannel.reorder',id:channel.id,direction:'sideways'},{type:'alphaChannel.remove',id:'missing'}])
    expect(()=>execute(stored,parseCommands([command])[0])).toThrow();
  expect(doc.toJSON()).toEqual(stored);
  expect(getExportCapabilityReport(stored,{format:'psd'}).featuresDegradedOrOmitted).toContain('Saved alpha channels');
  const legacy={...createDocument(),schemaVersion:20 as const};expect(Document.fromJSON(legacy).toJSON()).toEqual({...legacy,schemaVersion:SCHEMA_VERSION});
  const lut=new Document();lut.layers.add(new AdjustmentLayer({adjustment:defaultLutAdjustment()}));const saved=lut.toJSON();expect(Document.fromJSON({...saved,schemaVersion:20}).toJSON()).toEqual(saved);
});

it('tile culling preserves exact unsimplified native WASM coverage for affine holes and intersections followed by additions',async()=>{
  const cases=[new MarqueeSelection({regions:[{shape:'rectangle',x:-10,y:-2,width:1060,height:40,operation:'add'},{shape:'ellipse',x:500.25,y:2.5,width:30,height:20,operation:'subtract'},{shape:'rectangle',x:1.25,y:0,width:1030,height:32,operation:'intersect'}]}),
    new MarqueeSelection({regions:[{shape:'rectangle',x:0,y:0,width:10,height:10,operation:'add'},{shape:'rectangle',x:900,y:0,width:10,height:10,operation:'intersect'},{shape:'ellipse',x:509.5,y:2.5,width:16,height:20,operation:'add'}]}).transformed(new AffineTransform(1,.005,.02,1,-.5,-1))];
  const width=1040,height=32;
  for(const selection of cases){
    const expected=alpha(selection.toJSON(),width,height);
    const prepared=await composeChannelSelection(kernel,{selection:selection.toJSON(),base:null,width,height,operation:'replace',invert:false});
    expect(alpha(prepared,width,height)).toEqual(expected);
  }
});

it('native channel loading combines whole Boolean expressions, holes, inversion and fractional alpha correctly',async()=>{
  const selection=new MarqueeSelection({regions:[{shape:'rectangle',x:0,y:0,width:4,height:1,operation:'add'},{shape:'rectangle',x:1,y:0,width:1,height:1,operation:'subtract'},{shape:'rectangle',x:0,y:0,width:3,height:1,operation:'intersect'}]}).toJSON();
  const expected={replace:[255,0,255,0],add:[255,128,255,128],subtract:[0,128,0,128],intersect:[128,0,128,0]};
  for(const operation of ['replace','add','subtract','intersect'] as const){
    const result=await composeChannelSelection(kernel,{selection,base:fractional().toJSON(),width:4,height:1,operation,invert:false});expect(alpha(result),operation).toEqual(expected[operation]);
  }
  expect(alpha(await composeChannelSelection(kernel,{selection,base:null,width:4,height:1,operation:'replace',invert:true}))).toEqual([0,255,0,255]);
  expect(alpha(await composeChannelSelection(kernel,{selection:fractional().toJSON(),base:fractional().toJSON(),width:4,height:1,operation:'subtract',invert:false}))).toEqual([64,64,64,64]);
  for(const operation of ['add','intersect'] as const)expect(alpha(await composeChannelSelection(kernel,{selection:fractional().toJSON(),base:fractional().toJSON(),width:4,height:1,operation,invert:false}))).toEqual([128,128,128,128]);
  expect(alpha(await composeChannelSelection(kernel,{selection:{regions:[]},base:null,width:4,height:1,operation:'replace',invert:true}))).toEqual([255,255,255,255]);
});

it('load is one atomic selection edit and rejects missing hosts, stale/invalid/cancelled preparations and transactions',async()=>{
  const doc=new Document({width:4,height:1}),channel=doc.alphaChannels.add(new AlphaChannel({selection:rectangle()}));
  await expect(channel.load()).rejects.toThrow(/host/);bind(doc);const before=doc.toJSON(),revision=doc.getSnapshot().revision;await channel.load();expect(doc.getSnapshot().revision).toBe(revision+1);doc.undo();expect(doc.toJSON()).toEqual(before);
  const abort=new AbortController();abort.abort();await expect(channel.load({}, {signal:abort.signal})).rejects.toThrow();expect(doc.toJSON()).toEqual(before);
  let pending!:Promise<void>;doc.transaction('Sync',()=>{pending=channel.load();});await expect(pending).rejects.toThrow(/synchronous/);
  await expect(channel.load({unexpected:true} as any)).rejects.toThrow();
  doc._prepareChannelLoad=async()=>({regions:[{}]} as any);await expect(channel.load()).rejects.toThrow();expect(doc.toJSON()).toEqual(before);
  doc._prepareChannelLoad=async()=>{doc.name='Concurrent';return rectangle().toJSON();};await expect(channel.load()).rejects.toThrow(/changed/);expect(doc.selection).toBe(null);
});

it('crop, image resize and canvas resize retain the correct independent channel coordinate space',()=>{
  const doc=new Document({width:8,height:4});doc.selection=new MarqueeSelection({shape:'rectangle',x:2,y:1,width:4,height:2});const channel=doc.alphaChannels.capture('Center'),before=doc.toJSON();
  doc.crop({x:2,y:1,width:4,height:2});expect(alpha(channel.selection.toJSON(),4,2)).toEqual(Array(8).fill(255));
  doc.resizeImage(8,4);expect(alpha(channel.selection.toJSON(),8,4)).toEqual(Array(32).fill(255));doc.undo();doc.undo();expect(doc.toJSON()).toEqual(before);
  const saved=channel.toJSON();doc.resize(20,20);expect(channel.toJSON()).toEqual(saved);
});

it('loaded channel coverage records for offline recipe replay with one undo entry',async()=>{
  const doc=new Document({width:4,height:1});doc.selection=fractional();const channel=doc.alphaChannels.capture('Soft');doc.deselect();bind(doc);
  const recorder=new RecipeRecorder();recorder.start();doc.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));await channel.load();
  const recipe=recorder.stop({name:'Loaded alpha'}),target=new Document({width:4,height:1});expect(executeRecipe(recipe,target).success).toBe(true);expect(target.selection!.toJSON()).toEqual(doc.selection!.toJSON());target.undo();expect(target.selection).toBe(null);
});
