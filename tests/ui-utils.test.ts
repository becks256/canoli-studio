import { describe, it, expect, vi } from "vitest";
import {
  calculateFitZoom,
  canvasPoint,
  computeResizePatch,
  computeVisibleRegion,
  download,
  fileName,
  modifiers,
} from "../src/ui/utils";

describe("UI Utils", () => {
  describe("fileName", () => {
    it("preserves valid filenames", () => {
      expect(fileName("My Project 2026")).toBe("My Project 2026");
      expect(fileName("design-v2_final")).toBe("design-v2_final");
    });

    it("replaces illegal filesystem characters with underscores", () => {
      expect(fileName('invalid:name*with?chars"and<more>|slash/back\\')).toBe(
        "invalid_name_with_chars_and_more__slash_back_",
      );
    });

    it("falls back to Untitled when empty or containing only replaced invalid characters that yield empty", () => {
      expect(fileName("")).toBe("Untitled");
    });
  });

  describe("download", () => {
    it("creates an ephemeral anchor, sets download attributes, and triggers click", () => {
      const clickSpy = vi.fn();
      const createObjectURLMock = vi.fn().mockReturnValue("blob:mock-url-123");
      const revokeObjectURLMock = vi.fn();
      globalThis.URL.createObjectURL = createObjectURLMock;
      globalThis.URL.revokeObjectURL = revokeObjectURLMock;

      const mockAnchor: Record<string, unknown> = {
        click: clickSpy,
        href: "",
        download: "",
      };

      const mockDocument = {
        createElement: vi.fn().mockReturnValue(mockAnchor),
      };

      const previousDocument = globalThis.document;
      // @ts-expect-error mock document in node environment
      globalThis.document = mockDocument;

      try {
        const blob = new Blob(["test-data"], { type: "text/plain" });
        download(blob, "export.png");

        expect(createObjectURLMock).toHaveBeenCalledWith(blob);
        expect(mockDocument.createElement).toHaveBeenCalledWith("a");
        expect(mockAnchor.href).toBe("blob:mock-url-123");
        expect(mockAnchor.download).toBe("export.png");
        expect(clickSpy).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.document = previousDocument;
      }
    });
  });

  describe("canvasPoint", () => {
    it("converts client coordinates to canvas coordinates based on host rect and zoom", () => {
      const rect = { left: 100, top: 50 };
      const event = { clientX: 200, clientY: 150 };

      // Zoom = 1
      const p1 = canvasPoint(event, rect, 1);
      expect(p1).toEqual({ x: 100, y: 100 });

      // Zoom = 2 (points are half distance on canvas)
      const p2 = canvasPoint(event, rect, 2);
      expect(p2).toEqual({ x: 50, y: 50 });

      // Zoom = 0.5 (points are double distance on canvas)
      const p3 = canvasPoint(event, rect, 0.5);
      expect(p3).toEqual({ x: 200, y: 200 });
    });
  });

  describe("modifiers", () => {
    it('preserves real zero and low pen pressure for explicit response curves',()=>{
      for(const pressure of [0,.001,.02,.5,1])expect(modifiers({altKey:false,shiftKey:false,pointerType:'pen',pressure},true).pressure).toBe(pressure);
      expect(modifiers({altKey:false,shiftKey:false,pointerType:'mouse',pressure:0},true).pressure).toBe(1);
    });
    it("extracts keyboard modifiers and default mouse pressure", () => {
      const result = modifiers({
        altKey: true,
        shiftKey: false,
        pointerType: "mouse",
        pressure: 0,
      });
      expect(result).toEqual({
        alt: true,
        shift: false,
        pressure: 1,
      });
    });

    it("extracts pen pressure when available or falls back to minimum 0.05", () => {
      const penWithPressure = modifiers({
        altKey: false,
        shiftKey: true,
        pointerType: "pen",
        pressure: 0.75,
      });
      expect(penWithPressure).toEqual({
        alt: false,
        shift: true,
        pressure: 0.75,
      });

      const penWithoutPressure = modifiers({
        altKey: false,
        shiftKey: false,
        pointerType: "pen",
        pressure: 0,
      });
      expect(penWithoutPressure).toEqual({
        alt: false,
        shift: false,
        pressure: 0.05,
      });
    });
  });

  describe("computeResizePatch", () => {
    it("computes bottom-right (se) resize for a raster layer without shift key", () => {
      const drag = {
        handle: "se" as const,
        layerX: 10,
        layerY: 20,
        layerWidth: 100,
        layerHeight: 80,
        layerKind: "raster" as const,
      };

      const patch = computeResizePatch(drag, 30, 40, false);
      expect(patch).toEqual({
        x: 10,
        y: 20,
        width: 130,
        height: 120,
      });
    });

    it("computes top-left (nw) resize adjusting both position and dimension", () => {
      const drag = {
        handle: "nw" as const,
        layerX: 50,
        layerY: 60,
        layerWidth: 100,
        layerHeight: 100,
        layerKind: "raster" as const,
      };

      // Dragging nw by dx: -20, dy: -30 (increasing layer size by 20x30)
      const patch = computeResizePatch(drag, -20, -30, false);
      expect(patch).toEqual({
        x: 30,
        y: 30,
        width: 120,
        height: 130,
      });
    });

    it("computes aspect-ratio locked resize when shiftKey is true", () => {
      const drag = {
        handle: "se" as const,
        layerX: 0,
        layerY: 0,
        layerWidth: 100,
        layerHeight: 50,
        layerKind: "raster" as const,
      };

      // dx = 50, dy = 10 -> dominant delta is dx (+50%), scale is 150/100 = 1.5
      const patch = computeResizePatch(drag, 50, 10, true);
      expect(patch).toEqual({
        x: 0,
        y: 0,
        width: 150,
        height: 75,
      });
    });

    it("computes font size and bounds for a text layer", () => {
      const drag = {
        handle: "se" as const,
        layerX: 10,
        layerY: 10,
        layerWidth: 100,
        layerHeight: 40,
        layerFontSize: 24,
        layerText: "Hello",
        layerFontFamily: "sans-serif",
        layerLineHeight: 1.2,
        layerKind: "text" as const,
      };

      const patch = computeResizePatch(drag, 100, 0, false);
      expect(patch.fontSize).toBeDefined();
      expect(patch.fontSize).toBeGreaterThan(24);
      expect(patch.x).toBe(10);
      expect(patch.y).toBe(10);
    });
  });

  describe("computeVisibleRegion", () => {
    it("computes visible document region from viewport and pan/zoom", () => {
      const doc = { width: 1000, height: 800 };
      const viewport = { width: 500, height: 400 };
      const pan = { x: 0, y: 0 };
      const zoom = 1;

      const region = computeVisibleRegion(doc, viewport, pan, zoom);
      expect(region.x).toBe(250);
      expect(region.y).toBe(200);
      expect(region.width).toBe(500);
      expect(region.height).toBe(400);
    });

    it("clamps region within document bounds", () => {
      const doc = { width: 200, height: 200 };
      const viewport = { width: 1000, height: 1000 };
      const pan = { x: 0, y: 0 };
      const zoom = 1;

      const region = computeVisibleRegion(doc, viewport, pan, zoom);
      expect(region.x).toBe(0);
      expect(region.y).toBe(0);
      expect(region.width).toBe(200);
      expect(region.height).toBe(200);
    });
  });

  describe("calculateFitZoom", () => {
    it("calculates zoom to fit document within box with padding", () => {
      const doc = { width: 800, height: 600 };
      const box = { width: 920, height: 720 };
      // box - 120 = 800x600 -> zoom should be 1
      const zoom = calculateFitZoom(doc, box, 120);
      expect(zoom).toBe(1);
    });

    it("caps maximum fit zoom at 1.0", () => {
      const smallDoc = { width: 100, height: 100 };
      const largeBox = { width: 1000, height: 1000 };
      const zoom = calculateFitZoom(smallDoc, largeBox, 120);
      expect(zoom).toBe(1);
    });

    it("scales down when document is larger than box", () => {
      const largeDoc = { width: 1600, height: 1200 };
      const box = { width: 920, height: 720 };
      // box - 120 = 800x600 -> 800/1600 = 0.5, 600/1200 = 0.5
      const zoom = calculateFitZoom(largeDoc, box, 120);
      expect(zoom).toBe(0.5);
    });
  });
});
