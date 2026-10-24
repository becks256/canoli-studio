import {it,expect} from 'vitest';
import {EditorApplication} from '../src/editor';
import {Document} from '../src/dom';
import {serializeProject} from '../src/core/project';
if(typeof globalThis.Worker==='undefined')globalThis.Worker=class {postMessage(){}addEventListener(){}removeEventListener(){}terminate(){}} as unknown as typeof Worker;

it('rejects empty, duplicate, detached and invalid-option page selections without rendering or editing',async()=>{
 const editor=new EditorApplication(),before=editor.document.getSnapshot();let callbacks=0;
 try{
  for(const [pages,options]of [[[],{}],[[editor.document,editor.document],{}],[[new Document()],{}],[[editor.document],{variant:'wrong'}],[[editor.document],{unexpected:true}]] as const){
   await expect(editor.exportTiffPages(pages,options as never,{onProgress:()=>callbacks++})).rejects.toThrow();
   expect(editor.document.getSnapshot()).toBe(before);
  }
  expect(callbacks).toBe(0);
 }finally{editor.dispose();}
});
it('uses open-document identity even when two projects share their persisted document ID',async()=>{
 const editor=new EditorApplication();
 try{
  const first=editor.document;first.name='First open copy';
  const file=await serializeProject(first.toJSON(),editor.assetStore);
  await editor.openProject(new File([file],'Second.luma'));const second=editor.document;
  expect(second).not.toBe(first);expect(second.id).toBe(first.id);second.name='Second open copy';
  const before=editor.openDocuments.map(doc=>doc.getSnapshot());
  const report=editor.getTiffPagesCapabilityReport([second,first],{variant:'big'});
  expect(report.warnings[0]).toContain('2 TIFF pages');expect(report.featuresDegradedOrOmitted.join(' ')).not.toMatch(/multipage/);expect(report.warnings.join(' ')).toContain('Each TIFF page is a flattened image');expect(report.featuresPreserved).toContain('Independent native page dimensions and page order');
  expect(editor.openDocuments.map(doc=>doc.getSnapshot())).toEqual(before);expect(editor.document).toBe(second);
 }finally{editor.dispose();}
});
it('reports one-page TIFF without inventing an editable container or precision upgrade',()=>{
 const editor=new EditorApplication();
 try{const report=editor.getTiffPagesCapabilityReport([editor.document]);expect(report.warnings.join(' ')).toMatch(/flattened/);expect(JSON.stringify(report)).toMatch(/8-bit|RGBA8|sRGB/);expect(report.format).toBe('tiff');}
 finally{editor.dispose();}
});
