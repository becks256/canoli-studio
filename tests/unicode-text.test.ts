import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  UNICODE_TEXT_VERSION,
  unicodeTextProperties,
} from "../src/fonts/unicode-text-data";

const directory = new URL("../third_party/unicode-17/", import.meta.url);
const source = (name: string) => readFileSync(new URL(name, directory), "utf8");
function records(name: string) {
  return source(name)
    .split("\n")
    .map((line) => line.split("#")[0].trim())
    .filter(Boolean)
    .map((line) => {
      const fields = line.split(";").map((value) => value.trim()),
        range = fields[0].split("..");
      return {
        first: parseInt(range[0], 16),
        last: parseInt(range.at(-1)!, 16),
        fields: fields.slice(1),
      };
    });
}

test("every Unicode code point retains the independent pinned source script, extensions and bidi class", () => {
  expect(UNICODE_TEXT_VERSION).toBe("17.0.0");
  const identities = JSON.parse(source("sources.json")) as Record<
    string,
    { bytes: number; sha256: string }
  >;
  for (const [name, identity] of Object.entries(identities)) {
    const bytes = readFileSync(new URL(name, directory));
    expect({
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }).toEqual({ bytes: identity.bytes, sha256: identity.sha256 });
  }
  const scriptAliases = new Map<string, string>(),
    bidiAliases = new Map<string, string>();
  for (const line of source("PropertyValueAliases.txt").split("\n")) {
    const fields = line
      .split("#")[0]
      .split(";")
      .map((value) => value.trim());
    if (fields.length < 3) continue;
    const map =
      fields[0] === "sc"
        ? scriptAliases
        : fields[0] === "bc"
          ? bidiAliases
          : undefined;
    if (map) for (const value of fields.slice(1)) map.set(value, fields[1]);
  }
  const scripts = new Array<string>(0x110000).fill("Zzzz"),
    classes = new Array<string>(0x110000).fill("L"),
    extensions = new Map<number, string>();
  for (const line of source("DerivedBidiClass.txt").split("\n"))
    if (line.includes("@missing:")) {
      const [range, value] = line
          .split("@missing:")[1]
          .split(";")
          .map((part) => part.trim()),
        bounds = range.split("..");
      classes.fill(
        bidiAliases.get(value)!,
        parseInt(bounds[0], 16),
        parseInt(bounds.at(-1)!, 16) + 1,
      );
    }
  for (const row of records("Scripts.txt"))
    scripts.fill(scriptAliases.get(row.fields[0])!, row.first, row.last + 1);
  for (const row of records("DerivedBidiClass.txt"))
    classes.fill(bidiAliases.get(row.fields[0])!, row.first, row.last + 1);
  for (const row of records("ScriptExtensions.txt"))
    for (let point = row.first; point <= row.last; point++)
      extensions.set(point, row.fields[0].split(/\s+/).sort().join(" "));
  const failures = [];
  for (let point = 0; point < 0x110000; point++) {
    const actual = unicodeTextProperties(point),
      expectedExtensions = extensions.get(point) ?? scripts[point];
    if (
      actual.script !== scripts[point] ||
      actual.extensions.join(" ") !== expectedExtensions ||
      actual.bidi !== classes[point]
    ) {
      failures.push({
        point,
        actual,
        script: scripts[point],
        extensions: expectedExtensions,
        bidi: classes[point],
      });
      if (failures.length === 10) break;
    }
  }
  expect(failures).toEqual([]);
});

test("all pinned paired brackets and immutable property records retain their source identity", () => {
  const rows = records("BidiBrackets.txt");
  expect(rows).toHaveLength(128);
  for (const row of rows)
    expect(unicodeTextProperties(row.first).bracket).toEqual({
      pair: parseInt(row.fields[0], 16),
      open: row.fields[1] === "o",
    });
  const value = unicodeTextProperties(0x301);
  expect(Object.isFrozen(value) && Object.isFrozen(value.extensions)).toBe(
    true,
  );
  expect(() => {
    (value.extensions as string[]).push("Fake");
  }).toThrow();
  for (const point of [-1, 0.5, Infinity, NaN, 0x110000])
    expect(() => unicodeTextProperties(point)).toThrow("Invalid Unicode");
});
