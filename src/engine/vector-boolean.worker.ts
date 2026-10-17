import { calculateVectorBoolean } from './vector-boolean-kernel';
import type { VectorBooleanRequest } from '../core/vector-boolean';
self.onmessage=(event:MessageEvent<VectorBooleanRequest>)=>{
  try { self.postMessage({result:calculateVectorBoolean(event.data,progress=>self.postMessage({progress}))}); }
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
