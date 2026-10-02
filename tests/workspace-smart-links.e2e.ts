import { expect, test } from "@playwright/test";

for (const automatic of [false, true])
  test(`restores smart contents links and applies editable contents after reload (automatic ${automatic})`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(async (automatic) => {
      const { editor, Document, TextLayer } = window.luma;
      await editor.initializeWorkspaceRecovery();
      const owner = editor.newDocument({
        name: "Owner",
        width: 64,
        height: 64,
      });
      const master = new Document({ name: "Master", width: 64, height: 64 });
      master.layers.add(new TextLayer({ text: "Before" }));
      const instance = owner.placeSmartObject(owner.defineComponent(master));
      const contents = await editor.editSmartObject(instance);
      (contents.layers.at(0) as InstanceType<typeof TextLayer>).text =
        "After recovery";
      if (automatic) {
        editor.workspaceRepository.restoreOnStartup = true;
        await editor.workspaceAutosave.flush();
      } else await editor.saveWorkspace();
    }, automatic);
    await page.reload();
    const result = await page.evaluate(async (automatic) => {
      const { editor } = window.luma;
      await editor.initializeWorkspaceRecovery();
      if (!automatic) await editor.restoreWorkspace();
      const owner = editor.openDocuments.find((doc) => doc.name === "Owner")!;
      const contents = editor.document;
      const link = editor.getSnapshot().smartObjectEdit;
      const history = owner.getSnapshot().past.length;
      await editor.applySmartObjectContents();
      const master = owner.getComponent(link!.componentId);
      const text = (
        master.layers.at(0) as InstanceType<typeof window.luma.TextLayer>
      ).text;
      const clean = !editor.getSnapshot().smartObjectEdit!.changed;
      const oneUndo = owner.getSnapshot().past.length === history + 1;
      owner.undo();
      const before = (
        owner.getComponent(link!.componentId).layers.at(0) as InstanceType<
          typeof window.luma.TextLayer
        >
      ).text;
      return {
        link: { ownerOpen: link?.ownerOpen, changed: link?.changed },
        contentsName: contents.name,
        text,
        clean,
        oneUndo,
        before,
      };
    }, automatic);
    expect(result).toEqual({
      link: { ownerOpen: true, changed: true },
      contentsName: "Master",
      text: "After recovery",
      clean: true,
      oneUndo: true,
      before: "Before",
    });
  });

test("source conflicts survive checkpoint restore and malformed links publish no tabs", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor, Document, TextLayer } = window.luma;
    const owner = editor.newDocument({ name: "Owner" });
    const master = new Document({ name: "Master", width: 32, height: 32 });
    master.layers.add(new TextLayer({ text: "Before" }));
    const contents = await editor.editSmartObject(
      owner.placeSmartObject(owner.defineComponent(master)),
    );
    (contents.layers.at(0) as InstanceType<typeof TextLayer>).text =
      "Unapplied";
    owner.name = "Changed owner";
    await editor.saveWorkspace();
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const { editor } = window.luma;
    await editor.restoreWorkspace();
    const before = editor.openDocuments.map((doc) =>
      JSON.stringify(doc.toJSON()),
    );
    let conflict = "";
    try {
      await editor.applySmartObjectContents();
    } catch (error) {
      conflict = String(error);
    }
    const unchanged = editor.openDocuments.every(
      (doc, i) => JSON.stringify(doc.toJSON()) === before[i],
    );
    const saved = (await editor.workspaceRepository.load())!;
    const link = saved.documents.find(
      (entry) => entry.componentEdit,
    )!.componentEdit!;
    link.sourceUnchanged = true;
    link.componentId = "missing-master";
    await editor.workspaceRepository.save(saved);
    let invalid = "";
    try {
      await editor.restoreWorkspace();
    } catch (error) {
      invalid = String(error);
    }
    return {
      conflict,
      unchanged,
      invalid,
      count: editor.openDocuments.length,
      expectedCount: before.length,
    };
  });
  expect(result.conflict).toContain("Source document changed");
  expect(result.unchanged).toBe(true);
  expect(result.invalid).toContain("missing source master");
  expect(result.count).toBe(result.expectedCount);
});

test("named workspace versions restore nested owners and clean/applied state", async ({
  page,
}) => {
  await page.goto("/");
  const version = await page.evaluate(async () => {
    const { editor, Document, TextLayer, SmartObjectLayer } = window.luma;
    const owner = editor.newDocument({ name: "Owner" });
    const leaf = new Document({ name: "Leaf", width: 32, height: 32 });
    leaf.layers.add(new TextLayer({ text: "Before" }));
    const leafId = owner.defineComponent(leaf);
    const root = Document.fromJSON({
      ...new Document({ name: "Root", width: 32, height: 32 }).toJSON(),
      components: owner.toJSON().components,
    });
    root.placeSmartObject(leafId);
    const contents = await editor.editSmartObject(
      owner.placeSmartObject(owner.defineComponent(root)),
    );
    const nested = await editor.editSmartObject(
      contents.layers.at(0) as InstanceType<typeof SmartObjectLayer>,
    );
    (nested.layers.at(0) as InstanceType<typeof TextLayer>).text =
      "Nested update";
    return editor.saveWorkspaceVersion("Nested contents");
  });
  await page.reload();
  const result = await page.evaluate(async (version) => {
    const { editor, TextLayer } = window.luma;
    await editor.restoreWorkspace(version);
    const owner = editor.openDocuments.find((doc) => doc.name === "Owner")!;
    const root = editor.openDocuments.find((doc) => doc.name === "Root")!;
    const leaf = editor.openDocuments.find((doc) => doc.name === "Leaf")!;
    const nestedLink = editor.getSnapshot().smartObjectEdit!;
    editor.activateDocument(root);
    const initialClean = !editor.getSnapshot().smartObjectEdit!.changed;
    const rootId = editor.getSnapshot().smartObjectEdit!.componentId;
    await editor.applySmartObjectContents(leaf);
    const becameDirty = editor.getSnapshot().smartObjectEdit!.changed;
    await editor.applySmartObjectContents(root);
    const updated = owner
      .getComponent(rootId)
      .getComponent(nestedLink.componentId);
    return {
      nestedOwner: nestedLink.ownerName,
      initialClean,
      becameDirty,
      clean: !editor.getSnapshot().smartObjectEdit!.changed,
      text: (updated.layers.at(0) as InstanceType<typeof TextLayer>).text,
    };
  }, version);
  expect(result).toEqual({
    nestedOwner: "Root",
    initialClean: true,
    becameDirty: true,
    clean: true,
    text: "Nested update",
  });
});
