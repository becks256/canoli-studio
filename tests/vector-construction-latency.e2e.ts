import {test,expect} from '@playwright/test';

test('building a detached vector layer records construction and attachment latency',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 const result=await page.evaluate(()=>{
  const {Document,VectorLayer,VectorPath}=window.luma;
  const doc=new Document({width:800,height:600}),before=doc.toJSON(),layer=new VectorLayer();
  const start=performance.now();
  for(let i=0;i<2000;i++)layer.paths.add(new VectorPath({points:[{x:i,y:0},{x:i+10,y:0},{x:i+10,y:10},{x:i,y:10}],closed:true,fill:'#ff3300'}));
  const constructionMs=performance.now()-start,attachStart=performance.now();
  doc.layers.add(layer);
  const attachmentMs=performance.now()-attachStart,after=doc.toJSON();
  doc.undo();const undoEqual=JSON.stringify(doc.toJSON())===JSON.stringify(before);
  doc.redo();
  return {constructionMs,attachmentMs,paths:layer.paths.length,first:layer.paths.at(0)!.points,last:layer.paths.at(1999)!.points,undoEqual,redoEqual:JSON.stringify(doc.toJSON())===JSON.stringify(after),history:doc.getSnapshot().past.length};
 });
 console.log('vector-construction',JSON.stringify(result));
 expect(result).toMatchObject({paths:2000,undoEqual:true,redoEqual:true,history:1});
 expect(result.first[0]).toMatchObject({x:0,y:0});expect(result.last[0]).toMatchObject({x:1999,y:0});
});

for(const count of [750,2000])test(`isolated vector script with ${count} paths preserves commit and payload boundaries`,async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 const result=await page.evaluate(async(count)=>{
  const e=window.luma.editor;e.newDocument({width:800,height:600});
  const before=e.document.toJSON(),revision=e.document.getSnapshot().revision,start=performance.now();
  let logs:string[]=[],error='';
  try{logs=await e.runScript(`
    const layer=new VectorLayer({name:"Generated vector",visible:false});
    for(let i=0;i<${count};i++)layer.paths.add(new VectorPath({points:[{x:i,y:0},{x:i+10,y:0},{x:i+10,y:10},{x:i,y:10}],closed:true,fill:'#ff3300'}));
    document.layers.add(layer);
    print(layer.paths.length);
  `);}catch(cause){error=cause instanceof Error?cause.message:String(cause);}
  const ms=performance.now()-start,after=e.document.toJSON(),revisions=e.document.getSnapshot().revision-revision;
  if(error)return {ms,error,revisions,unchanged:JSON.stringify(after)===JSON.stringify(before)};
  const layer=after.children[0];if(layer.kind!=='vector')throw Error('Expected vector');
  e.document.undo();const undoEqual=JSON.stringify(e.document.toJSON())===JSON.stringify(before);
  e.document.redo();
  return {ms,error,logs,revisions,paths:layer.paths.length,undoEqual,redoEqual:JSON.stringify(e.document.toJSON())===JSON.stringify(after)};
 },count);
 console.log('vector-construction-script',JSON.stringify({count,...result}));
 if(count===750)expect(result).toMatchObject({error:'',logs:['750'],revisions:1,paths:750,undoEqual:true,redoEqual:true});
 else expect(result).toMatchObject({error:'The script returned invalid or unsupported document operations.',revisions:0,unchanged:true});
});

test('adding paths inside an attached transaction records latency and one undo',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 const result=await page.evaluate(()=>{
  const {Document,VectorLayer,VectorPath}=window.luma,doc=new Document(),before=doc.toJSON(),start=performance.now();
  doc.transaction('Build vector',()=>{
   const layer=doc.layers.add(new VectorLayer());
   for(let i=0;i<2000;i++)layer.paths.add(new VectorPath({points:[{x:i,y:0},{x:i+10,y:10}],stroke:'#ff3300'}));
  });
  const ms=performance.now()-start,after=doc.toJSON(),layer=after.children[0];
  if(layer.kind!=='vector')throw Error('Expected vector');
  const history=doc.getSnapshot().past.length;doc.undo();const undoEqual=JSON.stringify(doc.toJSON())===JSON.stringify(before);doc.redo();
  return {ms,paths:layer.paths.length,history,undoEqual,redoEqual:JSON.stringify(doc.toJSON())===JSON.stringify(after)};
 });
 console.log('vector-construction-transaction',JSON.stringify(result));
 expect(result).toMatchObject({paths:2000,history:1,undoEqual:true,redoEqual:true});
});
