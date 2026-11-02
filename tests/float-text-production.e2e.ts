import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {historyProject} from './helpers/history-inspector';

test('production float Text tool retains its original font, HDR Inspector edits, Undo and exact native delivery after reopen',async({page},info)=>{
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByTestId('import-input').setInputFiles('tests/fixtures/tiff-float/rgba-raw-le.tif');const dialog=page.getByRole('dialog',{name:'Import TIFF',exact:true});await dialog.getByLabel('TIFF editing precision',{exact:true}).selectOption('float32');await dialog.getByRole('button',{name:'Import TIFF page',exact:true}).click();await expect(dialog).toHaveCount(0);
 const original=await historyProject(page,info,'original.luma');await page.getByRole('button',{name:'Text tool (T)',exact:true}).click();const box=(await page.locator('.canvas-wrap').boundingBox())!;await page.mouse.click(box.x+box.width/2-40,box.y+box.height/2-20);const color=page.getByRole('textbox',{name:'Text color',exact:true});await expect(color).toBeVisible();const added=await historyProject(page,info,'added.luma');expect(added.value.document.schemaVersion).toBe(60);expect(added.value.fonts).toHaveLength(1);expect(Buffer.from(await added.value.fonts[0].original.arrayBuffer())).toEqual(await readFile('node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2'));
 await color.fill('color(srgb-linear 4 -.25 1.5 / .5)');await color.press('Enter');const edited=await historyProject(page,info,'edited.luma');expect(edited.value.document.children.find(layer=>layer.kind==='text')).toMatchObject({text:'Text',color:'color(srgb-linear 4 -.25 1.5 / .5)'});await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();expect((await historyProject(page,info,'color-undo.luma')).value.document).toEqual(added.value.document);await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();const undo=await historyProject(page,info,'tool-undo.luma');expect(undo.value.document).toEqual(original.value.document);expect(undo.value.fonts).toHaveLength(0);await page.getByRole('button',{name:'Redo (Mod+Shift+Z)',exact:true}).click();await page.getByRole('button',{name:'Redo (Mod+Shift+Z)',exact:true}).click();expect((await historyProject(page,info,'redo.luma')).value.document).toEqual(edited.value.document);
 const output=async(name:string)=>{await page.getByRole('button',{name:'Export…',exact:true}).click();const modal=page.locator('.export-dialog');await modal.getByLabel('Format',{exact:true}).selectOption('tiff');await modal.getByLabel('TIFF precision',{exact:true}).selectOption('float32');await modal.getByLabel('Use output RGB profile for high-precision TIFF',{exact:true}).uncheck();const pending=page.waitForEvent('download');await modal.getByRole('button',{name:'Export .tif',exact:true}).click();const path=info.outputPath(name+'.tif');await(await pending).saveAs(path);await expect(modal).toHaveCount(0);return path;};
 const first=await output('edited');await page.getByTestId('project-input').setInputFiles(edited.path);expect((await historyProject(page,info,'reopened.luma')).value.document).toEqual(edited.value.document);const second=await output('reopened');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
 const check=spawnSync(process.env.CANOLI_PDF_PYTHON||'python3',['-c',String.raw`
import ctypes as C,ctypes.util,sys,numpy as np,json,hashlib
l=C.CDLL(ctypes.util.find_library('tiff'));P=C.c_void_p;U=C.c_uint32
l.TIFFOpen.argtypes=[C.c_char_p,C.c_char_p];l.TIFFOpen.restype=P;l.TIFFGetField.argtypes=[P,U];l.TIFFReadEncodedTile.argtypes=[P,U,P,C.c_ssize_t];l.TIFFReadEncodedTile.restype=C.c_ssize_t;l.TIFFClose.argtypes=[P]
def read(path):
 h=l.TIFFOpen(path.encode(),b'r');assert h
 try:
  def get(tag,ty=U):
   v=ty();assert l.TIFFGetField(h,tag,C.byref(v));return v.value
  width=get(256);height=get(257);assert(width,height,get(258,C.c_uint16),get(339,C.c_uint16),get(277,C.c_uint16))==(131,79,32,3,4)
  w=get(322);t=get(323);out=np.empty((height,width,4),dtype='<f4')
  for y in range(0,height,t):
   for x in range(0,width,w):
    tile=np.empty((t,w,4),dtype='<f4');assert l.TIFFReadEncodedTile(h,(y//t)*((width+w-1)//w)+x//w,tile.ctypes.data,-1)==tile.nbytes
    rows=min(t,height-y);cols=min(w,width-x);out[y:y+rows,x:x+cols]=tile[:rows,:cols]
  return out
 finally:l.TIFFClose(h)
a=read(sys.argv[1]);b=read(sys.argv[2]);assert np.array_equal(a.view('<u4'),b.view('<u4'));assert np.max(a[:,:,:3])>1
print(json.dumps({'reader':'native libtiff','words':int(a.size),'wordErrors':0,'peak':float(np.max(a[:,:,:3])),'sha256':hashlib.sha256(a.tobytes()).hexdigest(),'debugGlobals':False}))
`,first,second],{encoding:'utf8',timeout:60000});expect(check.status,check.stderr||check.stdout).toBe(0);await writeFile(info.outputPath('production-float-text.json'),check.stdout);
});
