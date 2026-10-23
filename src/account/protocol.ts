import {z} from 'zod';

/** Account metadata portability only: never an editable artwork or credential package. */
export const accountExportSchema=z.object({
 format:z.literal('canoli-account'),schemaVersion:z.literal(1),exportedAt:z.iso.datetime(),
 account:z.object({id:z.string().min(1).max(512),name:z.string().max(1024).nullable(),email:z.string().max(320).nullable(),createdAt:z.iso.datetime()}).strict(),
 identities:z.array(z.object({provider:z.literal('openai'),issuer:z.literal('https://auth.openai.com'),clientId:z.string().min(1).max(256),subject:z.string().min(1).max(512),name:z.string().max(1024).nullable(),email:z.string().max(320).nullable(),emailVerified:z.boolean()}).strict()),
 activeSessionCount:z.number().int().nonnegative(),
}).strict();
export type AccountExport=z.infer<typeof accountExportSchema>;
