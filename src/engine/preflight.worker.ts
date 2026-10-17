import {inspectDesign,type PreflightOptions,type PreflightFontStatus} from '../core/preflight';
import type {PreflightDocumentView} from '../core/preflight-view';
self.onmessage=async(event:MessageEvent<{document:PreflightDocumentView;revision:number;options:PreflightOptions;assets:[string,{width:number;height:number}][];fonts:[string,PreflightFontStatus][]}>)=>{
  try{const {document,revision,options,assets,fonts}=event.data;self.postMessage({report:await inspectDesign(document,revision,options,{assets:new Map(assets),fonts:new Map(fonts)})});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
