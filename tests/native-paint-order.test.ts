import {test,expect} from 'vitest';
import {nativeSvgPaintOrder} from '../src/engine/native-paint-order';

test('native visual ranking retains source identity and the shaped order of marks in one cluster',()=>{
 const glyphs=Object.freeze([{sourceCluster:0,id:'right'},{sourceCluster:2,id:'left-base'},{sourceCluster:2,id:'left-mark'},{sourceCluster:1,id:'middle'}].map(glyph=>Object.freeze(glyph)));
 const visual=[{order:100,direction:'ltr' as const},{order:40,direction:'rtl' as const},{order:0,direction:'rtl' as const}];
 const result=nativeSvgPaintOrder(glyphs,visual);
 expect(result.map(g=>g.id)).toEqual(['left-base','left-mark','middle','right']);
 expect(result[0]).toBe(glyphs[1]);expect(result[1]).toBe(glyphs[2]);
 expect(glyphs.map(g=>g.id)).toEqual(['right','left-base','left-mark','middle']);expect(Object.isFrozen(result)).toBe(true);
});

test('tied native source positions retain their complete original shaped paint order',()=>{
 const glyphs=[{sourceCluster:1,id:'a'},{sourceCluster:0,id:'b'},{sourceCluster:1,id:'c'}];
 expect(nativeSvgPaintOrder(glyphs,[{order:-25,direction:null},{order:-25,direction:'ltr'}])).toEqual(glyphs);
 expect(nativeSvgPaintOrder([],[])).toEqual([]);
});

test('unowned source addresses and malformed native ordering reject without altering glyph data',()=>{
 const visual=[{order:0,direction:'ltr' as const}];
 for(const sourceCluster of [undefined,-1,.5,NaN,Infinity,1]){const glyphs=[{sourceCluster}],before=[...glyphs];expect(()=>nativeSvgPaintOrder(glyphs,visual)).toThrow('valid original source cluster');expect(glyphs).toEqual(before);}
 expect(()=>nativeSvgPaintOrder([{sourceCluster:0}],[{order:NaN,direction:null}])).toThrow('ordering metadata is invalid');
});
