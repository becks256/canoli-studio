import {describe, it, expect} from 'vitest';
import {Document, TextLayer, LayerGroup, VectorLayer} from '../src/dom';
import {layoutText} from '../src/core/text-layout';
import {validateDocument, SCHEMA_VERSION} from '../src/core/model';
import {parseCommands} from '../src/core/validation';
import {computeResizePatch} from '../src/ui/utils';

const advance = (text: string) => [...new Intl.Segmenter(undefined, {granularity:'grapheme'}).segment(text)].length*10;
const layout = (text: string, options: Partial<Parameters<typeof layoutText>[0]> = {}) => layoutText({text,fontSize:10,lineHeight:1.2,...options},advance);

describe('paragraph layout and shared mutation contracts', () => {
  it('wraps complete words without changing authored source and maps consumed separators', () => {
    const text='Alpha beta gamma', result=layout(text,{wrapWidth:70});
    expect(result.lines.map(line=>line.text)).toEqual(['Alpha','beta','gamma']);
    expect(result.lines.map(line=>[line.start,line.end])).toEqual([[0,6],[6,11],[11,16]]);
    expect(result).toMatchObject({width:70,height:36});
    expect(result.lines.map(line=>line.y)).toEqual([0,12,24]);
    expect(text).toBe('Alpha beta gamma');
  });
  it('spaces hard paragraphs and applies first-line indent from the logical start', () => {
    const result=layout('One two\nThree four',{wrapWidth:60,paragraphSpacing:8,firstLineIndent:10});
    expect(result.lines.map(line=>[line.text,line.x,line.y])).toEqual([['One',10,0],['two',0,12],['Three',10,32],['four',0,44]]);
    expect(result.height).toBe(56);
    expect(layout('One two',{wrapWidth:60,firstLineIndent:10,direction:'rtl',align:'right'}).lines.map(line=>line.x)).toEqual([50,60]);
    expect(layout('One two',{wrapWidth:60,firstLineIndent:10,align:'center'}).lines.map(line=>line.x)).toEqual([35,30]);
  });
  it('retains nonbreaking runs, CJK punctuation and complete modern graphemes', () => {
    expect(layout('a\u00a0b c',{wrapWidth:20}).lines.map(line=>line.text)).toEqual(['a\u00a0b','c']);
    expect(layout('你好，世界。',{wrapWidth:30}).lines.map(line=>line.text)).toEqual(['你好，','世界。']);
    for(const text of ['👩‍👩‍👧‍👦家','🫨\u0301家','क्‍ष家','🇺🇸家']) {
      const result=layout(text,{wrapWidth:10}), boundaries=new Set([0,...[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(s=>s.index+s.segment.length)]);
      for(const line of result.lines){expect(boundaries.has(line.start)).toBe(true);expect(boundaries.has(line.end)).toBe(true);}
      expect(result.lines.map(line=>line.text).join('')).toBe(text);
    }
  });
  it('shows a discretionary hyphen only at its chosen break and keeps long words intact', () => {
    expect(layout('co\u00adoperate',{wrapWidth:40}).lines.map(line=>line.text)).toEqual(['co-','operate']);
    expect(layout('co\u00adoperate',{wrapWidth:100}).lines.map(line=>line.text)).toEqual(['cooperate']);
    expect(layout('Unbreakable',{wrapWidth:1}).lines.map(line=>line.text)).toEqual(['Unbreakable']);
    expect(layout('a b',{wrapWidth:1,firstLineIndent:100}).lines.map(line=>line.text)).toEqual(['a','b']);
  });
  it('keeps legacy point text, explicit whitespace, empty paragraphs and signed advances', () => {
    expect(layout(' a \t\n\nlast').lines.map(line=>line.text)).toEqual([' a \t','','last']);
    expect(layout('\n',{wrapWidth:60,paragraphSpacing:5})).toMatchObject({width:60,height:29});
    expect(layoutText({text:'A B',fontSize:10,lineHeight:1,wrapWidth:50},()=>-12).lines.map(line=>line.text)).toEqual(['A B']);
    expect(()=>layout('text',{wrapWidth:NaN})).toThrow(/width/);
    expect(()=>layout('text',{paragraphSpacing:-1})).toThrow(/spacing/);
    expect(()=>layoutText({text:'text',fontSize:10,lineHeight:1},()=>Infinity)).toThrow(/nonfinite/);
    expect(layout('a\u2028b\u2029c',{wrapWidth:60,paragraphSpacing:5}).lines.map(line=>[line.text,line.y])).toEqual([['a',0],['b',12],['c',29]]);
    expect(layout('a\u2028',{wrapWidth:60}).lines.map(line=>line.text)).toEqual(['a','']);
    expect(layout('a\u2029b').lines.map(line=>line.text)).toEqual(['a\u2029b']);
  });
  it('preserves source, fractional frame width, one-command reset, undo and ancestor locks', () => {
    const doc=new Document(),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new TextLayer({text:'Alpha beta gamma',fontSize:20,wrapWidth:120.5,paragraphSpacing:12,firstLineIndent:14}));
    expect(layer.width).toBe(120.5);const original=layer.toJSON(),count=doc.getSnapshot().past.length;
    layer.resetParagraph();expect(layer.wrapWidth).toBeUndefined();expect(layer.paragraphSpacing).toBe(0);expect(layer.firstLineIndent).toBe(0);expect(doc.getSnapshot().past.length).toBe(count+1);
    doc.undo();expect(layer.toJSON()).toEqual(original);doc.redo();layer.wrapWidth=90;layer.paragraphSpacing=4;layer.firstLineIndent=-12;expect(layer.width).toBe(90);expect(layer.text).toBe('Alpha beta gamma');
    group.locked=true;const locked=doc.toJSON();expect(()=>layer.resetParagraph()).toThrow(/Unlock/);expect(()=>{layer.wrapWidth=100;}).toThrow(/Unlock/);expect(doc.toJSON()).toEqual(locked);
  });
  it('rejects invalid external styles, wrong owners and mismatched paragraph bounds atomically', () => {
    const doc=new Document(),layer=doc.layers.add(new TextLayer()),vector=doc.layers.add(new VectorLayer());
    for(const patch of [{wrapWidth:0},{wrapWidth:Infinity},{paragraphSpacing:-1},{paragraphSpacing:10001},{firstLineIndent:NaN},{firstLineIndent:10001}])expect(()=>parseCommands([{type:'layer.update',id:layer.id,patch}])).toThrow();
    expect(parseCommands([{type:'layer.update',id:layer.id,patch:{wrapWidth:null}}])[0]).toMatchObject({patch:{wrapWidth:null}});
    const before=doc.toJSON();expect(()=>doc._dispatch({type:'layer.update',id:vector.id,patch:{wrapWidth:10}})).toThrow(/text layer/);expect(doc.toJSON()).toEqual(before);
    const data=new TextLayer({wrapWidth:50}).toJSON();expect(()=>validateDocument({...doc.toJSON(),children:[{...data,width:51}]})).toThrow(/wrap width/);
    expect(()=>new TextLayer({wrapWidth:0})).toThrow(/width/);
  });
  it('upgrades every valid earlier root/history without injecting paragraph properties', () => {
    const doc=new Document();doc.layers.add(new TextLayer({text:'Legacy'}));doc.name='Later';
    for(let schemaVersion=1;schemaVersion<SCHEMA_VERSION;schemaVersion++){
      const restored=Document.fromJSON({...doc.toJSON(),schemaVersion});expect(restored.toJSON().schemaVersion).toBe(43);
      for(const key of ['wrapWidth','paragraphSpacing','firstLineIndent'])expect(restored.toJSON().children[0]).not.toHaveProperty(key);
    }
    const state=doc.getSnapshot(),old=(value:ReturnType<Document['toJSON']>)=>({...value,schemaVersion:25 as const});
    const restored=Document._fromWorkspace(old(doc.toJSON()),{version:1,past:state.past.map(entry=>({...entry,document:old(entry.document)})),future:[]});restored.undo();expect(restored.name).toBe('Untitled');restored.redo();expect(restored.toJSON()).toEqual(doc.toJSON());
  });
  it('rejects new fields under every earlier schema including immutable snapshots', () => {
    const doc=new Document();doc.layers.add(new TextLayer({wrapWidth:100,paragraphSpacing:0,firstLineIndent:0}));
    for(const source of [doc.toJSON(),doc.getSnapshot().document])for(let schemaVersion=1;schemaVersion<26;schemaVersion++)expect(()=>Document.fromJSON({...source,schemaVersion})).toThrow(/version 26/);
  });
  it('resizes paragraph width without scaling glyphs and holds the opposite corner', () => {
    const layer=new TextLayer({text:'One two three four five six',fontSize:20,wrapWidth:180,paragraphSpacing:8,firstLineIndent:12}),data=layer.toJSON();
    if(data.kind!=='text')throw new Error('Expected text');
    const patch=computeResizePatch({handle:'nw',layerX:10,layerY:20,layerWidth:layer.width,layerHeight:layer.height,layerFontSize:layer.fontSize,layerText:layer.text,layerFontFamily:layer.fontFamily,layerLineHeight:layer.lineHeight,layerTextStyle:data,layerKind:'text'},60,0,false);
    expect(patch).not.toHaveProperty('fontSize');expect(patch.wrapWidth).toBe(120);layer.update(patch);
    expect(layer.fontSize).toBe(20);expect(layer.x+layer.width).toBe(190);expect(layer.y+layer.height).toBe(20+data.height);
  });
  it('bounds nearly full-width measurement work and verifies fitting lines after misleading token estimates', () => {
    const text=Array.from({length:1800},()=> 'word').join(' ');let calls=0,characters=0;
    const result=layoutText({text,fontSize:10,lineHeight:1,wrapWidth:text.length*10-1},value=>{calls++;characters+=value.length;return value.length*10;});
    expect(result.lines).toHaveLength(2);expect(calls).toBeLessThan(20);expect(characters).toBeLessThan(text.length*4);
    const nonlinear=(value:string)=>value.endsWith(' ')?1000:value.length*10;
    const wrapped=layoutText({text:'a b c',fontSize:10,lineHeight:1,wrapWidth:30},nonlinear);
    expect(wrapped.lines.map(line=>line.text)).toEqual(['a b','c']);
    for(const line of wrapped.lines)expect(nonlinear(line.text)).toBeLessThanOrEqual(30);
    const point=layoutText({text:'Original\nPoint text',fontSize:20,lineHeight:1.2,align:'right'},()=>{throw new Error('Unneeded measurement');},160);
    expect(point.lines.map(line=>[line.x,line.y])).toEqual([[160,0],[160,24]]);expect(point.width).toBe(160);
  });
});
