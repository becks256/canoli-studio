import {z} from 'zod';
import {lensProfileSchema} from './schema';

const label=z.string().max(512),aliases=z.array(label.min(1)).max(128),index=z.number().int().nonnegative();
const positive=z.number().finite().refine(value=>Number.isFinite(Math.fround(value))&&Math.fround(value)>0,'A positive native value is required.');
export const lensDatabaseSourceSchema=z.object({name:z.string().min(1).max(1024),type:z.string().max(256),byteLength:z.number().int().positive().safe(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const issues=z.array(z.string().min(1).max(1024));
const range=z.object({min:z.number().finite().nonnegative(),max:z.number().finite().nonnegative()}).strict();
export const lensCatalogSchema=z.object({
  version:z.literal(1),databaseVersion:z.union([z.literal(1),z.literal(2)]),source:lensDatabaseSourceSchema,
  lenses:z.array(z.object({index,maker:label,model:label.min(1),makerAliases:aliases,modelAliases:aliases,mounts:aliases,apertureRange:range,definition:lensProfileSchema.nullable(),issues}).strict()),
  cameras:z.array(z.object({index,maker:label,model:label.min(1),variant:label,makerAliases:aliases,modelAliases:aliases,mount:label,cropFactor:positive.nullable(),issues}).strict()),
  mounts:z.array(z.object({index,name:label.min(1),aliases,compatible:aliases,issues}).strict()),
}).strict().superRefine((catalog,context)=>{
  for(const kind of ['lenses','cameras','mounts']as const){const indices=new Set<number>();for(const row of catalog[kind]){if(indices.has(row.index))context.addIssue({code:'custom',message:'Duplicate database record index.'});indices.add(row.index);}}
  for(const lens of catalog.lenses){
    const definition=lens.definition;
    if((definition===null)!==(lens.issues.length>0)||definition&&(definition.maker!==lens.maker||definition.model!==lens.model||JSON.stringify(definition.mounts)!==JSON.stringify(lens.mounts)||JSON.stringify(definition.aliases)!==JSON.stringify(lens.modelAliases)||definition.source?.index!==lens.index||definition.source.sha256!==catalog.source.sha256||definition.source.name!==catalog.source.name))context.addIssue({code:'custom',message:'Inconsistent lens database profile record.'});
  }
  for(const camera of catalog.cameras)if(!camera.issues.length&&(camera.cropFactor===null||!camera.maker||!camera.mount))context.addIssue({code:'custom',message:'Inconsistent lens database camera record.'});
});
export type LensDatabaseSource=z.infer<typeof lensDatabaseSourceSchema>;
export type LensCatalog=z.infer<typeof lensCatalogSchema>;
export type CatalogLens=LensCatalog['lenses'][number];
export type CatalogCamera=LensCatalog['cameras'][number];
