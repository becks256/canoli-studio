import type { SelectionData } from './drawing';
import { yieldTask } from './task-yield';

/** Append scanline-ordered native coverage without retaining a full-image plane. */
export class SelectionRows {
  private runs:number[]=[];
  private offset=0;
  private nonempty=false;
  constructor(readonly region:{x:number;y:number;width:number;height:number}) {
    if(![region.x,region.y,region.width,region.height,region.width*region.height].every(Number.isSafeInteger)||region.width<=0||region.height<=0)
      throw new Error('Selection coverage requires safe integer geometry.');
  }
  async append(alpha:Uint8Array,check:()=>void=()=>{}):Promise<void> {
    if(this.offset+alpha.length>this.region.width*this.region.height)throw new Error('Too much selection coverage.');
    let deadline=performance.now()+2;
    for(let i=0;i<alpha.length;i++){
      const value=alpha[i];this.nonempty ||= value>0;
      if(this.runs.length&&this.runs[this.runs.length-1]===value)this.runs[this.runs.length-2]=++this.offset;
      else this.runs.push(++this.offset,value);
      if(i%4096===0&&performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
    }
    check();
  }
  finish():SelectionData {
    const {width,height}=this.region;
    if(this.offset!==width*height)throw new Error('Incomplete selection coverage.');
    return this.nonempty?{regions:[{...this.region,shape:'pixels',operation:'add',coverage:{width,height,runs:this.runs}}]}:{regions:[]};
  }
}
