import { Worker } from 'node:worker_threads';
import type { SelectionModificationRequest } from '../src/core/selection-modification';
import { selectionSchema, type SelectionData } from '../src/core/drawing';
import type { ChannelCoverageRequest } from '../src/core/alpha-channels';

/** A Node worker uses the same native tile/WASM implementation as the browser. */
export function prepareServerSelection(request: SelectionModificationRequest, signal: AbortSignal): Promise<SelectionData> {
  return prepareSelectionWorker(request,signal);
}
export function prepareServerChannelSelection(request:ChannelCoverageRequest,signal:AbortSignal):Promise<SelectionData>{
  return prepareSelectionWorker({channelSelection:request},signal);
}
function prepareSelectionWorker(request:SelectionModificationRequest|{channelSelection:ChannelCoverageRequest},signal:AbortSignal):Promise<SelectionData>{
  signal.throwIfAborted();
  return new Promise((resolve,reject) => {
    const worker = new Worker(new URL('./selection-worker.mjs',import.meta.url), {workerData:request,execArgv:[]});
    let settled = false;
    const finish = (error?: unknown, result?: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort',cancel);
      void worker.terminate();
      if (error) reject(error);
      else { try {resolve(selectionSchema.parse(result));} catch(cause) {reject(cause);} }
    };
    const cancel = () => finish(signal.reason ?? new Error('Selection modification cancelled.'));
    signal.addEventListener('abort',cancel,{once:true});
    worker.once('error',finish);
    worker.once('exit',code => finish(new Error(`Selection worker closed (${code}).`)));
    worker.once('message',message => message.error ? finish(new Error(message.error)) : finish(undefined,message.selection));
    if (signal.aborted) cancel();
  });
}
