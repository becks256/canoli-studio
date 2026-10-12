import {expect,it} from 'vitest';
import {Document,PaintLayer,PaintFill} from '../src/dom';
import {contentSignature} from '../src/engine/content-signature';

it('equivalent resize commands retain cache identity while different geometry invalidates it',()=>{
 const doc=new Document({width:800,height:600});
 const layer=doc.layers.add(new PaintLayer());
 layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:100,height:60},color:'#123456'}));
 doc.resizeImage(1200,900);
 const first=doc.getSnapshot().document.children[0];
 doc.undo();doc.resizeImage(1200,900);
 const repeated=doc.getSnapshot().document.children[0];
 expect(first.transform).not.toBe(repeated.transform);
 expect(first.transform).toEqual(repeated.transform);
 expect(contentSignature(first)).toBe(contentSignature(repeated));
 doc.resizeImage(1600,1200);
 expect(contentSignature(doc.getSnapshot().document.children[0])).not.toBe(contentSignature(first));
});
