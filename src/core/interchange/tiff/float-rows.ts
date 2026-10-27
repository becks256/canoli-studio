import{Cursor,decodedStream}from'./pixel-stream';
import type{InspectedTiff,TiffPage}from'./inspect';
import{supportsFloatTiff}from'./types';
/** Byte-plane accumulation follows TIFF floating-point Predictor 3. The wire
 * planes are most-significant-byte first, independently of file byte order. */
function restore(row:Uint8Array,predictor:number,channels:number,little:boolean,bytes:number){
 if(predictor===2){const view=new DataView(row.buffer,row.byteOffset,row.byteLength);for(let i=channels*bytes;i<row.length;i+=bytes){if(bytes===2)view.setUint16(i,(view.getUint16(i,little)+view.getUint16(i-channels*bytes,little))&65535,little);else view.setUint32(i,(view.getUint32(i,little)+view.getUint32(i-channels*bytes,little))>>>0,little);}}
 if(predictor===3){for(let i=channels;i<row.length;i++)row[i]=(row[i]+row[i-channels])&255;const planes=row.slice(),words=row.length/4;for(let i=0;i<words;i++)for(let byte=0;byte<4;byte++)row[i*4+byte]=planes[(little?3-byte:byte)*words+i];}
}
/** Owned straight RGBA float rows in the original source encoding. Unsigned
 * 16-bit samples normalize in float64 before one float32 rounding; no byte
 * proxy participates. All 65536 integer levels remain distinguishable. Finite HDR
 * values remain available internally; the current SDR editing proxy rejects
 * ranges which require a separate tone-map operation. No quantization here. */
export async function* floatTiffRows(inspection:InspectedTiff,page:TiffPage):AsyncGenerator<{top:number;samples:Float32Array<ArrayBuffer>}>{
 const r=page.report,reader=inspection.reader;if(!supportsFloatTiff(r))throw new Error('A supported unsigned 16-bit or float32 TIFF page is required.');const bytesPerSample=r.bits/8;
 const cursors:Cursor[]=[],predictor=page.fields.has(317)?await page.fields.get(317)!.value():1;
 try{
  for(let blockY=0;blockY<page.blocksDown;blockY++){
   const rows=Math.min(page.blockHeight,r.height-blockY*page.blockHeight),storedRows=page.fields.has(324)?page.blockHeight:rows,active:{cursor:Cursor;width:number;channels:number;rowBytes:number;x:number}[]=[];
   for(let plane=0;plane<(r.planar===2?r.samples:1);plane++)for(let column=0;column<page.blocksAcross;column++){
    const index=plane*page.blocksAcross*page.blocksDown+blockY*page.blocksAcross+column,width=Math.min(page.blockWidth,r.width-column*page.blockWidth),channels=r.planar===2?1:r.samples,rowBytes=page.blockWidth*channels*bytesPerSample,expected=rowBytes*storedRows,offset=await page.fields.get(page.fields.has(324)?324:273)!.value(index),bytes=await page.fields.get(page.fields.has(324)?325:279)!.value(index);
    if(!Number.isSafeInteger(expected)||!bytes||!Number.isSafeInteger(offset+bytes)||offset+bytes>reader.blob.size)throw new Error('Invalid TIFF float block extent.');const cursor=new Cursor(decodedStream(reader.blob.slice(offset,offset+bytes),r.compression,expected));cursors.push(cursor);active.push({cursor,width,channels,rowBytes,x:column*page.blockWidth});
   }
   for(let y=0;y<rows;y++){
    const source:DataView[]=[];
    for(const block of active){const useful=block.width*block.channels*bytesPerSample,read=predictor===3?block.rowBytes:useful,bytes=await block.cursor.read(read);await block.cursor.skip(block.rowBytes-read);restore(bytes,predictor,block.channels,reader.little,bytesPerSample);source.push(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength));}
    const samples=new Float32Array(r.width*4),colors=r.photometric===2?3:1;
    for(let column=0;column<page.blocksAcross;column++)for(let x=0;x<active[column].width;x++){
     const get=(channel:number)=>{const view=source[r.planar===2?channel*page.blocksAcross+column:column],at=(r.planar===2?x:x*r.samples+channel)*bytesPerSample;return bytesPerSample===2?view.getUint16(at,reader.little)/65535:view.getFloat32(at,reader.little);},alpha=page.alpha?get(colors):1,at=(active[column].x+x)*4;
     if(!Number.isFinite(alpha)||alpha<0||alpha>1)throw new Error('TIFF float alpha must be finite and in [0,1].');
     for(let c=0;c<3;c++){const value=get(r.photometric===2?c:0);if(!Number.isFinite(value))throw new Error('TIFF float color samples must be finite.');let color=r.photometric===0?1-value:value;if(page.alpha===1)color=alpha?color/alpha:0;samples[at+c]=color;if(!Number.isFinite(samples[at+c]))throw new Error('TIFF float unassociated color is not representable.');}samples[at+3]=alpha;
    }
    yield{top:blockY*page.blockHeight+y,samples};
   }
   for(const block of active){await block.cursor.skip(block.rowBytes*(storedRows-rows));await block.cursor.end();await block.cursor.close();cursors.splice(cursors.indexOf(block.cursor),1);}
  }
 }finally{await Promise.allSettled(cursors.map(cursor=>cursor.close()));}
}
