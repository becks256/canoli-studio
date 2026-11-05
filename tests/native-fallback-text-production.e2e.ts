import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { Document, TextLayer, AffineTransform } from "../src/dom";
import { AssetStore } from "../src/core/assets";
import { prepareFontBytes } from "../src/fonts/parser";
import { serializeProject } from "../src/core/project";
import {
  historyPng,
  historyProject,
  historyScript,
} from "./helpers/history-inspector";

for (const mode of ["parent", "authored", "baseline", "joining", "joining-single"] as const)
  for (const direction of ["ltr", "rtl"] as const)
    test(`production ${mode} ${direction} float text retains actual source capture, native pixels, Undo and original-bearing reopening`, async ({
      page,
    }, info) => {
      const joining = mode === "joining" || mode === "joining-single",
        sources = await Promise.all(
        [
          "native-fallback/Latin-no-mark.ttf",
          mode === "baseline"
            ? "vertical-font/Vertical.ttf"
            : "shaping-font/Shaping.ttf",
        ].map((file) => readFile("tests/fixtures/" + file)),
      );
      const assets = new AssetStore({
        fontSources: {
          nativeSet: null,
          prepare: async (blob, options) =>
            prepareFontBytes(new Uint8Array(await blob.arrayBuffer()), options),
        },
      });
      let expected: ReturnType<Document["toJSON"]>;
      const path = info.outputPath("fallback-source.luma");
      try {
        const document = new Document({ assets, width: 512, height: 512 });
        const fonts: Awaited<ReturnType<typeof document.fonts.embed>>[] = [];
        for (const source of sources)
          fonts.push(
            await document.fonts.embed(new Blob([new Uint8Array(source)])),
          );
        document.convertToFloat();
        const layer = document.layers.add(
          new TextLayer({
            name: "Curved spans",
            text: joining ? "ببلا AV" : mode === "baseline" ? "A漢、 B字" : "AV a\u0301 fi",
            fontFamily: (mode === "joining-single" ? [fonts[1]] : fonts)
              .map((font) => font.family).join(", "),
            fontSize: 40,
            letterSpacing: mode === "parent" || joining ? -30 : 0,
            direction,
            align: "center",
            ...(mode === "baseline"
              ? {
                  writingMode: "vertical-rl" as const,
                  textOrientation: "mixed" as const,
                }
              : {}),
            color: "color(srgb-linear 4 -.25 1.5 / .5)",
            characterRanges: joining ? [] : [
              {
                start: mode === "baseline" ? 1 : 4,
                end: mode === "baseline" ? 3 : 8,
                format: { color: "color(srgb-linear -.5 3 .125 / .25)" },
              },
            ],
          }),
        );
        layer.transform =
          mode === "parent"
            ? new AffineTransform(1, 0, 0, 1, 240, 180)
            : new AffineTransform(1.25, 0.125, -0.25, 0.9, 240, 180);
        document.selectedLayer = layer;
        expected = document.toJSON();
        await writeFile(
          path,
          new Uint8Array(
            await (await serializeProject(expected, assets)).arrayBuffer(),
          ),
        );
      } finally {
        assets.dispose();
      }

      await page.goto("/");
      expect(await page.evaluate(() => "luma" in window)).toBe(false);
      await page.getByTestId("project-input").setInputFiles(path);
      const original = await historyProject(page, info, "opened.luma");
      expect(original.value.document).toEqual(expected);
      expect(original.value.fonts).toHaveLength(2);
      for (const source of sources)
        expect(
          original.value.fonts.some(
            (font) => font.original.size === source.length,
          ),
        ).toBe(true);
      const originals = await Promise.all(
        original.value.fonts.map(async (font) =>
          Buffer.from(await font.original.arrayBuffer()),
        ),
      );
      for (const source of sources)
        expect(originals.some((bytes) => bytes.equals(source))).toBe(true);
      const before = await historyPng(page, info, "native-before.png");
      const painted = await page.evaluate(
        async (bytes) => {
          const image = await createImageBitmap(
            new Blob([new Uint8Array(bytes)], { type: "image/png" }),
          );
          try {
            const canvas = new OffscreenCanvas(image.width, image.height);
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(
              0,
              0,
              image.width,
              image.height,
            ).data;
            let count = 0;
            for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++;
            return count;
          } finally {
            image.close();
          }
        },
        [...before.bytes],
      );
      expect(painted).toBeGreaterThan(0);

      await historyScript(
        page,
        "const text=[...document.layers].find(layer=>layer.name==='Curved spans');text.opacity=.75",
        "Curved opacity ready",
      );
      expect(
        (await historyPng(page, info, "native-edited.png")).bytes,
      ).not.toEqual(before.bytes);
      await page
        .getByRole("button", { name: "Undo (Mod+Z)", exact: true })
        .click();
      expect(
        (await historyProject(page, info, "undone.luma")).value.document,
      ).toEqual(expected);
      expect((await historyPng(page, info, "native-undone.png")).bytes).toEqual(
        before.bytes,
      );
      await page.getByTestId("project-input").setInputFiles(original.path);
      expect(
        (await historyPng(page, info, "native-reopened.png")).bytes,
      ).toEqual(before.bytes);
      const reopened = await historyProject(page, info, "reopened.luma");
      expect(reopened.value.document).toEqual(expected);
      const reopenedOriginals = await Promise.all(
        reopened.value.fonts.map(async (font) =>
          Buffer.from(await font.original.arrayBuffer()),
        ),
      );
      for (const source of sources)
        expect(reopenedOriginals.some((bytes) => bytes.equals(source))).toBe(
          true,
        );
      expect(await page.evaluate(() => "luma" in window)).toBe(false);
      await writeFile(
        info.outputPath("production-fallback-text.json"),
        JSON.stringify(
          {
            direction,
            painted,
            mode,
            originalBytes: sources.map((source) => source.length),
            undoExact: true,
            reopenedExact: true,
            developmentGlobals: false,
          },
          null,
          2,
        ),
      );
    });
