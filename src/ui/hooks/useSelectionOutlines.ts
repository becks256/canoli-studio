import { useEffect, useReducer, useRef } from 'react';
import type { SelectionData } from '../../core/drawing';
import type { PixelCoverage } from '../../core/pixel-selection';

/** Geometry remains authoritative immediately; only its visual outline is asynchronous. */
export function useSelectionOutlines(selection: SelectionData | null | undefined, onError?: (message:string)=>void) {
  const cache=useRef(new WeakMap<PixelCoverage,string>());
  const [,refresh]=useReducer((n:number)=>n+1,0);
  const report=useRef(onError);report.current=onError;
  useEffect(()=>{
    const pending=[...new Set(selection?.regions.flatMap(region=>region.coverage && !cache.current.has(region.coverage) ? [region.coverage] : [])??[])];
    if(!pending.length)return;
    let worker:Worker|undefined, cancelled=false;
    try {
      worker=new Worker(new URL('../selection-outline.worker.ts',import.meta.url),{type:'module'});
      worker.onmessage=({data}:MessageEvent<{paths?:string[];error?:string}>)=>{
        if(cancelled)return;
        worker?.terminate();
        if(data.error || !data.paths || data.paths.length!==pending.length){report.current?.(data.error??'Selection outline failed.');return;}
        pending.forEach((coverage,index)=>cache.current.set(coverage,data.paths![index]));
        refresh();
      };
      worker.onerror=()=>{
        if(cancelled)return;
        worker?.terminate();report.current?.('Selection outline worker failed. Reselect the area to retry.');
      };
      worker.postMessage(pending);
    } catch(error) {worker?.terminate();report.current?.(error instanceof Error?error.message:'Selection outline failed.');}
    return ()=>{cancelled=true;worker?.terminate();};
  },[selection]);
  return selection?.regions.map(region=>region.coverage ? cache.current.get(region.coverage) : undefined)??[];
}
