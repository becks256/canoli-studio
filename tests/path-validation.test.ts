import { expect, it } from "vitest";
import { Document, VectorLayer, VectorPath } from "../src/dom";
import { validateDocument } from "../src/core/model";
import { pathSchema } from "../src/core/drawing";
import { freeze } from "../src/core/immutable";

it("cached document path validation matches the public path schema", () => {
  const doc=new Document();
  const layer=doc.layers.add(new VectorLayer());
  layer.paths.add(new VectorPath({points:[{x:1,y:2}]}));
  const base=doc.toJSON();
  const vector=base.children[0];
  if(vector.kind!=="vector") throw Error("Expected vector");
  const path=vector.paths[0];
  const cases: unknown[]=[path,{...path,points:[]},{...path,points:[null]},
    {...path,points:[{x:NaN,y:2,in:{x:1,y:2},out:{x:1,y:2}}]},
    {...path,points:[{...path.points[0],in:{x:"1",y:2}}]},
    {...path,points:Array(20001).fill(path.points[0])},
    {...path,unexpected:true},{...path,strokeWidth:-1},
    {...path,points:[{...path.points[0],out:{x:Infinity,y:2}}]}];
  for(const candidate of cases) for(const frozen of [false,true]) {
    const value=structuredClone(candidate);
    if(frozen) freeze(value);
    const document=structuredClone(base);
    const target=document.children[0];
    if(target.kind!=="vector") throw Error("Expected vector");
    target.paths=[value as typeof path];
    const valid=pathSchema.safeParse(value).success;
    for(let repeat=0;repeat<2;repeat++) {
      if(valid) expect(()=>validateDocument(document)).not.toThrow();
      else expect(()=>validateDocument(document)).toThrow();
    }
  }
});

it("mutable anchor validation is never reused after caller changes", () => {
  const doc=new Document();
  const layer=doc.layers.add(new VectorLayer());
  layer.paths.add(new VectorPath({points:[{x:1,y:2}]}));
  const data=doc.toJSON();
  validateDocument(data);
  const vector=data.children[0];
  if(vector.kind!=="vector") throw Error("Expected vector");
  vector.paths[0].points[0].out.x=NaN;
  expect(()=>validateDocument(data)).toThrow();
});
