import{describe,it,expect}from'vitest';
import{Document,PaintLayer,PaintFill}from'../src/dom';
import{GesturePreviews}from'../src/ui/gesture-previews';

function artwork(){const owner=new Document({width:400,height:300}),layer=owner.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:100,y:100,width:80,height:40},color:'#ee6633'}));owner.selectedLayer=layer;const state=owner.getSnapshot();return{owner,layer,source:state.document,selection:state.selectedIds,gesture:{}};}

describe('detached UI gesture previews',()=>{
 it('validates once and shares a detached result without changing attached artwork or history',()=>{
  const {layer,...context}=artwork(),channel=new GesturePreviews(),before=JSON.stringify(context.owner.toJSON()),state=context.owner.getSnapshot();let published=0;const stop=channel.subscribe(()=>published++);
  channel.publish({type:'layer.update',id:layer.id,patch:{x:24,y:12}},context);const preview=channel.getSnapshot()!;expect(preview.valid).toBe(true);expect(preview.document.children[0]).toMatchObject({x:24,y:12});expect(preview.document).not.toBe(context.source);expect(channel.getSnapshot()?.document).toBe(preview.document);expect(JSON.stringify(context.owner.toJSON())).toBe(before);expect(context.owner.getSnapshot()).toBe(state);expect(published).toBe(1);channel.publish(null,context);expect(channel.getSnapshot()).toBeNull();expect(context.owner.getSnapshot()).toBe(state);stop();
 });
 it('a partially invalid shared transaction cannot leak its earlier preview mutation',()=>{
  const {layer,...context}=artwork(),channel=new GesturePreviews(),state=context.owner.getSnapshot(),received:unknown[]=[];channel.subscribe(()=>received.push(channel.getSnapshot()?.document));
  channel.publish({type:'transaction',label:'Invalid preview',commands:[{type:'layer.update',id:layer.id,patch:{x:999}},{type:'layer.update',id:'missing-layer',patch:{x:20}}]},context);expect(channel.getSnapshot()?.valid).toBe(false);expect(channel.getSnapshot()?.document).toBe(context.source);expect(received).toEqual([context.source]);expect(context.source.children[0].x).toBe(0);expect(context.owner.getSnapshot()).toBe(state);
 });
});
