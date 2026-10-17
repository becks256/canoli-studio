/** Private packed graph ABI, after classification, factorization and row packing. */
export interface PackedMattingRows {
  values:Float64Array;neighbors:Int32Array;factor?:Float64Array;
  frozen:Uint8Array;rank:Uint8Array;anchor:Uint8Array;
}
export interface MattingIterationGraph {
  chunks:readonly PackedMattingRows[];count:number;chunkSize:number;rowStride:number;
  diagonal:Float64Array;hasFactor:boolean;availableBytes:number;
}
export interface MattingIterations {
  estimatedBytes:number;
  multiply?:(input:Float64Array,output:Float64Array)=>void;
  condition?:(input:Float64Array,output:Float64Array)=>void;
}
export type MattingIterationFactory=(graph:MattingIterationGraph)=>MattingIterations;
