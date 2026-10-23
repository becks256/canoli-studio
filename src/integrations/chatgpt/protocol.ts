import {z} from 'zod';

export const MCP_BRIDGE_VERSION=1;
export const MCP_METADATA_BYTES=2_000_000;
export const connectionPermissionsSchema=z.object({read:z.literal(true),write:z.boolean()}).strict();
export type ConnectionPermissions=z.infer<typeof connectionPermissionsSchema>;
export const connectedDocumentSchema=z.object({id:z.string().min(1).max(256),name:z.string().max(1024),revision:z.number().int().nonnegative(),width:z.number().int().positive(),height:z.number().int().positive()}).strict();
export type ConnectedDocument=z.infer<typeof connectedDocumentSchema>;
export const operationSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('inspect')}).strict(),
  z.object({kind:z.literal('template'),layerKind:z.enum(['paint','vector','text','group'])}).strict(),
  z.object({kind:z.literal('apply'),expectedRevision:z.number().int().nonnegative(),label:z.string().min(1).max(128),commands:z.array(z.record(z.string(),z.unknown())).min(1).max(256),idempotencyKey:z.string().min(1).max(128)}).strict(),
  z.object({kind:z.enum(['undo','redo']),expectedRevision:z.number().int().nonnegative(),idempotencyKey:z.string().min(1).max(128)}).strict(),
]);
export type ConnectionOperation=z.infer<typeof operationSchema>;
export function isReadOperation(operation:ConnectionOperation):operation is Extract<ConnectionOperation,{kind:'inspect'|'template'}>{return operation.kind==='inspect'||operation.kind==='template';}
export const operationResultSchema=z.discriminatedUnion('ok',[
  z.object({ok:z.literal(true),value:z.record(z.string(),z.unknown())}).strict(),
  z.object({ok:z.literal(false),error:z.object({code:z.enum(['INVALID_REQUEST','REVISION_CONFLICT','PERMISSION_DENIED','BUSY','CANCELLED','DISCONNECTED','OUTCOME_UNKNOWN','FAILED']),message:z.string().min(1).max(2048),revision:z.number().int().nonnegative().optional()}).strict()}).strict(),
]);
export type ConnectionResult=z.infer<typeof operationResultSchema>;
export const bridgeEventSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('request'),id:z.string().uuid(),operation:operationSchema}).strict(),
  z.object({kind:z.literal('cancel'),id:z.string().uuid()}).strict(),
  z.object({kind:z.literal('heartbeat')}).strict(),
]);
export type BridgeEvent=z.infer<typeof bridgeEventSchema>;
export function failure(code:Extract<ConnectionResult,{ok:false}>['error']['code'],message:string,revision?:number):ConnectionResult{return{ok:false,error:{code,message:message.slice(0,2048),...(revision===undefined?{}:{revision})}};}

/** Metadata budgets are independent of document geometry and original files. */
export function boundedJson(value:unknown):string{
  const pending=[{value,depth:0}];let budget=100_000;
  while(pending.length){const {value,depth}=pending.pop()!;if(--budget<0||depth>48)throw new Error('Connection metadata exceeds its complexity budget.');if(value&&typeof value==='object')for(const child of Object.values(value))pending.push({value:child,depth:depth+1});}
  const text=JSON.stringify(value);if(typeof text!=='string'||new TextEncoder().encode(text).length>MCP_METADATA_BYTES)throw new Error('Connection metadata exceeds its 2 MB budget. Original image resolution and file bytes are unchanged.');return text;
}
export function parseConnectionCode(value:string){
  const url=new URL(value.trim());
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.pathname!=='/'||url.search||!/^#canoli=[a-f0-9]{64}$/.test(url.hash))throw new Error('Paste the complete local Canoli connection code from the ChatGPT plugin.');
  return{origin:url.origin,code:url.hash.slice(8)};
}
