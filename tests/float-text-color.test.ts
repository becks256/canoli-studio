import {it,expect} from 'vitest';
import {linearHexTextColor,captureLinearTextColors} from '../src/engine/float-text-color';
const linear=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
it('captures exact authored hex components in linear Float32 without a browser or pixel conversion',async()=>{
 for(const input of ['#369','#369a','#336699','#336699ab','#ffffff','#00000000']){
  let h=input.slice(1);if(h.length<6)h=[...h].map(v=>v+v).join('');const expected=[...[0,2,4].map(p=>Math.fround(linear(parseInt(h.slice(p,p+2),16)/255))),Math.fround(h.length===8?parseInt(h.slice(6),16)/255:1)];expect(linearHexTextColor(input)).toEqual(expected);
 }
 const captured=await captureLinearTextColors(['#336699','#369','#336699']);expect(captured[0]).toBe(captured[2]);expect(Object.isFrozen(captured)).toBe(true);expect(Object.isFrozen(captured[0])).toBe(true);expect(captured[0]).toEqual(captured[1]);
});
it('keeps malformed hex, native CSS requirements and cancellation explicit without exposing partial output',async()=>{
 for(const input of ['#12','#12345','#GG0000','red','rgb(1 2 3)'])expect(linearHexTextColor(input)).toBeNull();await expect(captureLinearTextColors(['red'])).rejects.toThrow('browser');await expect(captureLinearTextColors([null]as never)).rejects.toThrow('CSS strings');
 const abort=new AbortController();abort.abort(new Error('Cancelled color capture'));await expect(captureLinearTextColors(['#123456'],{signal:abort.signal})).rejects.toThrow('Cancelled color capture');
});
