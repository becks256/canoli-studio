import {z} from 'zod';
const count=z.number().int().nonnegative().safe();
export const artworkMetadataSchema=z.object({
 name:z.string().trim().min(1).max(120),description:z.string().max(4096),
 tags:z.array(z.string().trim().min(1).max(80)).max(64).transform(tags=>[...new Map(tags.map(tag=>[tag.normalize('NFKC').toLocaleLowerCase('en'),tag])).values()]),
}).strict();
export type ArtworkMetadata=z.infer<typeof artworkMetadataSchema>;
export const artworkContentSchema=z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:count.positive(),width:count.positive(),height:count.positive(),layers:count.positive()}).strict();
export const artworkEntrySchema=z.object({version:z.literal(1),id:z.string().uuid(),revision:z.string().uuid(),createdAt:count,updatedAt:count,metadata:artworkMetadataSchema,content:artworkContentSchema}).strict();
export type ArtworkEntry=z.infer<typeof artworkEntrySchema>;
export interface ArtworkRow {key:IDBValidKey;value:unknown}
export interface ArtworkSummary {id:string|null;entry:ArtworkEntry|null;error:string}
export interface PreparedArtwork {metadata:ArtworkMetadata;content:z.infer<typeof artworkContentSchema>;blob:Blob}
export function artworkRow(row:ArtworkRow):ArtworkEntry{const entry=artworkEntrySchema.parse(row.value);if(entry.id!==row.key)throw new Error('Artwork identifier changed.');return entry;}
export function artworkMatches(entry:ArtworkEntry,query:string){const normalize=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('en');return normalize(query).trim().split(/\s+/u).filter(Boolean).every(word=>normalize([entry.metadata.name,entry.metadata.description,...entry.metadata.tags].join('\n')).includes(word));}
