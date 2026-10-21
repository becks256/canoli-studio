import {expect,test} from '@playwright/test';

test('full-flow texture saturation preserves every native alpha pair while fractional-flow counterexamples remain excluded',async({page},info)=>{
 await page.goto('/');const rows=await page.evaluate(()=>{
  const rows=[];
  for(const color of [[255,255,255],[0,0,0],[255,0,255]])for(const flow of [0,.0039,.1,.3,.5,.123456789,1]){
   const source=document.createElement('canvas'),target=document.createElement('canvas');source.width=source.height=260;target.width=target.height=256;
   const s=source.getContext('2d',{willReadFrequently:true})!,c=target.getContext('2d',{willReadFrequently:true})!,src=s.createImageData(260,260),dst=c.createImageData(256,256);
   try{
    for(let y=0;y<260;y++)for(let x=0;x<260;x++)src.data.set([...color,Math.max(0,Math.min(255,y-2))],(y*260+x)*4);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++)dst.data.set([...color,x],(y*256+x)*4);
    s.putImageData(src,0,0);c.putImageData(dst,0,0);const before=c.getImageData(0,0,256,256).data;
    c.globalAlpha=flow;c.beginPath();c.rect(0,0,256,256);c.clip();c.drawImage(source,-2,-2);const after=c.getImageData(0,0,256,256).data;
    let certified=0,changed=0,maximum=0,excludedCounterexamples=0,nonmonotone=0;
    for(let sourceAlpha=0;sourceAlpha<256;sourceAlpha++)for(let oldAlpha=0;oldAlpha<256;oldAlpha++){
     // Keep the rejected fractional-flow proposal visible as a native
     // counterexample. Only unit global alpha uses the certificate.
     const upper=Math.ceil(sourceAlpha*Math.ceil(flow*255)/255),at=(sourceAlpha*256+oldAlpha)*4;
     if(flow!==1&&2*(255-oldAlpha)*upper<255&&after[at+3]!==before[at+3])excludedCounterexamples++;
     if(flow===1&&after[at+3]<before[at+3])nonmonotone++;
     if(flow!==1||2*(255-oldAlpha)*sourceAlpha>=255)continue;
     certified++;for(let k=0;k<4;k++){const delta=Math.abs(after[at+k]-before[at+k]);changed+=Number(delta>0);maximum=Math.max(maximum,delta);}
    }
    rows.push({color,flow,certified,changed,maximum,excludedCounterexamples,nonmonotone});
   }finally{source.width=source.height=target.width=target.height=0;}
  }return rows;
 });await info.attach('exhaustive-native-alpha-bound',{body:JSON.stringify(rows),contentType:'application/json'});for(const row of rows){if(row.flow===1){expect(row.certified).toBeGreaterThan(1000);expect(row.nonmonotone).toBe(0);}else{expect(row.certified).toBe(0);if(row.flow>0)expect(row.excludedCounterexamples).toBeGreaterThan(0);}expect(row.changed,JSON.stringify(row)).toBe(0);expect(row.maximum).toBe(0);}
});
