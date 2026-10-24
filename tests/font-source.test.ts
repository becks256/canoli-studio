import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {inspectFontBytes,prepareFontBytes} from '../src/fonts/parser';
import {fontDigest} from '../src/fonts/types';
import {sfntChecksum} from '../src/fonts/sfnt';

const fixture=(name:string)=>readFileSync(new URL(`./fixtures/fonts/${name}`,import.meta.url));
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');

describe('font source inspection and whole-face extraction',()=>{
  it.each([['Regular.ttf','ttf',1],['CFF.otf','otf',1],['Regular.woff','woff',1],['Regular.woff2','woff2',1],['Collection.ttc','ttc',2],['Collection.dfont','dfont',2]]as const)('inspects real %s bytes and face identities',async(name,format,count)=>{
    const bytes=fixture(name),report=await inspectFontBytes(bytes);
    expect(report).toMatchObject({version:1,format,faceCount:count,byteLength:bytes.length,sha256:sha(bytes),offset:0});
    expect(report.faces).toHaveLength(count);
    for(const face of report.faces){expect(face.glyphCount).toBe(3);expect(face.unitsPerEm).toBe(1000);expect(face.embeddingFlags).toBe(0);expect(face.cssFamily).toBe(`CanoliFont_${face.id}`);}
    if(count===2)expect(report.faces.map(f=>f.fullName)).toEqual(['Canoli Source Regular','Canoli Source Bold']);
  });
  it('uses exact pooled Buffer view bytes and captures mutable inputs before yielding',async()=>{
    const original=fixture('Regular.ttf'),pool=Buffer.alloc(original.length+32,42);original.copy(pool,16);const view=pool.subarray(16,16+original.length);
    expect(await fontDigest(view)).toBe(sha(original));
    const pending=inspectFontBytes(view);view.fill(0);expect((await pending).sha256).toBe(sha(original));
  });
  it('pages all collection faces and requires an explicit face for preparation',async()=>{
    const bytes=fixture('Collection.ttc'),first=await inspectFontBytes(bytes,{limit:1}),second=await inspectFontBytes(bytes,{offset:1,limit:1});
    expect(first.faces[0].index).toBe(0);expect(second).toMatchObject({faceCount:2,offset:1});expect(second.faces[0].index).toBe(1);expect(second.faces[0].id).not.toBe(first.faces[0].id);
    await expect(prepareFontBytes(bytes)).rejects.toThrow('explicit face index');
    await expect(inspectFontBytes(bytes,{offset:2})).rejects.toThrow('offset');
    await expect(prepareFontBytes(bytes,{faceIndex:2})).rejects.toThrow('face index');
  });
  it.each(['Regular.ttf','CFF.otf','Regular.woff','Regular.woff2'])('retains all original %s bytes without conversion',async name=>{
    const bytes=fixture(name),prepared=await prepareFontBytes(bytes);
    expect(prepared).toMatchObject({extracted:false,repacked:false,omittedTables:[],renderSha256:sha(bytes)});
    expect(new Uint8Array(await prepared.renderBlob.arrayBuffer())).toEqual(new Uint8Array(bytes));
  });
  it('repackages the complete selected TTC face with a valid SFNT checksum',async()=>{
    const bytes=fixture('Collection.ttc'),original=sha(bytes),prepared=await prepareFontBytes(bytes,{faceIndex:1});
    expect(prepared.report.faces[0]).toMatchObject({index:1,fullName:'Canoli Source Bold',weightClass:700,glyphCount:3});
    expect(prepared).toMatchObject({extracted:true,repacked:true,renderFormat:'ttf',omittedTables:[]});
    const native=new Uint8Array(await prepared.renderBlob.arrayBuffer());expect(sfntChecksum(native)).toBe(0xb1b0afba);expect((await inspectFontBytes(native)).faces[0].fullName).toBe('Canoli Source Bold');expect(sha(bytes)).toBe(original);
  });
  it('extracts the exact standalone face from a Macintosh datafork',async()=>{
    const prepared=await prepareFontBytes(fixture('Collection.dfont'),{faceIndex:1});expect(prepared).toMatchObject({extracted:true,repacked:false,renderFormat:'ttf',omittedTables:[]});
    expect(new Uint8Array(await prepared.renderBlob.arrayBuffer())).toEqual(new Uint8Array(fixture('Bold.ttf')));
  });
  it('reports removal of DSIG on repacking while preserving the original collection',async()=>{
    const bytes=fixture('DsigCollection.ttc'),original=sha(bytes),prepared=await prepareFontBytes(bytes,{faceIndex:0});expect(prepared.omittedTables).toEqual(['DSIG']);expect(sha(bytes)).toBe(original);
    expect(sfntChecksum(new Uint8Array(await prepared.renderBlob.arrayBuffer()))).toBe(0xb1b0afba);
  });
  it('rejects corrupt collection directories before allocating derived font data',async()=>{
    const bytes=new Uint8Array(fixture('Collection.ttc')),view=new DataView(bytes.buffer),offset=view.getUint32(12);
    view.setUint32(offset+12+8,bytes.length+100);
    await expect(prepareFontBytes(bytes,{faceIndex:0})).rejects.toThrow('outside its source');
    const duplicate=new Uint8Array(fixture('Collection.ttc')),d=new DataView(duplicate.buffer),start=d.getUint32(12);d.setUint32(start+28,d.getUint32(start+12));
    await expect(prepareFontBytes(duplicate,{faceIndex:0})).rejects.toThrow('Duplicate');
  });
  it('reads genuine variable WOFF2 axes without pretending a static face range',async()=>{
    const bytes=readFileSync('node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2'),report=await inspectFontBytes(bytes),face=report.faces[0];
    expect(face.axes).toEqual([{tag:'wght',name:'Weight',min:200,default:200,max:800}]);expect(face.descriptors).toEqual([{style:'normal',weight:'200 800',stretch:'100%'}]);expect(report.sha256).toBe(sha(bytes));
  });
  it('rejects malformed data and invalid options instead of returning a fake face',async()=>{
    await expect(inspectFontBytes(new Uint8Array(4))).rejects.toThrow('Truncated');
    await expect(inspectFontBytes(fixture('Regular.ttf'),{limit:0})).rejects.toThrow();
    await expect(prepareFontBytes(fixture('Regular.ttf'),{faceIndex:-1})).rejects.toThrow();
  });
});
