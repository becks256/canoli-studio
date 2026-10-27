import{test,expect}from'@playwright/test';
import{writeFile}from'node:fs/promises';
import{spawnSync}from'node:child_process';
test('ordered native TIFF pages embed the captured output ICC profile and match independent converted samples on every page',async({page},info)=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const{editor,PaintLayer,PaintFill}=window.luma,documents=[];
  for(const name of ['First ICC page','Second ICC page']){
   editor.newDocument({name,width:96,height:64});const doc=editor.document,layer=doc.layers.add(new PaintLayer());
   for(const[x,color,opacity]of [[0,'#ff0000',1],[32,'#30b060',.5],[64,'#2060ff',.01]]as const)layer.strokes.add(new PaintFill({bounds:{x,y:0,width:32,height:64},color,opacity}));documents.push(doc);
  }
  const before=documents.map(doc=>doc.getSnapshot()),options={variant:'big' as const,color:{profile:'display-p3' as const}},source=await editor.exportPng();
  const tiff=await editor.exportTiffPages([...documents].reverse(),options,{onProgress:()=>{(options.color as{profile:string}).profile='linear-srgb';}}),png=await editor.export({format:'png',color:{profile:'display-p3'}}),pdf=await editor.export({format:'pdf',color:{profile:'display-p3'}});
  (window as unknown as{iccFiles:Record<string,Blob>}).iccFiles={source,png:png.blob,tiff:tiff.blob,pdf:pdf.blob};
  return{unchanged:documents.every((doc,i)=>doc.getSnapshot()===before[i]),report:tiff.report};
 });expect(result.unchanged).toBe(true);expect(result.report.warnings.join(' ')).toContain('Display P3');expect(result.report.warnings.join(' ')).not.toContain('Linear sRGB');
 const paths:Record<string,string>={};for(const key of ['source','png','tiff','pdf']){const pending=page.waitForEvent('download');await page.evaluate(key=>{const blob=(window as unknown as{iccFiles:Record<string,Blob>}).iccFiles[key],a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=key;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},key);paths[key]=info.outputPath(key+(key==='pdf'?'.pdf':key==='tiff'?'.tif':'.png'));await(await pending).saveAs(paths[key]);}
 const checked=spawnSync(process.env.CANOLI_PDF_PYTHON||'python3',['scripts/check-icc-delivery.py',paths.source,'tests/fixtures/icc-native/display-p3.icc',paths.png,paths.tiff,paths.pdf],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stderr||checked.stdout).toBe(0);const independent=JSON.parse(checked.stdout);expect(independent.cases.filter((c:{format:string})=>c.format==='TIFF')).toHaveLength(2);await writeFile(info.outputPath('icc-pages.json'),JSON.stringify({runtime:result,independent},null,2));
});
