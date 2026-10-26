import {expect,it} from 'vitest';
import {measureCharacterText,normalizeCharacterText,withPreparedCharacterBounds,characterTextBounds} from '../src/core/character-layout';
import {normalizeStyledTextScene} from '../src/engine/styled-text';
import {Document,TextLayer} from '../src/dom';
import {svgTextElements} from '../src/core/svg-text';

it('native writing settings are strictly parsed, owned and frozen without changing logical source',()=>{
 const input={text:'AA\nBB',writing:{mode:'vertical-rl' as 'vertical-rl'|'vertical-lr'}},snapshot=normalizeCharacterText(input);input.text='Changed';input.writing.mode='vertical-lr';expect(snapshot.text).toBe('AA\nBB');expect(snapshot.writing).toEqual({mode:'vertical-rl',orientation:'mixed'});expect(Object.isFrozen(snapshot.writing)).toBe(true);
 for(const writing of [{mode:'vertical'},{orientation:'rotate'},{mode:'vertical-rl',rotate:90}])expect(()=>normalizeCharacterText({text:'AA',writing}as never)).toThrow();
 const scene=normalizeStyledTextScene({width:100,height:100,lines:[{writing:{mode:'vertical-lr'},spans:[{text:'AA'}]}]});expect(scene.lines[0].writing).toEqual({mode:'vertical-lr',orientation:'mixed'});expect(Object.isFrozen(scene.lines[0].writing)).toBe(true);
});
for(const mode of ['vertical-rl','vertical-lr']as const)it(`estimated vertical lines keep source indices and block direction: ${mode}`,()=>{
 const layout=measureCharacterText({text:'AA\nBB',style:{fontSize:20},paragraph:{lineHeight:1},writing:{mode}});expect(layout.accuracy).toBe('estimated');expect([layout.width,layout.height]).toEqual([40,40]);expect(layout.origin).toEqual({x:mode==='vertical-rl'?-40:0,y:0});expect(layout.lines.map(l=>[l.source.start,l.source.end,l.x,l.y])).toEqual([[0,2,mode==='vertical-rl'?-10:10,0],[3,5,mode==='vertical-rl'?-30:30,0]]);expect(layout.lines.map(l=>l.spans.map(s=>s.text).join(''))).toEqual(['AA','BB']);
});
it('vertical wrapping reuses logical inline extent, paragraph gaps and source-aware indentation',()=>{
 const layout=measureCharacterText({text:'AA AA\nAA',style:{fontSize:20},paragraph:{lineHeight:1,wrapWidth:60,firstLineIndent:10,paragraphSpacing:7},writing:{mode:'vertical-lr'}});expect(layout.lines).toHaveLength(3);expect(layout.lines[0].y).toBe(10);expect(layout.lines[2].x).toBe(57);expect(layout.lines[2].y).toBe(10);expect(layout.height).toBe(60);expect(layout.lines[2].source).toMatchObject({start:6,end:8});
});
it('vertical native requests distinguish sideways estimates, preserve physical inline alignment and allow empty columns',()=>{
 const a=measureCharacterText({text:'AA',style:{fontSize:20},paragraph:{wrapWidth:100,align:'right',direction:'rtl',lineHeight:1},writing:{mode:'vertical-rl',orientation:'upright'}}),b=measureCharacterText({text:'AA',style:{fontSize:20},writing:{mode:'vertical-rl',orientation:'sideways'}}),empty=measureCharacterText({text:'',style:{fontSize:20},paragraph:{lineHeight:1},writing:{mode:'vertical-lr'}});expect(a.lines[0]).toMatchObject({y:100,direction:'rtl',advance:40});expect(a.ink.y).toBe(60);expect(b.lines[0].advance).toBe(24);expect(empty).toMatchObject({width:20,height:1,origin:{x:0,y:0}});
});
it('prepared native bounds cannot be reused for a different writing mode or orientation',()=>{
 const input={text:'AA',style:{fontSize:20},writing:{mode:'vertical-rl' as const}},bounds={width:77,height:88,origin:{x:-5,y:2}};
 withPreparedCharacterBounds(input,bounds,()=>{expect(characterTextBounds(input)).toEqual(bounds);expect(characterTextBounds({...input,writing:{mode:'vertical-lr'}})).not.toEqual(bounds);expect(characterTextBounds({...input,writing:{mode:'vertical-rl',orientation:'sideways'}})).not.toEqual(bounds);});expect(characterTextBounds(input)).not.toEqual(bounds);
});
it('private writing settings do not become unversioned public mutation fields',()=>{
 const document=new Document(),layer=document.layers.add(new TextLayer({text:'Authoring stays explicit'})),before=document.getSnapshot();
 expect(()=>layer.update({writing:{mode:'vertical-rl'}}as never)).toThrow();expect(document.getSnapshot()).toBe(before);
 const data=layer.toJSON(),layout=measureCharacterText({text:'Vertical',writing:{mode:'vertical-rl'}});if(data.kind!=='text')throw new Error('Expected text');expect(()=>[...svgTextElements(data,{styledLines:layout.lines,baselines:[],color:'#ffffff',letterSpacing:0})]).toThrow('Prepared SVG writing does not match its text layer.');expect(document.getSnapshot()).toBe(before);
});
