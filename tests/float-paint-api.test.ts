import { beforeAll, afterAll, it, expect } from "vitest";
import type { AddressInfo } from "node:net";
import { createApiServer } from "../server/app";
import { PaintLayer, PencilStroke, TextLayer } from "../src/dom";
import { readProject } from "../src/core/project";
const server = createApiServer({ authToken: "float-paint-test" }),
  auth = { authorization: "Bearer float-paint-test" };
let base: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
const json = (value: unknown) => ({
  method: "POST",
  headers: { ...auth, "content-type": "application/json" },
  body: JSON.stringify(value),
});
it("independent REST retains editable float paint through atomic commands, revisions, history and projects", async () => {
  const created = await fetch(
    base + "/documents",
    json({ name: "Independent linear paint", width: 64, height: 48 }),
  );
  expect(created.status).toBe(201);
  const initial = await created.json(),
    endpoint = base + "/documents/" + initial.document.id,
    paint = new PaintLayer({ name: "Native editable paint" });
  paint.strokes.add(
    new PencilStroke({
      points: [{ x: 3.5, y: 4.5 }],
      size: 2,
      color: "#208040",
      opacity: 0.64123,
    }),
  );
  const response = await fetch(
    endpoint + "/commands",
    json({
      expectedRevision: 0,
      commands: [
        { type: "document.precision.float" },
        { type: "layer.add", layer: paint.toJSON() },
      ],
    }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  const after = await response.json();
  expect(after.document.precision).toBe("float32");
  expect(after.document.children).toEqual([paint.toJSON()]);
  const invalid = await fetch(
    endpoint + "/commands",
    json({
      expectedRevision: after.revision,
      commands: [
        { type: "document.rename", name: "Must roll back" },
        { type: "layer.add", layer: new TextLayer().toJSON() },
      ],
    }),
  );
  expect(invalid.status).toBe(400);
  expect(
    (await (await fetch(endpoint, { headers: auth })).json()).document,
  ).toEqual(after.document);
  expect(
    (
      await fetch(
        endpoint + "/commands",
        json({
          expectedRevision: 0,
          commands: [{ type: "document.rename", name: "Stale" }],
        }),
      )
    ).status,
  ).toBe(409);
  const project = await readProject(
    await (
      await fetch(endpoint + "/project?history=true", { headers: auth })
    ).blob(),
  );
  expect(project.document).toEqual(after.document);
  expect(project.history?.past).toHaveLength(1);
  const undo = await (
    await fetch(endpoint + "/undo", json({ expectedRevision: after.revision }))
  ).json();
  expect(undo.document).toEqual(initial.document);
  const redo = await (
    await fetch(endpoint + "/redo", json({ expectedRevision: undo.revision }))
  ).json();
  expect(redo.document).toEqual(after.document);
});
