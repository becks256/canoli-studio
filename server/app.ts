import {captureRetainedHistory} from '../src/core/history';
import {historyTimeline,inspectHistoryChange} from '../src/core/history-inspection';
import {validateServerProjectSources} from "./project";
import {inspectServerRaw} from "./raw";
import {importServerRaw,developServerRawComponent} from "./raw-document";
import {RawDevelopment,SmartObjectLayer} from "../src/dom";
import {rawDecodeOptionsSchema,type RawImportControl} from "../src/core/interchange/raw/types";
import {rawSourceMetadata} from "../src/core/interchange/raw/source";
import {serializeProject} from "../src/core/project";
import { captureVectorBoolean, vectorBooleanSelectionSchema } from '../src/core/vector-boolean';
import { prepareServerVectorBoolean } from './vector-boolean';
import { z } from "zod";
import {prepareServerMatting} from './matting';
import {refineEdgeOptionsSchema} from '../src/core/matting';
import {preflightOptionsSchema} from '../src/core/preflight';
import {prepareServerPreflight} from './preflight';
import { prepareServerSubject } from './subject-selection';
import { selectSubjectOptionsSchema, subjectSource } from '../src/core/subject-selection';
import { transformSelection } from '../src/core/drawing';
import { AffineTransform } from '../src/core/affine';
import { prepareServerSelection, prepareServerChannelSelection } from "./selection";
import { channelLoadSchema } from '../src/core/alpha-channels';
import { prepareServerColorRange } from "./color-range";
import { prepareServerQuickSelection } from './quick-selection';
import { quickSelectionOptionsSchema } from '../src/core/quick-selection';
import { colorRangeOptionsSchema } from "../src/core/color-range";
import { selectionModificationSchema } from "../src/core/selection-modification";
import { tonalSculptSchema } from "../src/core/retouch/tonal-sculpt";
import { encodeRgbaPng } from "../src/engine/png";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { Document, LayerGroup, RasterLayer, VectorLayer } from "../src/dom";
import { AssetStore } from "../src/core/assets";
import { BLEND_MODES, id, findLayer, allLayers, type DocumentData } from "../src/core/model";
import {visitLayerAssets} from '../src/core/asset-references';
import { validateWetPaintAssets, wetDocumentOperations,commandHasWetPaint } from '../src/core/wet-assets';
import { execute } from '../src/core/commands';
import { wetServerAssets } from './wet-assets';
import {
  commandRequestSchema,
  createDocumentSchema,
  parseCommands,
  revisionSchema,
} from "../src/core/validation";

/** Legacy raster/clone DTO references remain metadata-only; authored textures require a session source. */
function validateTextureSources(document:DocumentData,assets:AssetStore){
  const trees=[document.children,...(document.components??[]).flatMap(definition=>definition.source.kind==='document'?[definition.source.document.children]:[])];
  for(const tree of trees)for(const layer of allLayers(tree))visitLayerAssets(layer,(reference,role)=>{if(role==='texture')assets.get(reference.assetId);});
}

function safeTokenCompare(
  provided: string | undefined,
  expected: string,
): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface ServerGenerationRequest {
  documentId: string;
  prompt: string;
  targetWidth: number;
  targetHeight: number;
}

export interface ApiServerOptions {
  authToken?: string;
  /** Explicit host integration. Returns decoded RGBA; owns provider authorization/billing. */
  executeGeneration?: (
    request: ServerGenerationRequest,
    signal: AbortSignal,
  ) => Promise<Uint8Array>;
}

export interface ServerJob {
  id: string;
  documentId: string;
  kind: "generation" | "analysis";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  prompt: string;
  idempotencyKey?: string;
  createdAt: string;
  completedAt?: string;
  progress: { phase: string; percent: number; message: string };
  candidate?: {
    id: string;
    assetId: string;
    width: number;
    height: number;
    reviewState: "staged" | "accepted";
  };
  error?: string;
}

interface DocumentSession {
  document: Document;
  assets: AssetStore;
}

export function createApiServer(options: ApiServerOptions = {}) {
  const configuredToken =
    options.authToken ??
    process.env.LUMA_API_KEY ??
    process.env.LUMA_AUTH_TOKEN;

  const sessions = new Map<string, DocumentSession>();
  const allJobs = new Map<string, ServerJob>();
  const idempotencyJobs = new Map<string, ServerJob>();
  const jobSignatures = new Map<string, string>();
  const controllers = new Map<string, AbortController>();
  const selectionControllers = new Map<AbortController, string>();

  const pruneJobs = () => {
    if (allJobs.size <= 100) return;
    const completed = [...allJobs.values()]
      .filter(
        (j) =>
          !j.idempotencyKey &&
          (j.status === "succeeded" ||
            j.status === "failed" ||
            j.status === "cancelled"),
      )
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );

    while (allJobs.size > 100 && completed.length > 0) {
      const oldest = completed.shift()!;
      allJobs.delete(oldest.id);
      jobSignatures.delete(oldest.id);
    }
  };

  const send = (
    response: ServerResponse,
    status: number,
    value: unknown,
    headers: Record<string, string> = {},
  ) => {
    response.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    });
    response.end(JSON.stringify(value));
  };

  async function rawScope<T>(document:Document,assets:AssetStore,control:RawImportControl,work:(control:RawImportControl,check:()=>void,beforeCommit:()=>void)=>Promise<T>):Promise<T>{
    control.signal?.throwIfAborted();const revision=document.getSnapshot().revision,alive=assets.captureLifetime(),abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason);
    control.signal?.addEventListener('abort',cancel,{once:true});selectionControllers.set(abort,document.id);
    const check=()=>{abort.signal.throwIfAborted();alive();const session=sessions.get(document.id);if(!session||session.document!==document||session.assets!==assets||document.getSnapshot().revision!==revision)throw new Error('Document session changed during RAW preparation.');};
    const stop=document.subscribe(()=>{try{check();}catch(error){abort.abort(error);}});
    try{return await work({signal:abort.signal,onProgress:control.onProgress},check,()=>{check();stop();});}
    finally{stop();control.signal?.removeEventListener('abort',cancel);selectionControllers.delete(abort);}
  }

  const readRawBody = async (
    request: IncomingMessage,
    maxBytes?: number,
  ): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (!Number.isSafeInteger(length)||maxBytes!==undefined&&length > maxBytes)
        throw new Error(`Request body exceeds ${maxBytes} bytes.`);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };

  const body = async (request: IncomingMessage,maxBytes:number|null=1_000_000) => {
    if (!request.headers["content-type"]?.startsWith("application/json"))
      throw new Error("Send application/json.");
    const buf = await readRawBody(request, maxBytes??undefined);
    return JSON.parse(buf.toString("utf8")) as unknown;
  };

  const snapshot = (document: Document) => ({
    document: document.toJSON(),
    revision: document.getSnapshot().revision,
    canUndo: document.canUndo,
    canRedo: document.canRedo,
  });

  const navigateHistory = (document:Document,run:()=>void) => {
    const revision=document.getSnapshot().revision;
    try {run();} catch(cause) {
      if(document.getSnapshot().revision===revision)throw cause;
      return {...snapshot(document),warning:'History moved, but an observer failed. Inspect the document before retrying.'};
    }
    return snapshot(document);
  };

  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    const trustedOrigins = [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      "http://127.0.0.1:4173",
      "http://localhost:4173",
    ];
    // Defense against cross-site requests and DNS rebinding to this local service.
    const host = request.headers.host?.split(":")[0];
    if (
      !["localhost", "127.0.0.1"].includes(host ?? "") ||
      (origin && !trustedOrigins.includes(origin))
    ) {
      send(response, 403, {
        error:
          "This local API only accepts loopback clients and the local editor origin.",
      });
      return;
    }
    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      response.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, DELETE, OPTIONS",
      );
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-API-Key, X-Asset-Name, X-Asset-Width, X-Asset-Height",
      );
      response.writeHead(204);
      response.end();
      return;
    }

    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = request.method;

      // Authentication verification
      const authHeader = request.headers.authorization;
      const apiKeyHeader = request.headers["x-api-key"] as string | undefined;
      const bearerToken = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : undefined;
      const providedToken = bearerToken ?? apiKeyHeader;

      if (configuredToken && path !== "/api/v1/health") {
        if (!safeTokenCompare(providedToken, configuredToken)) {
          send(
            response,
            401,
            { error: "Unauthorized: Invalid or missing authentication token." },
            { "WWW-Authenticate": 'Bearer realm="Canoli Studio REST API"' },
          );
          return;
        }
      }

      if (path === "/api/v1/health" && method === "GET") {
        send(response, 200, {
          status: "ok",
          storage: "memory",
          scope: "document-model",
          authenticated: Boolean(configuredToken),
        });
        return;
      }

      // GET /api/v1/documents or POST /api/v1/documents
      if (path === "/api/v1/documents") {
        if (method === "GET") {
          send(response, 200, {
            documents: [...sessions.values()].map((s) => ({
              id: s.document.id,
              name: s.document.name,
              revision: s.document.getSnapshot().revision,
            })),
          });
          return;
        }
        if (method === "POST") {
          if (sessions.size >= 100) {
            send(response, 409, {
              error: "Local session limit: 100 documents.",
            });
            return;
          }
          const document = new Document(
            createDocumentSchema.parse(await body(request)),
          );
          document._prepareSelectionModification = async (settings,control) => {
            const selection = await prepareServerSelection({...settings,selection:document.getSnapshot().document.selection!,width:document.width,height:document.height},control.signal ?? new AbortController().signal);
            if (!sessions.has(document.id)) throw new Error("Document was deleted.");
            return selection;
          };
          document._prepareVectorBoolean=async(selection,control)=>{
            const snapshot=document.getSnapshot(),request=captureVectorBoolean(snapshot.document,selection).request,abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason);
            control.signal?.throwIfAborted();control.signal?.addEventListener('abort',cancel,{once:true});
            const unsubscribe=document.subscribe(()=>{if(document.getSnapshot().revision!==snapshot.revision)abort.abort(new Error('Document changed during the Boolean operation.'));});
            try{const result=await prepareServerVectorBoolean(request,{signal:abort.signal,onProgress:control.onProgress});if(!sessions.has(document.id))throw new Error('Document was deleted.');return result;}
            finally{unsubscribe();control.signal?.removeEventListener('abort',cancel);}
          };
          document._prepareChannelLoad=async(settings,control)=>{
            const snapshot=document.getSnapshot(),channel=snapshot.document.alphaChannels?.find(entry=>entry.id===settings.id);
            if(!channel)throw new Error('Alpha channel not found.');
            const abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason);
            control.signal?.throwIfAborted();control.signal?.addEventListener('abort',cancel,{once:true});
            const unsubscribe=document.subscribe(()=>{if(document.getSnapshot().revision!==snapshot.revision)abort.abort(new Error('Document changed while loading its alpha channel.'));});
            try{
              const selection=await prepareServerChannelSelection({operation:settings.operation,invert:settings.invert,selection:channel.selection,base:snapshot.document.selection??null,width:document.width,height:document.height},abort.signal);
              if(!sessions.has(document.id))throw new Error('Document was deleted.');return selection;
            }finally{unsubscribe();control.signal?.removeEventListener('abort',cancel);}
          };
          const assets = new AssetStore();document.assetStore=assets;
          document._prepareRawDevelopment=(layerId,development,control)=>rawScope(document,assets,control,(native,current,beforeCommit)=>developServerRawComponent(document,assets,layerId,{development,allowPrecisionLoss:control.allowPrecisionLoss??false},native,current,beforeCommit));
          document._preflight=async(options,control)=>{
            const snapshot=document.getSnapshot(),originals=assets.values(),alive=assets.captureLifetime();
            const report=await prepareServerPreflight(snapshot.document,snapshot.revision,options,originals.map(asset=>[asset.id,{width:asset.width,height:asset.height}]),control.signal??new AbortController().signal);
            alive();if(!sessions.has(document.id))throw new Error('Document was deleted during design checks.');for(const asset of originals)if(assets.get(asset.id)!==asset)throw new Error('Source assets changed during design checks.');return report;
          };
          document._prepareMatting=async(request,control)=>{
            const snapshot=document.getSnapshot(),alive=assets.captureLifetime(),abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason);
            control.signal?.throwIfAborted();control.signal?.addEventListener('abort',cancel,{once:true});
            const source=findLayer(snapshot.document,request.layerId),keys=new Set<string>();if(source?.kind==='raster')keys.add(source.assetId);if(source?.mask?.kind==='bitmap')keys.add(source.mask.assetId);if(request.options.trimapAssetId)keys.add(request.options.trimapAssetId);
            const originals=new Map([...keys].map(key=>[key,assets.get(key)]));
            const check=()=>{abort.signal.throwIfAborted();alive();if(!sessions.has(document.id)||document.getSnapshot().revision!==snapshot.revision)throw new Error('Document changed during matting.');for(const [key,asset] of originals)if(assets.get(key)!==asset)throw new Error('Matting source changed.');};
            const unsubscribe=document.subscribe(()=>{if(document.getSnapshot().revision!==snapshot.revision)abort.abort(new Error('Document changed during matting.'));});
            try{return await prepareServerMatting(snapshot.document,assets,request,abort.signal,check,()=>document.getSnapshot().revision!==snapshot.revision);}
            finally{unsubscribe();control.signal?.removeEventListener('abort',cancel);}
          };
          document._prepareSubject=async(settings,control)=>{
            const source=subjectSource(document.getSnapshot().document,settings,id=>assets.get(id)),asset=assets.get(source.assetId),revision=document.getSnapshot().revision;
            const abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason);
            control.signal?.throwIfAborted();control.signal?.addEventListener('abort',cancel,{once:true});
            const unsubscribe=document.subscribe(()=>{if(document.getSnapshot().revision!==revision)abort.abort(new Error('Document changed during Select Subject.'));});
            try{
              const selection=await prepareServerSubject(settings,asset,abort.signal);
              if(!sessions.has(document.id)||assets.get(asset.id)!==asset)throw new Error('Select Subject source session changed.');
              return transformSelection(selection,AffineTransform.fromJSON(source.transform))!;
            }finally{unsubscribe();control.signal?.removeEventListener('abort',cancel);}
          };
          document._prepareQuickSelection=async(settings,control)=>{
            if(settings.source.kind!=='asset')throw new Error('Headless Quick Selection requires an explicit PNG asset source.');
            const asset=assets.get(settings.source.assetId),revision=document.getSnapshot().revision,abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason);
            control.signal?.throwIfAborted();control.signal?.addEventListener('abort',cancel,{once:true});
            const unsubscribe=document.subscribe(()=>{if(document.getSnapshot().revision!==revision)abort.abort(new Error('Document changed during Quick Selection.'));});
            try{
              const selection=await prepareServerQuickSelection(settings,asset,document.width,document.height,abort.signal);
              if(!sessions.has(document.id)||assets.get(asset.id)!==asset)throw new Error('Quick Selection source session changed.');return selection;
            }finally{unsubscribe();control.signal?.removeEventListener('abort',cancel);}
          };
          document._prepareColorRange=async(settings,control)=>{
            if(settings.source.kind!=='asset')throw new Error('Headless Color Range requires source.kind asset; browser composite/layer rendering is unavailable.');
            const asset=assets.get(settings.source.assetId);
            const revision=document.getSnapshot().revision,abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason);
            control.signal?.throwIfAborted();control.signal?.addEventListener('abort',cancel,{once:true});
            const unsubscribe=document.subscribe(()=>{if(document.getSnapshot().revision!==revision)abort.abort(new Error('Document changed during Color Range sampling.'));});
            try{
              const selection=await prepareServerColorRange(settings,asset,document.width,document.height,abort.signal);
              if(!sessions.has(document.id)||assets.get(asset.id)!==asset)throw new Error('Color Range source session changed.');
              return selection;
            }finally{unsubscribe();control.signal?.removeEventListener('abort',cancel);}
          };
          sessions.set(document.id, { document, assets });
          send(response, 201, snapshot(document));
          return;
        }
      }

      // GET /api/v1/jobs/:jobId
      const jobMatch = path.match(/^\/api\/v1\/jobs\/([^/]+)(?:\/(cancel))?$/);
      if (jobMatch) {
        const jobId = jobMatch[1];
        const isCancel = jobMatch[2] === "cancel";
        const job = allJobs.get(jobId);
        if (!job) {
          send(response, 404, { error: "Job not found." });
          return;
        }
        if (isCancel && method === "POST") {
          if (job.status === "queued" || job.status === "running") {
            controllers.get(jobId)?.abort(new Error("Job cancelled"));
            job.status = "cancelled";
            job.completedAt = new Date().toISOString();
            job.progress = {
              phase: "cancelled",
              percent: job.progress.percent,
              message: "Job cancelled",
            };
          }
          send(response, 200, { job });
          return;
        }
        if (!isCancel && method === "GET") {
          send(response, 200, { job });
          return;
        }
      }

      // Document scoped endpoints: /api/v1/documents/:id/...
      const docMatch = path.match(
        /^\/api\/v1\/documents\/([^/]+)(?:\/(commands|undo|redo|history|history-branches|assets|jobs|apply-candidate|tonal-sculpt|selection-modify|color-range|alpha-channel-load|quick-selection|select-subject|refine-edge|preflight|vector-boolean|raw-import|raw-inspect|raw-develop|project))?(?:\/([^/]+))?$/,
      );
      if (!docMatch || !sessions.has(docMatch[1])) {
        send(response, 404, { error: "Document or endpoint not found." });
        return;
      }

      const session = sessions.get(docMatch[1])!;
      const document = session.document;
      const subresource = docMatch[2];
      const subresourceId = docMatch[3];
      if((subresource==='raw-import'||subresource==='raw-inspect')&&!subresourceId&&method==='POST'){
        const parsed=revisionSchema.parse({expectedRevision:url.searchParams.has('expectedRevision')?Number(url.searchParams.get('expectedRevision')):undefined}),revision=document.getSnapshot().revision;
        if(parsed.expectedRevision!==revision){send(response,409,{error:'Revision conflict. Read the document and retry.',revision});return;}
        const header=request.headers['x-raw-options'];if(header!==undefined&&typeof header!=='string')throw new Error('Invalid RAW options header.');
        const options=rawDecodeOptionsSchema.parse(JSON.parse(header??'{}'));if(subresource==='raw-import'&&!options.allowPrecisionLoss)throw new Error('RAW working output requires explicit 8-bit precision-loss consent.');
        const name=z.string().min(1).parse(url.searchParams.get('name')??request.headers['x-asset-name']??'Camera RAW'),mime=(request.headers['content-type']??'application/octet-stream').split(';')[0].trim();
        if(mime==='application/json')throw new Error('Send binary RAW file bytes.');
        const abort=new AbortController(),close=()=>{if(!response.writableEnded)abort.abort(new Error('RAW request disconnected.'));};response.on('close',close);
        try{
          const result=await rawScope(document,session.assets,{signal:abort.signal},async(control,current,beforeCommit)=>{
            const bytes=await readRawBody(request);current();const blob=new Blob([new Uint8Array(bytes)],{type:mime});
            if(subresource==='raw-inspect'){const report=await inspectServerRaw(blob,options.development.image,control);current();return{report};}
            return importServerRaw(document,session.assets,blob,name,options,control,current,beforeCommit);
          });send(response,subresource==='raw-inspect'?200:201,{...snapshot(document),...result});
        }catch(error){if(!sessions.has(document.id)){send(response,404,{error:'Document was deleted during RAW import.'});}else if(document.getSnapshot().revision!==revision)send(response,409,{error:'Document changed during RAW import.',revision:document.getSnapshot().revision});else throw error;}
        finally{response.off('close',close);}return;
      }
      if(subresource==='raw-develop'&&!subresourceId&&method==='POST'){
        const parsed=z.object({...revisionSchema.shape,layerId:z.string().min(1).max(240),options:rawDecodeOptionsSchema}).strict().parse(await body(request,16_000_000)),revision=document.getSnapshot().revision;
        if(parsed.expectedRevision!==revision){send(response,409,{error:'Revision conflict. Read the document and retry.',revision});return;}
        const layer=document.getLayer(parsed.layerId);if(!(layer instanceof SmartObjectLayer))throw new Error('Choose an attached RAW smart object.');
        const abort=new AbortController(),close=()=>{if(!response.writableEnded)abort.abort(new Error('RAW request disconnected.'));};response.on('close',close);
        try{const report=await layer.developRaw(new RawDevelopment(parsed.options.development),{signal:abort.signal,allowPrecisionLoss:parsed.options.allowPrecisionLoss});send(response,200,{...snapshot(document),report});}
        catch(error){if(!sessions.has(document.id))send(response,404,{error:'Document was deleted during RAW development.'});else if(document.getSnapshot().revision!==revision)send(response,409,{error:'Document changed during RAW development.',revision:document.getSnapshot().revision});else throw error;}
        finally{response.off('close',close);}return;
      }
      if(subresource==='project'&&!subresourceId&&method==='GET'){
        const state=document.getSnapshot(),history=url.searchParams.get('history')==='true'?captureRetainedHistory(state):undefined;
        const abort=new AbortController(),close=()=>{if(!response.writableEnded)abort.abort(new Error('Project download disconnected.'));};response.on('close',close);selectionControllers.set(abort,document.id);
        try{
          await validateServerProjectSources(state.document,session.assets,history,abort.signal);
          const file=await serializeProject(state.document,session.assets,history),bytes=await file.arrayBuffer();abort.signal.throwIfAborted();
          if(sessions.get(document.id)!==session)throw new Error('Document was deleted during project encoding.');
          response.writeHead(200,{'Content-Type':'application/x-luma','Content-Length':String(bytes.byteLength),'Cache-Control':'no-store'});response.end(Buffer.from(bytes));
        }finally{response.off('close',close);selectionControllers.delete(abort);}return;
      }
      if(subresource==='preflight'&&!subresourceId&&method==='POST'){
        const parsed=z.object({...revisionSchema.shape,options:preflightOptionsSchema.optional()}).strict().parse(await body(request)),revision=document.getSnapshot().revision;
        if(parsed.expectedRevision!==revision){send(response,409,{error:'Revision conflict. Read the document and retry.',revision});return;}
        if(selectionControllers.size>=4){send(response,409,{error:'Inspection workers are busy. Retry after an active operation finishes.'});return;}
        const abort=new AbortController();selectionControllers.set(abort,document.id);const cancel=()=>{if(!response.writableEnded)abort.abort(new Error('Design-check request disconnected.'));};response.on('close',cancel);
        const unsubscribe=document.subscribe(()=>{if(document.getSnapshot().revision!==revision)abort.abort(new Error('Document changed during design checks.'));});
        try{send(response,200,{report:await document.preflight(parsed.options,{signal:abort.signal})});}
        catch(error){if(document.getSnapshot().revision!==revision)send(response,409,{error:'Document changed during design checks.',revision:document.getSnapshot().revision});else throw error;}
        finally{unsubscribe();selectionControllers.delete(abort);response.off('close',cancel);}return;
      }
      if(subresource==='refine-edge'&&!subresourceId&&method==='POST'){
        const parsed=z.object({...revisionSchema.shape,layerId:z.string().min(1).max(240),options:z.unknown().optional()}).strict().parse(await body(request)),revision=document.getSnapshot().revision;
        if(parsed.expectedRevision!==revision){send(response,409,{error:'Revision conflict. Read the document and retry.',revision});return;}
        const options=refineEdgeOptionsSchema.parse(parsed.options??{}),layer=document.getLayer(parsed.layerId);if(!(layer instanceof RasterLayer))throw new Error('Refine Edge requires a raster layer.');
        if(selectionControllers.size>=4){send(response,409,{error:'Selection workers are busy. Retry after an active operation finishes.'});return;}
        const abort=new AbortController();selectionControllers.set(abort,document.id);const close=()=>{if(!response.writableEnded)abort.abort(new Error('Client disconnected.'));};response.on('close',close);
        try{await layer.refineEdge(options,{signal:abort.signal});send(response,200,snapshot(document));}
        catch(error){if(document.getSnapshot().revision!==revision)send(response,409,{error:'Revision conflict. Read the document and retry.',revision:document.getSnapshot().revision});else throw error;}
        finally{selectionControllers.delete(abort);response.off('close',close);}return;
      }
      if(subresource==='select-subject'&&!subresourceId&&method==='POST'){
        const parsed=selectSubjectOptionsSchema.extend(revisionSchema.shape).parse(await body(request)),revision=document.getSnapshot().revision;
        if(parsed.expectedRevision!==revision){send(response,409,{error:'Revision conflict. Read the document and retry.',revision});return;}
        if(selectionControllers.size>=4){send(response,409,{error:'Selection workers are busy. Retry after an active operation finishes.'});return;}
        const {expectedRevision,...settings}=parsed,abort=new AbortController();selectionControllers.set(abort,document.id);
        const close=()=>{if(!response.writableEnded)abort.abort(new Error('Client disconnected.'));};response.on('close',close);
        try{await document.selectSubject(settings,{signal:abort.signal});send(response,200,snapshot(document));}
        catch(error){if(document.getSnapshot().revision!==revision)send(response,409,{error:'Revision conflict. Read the document and retry.',revision:document.getSnapshot().revision});else throw error;}
        finally{selectionControllers.delete(abort);response.off('close',close);}return;
      }
      if(subresource==='quick-selection'&&!subresourceId&&method==='POST'){
        const parsed=quickSelectionOptionsSchema.extend(revisionSchema.shape).parse(await body(request)),revision=document.getSnapshot().revision;
        if(parsed.expectedRevision!==revision){send(response,409,{error:'Revision conflict. Read the document and retry.',revision});return;}
        if(selectionControllers.size>=4){send(response,409,{error:'Selection workers are busy. Retry after an active operation finishes.'});return;}
        const {expectedRevision,...settings}=parsed,abort=new AbortController();selectionControllers.set(abort,document.id);
        const close=()=>{if(!response.writableEnded)abort.abort(new Error('Client disconnected.'));};response.on('close',close);
        try{await document.selectQuickSelection(settings,{signal:abort.signal});send(response,200,snapshot(document));}
        catch(error){if(document.getSnapshot().revision!==revision)send(response,409,{error:'Revision conflict. Read the document and retry.',revision:document.getSnapshot().revision});else throw error;}
        finally{selectionControllers.delete(abort);response.off('close',close);}return;
      }
      if(subresource==='alpha-channel-load'&&!subresourceId&&method==='POST'){
        const parsed=channelLoadSchema.extend(revisionSchema.shape).parse(await body(request)),revision=document.getSnapshot().revision;
        if(parsed.expectedRevision!==revision){send(response,409,{error:'Revision conflict. Read the document and retry.',revision});return;}
        if(selectionControllers.size>=4){send(response,409,{error:'Selection workers are busy. Retry after an active operation finishes.'});return;}
        const {expectedRevision,id,...settings}=parsed,channel=document.alphaChannels.getById(id);
        if(!channel)throw new Error('Alpha channel not found.');
        const abort=new AbortController();selectionControllers.set(abort,document.id);
        const close=()=>{if(!response.writableEnded)abort.abort(new Error('Client disconnected.'));};response.on('close',close);
        try{await channel.load(settings,{signal:abort.signal});send(response,200,snapshot(document));}
        catch(error){if(document.getSnapshot().revision!==revision)send(response,409,{error:'Revision conflict. Read the document and retry.',revision:document.getSnapshot().revision});else throw error;}
        finally{selectionControllers.delete(abort);response.off('close',close);}return;
      }
      if(subresource==='color-range'&&!subresourceId&&method==='POST'){
        const parsed=colorRangeOptionsSchema.extend(revisionSchema.shape).parse(await body(request)),revision=document.getSnapshot().revision;
        if(parsed.expectedRevision!==revision){send(response,409,{error:'Revision conflict. Read the document and retry.',revision});return;}
        if(selectionControllers.size>=4){send(response,409,{error:'Selection workers are busy. Retry after an active operation finishes.'});return;}
        const {expectedRevision,...settings}=parsed,abort=new AbortController();selectionControllers.set(abort,document.id);
        const close=()=>{if(!response.writableEnded)abort.abort(new Error('Client disconnected.'));};response.on('close',close);
        try{await document.selectColorRange(settings,{signal:abort.signal});send(response,200,snapshot(document));}
        catch(error){if(document.getSnapshot().revision!==revision)send(response,409,{error:'Revision conflict. Read the document and retry.',revision:document.getSnapshot().revision});else throw error;}
        finally{selectionControllers.delete(abort);response.off('close',close);}return;
      }
      if(subresource==='vector-boolean'&&!subresourceId&&method==='POST'){
        const parsed=vectorBooleanSelectionSchema.extend(revisionSchema.shape).parse(await body(request)),revision=document.getSnapshot().revision;
        if(parsed.expectedRevision!==revision){send(response,409,{error:'Revision conflict. Read the document and retry.',revision});return;}
        if(selectionControllers.size>=4){send(response,409,{error:'Native workers are busy. Retry after an active operation finishes.'});return;}
        const paths=parsed.operands.map(ref=>{const layer=document.getLayer(ref.layerId);if(!(layer instanceof VectorLayer))throw new Error('Select vector layers.');const path=layer.paths.get(ref.pathId);if(!path)throw new Error('Boolean operand path not found.');return path;});
        const abort=new AbortController();selectionControllers.set(abort,document.id);const close=()=>{if(!response.writableEnded)abort.abort(new Error('Client disconnected.'));};response.on('close',close);
        try{const path=await document.combinePaths(parsed.operation,paths,{signal:abort.signal});send(response,200,{...snapshot(document),result:path?{layerId:parsed.operands[0].layerId,pathId:path.id}:null});}
        catch(error){if(document.getSnapshot().revision!==revision)send(response,409,{error:'Revision conflict. Read the document and retry.',revision:document.getSnapshot().revision});else throw error;}
        finally{selectionControllers.delete(abort);response.off('close',close);}return;
      }
      if (subresource === "selection-modify" && !subresourceId && method === "POST") {
        const parsed = selectionModificationSchema.extend(revisionSchema.shape).parse(await body(request));
        const revision = document.getSnapshot().revision;
        if (parsed.expectedRevision !== revision) {
          send(response,409,{error:"Revision conflict. Read the document and retry.",revision});
          return;
        }
        if (selectionControllers.size >= 4) {
          send(response,409,{error:"Selection workers are busy. Retry after an active operation finishes."});
          return;
        }
        const abort = new AbortController();
        selectionControllers.set(abort,document.id);
        const close = () => { if (!response.writableEnded) abort.abort(new Error("Client disconnected.")); };
        response.on("close",close);
        try {
          await document.modifySelection({operation:parsed.operation,radius:parsed.radius},{signal:abort.signal});
          if (!sessions.has(document.id)) throw new Error("Document was deleted.");
          send(response,200,snapshot(document));
        } catch (error) {
          if (document.getSnapshot().revision !== revision) send(response,409,{error:"Revision conflict. Read the document and retry.",revision:document.getSnapshot().revision});
          else throw error;
        } finally {
          selectionControllers.delete(abort);
          response.off("close",close);
        }
        return;
      }

      // GET /api/v1/documents/:id
      if (!subresource && method === "GET") {
        send(response, 200, snapshot(document));
        return;
      }

      // DELETE /api/v1/documents/:id
      if (!subresource && method === "DELETE") {
        const input = await body(request);
        const parsed = revisionSchema.parse(input);
        if (parsed.expectedRevision !== document.getSnapshot().revision) {
          send(response, 409, {
            error: "Revision conflict. Read the document and retry.",
            revision: document.getSnapshot().revision,
          });
          return;
        }
        for (const job of allJobs.values()) {
          if (
            job.documentId === document.id &&
            (job.status === "queued" || job.status === "running")
          ) {
            controllers.get(job.id)?.abort(new Error("Document deleted"));
            job.status = "cancelled";
            job.completedAt = new Date().toISOString();
          }
        }
        sessions.delete(document.id);
        for (const [controller,documentId] of selectionControllers)
          if (documentId === document.id) controller.abort(new Error("Document was deleted."));
        send(response, 200, { deleted: document.id });
        return;
      }

      // POST /api/v1/documents/:id/commands
      if (
        subresource === "tonal-sculpt" &&
        !subresourceId &&
        method === "POST"
      ) {
        const parsed = tonalSculptSchema
          .extend(revisionSchema.shape)
          .parse(await body(request));
        if (parsed.expectedRevision !== document.getSnapshot().revision) {
          send(response, 409, {
            error: "Revision conflict. Read the document and retry.",
            revision: document.getSnapshot().revision,
          });
          return;
        }
        let layer!:ReturnType<Document['applyTonalSculpt']>;
        document.transaction('Tonal sculpt',()=>{
          layer = document.applyTonalSculpt(parsed.path,parsed.mode,parsed.range,parsed.exposure,parsed.options);
          validateTextureSources(document._read(),session.assets);
        });
        send(response, 200, { ...snapshot(document), layerId: layer.id });
        return;
      }

      if (subresource === "commands" && method === "POST") {
        const input = await body(request);
        const parsed = commandRequestSchema.parse(input);
        if (parsed.expectedRevision !== document.getSnapshot().revision) {
          send(response, 409, {
            error: "Revision conflict. Read the document and retry.",
            revision: document.getSnapshot().revision,
          });
          return;
        }
        const commands = parseCommands(parsed.commands);
        if (commands.some(commandHasWetPaint) || !wetDocumentOperations(document._read()).next().done) {
          const candidate = execute(document._read(), { type: 'transaction', label: parsed.label ?? 'REST transaction', commands });
          try {
            await validateWetPaintAssets(candidate, wetServerAssets(session.assets, () => {
              if (sessions.get(document.id) !== session || document.getSnapshot().revision !== parsed.expectedRevision) throw new Error('Document changed during wet-paint validation.');
            }));
          } catch (error) {
            if (document.getSnapshot().revision !== parsed.expectedRevision) { send(response,409,{error:'Revision conflict. Read the document and retry.',revision:document.getSnapshot().revision}); return; }
            throw error;
          }
          if (sessions.get(document.id) !== session) { send(response,404,{error:'Document not found.'}); return; }
          if (document.getSnapshot().revision !== parsed.expectedRevision) { send(response,409,{error:'Revision conflict. Read the document and retry.',revision:document.getSnapshot().revision}); return; }
        }
        document.transaction(parsed.label ?? "REST transaction", () => {
          commands.forEach((command) => document._dispatch(command));
          validateTextureSources(document._read(),session.assets);
        });
        send(response, 200, snapshot(document));
        return;
      }

      // History navigation shares the ordinary retained-state/recipe boundary.
      if (subresource === 'history-branches' && !docMatch[3]) {
        const branches = () => {
          const state = document.getSnapshot();
          return {activeBranchId: state.activeBranchId, branches: state.branches.map(branch => ({id: branch.id, name: branch.name, parentId: branch.parentId, retainedTransitions: branch.tip.past.length}))};
        };
        if (method === 'GET') {send(response, 200, {revision: document.getSnapshot().revision, ...branches()}); return;}
        if (method === 'POST') {
          const common = {...revisionSchema.shape, branchId: z.uuid()};
          const input = z.discriminatedUnion('action', [
            z.object({...revisionSchema.shape, action: z.literal('create'), name: z.string().trim().min(1).max(120)}).strict(),
            z.object({...common, action: z.literal('checkout')}).strict(),
            z.object({...common, action: z.literal('rename'), name: z.string().trim().min(1).max(120)}).strict(),
            z.object({...common, action: z.literal('delete')}).strict(),
          ]).parse(await body(request));
          if (input.expectedRevision !== document.getSnapshot().revision) {send(response, 409, {error: 'Revision conflict. Read the document and retry.', revision: document.getSnapshot().revision}); return;}
          const result = navigateHistory(document, () => {
            if (input.action === 'create') document.createHistoryBranch(input.name);
            else if (input.action === 'checkout') document.checkoutHistoryBranch(input.branchId);
            else if (input.action === 'rename') document.renameHistoryBranch(input.branchId, input.name);
            else document.deleteHistoryBranch(input.branchId);
          });
          send(response, 200, {...result, ...branches()}); return;
        }
      }
      if (subresource === 'history' && !docMatch[3] && method === 'GET') {
        const state=document.getSnapshot(),timeline=historyTimeline(state);
        const position=url.searchParams.has('position')?z.coerce.number().int().min(0).max(timeline.length-1).parse(url.searchParams.get('position')):null;
        send(response,200,{revision:state.revision,position:state.past.length,length:timeline.length,
          states:timeline.map(item=>({position:item.position,label:item.label,labelTruncated:item.labelTruncated})),
          ...(position===null?{}:{change:inspectHistoryChange(position?timeline[position-1].document:null,timeline[position].document)})});return;
      }
      if (subresource === 'history' && !docMatch[3] && method === 'POST') {
        const parsed=z.object({...revisionSchema.shape,position:z.number().int().nonnegative().safe()}).strict().parse(await body(request));
        if(parsed.expectedRevision!==document.getSnapshot().revision){send(response,409,{error:'Revision conflict. Read the document and retry.',revision:document.getSnapshot().revision});return;}
        send(response,200,navigateHistory(document,()=>document.navigateHistory(parsed.position)));return;
      }

      // POST /api/v1/documents/:id/undo or redo
      if (
        (subresource === "undo" || subresource === "redo") &&
        method === "POST"
      ) {
        const input = await body(request);
        const parsed = revisionSchema.parse(input);
        if (parsed.expectedRevision !== document.getSnapshot().revision) {
          send(response, 409, {
            error: "Revision conflict. Read the document and retry.",
            revision: document.getSnapshot().revision,
          });
          return;
        }
        send(response, 200, navigateHistory(document,()=>{if (subresource === "undo") document.undo();else document.redo();}));
        return;
      }

      // ASSETS ENDPOINTS:
      // POST /api/v1/documents/:id/assets
      // GET /api/v1/documents/:id/assets
      // GET /api/v1/documents/:id/assets/:assetId
      if (subresource === "assets") {
        if (!subresourceId && method === "GET") {
          send(response, 200, {
            assets: session.assets.values().map((a) => ({
              id: a.id,
              name: a.name,
              width: a.width,
              height: a.height,
              ...(a.raw?{raw:rawSourceMetadata(a.raw)}:{}),
            })),
          });
          return;
        }

        if (subresourceId && method === "GET") {
          if (!session.assets.has(subresourceId)) {
            send(response, 404, { error: `Asset not found: ${subresourceId}` });
            return;
          }
          const asset = session.assets.get(subresourceId);
          if(url.searchParams.get('original')==='true'){
            if(!asset.raw){send(response,404,{error:'No retained RAW original for this asset.'});return;}
            const blob=asset.raw.originalBlob,bytes=await blob.arrayBuffer();response.writeHead(200,{'Content-Type':blob.type||'application/octet-stream','Content-Length':String(bytes.byteLength),'Cache-Control':'no-store'});response.end(Buffer.from(bytes));return;
          }
          const accept = request.headers.accept ?? "";
          const isRaw =
            accept.includes("image/") || url.searchParams.get("raw") === "true";

          if (isRaw) {
            const arrayBuffer = await asset.blob.arrayBuffer();
            response.writeHead(200, {
              "Content-Type": asset.blob.type || "image/png",
              "Content-Length": String(arrayBuffer.byteLength),
              "Cache-Control": "no-store",
            });
            response.end(Buffer.from(arrayBuffer));
            return;
          }

          send(response, 200, {
            asset: {
              id: asset.id,
              name: asset.name,
              width: asset.width,
              height: asset.height,
              mimeType: asset.blob.type || "image/png",
              byteLength: asset.blob.size,
              ...(asset.raw?{raw:rawSourceMetadata(asset.raw)}:{}),
            },
          });
          return;
        }

        if (!subresourceId && method === "POST") {
          const contentType = request.headers["content-type"] ?? "";
          let assetName =
            (request.headers["x-asset-name"] as string) ?? "Uploaded image";
          let width = Number(request.headers["x-asset-width"]) || 0;
          let height = Number(request.headers["x-asset-height"]) || 0;
          let mime = "image/png";
          let buffer: Buffer;

          if (contentType.startsWith("application/json")) {
            const jsonBody = (await body(request,null)) as {
              name?: string;
              data?: string;
              width?: number;
              height?: number;
              contentType?: string;
            };
            if (!jsonBody.data || typeof jsonBody.data !== "string") {
              send(response, 400, {
                error: "Missing required 'data' base64 string in JSON body.",
              });
              return;
            }
            assetName = jsonBody.name ?? assetName;
            width = jsonBody.width ?? width;
            height = jsonBody.height ?? height;
            mime = jsonBody.contentType ?? "image/png";
            buffer = Buffer.from(
              jsonBody.data.replace(/^data:image\/[^;]+;base64,/, ""),
              "base64",
            );
          } else {
            mime = contentType.split(";")[0].trim() || "image/png";
            buffer = await readRawBody(request);
          }

          // Parse dimensions from PNG header if available (bytes 16..23)
          if (
            buffer.length >= 24 &&
            buffer[0] === 137 &&
            buffer[1] === 80 &&
            buffer[2] === 78 &&
            buffer[3] === 71
          ) {
            const detectedWidth = buffer.readUInt32BE(16);
            const detectedHeight = buffer.readUInt32BE(20);
            if (detectedWidth > 0 && detectedHeight > 0) {
              width = detectedWidth;
              height = detectedHeight;
            }
          }

          if (width <= 0) width = 512;
          if (height <= 0) height = 512;

          const assetId = id();
          const blob = new Blob([new Uint8Array(buffer)], { type: mime });
          session.assets.install(
            {
              id: assetId,
              name: assetName.slice(0, 240),
              width,
              height,
              blob,
              bitmap: { width, height, close() {} } as unknown as ImageBitmap,
              thumbnail: "",
            },
            false,
          );

          send(response, 201, {
            asset: {
              id: assetId,
              name: assetName,
              width,
              height,
              mimeType: mime,
              byteLength: buffer.length,
            },
          });
          return;
        }
      }

      // JOBS ENDPOINTS:
      // POST /api/v1/documents/:id/jobs
      if (subresource === "jobs" && method === "POST") {
        const input = z
          .object({
            kind: z.enum(["generation", "analysis"]).default("generation"),
            prompt: z
              .string()
              .trim()
              .min(1)
              .max(1000)
              .default("Untitled generation"),
            targetWidth: z.number().int().positive().default(512),
            targetHeight: z.number().int().positive().default(512),
            idempotencyKey: z.string().trim().min(1).max(240).optional(),
            expectedRevision: z.number().int().nonnegative().optional(),
          })
          .strict()
          .parse(await body(request));
        const { targetWidth, targetHeight, prompt } = input;
        if (!Number.isSafeInteger(targetWidth * targetHeight * 4))
          throw new Error("Invalid output geometry.");
        const requestKey = input.idempotencyKey
          ? JSON.stringify([document.id, input.idempotencyKey])
          : undefined;
        const signature = JSON.stringify([
          input.kind,
          prompt,
          targetWidth,
          targetHeight,
        ]);

        if (
          input.expectedRevision !== undefined &&
          input.expectedRevision !== document.getSnapshot().revision
        ) {
          send(response, 409, {
            error: "Revision conflict. Read the document and retry.",
            revision: document.getSnapshot().revision,
          });
          return;
        }

        // Bind keys to this document and normalized request content.
        if (requestKey && idempotencyJobs.has(requestKey)) {
          const existing = idempotencyJobs.get(requestKey)!;
          if (jobSignatures.get(existing.id) !== signature) {
            send(response, 409, {
              error: "Idempotency key belongs to a different request.",
            });
          } else send(response, 200, { job: existing });
          return;
        }
        if (input.kind !== "generation") {
          send(response, 501, {
            error: "REST analysis jobs are not implemented.",
          });
          return;
        }
        const executor = options.executeGeneration;
        if (!executor) {
          send(response, 503, {
            error:
              "No REST generation executor is configured. No provider was called.",
          });
          return;
        }

        // Concurrency cap: max 10 active jobs
        const activeCount = [...allJobs.values()].filter(
          (j) => j.status === "queued" || j.status === "running",
        ).length;
        if (activeCount >= 10) {
          send(response, 429, {
            error: "Concurrent job limit reached (10 maximum). Retry shortly.",
          });
          return;
        }

        const jobId = id();
        const candidateId = id();
        const assetId = id();

        const job: ServerJob = {
          id: jobId,
          documentId: document.id,
          kind: "generation",
          status: "queued",
          prompt,
          idempotencyKey: input.idempotencyKey
            ? String(input.idempotencyKey)
            : undefined,
          createdAt: new Date().toISOString(),
          progress: { phase: "queued", percent: 0, message: "Job queued" },
        };
        allJobs.set(jobId, job);
        if (requestKey) idempotencyJobs.set(requestKey, job);
        jobSignatures.set(job.id, signature);
        pruneJobs();

        const controller = new AbortController();
        controllers.set(job.id, controller);
        setTimeout(() => {
          void (async () => {
            try {
              controller.signal.throwIfAborted();
              job.status = "running";
              job.progress = {
                phase: "generating",
                percent: 0.5,
                message: "Waiting for configured executor",
              };
              const pixels = await executor(
                { documentId: document.id, prompt, targetWidth, targetHeight },
                controller.signal,
              );
              controller.signal.throwIfAborted();
              if (
                !(pixels instanceof Uint8Array) ||
                pixels.length !== targetWidth * targetHeight * 4
              ) {
                throw new Error("Executor returned invalid RGBA dimensions.");
              }
              const assetBlob = await encodeRgbaPng(
                new Uint8Array(pixels),
                targetWidth,
                targetHeight,
              );
              controller.signal.throwIfAborted();
              if (!sessions.has(document.id))
                throw new Error("Target document no longer exists.");
              session.assets.install(
                {
                  id: assetId,
                  name: `Generated: ${prompt.slice(0, 30)}`,
                  width: targetWidth,
                  height: targetHeight,
                  blob: assetBlob,
                  bitmap: {
                    width: targetWidth,
                    height: targetHeight,
                    close() {},
                  } as unknown as ImageBitmap,
                  thumbnail: "",
                },
                false,
              );
              job.status = "succeeded";
              job.completedAt = new Date().toISOString();
              job.progress = {
                phase: "completed",
                percent: 1,
                message: "Generation complete",
              };
              job.candidate = {
                id: candidateId,
                assetId,
                width: targetWidth,
                height: targetHeight,
                reviewState: "staged",
              };
            } catch (error) {
              job.status = controller.signal.aborted ? "cancelled" : "failed";
              job.error =
                error instanceof Error ? error.message : String(error);
              job.completedAt = new Date().toISOString();
              job.progress = {
                phase: job.status,
                percent: 1,
                message: job.error,
              };
            } finally {
              controllers.delete(job.id);
            }
          })();
        }, 0);

        send(response, 202, { job });
        return;
      }

      // POST /api/v1/documents/:id/apply-candidate
      if (subresource === "apply-candidate" && method === "POST") {
        const input = z
          .object({
            expectedRevision: z.number().int().nonnegative(),
            candidateId: z.string().min(1).max(240),
            layerName: z.string().min(1).max(240).optional(),
            parentId: z.string().min(1).max(240).nullable().optional(),
            opacity: z.number().min(0).max(1).optional(),
            blendMode: z.enum(BLEND_MODES).optional(),
          })
          .strict()
          .parse(await body(request));

        if (input.expectedRevision !== document.getSnapshot().revision) {
          send(response, 409, {
            error: "Revision conflict. Read the document and retry.",
            revision: document.getSnapshot().revision,
          });
          return;
        }

        // Find candidate across jobs belonging to this document
        let targetCandidate: ServerJob["candidate"] | undefined;
        for (const job of allJobs.values()) {
          if (
            job.documentId === document.id &&
            job.candidate?.id === input.candidateId
          ) {
            targetCandidate = job.candidate;
            break;
          }
        }

        if (!targetCandidate) {
          send(response, 404, {
            error: `Candidate not found for document: ${input.candidateId}`,
          });
          return;
        }

        if (!session.assets.has(targetCandidate.assetId)) {
          send(response, 400, {
            error: `Candidate asset does not exist in target document asset store: ${targetCandidate.assetId}`,
          });
          return;
        }

        const parent = input.parentId
          ? document.getLayer(input.parentId)
          : null;
        if (input.parentId && !(parent instanceof LayerGroup)) {
          throw new Error(
            `Target parent "${input.parentId}" must identify an existing layer group.`,
          );
        }

        const layer = new RasterLayer({
          name: input.layerName ?? "Generated layer",
          assetId: targetCandidate.assetId,
          width: targetCandidate.width,
          height: targetCandidate.height,
          opacity: input.opacity ?? 1,
          blendMode: input.blendMode ?? "normal",
        });

        document.transaction("Apply generated candidate", () => {
          if (parent instanceof LayerGroup) parent.layers.add(layer);
          else document.layers.add(layer);
        });

        targetCandidate.reviewState = "accepted";

        send(response, 200, {
          ...snapshot(document),
          layerId: layer.id,
        });
        return;
      }

      send(response, 405, { error: "Method not allowed." });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid request.";
      send(response, 400, { error: message.slice(0, 2000) });
    }
  });
  server.on("close", () => {
    for (const controller of selectionControllers.keys()) controller.abort(new Error("Server closed"));
    selectionControllers.clear();
    for(const session of sessions.values())session.assets.dispose();sessions.clear();
    for (const controller of controllers.values())
      controller.abort(new Error("Server closed"));
    controllers.clear();
  });
  return server;
}
