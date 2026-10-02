import { expect, it } from "vitest";
import { workspaceSchema } from "../src/workspace/repository";
const entry = () => ({
  project: new Blob(),
  selectedIds: [],
  view: { zoom: 1, pan: { x: 0, y: 0 }, initialized: false },
});
const link = (ownerIndex: number, componentId = "master") => ({
  ownerIndex,
  componentId,
  sourceUnchanged: true,
  contentsApplied: false,
});
it("accepts legacy independent documents and nested v2 component editing links", () => {
  expect(
    workspaceSchema.parse({
      version: 1,
      savedAt: 0,
      activeIndex: 0,
      documents: [entry()],
    }).version,
  ).toBe(1);
  const workspace = {
    version: 2,
    savedAt: 0,
    activeIndex: 2,
    documents: [
      entry(),
      { ...entry(), componentEdit: link(0) },
      { ...entry(), componentEdit: link(1) },
    ],
  };
  expect(workspaceSchema.parse(workspace).documents[2].componentEdit).toEqual(
    link(1),
  );
});
it("rejects dangling, self, cyclic, duplicate and legacy editing links", () => {
  for (const links of [
    [link(1), link(0)],
    [undefined, link(1)],
    [undefined, link(4)],
    [undefined, link(-1)],
    [undefined, link(0), link(0)],
  ]) {
    expect(() =>
      workspaceSchema.parse({
        version: 2,
        savedAt: 0,
        activeIndex: 0,
        documents: links.map((componentEdit) => ({
          ...entry(),
          componentEdit,
        })),
      }),
    ).toThrow();
  }
  expect(() =>
    workspaceSchema.parse({
      version: 1,
      savedAt: 0,
      activeIndex: 0,
      documents: [entry(), { ...entry(), componentEdit: link(0) }],
    }),
  ).toThrow(/version 2/);
});
