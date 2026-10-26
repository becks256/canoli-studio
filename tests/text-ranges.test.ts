import {expect,it} from 'vitest';
import {DEFAULT_CHARACTER_FORMAT} from '../src/core/character-format';
import {normalizeCharacterRanges,formatCharacterRange,editCharacterRanges,characterLineSpans,type CharacterRangeData} from '../src/core/text-ranges';
import {layoutText,layoutTextAsync,type TextLayoutInput,type TextMeasurementRange} from '../src/core/text-layout';

it('normalizes an owned range snapshot without accepting overlapping, paragraph or malformed formats',()=>{
 const input=[{start:0,end:2,format:{color:'#123456'}},{start:2,end:4,format:{color:'#123456'}}],result=normalizeCharacterRanges('abcd',input);input[0].format.color='changed';expect(result).toEqual([{start:0,end:4,format:{color:'#123456'}}]);expect(Object.isFrozen(result[0].format)).toBe(true);
 for(const ranges of [[{start:1,end:1,format:{}}],[{start:0,end:5,format:{}}],[{start:2,end:3,format:{}},{start:1,end:2,format:{}}],[{start:0,end:3,format:{}},{start:2,end:4,format:{}}],[{start:0,end:1,format:{lineHeight:2}}]])expect(()=>normalizeCharacterRanges('abcd',ranges as CharacterRangeData[])).toThrow();
});
it('overlays and clears selected character formats while retaining independent inherited gaps',()=>{
 const first=formatCharacterRange('abcdef',[],1,5,{color:'red'}),second=formatCharacterRange('abcdef',first,3,6,{fontSize:60});
 expect(second).toEqual([{start:1,end:3,format:{color:'red'}},{start:3,end:5,format:{color:'red',fontSize:60}},{start:5,end:6,format:{fontSize:60}}]);expect(formatCharacterRange('abcdef',second,2,4,null)).toEqual([{start:1,end:2,format:{color:'red'}},{start:4,end:5,format:{color:'red',fontSize:60}},{start:5,end:6,format:{fontSize:60}}]);
});
it('typing and replacement retain explicit affinity, removed-character inheritance and unaffected suffixes',()=>{
 const ranges=[{start:0,end:2,format:{color:'red'}},{start:2,end:4,format:{color:'blue'}}];
 expect(editCharacterRanges('abcd',ranges,2,2,'X').ranges).toEqual([{start:0,end:3,format:{color:'red'}},{start:3,end:5,format:{color:'blue'}}]);expect(editCharacterRanges('abcd',ranges,2,2,'X','after').ranges).toEqual([{start:0,end:2,format:{color:'red'}},{start:2,end:5,format:{color:'blue'}}]);expect(editCharacterRanges('abcd',ranges,2,4,'YZ')).toEqual({text:'abYZ',ranges});
 expect(editCharacterRanges('abcd',ranges,1,3,'')).toEqual({text:'ad',ranges:[{start:0,end:1,format:{color:'red'}},{start:1,end:2,format:{color:'blue'}}]});
});
it('rejects UTF-16 scalar splits without discarding combining-character style boundaries',()=>{
 for(const operation of [()=>normalizeCharacterRanges('A😀B',[{start:1,end:2,format:{color:'red'}}]),()=>formatCharacterRange('A😀B',[],2,3,{color:'red'}),()=>editCharacterRanges('A😀B',[],1,2,'')])expect(operation).toThrow('surrogate');
 expect(formatCharacterRange('a\u0301',[],1,2,{color:'red'})).toEqual([{start:1,end:2,format:{color:'red'}}]);
});
it('visible source projection keeps discretionary-hyphen style and consumes trailing spaces without shifting ranges',()=>{
 const text='ab\u00ad  cd',ranges=normalizeCharacterRanges(text,[{start:2,end:3,format:{color:'red'}},{start:5,end:7,format:{fontSize:60}}]),base=DEFAULT_CHARACTER_FORMAT;
 expect(characterLineSpans(text,ranges,base,{start:0,end:3,softBreak:true},true).map(s=>[s.text,s.style.color])).toEqual([['ab','#ffffff'],['-','red']]);expect(characterLineSpans(text,ranges,base,{start:0,end:5,softBreak:true},true).map(s=>s.text).join('')).toBe('ab');expect(characterLineSpans(text,ranges,base,{start:5,end:7,softBreak:false},true)).toMatchObject([{text:'cd',style:{fontSize:60}}]);
});
it('range formatting and replacement match an independent per-character reference over successive edits',()=>{
 let text='abcdefghij',ranges:readonly CharacterRangeData[]=[],reference:Record<string,unknown>[]=Array.from(text,()=>({})),state=0x12345678;
 const random=(limit:number)=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%limit;};
 for(let i=0;i<150;i++){
  const start=random(text.length+1),end=start+random(text.length-start+1);
  if(i%3&&end>start){const patch=i%5?{color:i%2?'red':'blue'}:null;ranges=formatCharacterRange(text,ranges,start,end,patch);reference=reference.map((format,index)=>index>=start&&index<end?patch?{...format,...patch}:{}:format);}
  else{const replacement=i%2?'XY':'Z',inherited={...(reference[end>start?start:Math.max(0,start-1)]??{})};const result=editCharacterRanges(text,ranges,start,end,replacement);text=result.text;ranges=result.ranges;reference.splice(start,end-start,...Array.from(replacement,()=>inherited));}
  const actual=Array.from(text,(_,index)=>({...ranges.find(r=>r.start<=index&&index<r.end)?.format}));expect(actual).toEqual(reference);
 }
});
it('source-aware wrapping does not reuse the width of an identical word with another format',()=>{
 const calls:{text:string;range:Readonly<TextMeasurementRange>}[]=[],text='AA AA AA',input={text,fontSize:10,lineHeight:1.2,wrapWidth:60},measure=(visible:string,_spacing?:number,range?:Readonly<TextMeasurementRange>)=>{
  expect(range).toBeDefined();calls.push({text:visible,range:range!});return [...visible].reduce((width,char,index)=>width+(char===' '?5:range!.start+index>=3&&range!.start+index<5?25:10),0);
 };
 const result=layoutText(input,measure,undefined,{sourceRanges:true});expect(result.lines.map(line=>[line.text,line.start,line.end])).toEqual([['AA',0,3],['AA',3,6],['AA',6,8]]);expect(calls.some(c=>c.text==='AA'&&c.range.start===0)).toBe(true);expect(calls.some(c=>c.text==='AA'&&c.range.start===3)).toBe(true);
});
it('sync and async measurement consume identical requests, source positions and native justification probes',async()=>{
 const inputs:TextLayoutInput[]=[{text:'one two three\nfour five',fontSize:10,lineHeight:1.2,wrapWidth:70,paragraphSpacing:12},{text:'a\u0301 bc\u00addef\u2028tail',fontSize:10,lineHeight:1.5,wrapWidth:40},{text:'one two three four\nend',fontSize:10,lineHeight:1.2,wrapWidth:90,paragraphJustify:'inter-word',wordSpacing:0}];
 for(const input of inputs){const sync:unknown[]=[],async:unknown[]=[],measure=(text:string,spacing:number|undefined,_range:Readonly<TextMeasurementRange>|undefined)=>text.length*10+(text.match(/ /g)?.length??0)*(spacing??0);const expected=layoutText(input,(...args)=>{sync.push(args);return measure(...args);},undefined,{sourceRanges:true});const actual=await layoutTextAsync(input,async(...args)=>{async.push(args);return measure(...args);},undefined,{sourceRanges:true});expect(actual).toEqual(expected);expect(async).toEqual(sync);}
});
it('forced point-text lines keep their paragraph indent and spacing identity without altering legacy point text',async()=>{
 const input={text:'AA\u2028AA\nAA',fontSize:40,lineHeight:1.2,firstLineIndent:10,paragraphSpacing:12},measure=(text:string)=>text.length*24,options={sourceRanges:true,pointLineBreaks:true};
 const result=layoutText(input,measure,undefined,options);expect(result).toMatchObject({width:58,height:156});expect(result.lines.map(line=>[line.text,line.x,line.y,line.start,line.end])).toEqual([['AA',10,0,0,2],['AA',0,48,3,5],['AA',10,108,6,8]]);expect(await layoutTextAsync(input,async text=>measure(text),undefined,options)).toEqual(result);expect(layoutText(input,measure).lines.map(line=>line.text)).toEqual(['AA\u2028AA','AA']);
});
it('async layout snapshots its input and rejects cancellation/nonfinite host results instead of returning partial lines',async()=>{
 const input={text:'one two three',fontSize:10,lineHeight:1.2,wrapWidth:50},original={...input};let resume!:(width:number)=>void;const barrier=new Promise<number>(resolve=>{resume=resolve;});const pending=layoutTextAsync(input,async text=>text===original.text?barrier:text.length*10);input.text='changed';input.wrapWidth=999;resume(original.text.length*10);expect(await pending).toEqual(layoutText(original,text=>text.length*10));
 const abort=new AbortController();await expect(layoutTextAsync(original,async()=>{abort.abort(new Error('Expected measurement cancellation'));return 10;},undefined,{signal:abort.signal})).rejects.toThrow('Expected measurement cancellation');await expect(layoutTextAsync(original,async()=>NaN)).rejects.toThrow('nonfinite');
});
