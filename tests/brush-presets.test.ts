import { expect, it } from 'vitest';
import { BrushPreset, BUILTIN_BRUSH_PRESETS, BRUSH_TOOLS, exportBrushPresets, parseBrushPresets } from '../src/brushes/presets';
import { BrushPresetLibrary } from '../src/brushes/library';
import { PressureCurve } from '../src/dom';
import type { ToolSettings } from '../src/tools';

const settings = (): ToolSettings => ({...BUILTIN_BRUSH_PRESETS[0].settings,tip:null,symmetry:null,texture:null,smudge:{load:0,wetness:0,pickup:.5},mixer:{load:1,wetness:.25,pickup:.5},
  pressureCurve:PressureCurve.firm().toJSON(), size:42.5, opacity:0.6, spacing:8.5, color:'#123456',
  quickSize:32, quickTolerance:32, quickEdgeThreshold:64, quickSampling:'merged',quickSelectionMode:'add',
  patchDirection:'destination',paintTarget:'filter-mask-hide',penEditTarget:'mask',penWidth:3,penFill:true,
  selectionShape:'ellipse',lassoMode:'polygon',wandTolerance:4,wandContiguous:false,selectionMode:'subtract'});

it('refuses silent texture loss in metadata-only preset capture and resets texture when applying legacy packs',()=>{
 expect(()=>BrushPreset.capture('Textured','brush',{...settings(),texture:{channel:'alpha',invert:true}})).toThrow(/source-bearing/);
 for(const preset of BUILTIN_BRUSH_PRESETS)expect(preset.toToolSettings().texture).toBeNull();
 const restored=parseBrushPresets(exportBrushPresets([BrushPreset.capture('Plain','brush',settings())]));
 expect(restored[0].toToolSettings().texture).toBeNull();
});

for (const tool of BRUSH_TOOLS) it(`${tool} presets own supported settings and exclude document targets/source state`, () => {
  const input=settings(),preset=BrushPreset.capture('  My brush  ',tool,input),data=preset.toJSON();
  expect(preset.name).toBe('My brush');expect(preset.tool).toBe(tool);expect(preset.color).toBeUndefined();
  expect(data.settings.size).toBe(42.5);expect(data.settings.spacing).toBe(8.5);expect(data.settings.pressureCurve).toEqual(PressureCurve.firm().toJSON());
  expect(preset.toToolSettings()).not.toHaveProperty('color');expect(preset.toToolSettings()).not.toHaveProperty('paintTarget');expect(preset.toToolSettings()).not.toHaveProperty('patchDirection');
  input.pressureCurve!.points[1].output=0;data.settings.size=1;const owned=preset.settings;owned.pressureCurve!.points[1].output=0;
  expect(preset.settings.size).toBe(42.5);expect(preset.settings.pressureCurve).toEqual(PressureCurve.firm().toJSON());
  expect(Object.isFrozen(preset)).toBe(true);
});
it('optional foreground capture, rename and duplication preserve exact editable dynamics',()=>{
 const preset=BrushPreset.capture('Ink','brush',settings(),true),copy=preset.duplicate('Ink copy');
 expect(copy.id).not.toBe(preset.id);expect(copy.settings).toEqual(preset.settings);expect(copy.toToolSettings().color).toBe('#123456');
 expect(preset.with({name:'Renamed'}).id).toBe(preset.id);expect(preset.name).toBe('Ink');expect(preset.with({color:undefined}).toToolSettings()).not.toHaveProperty('color');
});
it('portable data round-trips every supported tool and a true-zero authored response',()=>{
 const presets=BRUSH_TOOLS.map(tool=>BrushPreset.capture(tool,tool,{...settings(),pressureCurve:PressureCurve.linear().toJSON()},tool==='brush'));
 expect(parseBrushPresets(exportBrushPresets(presets)).map(p=>p.toJSON())).toEqual(presets.map(p=>p.toJSON()));
 expect(parseBrushPresets(exportBrushPresets(BUILTIN_BRUSH_PRESETS)).map(p=>p.name)).toEqual(['Hard round','Soft shading','Pixel pencil','Soft eraser']);
});
it('wet presets own both tool preferences, enforce their format age and reset them from legacy values',()=>{
 const input=settings();input.smudge={load:.2,wetness:.4,pickup:.6};input.mixer={load:.8,wetness:.3,pickup:.1};
 const preset=BrushPreset.capture('Mixer','mixer',input),data=preset.toJSON();
 expect(data.version).toBe(5);input.mixer.load=0;data.settings.smudge!.pickup=0;
 expect(preset.settings.mixer).toEqual({load:.8,wetness:.3,pickup:.1});expect(preset.settings.smudge!.pickup).toBe(.6);
 expect(parseBrushPresets(exportBrushPresets([preset]))[0].toJSON()).toEqual(preset.toJSON());
 expect(()=>new BrushPreset({...preset.toJSON(),version:4})).toThrow(/version 5/);
 expect(()=>new BrushPreset({...preset.toJSON(),settings:{...preset.settings,mixer:null}})).toThrow();
 expect(()=>new BrushPreset({...preset.toJSON(),settings:{...preset.settings,smudge:{load:0,wetness:2,pickup:0}}})).toThrow();
 expect(BUILTIN_BRUSH_PRESETS[0].toToolSettings()).toMatchObject({smudge:{load:0,wetness:0,pickup:.5},mixer:{load:1,wetness:.25,pickup:.5}});
 expect(BUILTIN_BRUSH_PRESETS[0].with({tool:'smudge'}).toJSON()).toMatchObject({version:5,tool:'smudge',settings:{smudge:{load:0,wetness:0,pickup:.5}}});
});
it('rejects unsupported versions, hidden code/assets, duplicate IDs and every malformed pack before storage',async()=>{
 const preset=BrushPreset.capture('Safe','brush',settings()),pack=JSON.parse(exportBrushPresets([preset]));
 const invalid=[{...pack,version:7},{...pack,format:'other'},{...pack,code:'execute me'},{...pack,presets:[preset.toJSON(),preset.toJSON()]},{...pack,presets:[]},{...pack,presets:[{...preset.toJSON(),assetId:'remote'}]},{...pack,presets:[{...preset.toJSON(),settings:{...preset.settings,pressureCurve:{points:[]}}}]},{...pack,presets:[{...preset.toJSON(),settings:{...preset.settings,size:Infinity}}]}];
 const library=new BrushPresetLibrary(),original=library.getSnapshot();
 try{for(const value of invalid) {expect(()=>parseBrushPresets(JSON.stringify(value))).toThrow();await expect(library.importJson(JSON.stringify(value))).rejects.toThrow();expect(library.getSnapshot()).toBe(original);}expect(()=>parseBrushPresets('{')).toThrow(/Invalid brush-pack JSON/);}finally{library.dispose();}
});
it('rejects built-in overwrite and refuses unavailable persistence rather than silently succeeding',async()=>{
 const library=new BrushPresetLibrary();try{
  await expect(library.save(BUILTIN_BRUSH_PRESETS[0])).rejects.toThrow(/Duplicate a built-in/);
  await expect(library.save(BrushPreset.capture('Not saved','brush',settings()))).rejects.toThrow(/storage is unavailable/);
  expect(library.getSnapshot().presets).toHaveLength(0);expect(library.getSnapshot().error).toMatch(/storage is unavailable/);
 }finally{library.dispose();}
});

it('backs up invalid JSON records exactly and refuses every lossy native representation without executing accessors',async()=>{
 const {serializeBrushRecovery,parseBrushRecovery}=await import('../src/brushes/recovery');
 const records=[{id:'old',revision:1,preset:{version:99,unknown:'Keep this verbatim'}}];expect(parseBrushRecovery(serializeBrushRecovery(records))).toEqual(records);
 const cycle:{self?:unknown}={};cycle.self=cycle;const shared={value:1};const sparse=new Array(1000000);let calls=0;const accessor=Object.defineProperty({},'data',{enumerable:true,get(){calls++;return'bad';}});
 for(const value of [undefined,NaN,Infinity,1n,new Date(),new Map(),new Set(),new Blob(['Keep']),new Uint8Array([1,2]),cycle,{a:shared,b:shared},sparse,accessor])expect(()=>serializeBrushRecovery([{id:'bad',value}])).toThrow(/cannot safely represent non-JSON/);
 expect(calls).toBe(0);expect(BrushPreset.capture('Default','brush',settings()).with({color:undefined}).toJSON()).not.toHaveProperty('color');
});
it('rejects unsupported recovery envelopes and unknown instructions without treating them as preset packs',async()=>{
 const {parseBrushRecovery}=await import('../src/brushes/recovery');
 for(const value of [{format:'other',version:1,records:[]},{format:'canoli-brush-library-recovery',version:2,records:[]},{format:'canoli-brush-library-recovery',version:1,records:[],code:'run'}])expect(()=>parseBrushRecovery(JSON.stringify(value))).toThrow();
});

it('versions tip-bearing portable presets without upgrading legacy packs and resets old tips on apply',()=>{
 const tip={roundness:.25,angle:35,tiltAngle:true,tiltRoundness:true,tiltCurve:PressureCurve.firm().toJSON()};
 const legacy=BrushPreset.capture('Legacy','brush',settings()),shaped=BrushPreset.capture('Tilt','brush',{...settings(),tip});
 expect(legacy.toJSON().version).toBe(1);expect(JSON.parse(exportBrushPresets([legacy])).version).toBe(1);expect(legacy.toToolSettings().tip).toBeNull();
 expect(shaped.toJSON().version).toBe(2);const pack=JSON.parse(exportBrushPresets([legacy,shaped]));expect(pack.version).toBe(2);expect(parseBrushPresets(JSON.stringify(pack)).map(p=>p.toJSON())).toEqual([legacy.toJSON(),shaped.toJSON()]);
 expect(()=>parseBrushPresets(JSON.stringify({...pack,version:1}))).toThrow(/pack version/);expect(()=>new BrushPreset({...shaped.toJSON(),version:1})).toThrow(/version 2/);
 const owned=shaped.settings;owned.tip!.angle=0;expect(shaped.settings.tip).toEqual(tip);expect(legacy.with({settings:{...legacy.settings,tip}}).toJSON().version).toBe(2);
});

it('versions symmetry as preset/pack 3 while preserving older packs and clearing future symmetry on legacy application',async()=>{
 const {BrushSymmetry}=await import('../src/dom'),base=BrushPreset.capture('Legacy','brush',settings()),shape=base.duplicate('Shape').with({settings:{...base.settings,tip:{roundness:.5,angle:20}}}),symmetry=BrushSymmetry.radial({x:32,y:32},4).toJSON(),mirrored=BrushPreset.capture('Radial','brush',{...settings(),symmetry});expect(mirrored.toJSON().version).toBe(3);expect(base.toToolSettings().symmetry).toBeNull();expect(shape.toJSON().version).toBe(2);
 const pack=JSON.parse(exportBrushPresets([base,shape,mirrored]));expect(pack.version).toBe(3);expect(parseBrushPresets(JSON.stringify(pack)).map(p=>p.toJSON())).toEqual([base.toJSON(),shape.toJSON(),mirrored.toJSON()]);for(const version of [1,2]){expect(()=>parseBrushPresets(JSON.stringify({...pack,version}))).toThrow(/pack version/);expect(()=>new BrushPreset({...mirrored.toJSON(),version})).toThrow(/symmetry requires preset version 3/);}
 const owned=mirrored.settings;owned.symmetry!.copies[0].e=0;expect(mirrored.settings.symmetry).toEqual(symmetry);expect(mirrored.with({settings:{...mirrored.settings,symmetry:null}}).toJSON().version).toBe(3);
});
