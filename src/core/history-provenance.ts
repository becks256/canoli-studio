import {z} from 'zod';
import type {EditorCommand} from './commands';
import {id} from './model';
const text = z.string().min(1).max(240);
export const historyOriginSchema = z.object({
  surface: z.enum(['host','editor','rest','script','plugin','connected-client']),
  executionId: z.uuid().optional(),
  plugin: z.object({id:text,commandId:text,version:text}).strict().optional(),
  connectionId: text.optional(), requestId: text.optional(),
  batch:z.object({runId:text,itemId:text}).strict().optional(),
  recipe: z.object({id:text,version:z.number().int().nonnegative().safe()}).strict().optional(),
  candidate: z.object({id:text,jobId:text,providerId:text.optional(),modelVersion:text.optional()}).strict().optional(),
}).strict().refine(value => value.surface !== 'plugin' || !!value.plugin, 'Plugin provenance requires its installed command identity.');
export type HistoryOrigin = z.infer<typeof historyOriginSchema>;
export const historyOperationSchema = z.object({
  id:z.uuid(), documentId:z.string().min(1), sessionId:z.uuid(), acceptedRevision:z.number().int().positive().safe(),
  recordedAt:z.number().int().min(-8640000000000000).max(8640000000000000).nullable(),
  label:z.string(), origin:historyOriginSchema,
  commandCount:z.number().int().nonnegative().safe(), commandTypes:z.array(text).max(512),
}).strict().refine(value => new Set(value.commandTypes).size === value.commandTypes.length && value.commandTypes.length <= value.commandCount && (value.commandCount === 0) === (value.commandTypes.length === 0), 'Invalid operation command summary.');
export type HistoryOperation = z.infer<typeof historyOperationSchema>;
export interface HistoryProvenance {current:HistoryOperation|null;past:(HistoryOperation|null)[];future:(HistoryOperation|null)[]}
export const historyProvenanceSchema = z.object({current:historyOperationSchema.nullable(),past:z.array(historyOperationSchema.nullable()).max(60),future:z.array(historyOperationSchema.nullable()).max(60)}).strict();
export const tipProvenanceSchema = historyProvenanceSchema.omit({future:true});
export type HistoryTipProvenance = Omit<HistoryProvenance,'future'>;
export function unknownProvenance(past=0,future=0):HistoryProvenance {return {current:null,past:Array(past).fill(null),future:Array(future).fill(null)};}
export function knownTipProvenance(value:HistoryTipProvenance):HistoryTipProvenance|undefined {
  return value.current || value.past.some(Boolean) ? {current:value.current,past:value.past} : undefined;
}
/** Called only after shared command validation accepts a changed result. No command data/code is copied. */
export function recordHistoryOperation(command:EditorCommand,documentId:string,sessionId:string,acceptedRevision:number,label:string,origin:HistoryOrigin):HistoryOperation {
  const pending=[command],types=new Set<string>();let commandCount=0;
  while(pending.length){const next=pending.pop()!;if(next.type==='transaction')for(const child of next.commands)pending.push(child);else{commandCount++;types.add(next.type);}}
  const time=Date.now(),recordedAt=Number.isSafeInteger(time)&&Math.abs(time)<=8640000000000000?time:null;
  return historyOperationSchema.parse({id:id(),documentId,sessionId,acceptedRevision,recordedAt,label,origin,commandCount,commandTypes:[...types].sort()});
}
