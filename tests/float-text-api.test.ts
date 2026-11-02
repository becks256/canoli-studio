import { it, expect, beforeAll, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createApiServer } from "../server/app";
import { TextLayer } from "../src/dom";
import { readProject } from "../src/core/project";
const server = createApiServer({ authToken: "float-text-test" }),
  auth = { authorization: "Bearer float-text-test" };
let base: string;
beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
afterAll(async () => {
  if (server.listening)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});
const json = (body: unknown) => ({
  method: "POST",
  headers: { ...auth, "content-type": "application/json" },
  body: JSON.stringify(body),
});
it("separate REST float text retains original fonts, revisioned edits, atomic refusal, native project and Undo", async () => {
  const created = await (
      await fetch(base + "/documents", json({ width: 128, height: 96 }))
    ).json(),
    url = base + "/documents/" + created.document.id,
    bytes = new Uint8Array(
      await readFile("tests/fixtures/shaping-font/Shaping.ttf"),
    );
  const upload = await fetch(url + "/fonts?expectedRevision=0", {
    method: "POST",
    headers: { ...auth, "content-type": "font/ttf" },
    body: bytes,
  });
  expect(upload.status, await upload.clone().text()).toBe(201);
  const embedded = await upload.json();
  expect(embedded.metrics).toBe("estimated");
  const text = new TextLayer({
    text: "AV",
    fontFamily: embedded.file.resource.report.faces[0].cssFamily,
    fontSize: 40,
    color: "color(srgb-linear 4 -.25 1.5 / .5)",
  });
  const response = await fetch(
    url + "/commands",
    json({
      expectedRevision: embedded.revision,
      commands: [
        { type: "document.precision.float" },
        { type: "layer.add", layer: text.toJSON() },
      ],
    }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const added = await response.json();
  expect(added.document).toMatchObject({
    schemaVersion: 60,
    precision: "float32",
    colorSpace: "linear-srgb",
  });
  expect(added.document.children[0].color).toBe(
    "color(srgb-linear 4 -.25 1.5 / .5)",
  );
  const rejected = await fetch(
    url + "/commands",
    json({
      expectedRevision: added.revision,
      commands: [
        { type: "document.rename", name: "Must roll back" },
        {
          type: "layer.update",
          id: text.id,
          patch: { fontFamily: "sans-serif" },
        },
      ],
    }),
  );
  expect(rejected.status).toBe(400);
  expect(await (await fetch(url, { headers: auth })).json()).toEqual(added);
  expect(
    (
      await fetch(
        url + "/commands",
        json({
          expectedRevision: 0,
          commands: [{ type: "document.rename", name: "Stale" }],
        }),
      )
    ).status,
  ).toBe(409);
  const project = await readProject(
    await (
      await fetch(url + "/project?history=true", { headers: auth })
    ).blob(),
  );
  expect(project.document).toEqual(added.document);
  expect(project.fonts).toHaveLength(1);
  expect(new Uint8Array(await project.fonts[0].original.arrayBuffer())).toEqual(
    bytes,
  );
  const undo = await (
    await fetch(url + "/undo", json({ expectedRevision: added.revision }))
  ).json();
  expect(undo.document).toEqual(embedded.document);
  const redo = await (
    await fetch(url + "/redo", json({ expectedRevision: undo.revision }))
  ).json();
  expect(redo.document).toEqual(added.document);
});
