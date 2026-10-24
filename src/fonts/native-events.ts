const listeners=new WeakMap<object,Set<()=>void>>();
/** Loaded FontFaceSet.add/delete do not emit native loading events. */
export function subscribeNativeFontChanges(set:object|undefined,listener:()=>void):()=>void{
  if(!set)return()=>{};
  let values=listeners.get(set);if(!values){values=new Set();listeners.set(set,values);}values.add(listener);
  return()=>{values!.delete(listener);};
}
export function nativeFontsChanged(set:object):void{
  // Cache invalidation is an internal notification, not a user command observer.
  for(const listener of listeners.get(set)??[])try{listener();}catch{/* A stale renderer cannot invalidate font ownership. */}
}
