import {z} from 'zod';

const finite=z.number().finite().refine(value=>Number.isFinite(Math.fround(value)),'Value cannot be represented by the native float32 model.');
const positive=finite.refine(value=>Math.fround(value)>0,'A positive native value is required.');
const label=z.string().max(512);
const distortion=z.discriminatedUnion('model',[
  z.object({model:z.literal('none'),focalLength:positive,terms:z.tuple([])}).strict(),
  z.object({model:z.literal('poly3'),focalLength:positive,realFocalLength:positive.optional(),terms:z.tuple([finite])}).strict(),
  z.object({model:z.literal('poly5'),focalLength:positive,realFocalLength:positive.optional(),terms:z.tuple([finite,finite])}).strict(),
  z.object({model:z.literal('ptlens'),focalLength:positive,realFocalLength:positive.optional(),terms:z.tuple([finite,finite,finite])}).strict(),
]);
const chromatic=z.discriminatedUnion('model',[
  z.object({model:z.literal('none'),focalLength:positive,terms:z.tuple([])}).strict(),
  z.object({model:z.literal('linear'),focalLength:positive,terms:z.tuple([positive,positive])}).strict(),
  z.object({model:z.literal('poly3'),focalLength:positive,terms:z.tuple([positive,positive,finite,finite,finite,finite])}).strict(),
]);
const vignette=z.object({model:z.literal('pa'),focalLength:positive,aperture:positive,focusDistance:positive,terms:z.tuple([finite,finite,finite])}).strict();
const calibration=z.object({
  cropFactor:positive,aspectRatio:positive.min(1).default(1.5),
  distortion:z.array(distortion).max(50000).default([]),chromatic:z.array(chromatic).max(50000).default([]),vignette:z.array(vignette).max(50000).default([]),
}).strict();
export const lensProfileSchema=z.object({
  version:z.literal(1).default(1),maker:label.default(''),model:label.min(1),type:z.literal('rectilinear').default('rectilinear'),
  mounts:z.array(label.min(1)).max(128).default([]),aliases:z.array(label.min(1)).max(128).default([]),
  center:z.object({x:finite.min(-1).max(1).default(0),y:finite.min(-1).max(1).default(0)}).strict().prefault({}),
  focalRange:z.object({min:z.union([positive,z.literal(0)]).default(0),max:z.union([positive,z.literal(0)]).default(0)}).strict().prefault({}),
  calibrations:z.array(calibration).min(1).max(128),
  source:z.object({name:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/),index:z.number().int().nonnegative(),notices:z.string().optional()}).strict().optional(),
}).strict().superRefine((profile,context)=>{
  const pointKeys=new Set<string>(),frameModels=new Map<string,Set<string>>();let count=0;
  if(profile.focalRange.max>0&&profile.focalRange.min>0&&profile.focalRange.max<profile.focalRange.min)context.addIssue({code:'custom',message:'Invalid lens focal range.'});
  for(const set of profile.calibrations){
    const frame=`${Math.fround(set.cropFactor)}:${Math.fround(set.aspectRatio)}`;
    for(const kind of ['distortion','chromatic','vignette']as const){
      const modelKey=frame+':'+kind,models=frameModels.get(modelKey)??new Set<string>();frameModels.set(modelKey,models);
      for(const point of set[kind]){
        count++;if(point.model!=='none')models.add(point.model);
        const key=frame+':'+kind+':'+Math.fround(point.focalLength)+('aperture'in point?':'+Math.fround(point.aperture)+':'+Math.fround(point.focusDistance):'');
        if(pointKeys.has(key))context.addIssue({code:'custom',message:'Duplicate native lens calibration coordinates.'});pointKeys.add(key);
      }
      if(models.size>1)context.addIssue({code:'custom',message:'Mixed calibration models within one frame/family are unsupported.'});
    }
  }
  if(count===0||count>50000)context.addIssue({code:'custom',message:'A profile requires between 1 and 50000 calibration metadata points.'});
});
export type LensProfileOptions=z.input<typeof lensProfileSchema>;
export type LensProfileData=z.output<typeof lensProfileSchema>;
export const lensProfileSelectionSchema=z.object({
  definition:lensProfileSchema,focalLength:positive,cropFactor:positive,
  aperture:positive.nullable().default(null),focusDistance:positive.nullable().default(null),
  distortion:z.boolean().default(true),chromatic:z.boolean().default(false),vignette:z.boolean().default(false),
}).strict().superRefine((selection,context)=>{
  for(const kind of ['distortion','chromatic','vignette']as const)if(selection[kind]&&!selection.definition.calibrations.some(set=>set[kind].some(point=>point.model!=='none')))context.addIssue({code:'custom',message:`The selected profile has no ${kind} calibration.`});
  if(selection.vignette&&selection.aperture===null)context.addIssue({code:'custom',message:'Vignette correction requires an explicit aperture.'});
});
export type LensProfileSelectionOptions=z.input<typeof lensProfileSelectionSchema>;
export type LensProfileSelectionData=z.output<typeof lensProfileSelectionSchema>;
