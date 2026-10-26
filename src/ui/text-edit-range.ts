export interface TextEditStart {value:string;start:number;end:number;inputType:string}
/** Prefer the browser's selected interval, especially for repeated characters. */
export function textEditRange(previous:string,value:string,before?:TextEditStart){
  let start=before?.start??0,end=before?.end??0;
  if(before?.value===previous){
    const removed=previous.length-value.length;
    if(start===end&&removed>0){
      if(before.inputType.endsWith('Backward'))start=Math.max(0,start-removed);
      else if(before.inputType.endsWith('Forward'))end=Math.min(previous.length,end+removed);
    }
    const length=value.length-(previous.length-(end-start));
    if(length>=0&&value.startsWith(previous.slice(0,start))&&value.endsWith(previous.slice(end)))return{start,end,replacement:value.slice(start,start+length)};
  }
  start=0;while(start<previous.length&&start<value.length&&previous[start]===value[start])start++;
  if(start>0&&/[\ud800-\udbff]/.test(previous[start-1])&&(/[\udc00-\udfff]/.test(previous[start]??'')||/[\udc00-\udfff]/.test(value[start]??'')))start--;
  end=previous.length;let nextEnd=value.length;
  while(end>start&&nextEnd>start&&previous[end-1]===value[nextEnd-1]){end--;nextEnd--;}
  if(end>start&&/[\ud800-\udbff]/.test(previous[end-1])&&/[\udc00-\udfff]/.test(previous[end]??'')){end++;nextEnd++;}
  return{start,end,replacement:value.slice(start,nextEnd)};
}
