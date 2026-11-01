import {test,expect} from 'vitest';
import {nativeSvgTextItems} from '../src/engine/native-text-items';
import {unicodeTextProperties} from '../src/fonts/unicode-text-data';
import type {StyledTextCharacterGeometry} from '../src/engine/styled-text';
function geometry(text:string,zero=false):StyledTextCharacterGeometry[]{return Array.from({length:text.length},(_,index)=>{const bidi=unicodeTextProperties(text.codePointAt(index)!).bidi,reverse=bidi==='R'||bidi==='AL';return{index,start:{x:index*20,y:40},end:{x:index*20+(zero?0:reverse?-20:20),y:40},rotation:0,extent:{x:index*20,y:0,width:20,height:40}};});}

test('script and native direction boundaries preserve clusters, brackets and complete UTF16 ranges',()=>{
 const text='AVאבبب';expect(nativeSvgTextItems(text,geometry(text),'ltr')).toEqual([{start:0,end:2,script:'Latn',direction:'ltr'},{start:2,end:4,script:'Hebr',direction:'rtl'},{start:4,end:6,script:'Arab',direction:'rtl'}]);
 const paired='A(אב)A',items=nativeSvgTextItems(paired,geometry(paired),'ltr');expect(items.map(item=>[paired.slice(item.start,item.end),item.script])).toEqual([['A(','Latn'],['אב','Hebr'],[')A','Latn']]);
 const marks='a\u0301אב';expect(nativeSvgTextItems(marks,geometry(marks),'ltr')[0]).toMatchObject({start:0,end:2,script:'Latn'});
 const supplementary='A𐐀אב',whole=nativeSvgTextItems(supplementary,geometry(supplementary),'ltr');expect(whole.map(item=>supplementary.slice(item.start,item.end)).join('')).toBe(supplementary);expect(whole.some(item=>item.start===2||item.end===2)).toBe(false);expect(()=>nativeSvgTextItems(supplementary,geometry(supplementary),'ltr',2)).toThrow('complete Unicode scalars');
 expect(Object.isFrozen(items)&&items.every(Object.isFrozen)).toBe(true);
});

test('zero-width native carets retain Unicode directional intent and invalid sources reject',()=>{
 const text='AאבA';expect(nativeSvgTextItems(text,geometry(text,true),'rtl').map(item=>item.direction)).toEqual(['ltr','rtl','ltr']);
 const invalid=geometry('A').map(c=>({...c,start:{...c.start,x:NaN}}));expect(()=>nativeSvgTextItems('A',invalid,'ltr')).toThrow('geometry is invalid');expect(()=>nativeSvgTextItems('A',[],'ltr')).toThrow('differs');expect(()=>nativeSvgTextItems('\ud800',geometry('\ud800'),'ltr')).toThrow('surrogate');expect(nativeSvgTextItems('',[],'rtl')).toEqual([]);
});

test('the full existing text budget retains every alternating-script and deeply nested bracket range',()=>{
 for(const text of ['אA'.repeat(5000),'('.repeat(2000)+'אA'.repeat(2500)+')'.repeat(2000)]){const items=nativeSvgTextItems(text,geometry(text),'ltr');expect(items.map(item=>text.slice(item.start,item.end)).join('')).toBe(text);expect(items[0].start).toBe(0);expect(items.at(-1)!.end).toBe(text.length);}
});

test('whole-source native visual hints retain bidi resolution erased by clamped tracked carets',()=>{
 const text='A אב V',directions=['ltr','rtl','rtl','rtl','rtl','ltr']as const,positions=[292,272,248,224,204,180],visual=positions.map((order,index)=>({order,direction:directions[index]}));
 expect(nativeSvgTextItems(text,geometry(text,true),'rtl',0,text.length,visual).map(item=>[item.start,item.end,item.direction])).toEqual([[0,1,'ltr'],[1,2,'rtl'],[2,5,'rtl'],[5,6,'ltr']]);
 expect(()=>nativeSvgTextItems(text,geometry(text),'rtl',0,text.length,[])).toThrow('visual ordering');expect(()=>nativeSvgTextItems(text,geometry(text),'rtl',0,text.length,visual.map(value=>({...value,order:NaN})))).toThrow('visual ordering');
});
