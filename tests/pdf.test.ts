import {describe,it,expect} from 'vitest';
import {PdfWriter,pdfCrossReferences,pdfNumber,pdfPageGeometry} from '../src/core/pdf';
import {Document} from '../src/dom';
import {getExportCapabilityReport} from '../src/engine/export';

describe('native PDF page and file contract',()=>{
 it('sets physical dimensions without changing native resolution and scales oversized pages',()=>{
  expect(pdfPageGeometry(2400,3000,300)).toEqual({width:576,height:720,userUnit:1,scale:.24,dpi:300});
  expect(pdfPageGeometry(16417,65)).toEqual({width:8208.5,height:32.5,userUnit:2,scale:.5,dpi:72});
  for(const dpi of [0,-1,NaN,Infinity,null,'300'])expect(()=>pdfPageGeometry(100,100,dpi)).toThrow(/resolution/);
  expect(()=>pdfPageGeometry(1e12,1)).toThrow(/physical page/);
  expect(()=>pdfPageGeometry(10.5,1)).toThrow(/dimensions/);
 });
 it('writes finite PDF real values without exponent notation or precision truncation',()=>{
  for(const value of [0,-0,1e-8,-2.345e-12,1.234e24,Number.MIN_VALUE,.24]){
   const text=pdfNumber(value);expect(text).not.toMatch(/[eE]/);expect(Number(text)).toBe(value===0?0:value);
  }
  expect(()=>pdfNumber(Infinity)).toThrow();
 });
 it('retains multi-GiB cross-reference offsets without allocating a huge file',()=>{
  const offsets=[0,15,2**32+47,10_000_000_001,Number.MAX_SAFE_INTEGER],bytes=pdfCrossReferences(offsets),view=new DataView(bytes.buffer);
  expect(view.getUint16(9)).toBe(65535);
  for(let i=1;i<offsets.length;i++){expect(bytes[i*11]).toBe(1);expect(view.getBigUint64(i*11+1)).toBe(BigInt(offsets[i]));}
  for(const bad of [[0,0],[0,-1],[1,15],[0,2**53]])expect(()=>pdfCrossReferences(bad)).toThrow();
 });
 it('refuses incomplete or duplicate objects and releases aborted output',()=>{
  const writer=new PdfWriter(),root=writer.reserve(),info=writer.reserve();
  writer.object(root,'<< /Type /Catalog >>');expect(()=>writer.object(root,'null')).toThrow(/duplicate/);
  expect(()=>writer.finish(root,info)).toThrow(/Missing/);
  writer.object(info,'<< /Producer (Canoli Studio) >>');writer.reserve();expect(()=>writer.finish(root,info)).toThrow(/Unwritten/);
  writer.abort();expect(()=>writer.reserve()).toThrow(/closed/);
 });
 it('discloses rasterization, metadata and production limits before export',()=>{
  const report=getExportCapabilityReport(new Document().toJSON(),{format:'pdf',pdfDpi:300});
  expect(report.featuresPreserved.join(' ')).toContain('300 DPI');
  expect(report.warnings.join(' ')).toMatch(/not searchable/);
  expect(report.warnings.join(' ')).toMatch(/not PDF\/X/);
  expect(report.warnings.join(' ')).toMatch(/EXIF\/GPS/);
 });
});
