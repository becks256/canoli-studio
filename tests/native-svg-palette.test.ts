import {it,expect} from 'vitest';
import {nativeVerificationPalette} from '../src/engine/native-svg-palette';
import type {LinearTextColor} from '../src/engine/float-text-color';
it('verification keeps ten thousand distinct source paints while isolating scalar ownership and preserving HDR inputs',()=>{
 const colors=Array.from({length:10000},(_,i)=>Object.freeze([Math.fround(4+i/1000),-.25,1.5,Math.fround(1e-8)])as LinearTextColor),before=colors.map(c=>[...c]),palette=nativeVerificationPalette(colors),selected=JSON.stringify(colors[513]),labels=colors.map(c=>palette.fill(c,selected));
 expect(new Set(labels).size).toBe(10000);expect(labels.filter(v=>v.startsWith('rgb(255 '))).toHaveLength(1);expect(labels.filter(v=>v.startsWith('rgb(0 '))).toHaveLength(9999);expect(palette.fill([...colors[513]])).toBe(palette.fill(colors[513]));expect(colors).toEqual(before);expect(()=>palette.fill([0,0,0,1])).toThrow('captured native paint');
});
