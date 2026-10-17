// Native region growing. 0=untested, 1=excluded, 2=eligible, 3=selected, 5=painted seed.
function eligible(pixels:usize,state:usize,index:i32,values:usize):bool{
  const code=load<u8>(state+<usize>index);if(code!=0)return code==2||code==5;
  store<f64>(values+88,load<f64>(values+88)+1);const p=pixels+<usize>index*4;let valid=load<u8>(p+3)>0;
  for(let c=0;c<3&&valid;c++)valid=Math.abs(<f64>load<u8>(p+<usize>c)-load<f64>(values+<usize>c*8))<=load<f64>(values+24+<usize>c*8);
  store<u8>(state+<usize>index,valid?2:1);return valid;
}
function edge(pixels:usize,a:i32,b:i32,values:usize):bool{
  const limit=load<f64>(values+48),left=pixels+<usize>a*4,right=pixels+<usize>b*4;
  for(let c=0;c<3;c++)if(Math.abs(<f64>load<u8>(left+<usize>c)-<f64>load<u8>(right+<usize>c))>limit)return false;return true;
}
export function quickSelectionInit(pixels:usize,state:usize,count:i32,spans:usize,spanCount:i32,values:usize,tolerance:f64):void{
  memory.fill(state,0,<usize>count);
  let n:f64=0,r:f64=0,g:f64=0,b:f64=0,rr:f64=0,gg:f64=0,bb:f64=0,examined:f64=0;
  for(let s=0;s<spanCount;s++){
    const start=load<u32>(spans+<usize>s*8),end=load<u32>(spans+<usize>s*8+4);
    for(let i=start;i<end;i++){
      if(load<u8>(state+<usize>i)!=0)continue;const p=pixels+<usize>i*4;examined++;
      if(!load<u8>(p+3)){store<u8>(state+<usize>i,1);continue;}
      store<u8>(state+<usize>i,5);n++;const red=<f64>load<u8>(p),green=<f64>load<u8>(p+1),blue=<f64>load<u8>(p+2);
      r+=red;g+=green;b+=blue;rr+=red*red;gg+=green*green;bb+=blue*blue;
    }
  }
  if(n>0){r/=n;g/=n;b/=n;}
  store<f64>(values,r);store<f64>(values+8,g);store<f64>(values+16,b);
  store<f64>(values+24,tolerance+2*Math.sqrt(Math.max(0,n>0?rr/n-r*r:0)));
  store<f64>(values+32,tolerance+2*Math.sqrt(Math.max(0,n>0?gg/n-g*g:0)));
  store<f64>(values+40,tolerance+2*Math.sqrt(Math.max(0,n>0?bb/n-b*b:0)));
  store<f64>(values+56,n);store<f64>(values+80,0);store<f64>(values+88,examined);
}
/** Emit bounded frontier batches and a resumable source position. */
export function quickSelectionSpan(pixels:usize,state:usize,count:i32,width:i32,start:i32,end:i32,dy:i32,values:usize,output:usize,capacity:i32,force:bool):void{
  let emitted=0,cursor=start;
  if(start+dy>=0&&end+dy<=count){
    for(;cursor<end;cursor++){
      const index=cursor+dy;if(!eligible(pixels,state,index,values)||(!force&&!edge(pixels,cursor,index,values)))continue;
      if(emitted>=capacity)break;
      const rowStart=index-index%width,rowEnd=rowStart+width;let left=index,right=index+1;store<u8>(state+<usize>index,3);
      while(left>rowStart&&eligible(pixels,state,left-1,values)&&edge(pixels,left,left-1,values)){left--;store<u8>(state+<usize>left,3);}
      while(right<rowEnd&&eligible(pixels,state,right,values)&&edge(pixels,right-1,right,values)){store<u8>(state+<usize>right,3);right++;}
      store<f64>(values+80,load<f64>(values+80)+<f64>(right-left));store<i32>(output+<usize>emitted*8,left);store<i32>(output+<usize>emitted*8+4,right);emitted++;
    }
  }else cursor=end;
  store<f64>(values+64,<f64>emitted);store<f64>(values+72,<f64>cursor);
}
export function quickSelectionAlpha(pixels:usize,state:usize,start:i32,count:i32,output:usize):void{
  for(let n=0;n<count;n++){const i=start+n;store<u8>(output+<usize>n,load<u8>(state+<usize>i)==3?load<u8>(pixels+<usize>i*4+3):0);}
}
