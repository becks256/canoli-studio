import {expect,it} from 'vitest';
import {Document,RasterLayer,PaintLayer,PencilStroke,WetPaintStroke,LayerMask,LayerGroup,AffineTransform} from '../src/dom';
import {SCHEMA_VERSION,validateDocument,referencedAssets} from '../src/core/model';
import {paintOperationSchema} from '../src/core/drawing';
import {assertFloatSources} from '../src/core/float-document';
import {parseCommands} from '../src/core/validation';
import {encodeFloatWetTile} from '../src/core/float-wet-tile';
import {validateWetPaintAssets,type WetAssetProvider} from '../src/core/wet-assets';
import {localBounds} from '../src/core/spatial';
import {parseRetainedHistory} from '../src/core/history';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readProject} from '../src/core/project';

const stroke=(options:Partial<ConstructorParameters<typeof WetPaintStroke>[0]>={})=>new WetPaintStroke({precision:'float32',brush:new PencilStroke({points:[{x:3.5,y:4.5}],pressureSize:false}),tiles:[{x:3,y:4,width:2,height:1,assetId:'pigment',coverage:{assetId:'removal'}}],...options});
const document=()=>{const d=new Document({precision:'float32',width:16,height:12}),r=d.layers.add(new RasterLayer({assetId:'original',width:16,height:12}));return{d,r};};

it('owns strict HDR metadata and defaults while preserving byte constructors',()=>{
 const s=stroke({load:{color:[4,-2,8,.375],load:.625}});expect(s.precision).toBe('float32');expect(s.load).toEqual({color:[4,-2,8,.375],load:.625});expect(stroke().load).toEqual({color:[0,0,0,1],load:0});expect(paintOperationSchema.parse(s.toJSON())).toEqual(s.toJSON());
 const b=stroke({precision:undefined});expect(b.precision).toBeUndefined();expect(b.load.color).toEqual([0,0,0,255]);expect('precision'in b.toJSON()).toBe(false);
 for(const patch of [{precision:null},{precision:'uint8'},{load:{color:[2,0,0,2]}},{load:{color:[Infinity,0,0,1]}},{load:{color:[1e300,0,0,1]}},{load:{color:[1,0,0,1],unknown:true}}])expect(()=>stroke(patch as never)).toThrow();
});

it('retains HDR modifiers on shared OO history and rejects false schema ages even for inert values',()=>{
 const{d,r}=document(),before=d.toJSON();r.applyWetPaint(stroke());const after=d.toJSON();expect(after.schemaVersion).toBe(SCHEMA_VERSION);expect(SCHEMA_VERSION).toBe(58);expect(Document.fromJSON(after).toJSON()).toEqual(after);d.undo();expect(d.toJSON()).toEqual(before);d.redo();expect(d.toJSON()).toEqual(after);
 expect(referencedAssets(after)).toEqual(new Set(['original','pigment','removal']));
 for(const opacity of [0,1]){const old=structuredClone(after);old.schemaVersion=56;const layer=old.children[0];if(layer.kind!=='raster')throw new Error('No raster');layer.erasures![0].stroke.opacity=opacity;expect(()=>validateDocument(old)).toThrow('57');}
 const layer=after.children[0];if(layer.kind!=='raster')throw new Error('No raster');const command={type:'layer.update',id:r.id,patch:{erasures:layer.erasures}};expect(parseCommands([command])).toHaveLength(1);
});

it('rejects HDR color in byte documents and mask positions without partial commands',()=>{
 const byte=new Document(),r=byte.layers.add(new RasterLayer({assetId:'byte',width:16,height:12})),before=byte.toJSON();expect(()=>r.applyWetPaint(stroke())).toThrow('float32');expect(byte.toJSON()).toEqual(before);
 expect(()=>byte.layers.add(new PaintLayer()).strokes.add(stroke())).toThrow('float32');
 expect(()=>new LayerMask({base:1,strokes:[{mode:'wet',stroke:stroke()}]})).toThrow(/byte|HDR/);
 const{d,r:float}=document(),saved=d.toJSON();expect(()=>d.transaction('Invalid HDR',()=>{float.applyWetPaint(stroke());float.opacity=2;})).toThrow();expect(d.toJSON()).toEqual(saved);const group=d.layers.add(new LayerGroup());float.moveTo(group);group.locked=true;expect(()=>float.applyWetPaint(stroke())).toThrow(/Unlock/i);
});

it('retains inactive HDR references without expanding bounds and scales active finite support with raster resizing',()=>{
 const{r}=document();r.applyWetPaint(stroke({opacity:0,tiles:[{x:100,y:-4,width:2,height:1,assetId:'pigment',coverage:{assetId:'removal'}}]}));expect(localBounds(r.toJSON())).toEqual({x:0,y:0,width:16,height:12});
 r.applyWetPaint(stroke({nativeTransform:AffineTransform.translation(-10,0)}));expect(localBounds(r.toJSON())).toEqual({x:-8,y:0,width:24,height:12});r.width=32;expect(localBounds(r.toJSON())).toEqual({x:-16,y:0,width:48,height:12});
});

it('exempts only actual HDR tile reference objects from byte-role checks, including duplicate IDs in a texture',()=>{
 const{d,r}=document();r.applyWetPaint(stroke());const original={tiff:{editingPrecision:'float32'},tiffColor:{}},assets={get:()=>original as never};expect(()=>assertFloatSources(d.toJSON(),assets)).not.toThrow();
 const bad=d.toJSON(),layer=bad.children[0];if(layer.kind!=='raster'||layer.erasures![0].stroke.kind!=='wet')throw new Error('No wet');layer.erasures![0].stroke.brush.texture={assetId:'pigment',channel:'alpha',invert:false};expect(()=>assertFloatSources(bad,assets)).toThrow('native byte');
});

it('shared document asset validation uses full native TIFF alpha rather than byte provider streams',async()=>{
 const{d,r}=document();r.applyWetPaint(stroke());const color=await encodeFloatWetTile(new Float32Array([4,-2,8,.375,8,-4,2,.125]),2,1),coverage=await encodeFloatWetTile(new Float32Array([0,0,0,.5,0,0,0,.75]),2,1);
 const provider:WetAssetProvider={get:id=>({blob:id==='pigment'?color:coverage,width:2,height:1}),async *alpha(){throw new Error('No byte proxy alpha');}};
 await validateWetPaintAssets(d.toJSON(),provider);const invalid=await encodeFloatWetTile(new Float32Array([0,0,0,.125,0,0,0,.75]),2,1);await expect(validateWetPaintAssets(d.toJSON(),{...provider,get:id=>({blob:id==='pigment'?color:invalid,width:2,height:1})})).rejects.toThrow('already be masked');
});

it('falsely aged HDR redo rejects and unsupported float embedding remains unavailable',()=>{
 const{d,r}=document(),before=d.toJSON();r.applyWetPaint(stroke({opacity:0}));const old=d.toJSON();old.schemaVersion=56;
 expect(()=>parseRetainedHistory({version:1,past:[],future:[{canvasChanged:true,label:'HDR redo',document:old}]},before)).toThrow('57');
 const root=new Document();root.defineComponent(new Document());const nested=root.toJSON(),definition=nested.components![0];if(definition.source.kind!=='document')throw new Error('No embedded source');definition.source.document=old;expect(()=>validateDocument(nested)).toThrow('float document integration');
});

it('production fixture retains checked original identities and native prepared sources before any HDR edit',async()=>{
 const base='tests/fixtures/hdr-wet-document/',manifest=JSON.parse(await readFile(base+'manifest.json','utf8')),bytes=await readFile(base+'setup.luma'),hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');expect(bytes.length).toBe(manifest.project.bytes);expect(hash(bytes)).toBe(manifest.project.sha256);expect(hash(await readFile('tests/helpers/hdr-wet-document.ts'))).toBe(manifest.helperSha256);expect(hash(await readFile(manifest.original.file))).toBe(manifest.original.sha256);
 const project=await readProject(new Blob([new Uint8Array(bytes)]));expect(project.document.schemaVersion).toBe(57);expect(project.document.precision).toBe('float32');expect(project.entries).toHaveLength(4);expect(project.entries.every(entry=>entry.tiff?.editingPrecision==='float32')).toBe(true);expect(project.document.children[0].name).toBe('HDR target');expect(project.document.children[0].kind==='raster'&&project.document.children[0].erasures).toBeUndefined();
});

it('float PaintLayer prepared values share history, strict pair source roles, schema ages and byte rejection',()=>{
 const d=new Document({precision:'float32'}),paint=d.layers.add(new PaintLayer()),before=d.toJSON();paint.strokes.add(stroke());const after=d.toJSON();expect(Document.fromJSON(after).toJSON()).toEqual(after);d.undo();expect(d.toJSON()).toEqual(before);d.redo();expect(d.toJSON()).toEqual(after);
 const fake={tiff:{editingPrecision:'float32'},tiffColor:{}},assets={get:()=>fake as never};expect(()=>assertFloatSources(after,assets)).not.toThrow();
 const bad=structuredClone(after),layer=bad.children[0];if(layer.kind!=='paint'||layer.strokes[0].kind!=='wet')throw new Error('No paint');layer.strokes[0].brush.texture={assetId:'pigment',channel:'alpha',invert:false};expect(()=>assertFloatSources(bad,assets)).toThrow('native byte');
 bad.schemaVersion=56;expect(()=>validateDocument(bad)).toThrow('57');expect(()=>paint.strokes.add(stroke({precision:undefined,opacity:0}))).toThrow('explicit HDR');expect(d.toJSON()).toEqual(after);
});
