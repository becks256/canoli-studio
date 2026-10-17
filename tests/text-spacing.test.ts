import {describe,expect,it} from 'vitest';
import {Document,TextLayer,LayerGroup,VectorLayer} from '../src/dom';
import {measureTextBounds,SCHEMA_VERSION,validateDocument} from '../src/core/model';
import {parseCommands} from '../src/core/validation';
import {applyTextStyle,assertTextStyleSupport} from '../src/core/text-style';
import {computeResizePatch} from '../src/ui/utils';

describe('native typography spacing contracts',()=>{
  it('retains absent legacy defaults and upgrades roots/history without injecting new fields',()=>{
    const doc=new Document(),layer=doc.layers.add(new TextLayer({text:'Original'}));doc.name='Later';const snapshot=doc.getSnapshot();
    const old=(value:ReturnType<Document['toJSON']>)=>({...value,schemaVersion:24 as const});
    for(let schemaVersion=1;schemaVersion<SCHEMA_VERSION;schemaVersion++){
      const restored=Document.fromJSON({...doc.toJSON(),schemaVersion});
      expect(restored.toJSON().schemaVersion).toBe(SCHEMA_VERSION);
      expect(restored.toJSON().children[0]).not.toHaveProperty('wordSpacing');
      expect(restored.toJSON().children[0]).not.toHaveProperty('fontKerning');
    }
    const restored=Document._fromWorkspace(old(doc.toJSON()),{version:1,past:snapshot.past.map(entry=>({...entry,document:old(entry.document)})),future:[]});
    restored.undo();expect(restored.name).toBe('Untitled');restored.redo();expect(restored.toJSON()).toEqual(doc.toJSON());expect(layer.wordSpacing).toBeUndefined();
  });
  it('edits and resets spacing through one command with exact undo, ownership and ancestor locks',()=>{
    const doc=new Document(),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new TextLayer({text:'AV wide words',wordSpacing:12,fontKerning:'none',letterSpacing:2,color:'#205080',fontWeight:'bold'}));
    const before=layer.toJSON(),count=doc.getSnapshot().past.length;layer.resetSpacing();
    expect(layer.toJSON()).toMatchObject({wordSpacing:0,fontKerning:'auto',letterSpacing:0,color:'#205080',fontWeight:'bold'});expect(doc.getSnapshot().past.length).toBe(count+1);
    doc.undo();expect(layer.toJSON()).toEqual(before);doc.redo();layer.wordSpacing=-4;layer.fontKerning='normal';expect(layer.wordSpacing).toBe(-4);expect(layer.fontKerning).toBe('normal');
    group.locked=true;const locked=doc.toJSON();expect(()=>layer.resetSpacing()).toThrow(/Unlock/);expect(()=>{layer.wordSpacing=10;}).toThrow(/Unlock/);expect(doc.toJSON()).toEqual(locked);
  });
  it('rejects invalid external typography and wrong layer kinds atomically',()=>{
    const doc=new Document(),layer=doc.layers.add(new TextLayer()),vector=doc.layers.add(new VectorLayer());
    for(const patch of [{wordSpacing:Infinity},{wordSpacing:501},{wordSpacing:-51},{fontKerning:'optical'},{fontKerning:null}])expect(()=>parseCommands([{type:'layer.update',id:layer.id,patch}])).toThrow();
    const before=doc.toJSON();expect(()=>doc._dispatch({type:'layer.update',id:vector.id,patch:{wordSpacing:4}})).toThrow(/text layer/);expect(doc.toJSON()).toEqual(before);
    expect(()=>new TextLayer({wordSpacing:NaN})).toThrow();expect(()=>new TextLayer({fontKerning:'optical' as never})).toThrow();
  });
  it('rejects new fields under every old root label, including immutable snapshots',()=>{
    const doc=new Document();doc.layers.add(new TextLayer({wordSpacing:0,fontKerning:'auto'}));validateDocument(doc.getSnapshot().document);
    for(const source of [doc.toJSON(),doc.getSnapshot().document])for(let schemaVersion=1;schemaVersion<25;schemaVersion++){
      expect(()=>validateDocument({...source,schemaVersion})).toThrow(/version 25/);
      expect(()=>Document.fromJSON({...source,schemaVersion})).toThrow(/version 25/);
    }
  });
  it('accounts for separator spacing in explicitly approximate headless metrics',()=>{
    const normal=measureTextBounds('A B\tC\u00a0D',20,'sans-serif',1.2),spaced=measureTextBounds('A B\tC\u00a0D',20,'sans-serif',1.2,{wordSpacing:12,fontKerning:'none'});
    expect(spaced.width-normal.width).toBe(36);expect(spaced.height).toBe(normal.height);
  });
  it('resets all reused native state and rejects unsupported nondefault controls before assignment',()=>{
    const context={font:'',letterSpacing:'9px',wordSpacing:'8px',fontKerning:'none',direction:'rtl'};
    applyTextStyle(context as never,{fontSize:24,fontFamily:'serif'});expect(context).toMatchObject({letterSpacing:'0px',wordSpacing:'0px',fontKerning:'auto',direction:'ltr'});
    const unsupported={font:'untouched'};expect(()=>assertTextStyleSupport(unsupported as never,{fontSize:24,fontFamily:'serif',wordSpacing:1})).toThrow(/word spacing/);expect(()=>applyTextStyle(unsupported as never,{fontSize:24,fontFamily:'serif',fontKerning:'none'})).toThrow(/kerning/);expect(unsupported.font).toBe('untouched');
    expect(()=>applyTextStyle(unsupported as never,{fontSize:24,fontFamily:'serif',wordSpacing:0,fontKerning:'auto'})).not.toThrow();
  });
  it('keeps the opposite corner anchored when resizing styled text with complete metrics',()=>{
    const layer=new TextLayer({text:'AV wide words',fontSize:20,wordSpacing:12,letterSpacing:2,fontWeight:'bold',fontKerning:'none'}),style=layer.toJSON();
    if(style.kind!=='text')throw new Error('Expected text');
    const patch=computeResizePatch({handle:'nw',layerKind:'text',layerX:10,layerY:20,layerWidth:layer.width,layerHeight:layer.height,layerFontSize:20,layerText:layer.text,layerFontFamily:layer.fontFamily,layerLineHeight:layer.lineHeight,layerTextStyle:style},-layer.width,-layer.height,false);
    const expected=measureTextBounds(layer.text,patch.fontSize!,layer.fontFamily,layer.lineHeight,{...style,fontSize:patch.fontSize!} as never);
    expect(patch.x!+expected.width).toBe(10+layer.width);expect(patch.y!+expected.height).toBe(20+layer.height);expect(patch.fontSize).toBe(40);
  });
});
