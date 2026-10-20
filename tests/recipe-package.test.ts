import { expect, it } from "vitest";
import {
  recipeAssetIds,
  readRecipePackage,
  serializeRecipePackage,
} from "../src/ai/recipes/package";
import type { Recipe } from "../src/ai/recipes/types";

const recipe: Recipe = {
  schemaVersion: 1,
  id: "portable",
  name: "Portable",
  description: "",
  version: 1,
  parameters: [],
  steps: [
    {
      id: "art",
      name: "Artwork",
      action: {
        type: "layer.add",
        layerTemplate: {
          kind: "raster",
          name: "Art",
          assetId: "image",
          width: 10000,
          height: 5000,
        },
      },
    },
  ],
};
const asset = {
  id: "image",
  name: "Original",
  width: 10000,
  height: 5000,
  blob: new Blob(["source bytes"], { type: "image/png" }),
};
it("round-trips recipe geometry and exact source blobs without base64", async () => {
  const file = await serializeRecipePackage(recipe, { get: () => asset });
  const result = await readRecipePackage(file);
  expect(result.recipe).toEqual(recipe);
  expect(result.assets[0].width).toBe(10000);
  expect(await result.assets[0].blob.text()).toBe("source bytes");
  expect(await file.text()).not.toContain("dataUrl");
});
it("rejects corrupt manifests, corrupt assets, truncation and trailing data", async () => {
  const file = await serializeRecipePackage(recipe, { get: () => asset });
  const bytes = new Uint8Array(await file.arrayBuffer());
  for (const index of [55, bytes.length - 1]) {
    const corrupt = bytes.slice();
    corrupt[index] ^= 1;
    await expect(readRecipePackage(new Blob([corrupt]))).rejects.toThrow(
      "checksum mismatch",
    );
  }
  await expect(readRecipePackage(file.slice(0, file.size - 1))).rejects.toThrow(
    "ranges",
  );
  await expect(readRecipePackage(new Blob([file, "extra"]))).rejects.toThrow(
    "trailing",
  );
});
it("collects nested image, bitmap-mask and clone references while rejecting unresolved sources", () => {
  const nested = structuredClone(recipe);
  nested.steps[0].action = {
    type: "layer.add",
    layerTemplate: {
      kind: "group",
      name: "Nested",
      children: [
        {
          kind: "raster",
          assetId: "image",
          mask: { kind: "bitmap", assetId: "mask" },
        },
        {
          kind: "paint",
          strokes: [
            {
              kind: "clone",
              tiles: [{ assetId: "tile" }, { assetId: "image" }],
            },
          ],
        },
      ],
    },
  };
  expect([...recipeAssetIds(nested)]).toEqual(["image", "mask", "tile"]);
  nested.steps[0].action = {
    type: "layer.add",
    layerTemplate: { kind: "raster", name: "Dynamic", assetId: "${source}" },
  };
  expect(() => recipeAssetIds(nested)).toThrow("concrete");
});

it('bundles texture-only assets from nested artwork, mask refinements, erasures and tonal patches',()=>{
 const nested=structuredClone(recipe),texture=(assetId:string)=>({assetId,channel:'alpha',invert:false});
 nested.steps[0].action={type:'layer.add',layerTemplate:{kind:'group',name:'Textured group',children:[{kind:'paint',strokes:[{kind:'brush',texture:texture('paint-grain')}]},{kind:'raster',assetId:'original',erasures:[{stroke:{kind:'eraser',texture:texture('erase-grain')}}]}]}};
 nested.steps.push({id:'mask',name:'Refinement',action:{type:'layer.update',target:{kind:'selected'},patch:{mask:{kind:'paint',strokes:[{mode:'hide',stroke:{kind:'brush',texture:texture('mask-grain')}}]},filterMask:{kind:'paint',strokes:[{mode:'hide',stroke:{kind:'brush',texture:texture('filter-grain')}}]},adjustment:{kind:'tonal',strokes:[{brush:{kind:'brush',texture:texture('tonal-grain')}}]}}}} as never);
 expect(recipeAssetIds(nested)).toEqual(new Set(['paint-grain','original','erase-grain','mask-grain','filter-grain','tonal-grain']));
});

it('packages constructor-default templates without treating absent stroke/adjustment arrays as complete DTOs',async()=>{
 const {Document}=await import('../src/dom'),{executeRecipe}=await import('../src/ai/recipes/executor'),minimal=structuredClone(recipe);
 minimal.steps=(['paint','vector','adjustment'] as const).map(kind=>({id:kind,name:kind,action:{type:'layer.add',layerTemplate:{kind,name:kind}}}));
 expect(recipeAssetIds(minimal)).toEqual(new Set());const file=await serializeRecipePackage(minimal,{get(){throw new Error('No image sources should be read.');}}),restored=await readRecipePackage(file);expect(restored.assets).toHaveLength(0);
 const doc=new Document(),result=executeRecipe(restored.recipe,doc);expect(result.success,result.error).toBe(true);expect(doc.toJSON().children.map(layer=>layer.kind)).toEqual(['paint','vector','adjustment']);doc.undo();expect(doc.layers.length).toBe(0);
});
