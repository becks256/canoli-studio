import { describe, expect, it } from "vitest";
import { LayerMetadata } from "../src/dom";
import { parse } from "exifr";
import { exifSegment } from "./fixtures/exif";
import {
  normalizeMetadata,
  metadataSidecar,
} from "../src/intelligence/metadata/model";
const input = {
  name: "private-file.jpg",
  width: 8,
  height: 4,
  size: 1200,
  type: "image/jpeg",
};

describe("metadata origin and privacy", () => {
  it("bounds empty-entry traversal and preserves GPS privacy behind truncated keys", () => {
    const emptyEntries = Object.fromEntries(
      Array.from({ length: 3000 }, (_, i) => [`empty${i}`, null]),
    );
    const metadata = normalizeMetadata(input, {
      ...emptyEntries,
      tail: "outside budget",
    });
    expect(
      metadata.fields.some((field) => field.value === "outside budget"),
    ).toBe(false);
    expect(metadata.warnings).toHaveLength(1);
    const prefix = "a".repeat(160);
    const fields = normalizeMetadata(input, {
      [`${prefix}gps`]: { Make: "private camera" },
      [`${prefix}one`]: "First",
      [`${prefix}two`]: "Second",
    }).fields;
    expect(
      fields.find((field) => field.value === "private camera")?.privacy,
    ).toBe("private");
    expect(new Set(fields.map((field) => field.id)).size).toBe(fields.length);
    expect(
      fields.every(
        (field) => field.label.length <= 160 && field.id.length < 32,
      ),
    ).toBe(true);
  });
  it("bounds arrays and cyclic nesting without modifying caller warnings", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const warnings = ["Original warning"];
    const metadata = normalizeMetadata(
      input,
      { cycle, tags: Array.from({ length: 10000 }, () => "tag") },
      warnings,
    );
    expect(
      metadata.fields.find((field) => field.label === "tags")?.value,
    ).toHaveLength(64);
    expect(metadata.warnings).toHaveLength(2);
    expect(warnings).toEqual(["Original warning"]);
  });
  it("applies export consent separately to authored descriptions and attribution", () => {
    const metadata = normalizeMetadata(input, {
      ifd0: { Artist: "Original author" },
    });
    const authored = new LayerMetadata({
      title: "Private project",
      description: "Client notes",
      altText: "Private caption",
      keywords: ["private"],
      creator: "Studio",
      copyright: "Studio rights",
      license: "Internal",
    }).toJSON();
    const output = metadataSidecar(
      metadata,
      { attribution: true, private: false },
      authored,
    );
    expect(output.authoredOrigin).toBe("user");
    expect(output.authored).toEqual({
      creator: "Studio",
      copyright: "Studio rights",
      license: "Internal",
    });
    expect(
      output.fields.some((field) => field.value === "Original author"),
    ).toBe(true);
    expect(
      metadataSidecar(
        metadata,
        { attribution: false, private: false },
        authored,
      ).authored,
    ).toEqual({});
    expect(
      metadataSidecar(metadata, { attribution: false, private: true }, authored)
        .authored,
    ).toEqual({
      title: "Private project",
      description: "Client notes",
      altText: "Private caption",
      keywords: ["private"],
    });
    expect(
      metadataSidecar(metadata, { attribution: true, private: true }, authored)
        .authored,
    ).toEqual(authored);
  });
  it("extracts actual EXIF declarations while keeping decoded geometry distinct", async () => {
    const segment = exifSegment();
    const jpeg = new Uint8Array(segment.length + 4);
    jpeg.set([255, 216]);
    jpeg.set(segment, 2);
    jpeg.set([255, 217], segment.length + 2);
    const raw = await parse(jpeg, {
      mergeOutput: false,
      translateValues: false,
      reviveValues: false,
    });
    const metadata = normalizeMetadata(input, raw);
    expect(metadata.fields.find((field) => field.label === "Make")?.value).toBe(
      "Fixture Camera",
    );
    expect(
      metadata.fields.find((field) => field.label === "Orientation")?.value,
    ).toBe(6);
    expect(
      metadata.fields.find((field) => field.label === "Orientation")?.origin,
    ).toBe("embedded");
    expect(
      metadata.fields.find((field) => field.id === "file:width")?.value,
    ).toBe(8);
  });
  it("excludes private fields by default and lets users choose attribution", () => {
    const metadata = normalizeMetadata(input, {
      ifd0: { Make: "Camera", Artist: "Author" },
      gps: { latitude: 42 },
      exif: { DateTimeOriginal: "2024:01:01", BodySerialNumber: "secret" },
    });
    const publicOutput = metadataSidecar(metadata, {
      attribution: true,
      private: false,
    });
    expect(publicOutput.fields.some((field) => field.value === "Author")).toBe(
      true,
    );
    expect(
      publicOutput.fields.some((field) => field.privacy === "private"),
    ).toBe(false);
    expect(
      metadataSidecar(metadata, {
        attribution: false,
        private: false,
      }).fields.some((field) => field.value === "Author"),
    ).toBe(false);
    expect(
      metadataSidecar(metadata, { attribution: true, private: true }).fields,
    ).toEqual(metadata.fields);
  });
  it("preserves conflicting namespaces and bounds malformed nested outputs", () => {
    const metadata = normalizeMetadata(input, {
      ifd0: { Artist: "A" },
      xmp: { Artist: "B", description: "x".repeat(5000) },
      gps: { Make: "private despite name" },
    });
    expect(
      metadata.fields
        .filter((field) => field.label === "Artist")
        .map((field) => field.value),
    ).toEqual(["A", "B"]);
    expect(
      metadata.fields.find((field) => field.value === "private despite name")
        ?.privacy,
    ).toBe("private");
    expect(metadata.warnings).toHaveLength(1);
    expect(
      String(
        metadata.fields.find((field) => field.label === "description")?.value,
      ).length,
    ).toBe(4096);
  });
});
