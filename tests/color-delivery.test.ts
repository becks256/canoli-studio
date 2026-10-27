import{afterEach,beforeEach,expect,it}from'vitest';
import{readFile}from'node:fs/promises';
import{nativeIccHost}from'./helpers/native-icc-host';
import{captureColorOutput,prepareColorOutputSource}from'../src/core/color/output-source';
import{encodeDeliveryPreset,readDeliveryPreset}from'../src/ai/batch/delivery-preset';
import{deliverySettingsHash,verifyDeliveryContract}from'../src/ai/batch/delivery-contract';
import{deliveryVariantSpecSchema}from'../src/ai/batch/schema';
import{serializeRecipePackage,readRecipePackage}from'../src/ai/recipes/package';
import{validateRecipe}from'../src/ai/recipes/schema';
import{computeSha256,generateDeliveryManifest,verifyDeliveryManifest}from'../src/ai/batch/manifest';
import{IccProfile}from'../src/core/color/profile-source';
import{Document}from'../src/dom';
import{AssetStore}from'../src/core/assets';
import{prepareFontBytes}from'../src/fonts/parser';
import type{DeliveryVariantSpec,BatchRun}from'../src/ai/batch/types';
import type{Recipe}from'../src/ai/recipes/types';
let cleanup:()=>void;beforeEach(async()=>{cleanup=await nativeIccHost();});afterEach(()=>cleanup());
const variant:DeliveryVariantSpec={id:'png',name:'Review',format:'png',targetWidth:32,targetHeight:16,fit:'contain'};
const recipe:Recipe={schemaVersion:1,id:'color-recipe',name:'Color recipe',description:'',version:1,parameters:[],steps:[{id:'size',name:'Resize',action:{type:'document.resize',width:32,height:16}}]};
it('captures complete built-in bytes and real native settings, rejects substituted files, CMYK output and aborted preparation',async()=>{
 const color=await captureColorOutput({profile:'display-p3',intent:'perceptual',blackPointCompensation:true});expect(color.profile.source.size).toBeGreaterThan(128);
 const prepared=await prepareColorOutputSource(color);expect(prepared.receipt).toMatchObject({sourceSpace:'srgb8',profileSha256:color.profile.sha256,engine:'Little CMS 2.19.1',intent:'perceptual',blackPointCompensation:true});
 const bad={...color,profile:{...color.profile,sha256:'0'.repeat(64)}};await expect(prepareColorOutputSource(bad)).rejects.toThrow('fingerprint');
 const abort=new AbortController();abort.abort();await expect(prepareColorOutputSource(color,{signal:abort.signal})).rejects.toThrow();
 const cmyk=await IccProfile.inspect(new Blob([await readFile('tests/fixtures/icc-native/synthetic-cmyk.icc')]));await expect(captureColorOutput({profile:cmyk})).rejects.toThrow('RGB output');
 for(const format of ['jpeg','webp','avif']as const)expect(deliveryVariantSpecSchema.safeParse({...variant,format,color}).success).toBe(false);
});
it('portable presets own full ICC originals, share payloads, preserve options and reject truncated or edited profile bytes',async()=>{
 const color=await captureColorOutput({profile:'display-p3'}),variants=[{...variant,color},{...variant,id:'pdf',format:'pdf' as const,pdfDpi:300,color}],file=await encodeDeliveryPreset({name:'Portable target',variants});
 const loaded=await readDeliveryPreset(new Blob([file]));expect(loaded.name).toBe('Portable target');expect(JSON.parse(JSON.stringify(loaded.variants))).toEqual(JSON.parse(JSON.stringify(variants)));for(let i=0;i<variants.length;i++)expect(new Uint8Array(await loaded.variants[i].color!.profile.source.arrayBuffer())).toEqual(new Uint8Array(await color.profile.source.arrayBuffer()));expect(await computeSha256(await loaded.variants[0].color!.profile.source.arrayBuffer())).toBe(color.profile.sha256);
 const bytes=new Uint8Array(await file.arrayBuffer()),length=Number(new DataView(bytes.buffer).getBigUint64(8,true)),manifest=JSON.parse(new TextDecoder().decode(bytes.slice(48,48+length)));expect(manifest.profiles).toHaveLength(1);
 bytes[bytes.length-1]^=1;await expect(readDeliveryPreset(new Blob([bytes]))).rejects.toThrow('checksum');await expect(readDeliveryPreset(file.slice(0,file.size-1))).rejects.toThrow('extent');
 const duplicated=[variants[0],variants[0]];await expect(encodeDeliveryPreset({name:'Bad',variants:duplicated})).rejects.toThrow('unique');
});
it('recipe v3/package v4 transport keeps delivery and font originals without granting document execution extra file authority',async()=>{
 const color=await captureColorOutput({profile:'adobe-rgb'}),deliveryPreset=await encodeDeliveryPreset({name:'Printed RGB',variants:[{...variant,color,format:'tiff'}]}),descriptor={version:1 as const,name:'Printed RGB',sha256:await computeSha256(await deliveryPreset.arrayBuffer()),byteLength:deliveryPreset.size};
 const assets=new AssetStore({fontSources:{nativeSet:null,prepare:async source=>prepareFontBytes(new Uint8Array(await source.arrayBuffer()))}}),document=new Document({assets});
 try{
  const font=await document.fonts.embed(new Blob([await readFile('tests/fixtures/fonts/Regular.ttf')]));
  const value:Recipe={...recipe,schemaVersion:3,delivery:descriptor,fontFiles:[font.toJSON()]};expect(validateRecipe(value).valid).toBe(true);expect(validateRecipe({...value,schemaVersion:2}).valid).toBe(false);
  await expect(serializeRecipePackage(value,assets)).rejects.toThrow('missing or corrupt');
  const file=await serializeRecipePackage(value,{get:id=>assets.get(id),fonts:assets.fonts,deliveryPreset});expect(new Uint8Array(await file.slice(0,8).arrayBuffer())[5]).toBe(52);
  const restored=await readRecipePackage(file);expect(restored.recipe).toEqual(value);expect(restored.fonts).toHaveLength(1);expect(restored.deliveryPreset).toBeDefined();expect(new Uint8Array(await restored.deliveryPreset!.arrayBuffer())).toEqual(new Uint8Array(await deliveryPreset.arrayBuffer()));expect(new Uint8Array(await restored.fonts[0].original.arrayBuffer())).toEqual(new Uint8Array(await assets.fonts.get(font.id).original.arrayBuffer()));
  const corrupted=new Uint8Array(await file.arrayBuffer());corrupted[corrupted.length-1]^=1;await expect(readRecipePackage(new Blob([corrupted]))).rejects.toThrow('delivery checksum');
 }finally{assets.dispose();}
});
it('accepted output cannot be reused after fit, quality, geometry, profile or intent changes, and its manifest integrity covers the receipt',async()=>{
 const color=await captureColorOutput({profile:'display-p3'}),value={...variant,color},prepared=await prepareColorOutputSource(color),settingsSha256=await deliverySettingsHash(value),delivery={id:'item:png',itemId:'item',variantId:'png',variantName:'Review',format:'png' as const,width:32,height:16,aspectRatio:'2:1',fileName:'review.png',byteLength:100,sha256:'b'.repeat(64),createdAt:new Date().toISOString(),settingsSha256,color:prepared.receipt};
 await verifyDeliveryContract(value,delivery,prepared.receipt);
 for(const changed of [{...value,fit:'cover' as const},{...value,targetWidth:64},{...value,color:{...color,intent:'saturation' as const}},{...value,color:undefined}])await expect(verifyDeliveryContract(changed,delivery)).rejects.toThrow('settings differ');
 await expect(verifyDeliveryContract(value,{...delivery,settingsSha256:undefined})).rejects.toThrow('no accepted output contract');
 const run={id:'run',config:{name:'Portable',variants:[value]},items:[{id:'item',name:'Input',source:{sha256:'a'.repeat(64)},actualCostCents:0,reviewState:'approved',deliverables:[delivery]}]}as BatchRun;
 const manifest=await generateDeliveryManifest(run);expect(manifest.schemaVersion).toBe(3);expect((await verifyDeliveryManifest(manifest)).valid).toBe(true);const changed=structuredClone(manifest);changed.deliverables[0].color!.intent='saturation';expect((await verifyDeliveryManifest(changed)).valid).toBe(false);
});
