import {DEFAULT_SMUDGE,DEFAULT_MIXER,wetToolSettingsSchema} from './wet-settings';
import {brushSymmetrySchema} from '../core/brush-symmetry';
import {brushTipSchema} from '../core/brush-tip';
import { z } from 'zod';
import { colorSchema } from '../core/drawing';
import { freeze } from '../core/immutable';
import { pressureCurveSchema } from '../core/pressure-curve';
import type { ToolSettings } from '../tools';
import {ownPresetSource,type PresetSource} from './sources';
import {textureMaskOptionsSchema} from '../core/brush-texture';

export const BRUSH_TOOLS = ['brush', 'pencil', 'eraser', 'clone', 'dodge', 'burn', 'heal', 'smudge', 'mixer'] as const;
export type BrushTool = typeof BRUSH_TOOLS[number];
export const BRUSH_TOOL_NAMES: Record<BrushTool, string> = {
  brush: 'Brush', pencil: 'Pencil', eraser: 'Eraser', clone: 'Clone',
  dodge: 'Dodge', burn: 'Burn', heal: 'Spot Healing', smudge:'Smudge', mixer:'Mixer brush',
};
const unit = z.number().finite().min(0).max(1);
export const brushPresetSettingsSchema = z.object({
  smudge:wetToolSettingsSchema.optional(),mixer:wetToolSettingsSchema.optional(),
  size: z.number().finite().min(0.1).max(2048), hardness: unit, opacity: unit,
  flow: z.number().finite().min(0.01).max(1),
  spacing: z.number().finite().min(0.01).max(10),
  smoothing: z.number().finite().min(0).max(0.9),
  pressureSize: z.boolean(), pressureOpacity: z.boolean(),
  pressureCurve: pressureCurveSchema.nullable(),
  tip:brushTipSchema.nullable().optional(),
  symmetry:brushSymmetrySchema.nullable().optional(),
  cloneAligned: z.boolean(),
  tonalRange: z.enum(['shadows', 'midtones', 'highlights']),
  tonalExposure: unit, protectTones: z.boolean(),
  healingRadius: z.number().finite().min(1).max(1024),
  patchSampling: z.enum(['current-layer', 'current-and-below', 'all-layers']),
  patchMode: z.enum(['source', 'mixed']),
}).strict();
export type BrushPresetSettings = z.infer<typeof brushPresetSettingsSchema>;
export const brushPresetSchema = z.object({
  version: z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4),z.literal(5),z.literal(6)]), id: z.string().min(1).max(240),
  name: z.string().trim().min(1).max(120), tool: z.enum(BRUSH_TOOLS),
  settings: brushPresetSettingsSchema, color: colorSchema.optional(),
  texture:z.object({sourceId:z.string().min(1).max(240),channel:z.enum(['alpha','luminance']),invert:z.boolean()}).strict().optional(),
}).strict().refine(value=>value.version>=2||value.settings.tip===undefined,'Brush tips require preset version 2 or later.').refine(value=>value.version>=3||value.settings.symmetry===undefined,'Brush symmetry requires preset version 3.').refine(value=>value.version>=4||value.texture===undefined,'Image textures require preset version 4.').refine(value=>value.version>=5||(value.tool!=='smudge'&&value.tool!=='mixer'&&value.settings.smudge===undefined&&value.settings.mixer===undefined),'Wet tools and settings require preset version 5.').refine(value=>(value.tool!=='smudge'&&value.tool!=='mixer')||(value.settings.smudge!==undefined&&value.settings.mixer!==undefined),'Wet presets require both tool preferences.');
export type BrushPresetData = z.infer<typeof brushPresetSchema>;
export const brushPresetPackSchema = z.object({
  format: z.literal('canoli-brush-presets'), version: z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4),z.literal(5),z.literal(6)]),
  presets: z.array(brushPresetSchema).min(1),
}).strict().superRefine((pack, context) => {
  if(pack.presets.some(preset=>preset.version>pack.version))context.addIssue({code:'custom',message:'Preset versions require an equal or newer brush pack version.'});
  if (new Set(pack.presets.map(preset => preset.id)).size !== pack.presets.length)
    context.addIssue({code: 'custom', message: 'The brush pack contains duplicate preset IDs.'});
});

/** Immutable preference value. It never contains artwork, targets or executable code. */
export class BrushPreset {
  private readonly data: BrushPresetData;
  readonly source:PresetSource|null;
  constructor(data: unknown,source?:unknown) { const owned = brushPresetSchema.parse(data); if (owned.color === undefined) delete owned.color;if(owned.texture===undefined)delete owned.texture;if(owned.settings.tip===null)delete owned.settings.tip;if(owned.settings.symmetry===null)delete owned.settings.symmetry;
    this.source=source===undefined||source===null?null:ownPresetSource(source);
    if(this.source?.raw&&owned.version<6)throw new Error('RAW-bearing textures require preset version 6.');
    if(!!owned.texture!==!!this.source||owned.texture&&owned.texture.sourceId!==this.source!.id)throw new Error('A textured preset requires its matching original source-bearing record.');
    this.data = freeze(owned); Object.freeze(this); }
  static capture(name: string, tool: BrushTool, settings: ToolSettings, includeColor = false,source?:PresetSource): BrushPreset {
    const texture=textureMaskOptionsSchema.nullable().parse(settings.texture??null);
    if(texture&&!source)throw new Error('Textured brush presets need a source-bearing brush pack. Capture the original texture source before saving.');
    if(!texture&&source)throw new Error('A plain brush preset cannot contain an unused image source.');
    const values = Object.fromEntries(Object.keys(brushPresetSettingsSchema.shape).map(key => [key, settings[key as keyof ToolSettings]]));
    const wet=tool==='smudge'||tool==='mixer';
    if(!wet){delete values.smudge;delete values.mixer;}
    if(values.tip==null)delete values.tip;
    if(values.symmetry==null)delete values.symmetry;
    return new BrushPreset({version: source?.raw?6:wet?5:texture?4:values.symmetry?3:values.tip?2:1, id: crypto.randomUUID(), name, tool, settings: values,
      ...(texture?{texture:{sourceId:source!.id,...texture}}:{}),...(includeColor ? {color: settings.color} : {})},source);
  }
  get id() { return this.data.id; }
  get name() { return this.data.name; }
  get tool() { return this.data.tool; }
  get color() { return this.data.color; }
  get texture(){return this.data.texture??null;}
  get settings(): BrushPresetSettings { return structuredClone(this.data.settings); }
  with(patch: Partial<Pick<BrushPresetData, 'name' | 'tool' | 'settings' | 'color'>>): BrushPreset {
    const data={...this.data,...patch,settings:{...(patch.settings??this.data.settings)}};
    if(data.settings.tip==null)delete data.settings.tip;
    if(data.settings.symmetry==null)delete data.settings.symmetry;
    if(data.tool==='smudge'||data.tool==='mixer'){data.settings.smudge??={...DEFAULT_SMUDGE};data.settings.mixer??={...DEFAULT_MIXER};}
    data.version=Math.max(data.version,data.settings.smudge||data.settings.mixer?5:1,data.texture?4:data.settings.symmetry?3:data.settings.tip?2:1) as 1|2|3|4|5|6;
    return new BrushPreset(data,this.source);
  }
  duplicate(name = `${this.name.slice(0, 115)} copy`): BrushPreset {
    return new BrushPreset({...this.data, id: crypto.randomUUID(), name},this.source);
  }
  toJSON(): BrushPresetData { return structuredClone(this.data); }
  /** Owned, validated settings only; selecting a UI tool is the host's responsibility. */
  toToolSettings(): Partial<ToolSettings> {
    return {...this.settings,smudge:this.data.settings.smudge??{...DEFAULT_SMUDGE},mixer:this.data.settings.mixer??{...DEFAULT_MIXER},texture:this.data.texture?{channel:this.data.texture.channel,invert:this.data.texture.invert}:null,tip:this.data.settings.tip??null,symmetry:this.data.settings.symmetry??null, ...(this.color === undefined ? {} : {color: this.color})};
  }
}

export function exportBrushPresets(presets: readonly BrushPreset[]): string {
  if(presets.some(preset=>preset.texture))throw new Error('Use a source-bearing binary brush pack to export textured presets.');
  return JSON.stringify(brushPresetPackSchema.parse({format: 'canoli-brush-presets', version: presets.reduce((version,preset)=>Math.max(version,preset.toJSON().version),1),
    presets: presets.map(preset => preset.toJSON())}), null, 2);
}
export function parseBrushPresets(text: string): BrushPreset[] {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('Invalid brush-pack JSON. No presets were imported.'); }
  const checked = brushPresetPackSchema.safeParse(value);
  if (!checked.success) throw new Error(`Invalid brush pack. ${checked.error.issues.slice(0, 3).map(issue => issue.message).join(' ')} No presets were imported.`);
  return checked.data.presets.map(preset => new BrushPreset(preset));
}

const foundation: BrushPresetSettings = {
  size:24, hardness:0.7, opacity:1, flow:1, spacing:0.12, smoothing:0,
  pressureSize:true, pressureOpacity:false, pressureCurve:null, cloneAligned:true,
  tonalRange:'midtones', tonalExposure:0.25, protectTones:true, healingRadius:64,
  patchSampling:'all-layers', patchMode:'source',
};
export const BUILTIN_BRUSH_PRESETS: readonly BrushPreset[] = Object.freeze([
  new BrushPreset({version:1,id:'canoli.hard-round',name:'Hard round',tool:'brush',settings:{...foundation,size:40,hardness:1}}),
  new BrushPreset({version:1,id:'canoli.soft-shading',name:'Soft shading',tool:'brush',settings:{...foundation,size:80,hardness:0,opacity:0.5,flow:0.25,spacing:0.08,pressureOpacity:true}}),
  new BrushPreset({version:1,id:'canoli.pixel-pencil',name:'Pixel pencil',tool:'pencil',settings:{...foundation,size:1,hardness:1,pressureSize:false}}),
  new BrushPreset({version:1,id:'canoli.soft-eraser',name:'Soft eraser',tool:'eraser',settings:{...foundation,size:64,hardness:0}}),
]);
