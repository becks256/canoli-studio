import {expect,it} from 'vitest';
import {normalizeStyledTextScene,prepareStyledTextSurface} from '../src/engine/styled-text';
import {AssetStore} from '../src/core/assets';
import {createDocument} from '../src/core/model';

it('snapshots inherited character formats and visual lines without changing authored input',()=>{
  const input={width:320,height:160,style:{fontSize:40,color:'#2468ac'},lines:[{x:12,y:70,spans:[{text:'A\tB',style:{fontSize:undefined}},{text:'C',style:{fontSize:60,color:'#cc4422'}}]}]};
  const result=normalizeStyledTextScene(input);input.lines[0].spans[1].text='Changed';input.style.fontSize=90;
  expect(result.lines[0].spans.map(value=>value.text)).toEqual(['A B','C']);expect(result.lines[0].spans[0].style).toMatchObject({fontSize:40,fontFamily:'sans-serif',color:'#2468ac'});expect(result.lines[0].spans[1].style).toMatchObject({fontSize:60,color:'#cc4422'});
  expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.lines[0].spans[0].style)).toBe(true);expect(result.transform).toEqual([1,0,0,1,0,0]);expect(input.lines[0].spans[0].text).toBe('A\tB');
  expect(normalizeStyledTextScene({width:32,height:32,lines:[{spans:[{text:'AA'},{text:'AA'}]}]}).lines[0].spans.map(value=>value.text)).toEqual(['AAAA']);
});

it('preserves scalar and combining text while rejecting split surrogate pairs and hidden line breaks',()=>{
  const scene=(spans:{text:string}[])=>({width:320,height:160,lines:[{spans}]});
  expect(normalizeStyledTextScene(scene([{text:'a'},{text:'\u0301 😀'}])).lines[0].spans.map(value=>value.text).join('')).toBe('a\u0301 😀');
  expect(()=>normalizeStyledTextScene(scene([{text:'\ud83d'},{text:''},{text:'\ude00'}]))).toThrow('surrogate');
  for(const text of ['a\nb','a\u2028b','a\u2029b'])expect(()=>normalizeStyledTextScene(scene([{text}]))).toThrow('visual lines');
  for(const text of ['a\0b','\ud800','\ufffe'])expect(()=>normalizeStyledTextScene(scene([{text}]))).toThrow('XML controls or unpaired surrogates');
});

it('enforces shared typography validation and the existing text budget independently of work-window geometry',()=>{
  const base={width:100000000,height:1,lines:[{spans:[{text:'A'.repeat(10000)}]}]};expect(normalizeStyledTextScene(base).width).toBe(100000000);
  expect(()=>normalizeStyledTextScene({...base,lines:[...base.lines,{spans:[]}]})).toThrow('text budget');
  for(const style of [{fontSize:Infinity},{wordSpacing:501},{fontVariationSettings:'"TEST" 50; color:red'},{fontVariantCaps:'invented'}])expect(()=>normalizeStyledTextScene({...base,style} as Parameters<typeof normalizeStyledTextScene>[0])).toThrow();
  expect(()=>normalizeStyledTextScene({...base,width:1.5})).toThrow();
  expect(()=>normalizeStyledTextScene({...base,style:{opacity:.5}} as Parameters<typeof normalizeStyledTextScene>[0])).toThrow();
});

it('requires a real browser host and rejects cancelled work without changing an asset store',async()=>{
  const assets=new AssetStore(),scene={width:32,height:32,lines:[]};
  try{await expect(prepareStyledTextSurface(scene,createDocument(),assets)).rejects.toThrow('browser SVG host');const abort=new AbortController();abort.abort(new Error('Expected styled-text cancellation'));await expect(prepareStyledTextSurface(scene,createDocument(),assets,{signal:abort.signal})).rejects.toThrow('Expected styled-text cancellation');expect(assets.fonts.size).toBe(0);}finally{assets.dispose();}
});
