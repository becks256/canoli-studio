import {prepareIccOutput,type IccOutput} from './icc-output';
import{isFloatDocument}from'../core/float-document';
import{prepareFloatDelivery,type FloatDelivery}from'./float-delivery';
import{freeze,isImmutable}from'../core/immutable';
import{validateDocument}from'../core/model';
import {normalizeColorOutput,type ColorOutput} from '../core/color/color-settings';
import type {DocumentData} from '../core/model';
import type {AssetStore} from '../core/assets';
import type {DocumentRenderer} from './renderer';
import {PdfWriter, pdfNumber, pdfPageGeometry} from '../core/pdf';
import {STANDARD_PROFILES} from '../core/color/icc';
import {RASTER_EXPORT_COLUMNS, rasterExportRows} from './raster-export-grid';
import {captureRasterExportSources} from './raster-export-source';
import {checkExport, type ExportControl} from './export-control';
import {release} from './canvas';
import {yieldTask} from '../core/task-yield';

class DeflateRows {
  private stream = new CompressionStream('deflate');
  private writer = this.stream.writable.getWriter();
  private reader = this.stream.readable.getReader();
  private parts: BlobPart[] = [];
  private collect: Promise<void>;
  private state: 'open'|'closed'|'failed' = 'open';
  private aborting?: Promise<void>;
  private cancel = () => { void this.abort(this.control?.signal?.reason); };
  constructor(private control?:ExportControl) {
    this.collect = (async()=>{while(true){const {done,value}=await this.reader.read();if(done)break;this.parts.push(new Uint8Array(value));}})();
    void this.collect.catch(error=>this.writer.abort(error).catch(()=>{}));
    control?.signal?.addEventListener('abort',this.cancel,{once:true});
  }
  async write(bytes:Uint8Array<ArrayBuffer>) {
    checkExport(this.control);if(this.state!=='open')throw new Error('PDF compression is closed.');await this.writer.write(bytes);checkExport(this.control);
  }
  private release() {this.control?.signal?.removeEventListener('abort',this.cancel);this.writer.releaseLock();this.reader.releaseLock();}
  async finish():Promise<Blob> {
    try {checkExport(this.control);if(this.state!=='open')throw new Error('PDF compression is closed.');await this.writer.close();await this.collect;checkExport(this.control);const blob=new Blob(this.parts);this.parts=[];this.state='closed';this.release();return blob;}
    catch(error){await this.abort(error);checkExport(this.control);throw error;}
  }
  abort(reason?:unknown):Promise<void> {
    if(this.aborting)return this.aborting;if(this.state==='closed')return Promise.resolve();this.state='failed';
    return this.aborting=Promise.allSettled([this.writer.abort(reason),this.reader.cancel(reason),this.collect]).then(()=>{this.parts=[];this.release();});
  }
}

/** One native-resolution raster page; source pixels are never resampled to set DPI. */
export async function exportPdf(document: DocumentData, assets: AssetStore, renderer: DocumentRenderer, dpi: unknown = 72, control?: ExportControl, color?:ColorOutput): Promise<Blob> {
  checkExport(control);
  document=isImmutable(document)?document:freeze(structuredClone(document));validateDocument(document);
  const geometry = pdfPageGeometry(document.width,document.height,dpi), writer = new PdfWriter();
  color=color?normalizeColorOutput(color):undefined;let output:IccOutput|null=null,float:FloatDelivery<'rgba8'>|undefined;
  const current = captureRasterExportSources(document,assets,control,'PDF export');
  try{
  if(isFloatDocument(document))float=await prepareFloatDelivery(document,assets,renderer,'rgba8',control,color);else output=await prepareIccOutput(color,control);current();
  const catalog=writer.reserve(),pages=writer.reserve(),page=writer.reserve(),profile=writer.reserve(),content=writer.reserve(),info=writer.reserve();
  const colors=new DeflateRows(control),coverage=new DeflateRows(control);
  const rows=rasterExportRows(document.width),total=Math.ceil(document.width/RASTER_EXPORT_COLUMNS)*Math.ceil(document.height/rows); let completed=0;
  let opaque=true;
  try {
    writer.stream(profile,'/N 3 /Alternate /DeviceRGB',new Blob([float?.profile??output?.profile??new Uint8Array(STANDARD_PROFILES.srgb.iccBytes!)]));
    control?.onProgress?.({phase:'rendering',fraction:0}); current();
    for(let y=0;y<document.height;y+=rows) {
      current();const height=Math.min(rows,document.height-y),rgb=new Uint8Array(document.width*height*3),alpha=new Uint8Array(document.width*height);
      for(let x=0;x<document.width;x+=RASTER_EXPORT_COLUMNS) {
        current();const width=Math.min(RASTER_EXPORT_COLUMNS,document.width-x);
        const tile=float?undefined:await renderer.render(document,assets,{region:{x,y,width,height},cache:false,readback:true,isCancelled:()=>!!control?.signal?.aborted});
        try {
          current();if(tile&&(tile.width!==width||tile.height!==height))throw new Error('PDF rendering did not return native-resolution pixels.');
          let rgba=float?await float.read({x,y,width,height}):tile!.getContext('2d')!.getImageData(0,0,width,height).data;
          if(output){rgba=await output.apply(rgba);current();}
          for(let row=0;row<height;row++)for(let col=0;col<width;col++) {
            const i=(row*width+col)*4,p=row*document.width+x+col,j=p*3;
            rgb[j]=rgba[i];rgb[j+1]=rgba[i+1];rgb[j+2]=rgba[i+2];alpha[p]=rgba[i+3];if(alpha[p]!==255)opaque=false;
          }
        }finally{if(tile)release(tile);}
        completed++;control?.onProgress?.({phase:'rendering',fraction:completed/total});current();await yieldTask();
      }
      await colors.write(rgb);await coverage.write(alpha);current();
    }
    current();control?.onProgress?.({phase:'encoding',fraction:null});current();
    const color=await colors.finish();current();const alpha=await coverage.finish();current();let mask=0;
    if(!opaque){mask=writer.reserve();writer.stream(mask,`/Type /XObject /Subtype /Image /Width ${document.width} /Height ${document.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Interpolate false /Filter /FlateDecode`,alpha);}
    const image=writer.reserve();writer.stream(image,`/Type /XObject /Subtype /Image /Width ${document.width} /Height ${document.height} /ColorSpace [/ICCBased ${profile} 0 R] /BitsPerComponent 8 /Interpolate false /Filter /FlateDecode${mask?` /SMask ${mask} 0 R`:''}`,color);
    // One image matrix prevents independent strip/tile edge rounding at non-72 DPI.
    writer.stream(content,'',new Blob([`q\n${pdfNumber(geometry.scale)} 0 0 ${pdfNumber(geometry.scale)} 0 0 cm\nq\n${document.width} 0 0 ${document.height} 0 0 cm\n/I0 Do\nQ\nQ\n`]));
    writer.object(page,`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${pdfNumber(geometry.width)} ${pdfNumber(geometry.height)}] /UserUnit ${geometry.userUnit} /Resources << /XObject << /I0 ${image} 0 R >> >> /Group << /S /Transparency /CS [/ICCBased ${profile} 0 R] /I true /K false >> /Contents ${content} 0 R >>`);
    writer.object(pages,`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
    writer.object(catalog,`<< /Type /Catalog /Pages ${pages} 0 R >>`);
    writer.object(info,'<< /Producer (Canoli Studio) /Creator (Canoli Studio) >>');
    current();const blob=writer.finish(catalog,info);current();return blob;
  } catch(error) {writer.abort();await Promise.allSettled([colors.abort(error),coverage.abort(error)]);throw error;}
  }finally{float?.dispose();output?.dispose();current.release();}
}
