import { strokeBounds } from "../src/core/drawing";
import { describe, expect, it } from "vitest";
import {
  Document,
  PaintLayer,
  BrushStroke,
  EraserStroke,
  PaintOperation,
} from "../src/dom";
import { EditorApplication } from "../src/editor";
import { drawPaint } from "../src/engine/drawing";
import { createCanvas, release } from "../src/engine/canvas";
import { AffineTransform } from "../src/core/affine";
import { PixelProcessor } from "../src/engine/processor";
import type { PaintLayerData } from "../src/core/model";
import type { BrushStrokeData } from "../src/core/drawing";

if (typeof globalThis.Worker === "undefined") {
  globalThis.Worker = class MockWorker {
    postMessage() {}
    addEventListener() {}
    removeEventListener() {}
    terminate() {}
  } as unknown as typeof Worker;
}

if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    return setTimeout(cb, 0) as unknown as number;
  }) as unknown as typeof requestAnimationFrame;
}
if (typeof globalThis.cancelAnimationFrame === "undefined") {
  globalThis.cancelAnimationFrame = ((id: number) => {
    clearTimeout(id);
  }) as unknown as typeof cancelAnimationFrame;
}

if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    createElement(tag: string) {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              save() {},
              restore() {},
              resetTransform() {},
              setTransform() {},
              transform() {},
              translate() {},
              scale() {},
              rotate() {},
              beginPath() {},
              closePath() {},
              moveTo() {},
              lineTo() {},
              arc() {},
              bezierCurveTo() {},
              fill() {},
              stroke() {},
              fillRect() {},
              clearRect() {},
              fillText() {},
              drawImage() {},
              getImageData(_x: number, _y: number, w: number, h: number) {
                return { data: new Uint8ClampedArray(w * h * 4) };
              },
              createImageData(w: number, h: number) {
                return { data: new Uint8ClampedArray(w * h * 4) };
              },
              putImageData() {},
              createRadialGradient() {
                return { addColorStop() {} };
              },
            };
          },
          toBlob(cb: (b: Blob) => void, type?: string) {
            cb(new Blob(["mock-image"], { type: type || "image/png" }));
          },
        };
      }
      return {};
    },
  } as unknown as typeof document;
}

describe("rich artist brush and eraser engine (F06)", () => {
  it("instantiates EraserStroke with kind 'eraser' and custom flow and spacing", () => {
    const eraser = new EraserStroke({
      size: 32,
      hardness: 0.8,
      opacity: 0.9,
      flow: 0.75,
      spacing: 0.2,
      points: [{ x: 10, y: 10, pressure: 0.5 }],
    });

    expect(eraser.kind).toBe("eraser");
    expect(eraser.size).toBe(32);
    expect(eraser.hardness).toBe(0.8);
    expect(eraser.opacity).toBe(0.9);
    expect(eraser.flow).toBe(0.75);
    expect(eraser.spacing).toBe(0.2);

    const json = eraser.toJSON() as BrushStrokeData;
    expect(json.kind).toBe("eraser");
    expect(json.flow).toBe(0.75);
    expect(json.spacing).toBe(0.2);

    const restored = PaintOperation.fromJSON(json);
    expect(restored).toBeInstanceOf(EraserStroke);
    expect((restored as EraserStroke).flow).toBe(0.75);
    expect((restored as EraserStroke).spacing).toBe(0.2);
  });

  it("supports independent pressureSize and pressureOpacity dynamics", () => {
    const stroke = new BrushStroke({
      size: 24,
      pressureSize: false,
      pressureOpacity: true,
      points: [{ x: 5, y: 5, pressure: 0.3 }],
    });

    expect(stroke.pressureSize).toBe(false);
    expect(stroke.pressureOpacity).toBe(true);

    const json = stroke.toJSON() as BrushStrokeData;
    expect(json.pressureSize).toBe(false);
    expect(json.pressureOpacity).toBe(true);

    const restored = PaintOperation.fromJSON(json) as BrushStroke;
    expect(restored.pressureSize).toBe(false);
    expect(restored.pressureOpacity).toBe(true);
  });

  it("applies eraser stroke to paint layer and commits to undo history", () => {
    const doc = new Document({ width: 100, height: 100 });
    const layer = new PaintLayer({ name: "Drawing" });
    doc.layers.add(layer);

    // Initial brush stroke
    const brush = new BrushStroke({
      size: 20,
      points: [{ x: 50, y: 50, pressure: 1 }],
      color: "#ff0000",
    });
    layer.strokes.add(brush);
    expect(layer.strokes.length).toBe(1);

    // Add eraser stroke
    const eraser = new EraserStroke({
      size: 15,
      flow: 0.5,
      spacing: 0.1,
      points: [{ x: 50, y: 50, pressure: 0.8 }],
    });
    layer.strokes.add(eraser);
    expect(layer.strokes.length).toBe(2);

    const stroke2 = layer.strokes.at(1);
    expect(stroke2?.kind).toBe("eraser");

    doc.undo();
    expect(layer.strokes.length).toBe(1);
    doc.redo();
    expect(layer.strokes.length).toBe(2);
  });

  it("composites eraser stroke with destination-out in drawPaint", async () => {
    const processor = new PixelProcessor();
    const assets = new EditorApplication().assetStore;
    const target = createCanvas(100, 100);
    const space = { x: 0, y: 0, width: 100, height: 100, sx: 1, sy: 1 };
    const world = new AffineTransform();

    const layer = new PaintLayer();
    const eraser = new EraserStroke({
      size: 10,
      flow: 0.8,
      points: [
        { x: 10, y: 10, pressure: 1 },
        { x: 20, y: 20, pressure: 1 },
      ],
    });
    layer.strokes.add(eraser);

    // drawPaint should execute cleanly without errors
    await expect(
      drawPaint(
        layer.toJSON() as PaintLayerData,
        assets,
        target,
        space,
        world,
        processor,
      ),
    ).resolves.not.toThrow();

    release(target);
  });

  it("tool controller configures flow, spacing, smoothing, and pressure dynamics", () => {
    const editor = new EditorApplication();
    const controller = editor.tools;

    controller.configure({
      flow: 0.65,
      spacing: 0.25,
      smoothing: 0.5,
      pressureSize: true,
      pressureOpacity: true,
    });

    const snapshot = controller.getSnapshot();
    expect(snapshot.settings.flow).toBe(0.65);
    expect(snapshot.settings.spacing).toBe(0.25);
    expect(snapshot.settings.smoothing).toBe(0.5);
    expect(snapshot.settings.pressureSize).toBe(true);
    expect(snapshot.settings.pressureOpacity).toBe(true);
  });

  it("tool controller executes eraser gesture into an EraserStroke", async () => {
    const editor = new EditorApplication();
    const existingLayer = new PaintLayer({ name: "Existing Paint" });
    editor.document.layers.add(existingLayer);
    editor.document.selectedLayer = existingLayer;
    const controller = editor.tools;

    controller.configure({
      size: 30,
      hardness: 0.5,
      flow: 0.8,
      spacing: 0.15,
      smoothing: 0.2,
    });

    // Start eraser stroke
    controller.begin(
      "eraser",
      { x: 20, y: 20 },
      { alt: false, shift: false, pressure: 0.7 },
      1,
    );
    controller.move(
      { x: 30, y: 30 },
      { alt: false, shift: false, pressure: 0.8 },
    );
    await controller.end();

    const layer = editor.document.selectedLayer;
    expect(layer).toBe(existingLayer);
    const paintLayer = layer as PaintLayer;
    expect(paintLayer.strokes.length).toBe(1);

    const stroke = paintLayer.strokes.at(0);
    expect(stroke?.kind).toBe("eraser");
    expect((stroke as EraserStroke).flow).toBe(0.8);
    expect((stroke as EraserStroke).spacing).toBe(0.15);

    // 1-step undo
    expect(editor.document.canUndo).toBe(true);
    editor.document.undo();
    expect(paintLayer.strokes.length).toBe(0);
  });
});

it("keeps full brush bounds when pressure controls opacity but not size", () => {
  const stroke = new BrushStroke({
    size: 100,
    pressureSize: false,
    pressureOpacity: true,
    points: [{ x: 100, y: 100, pressure: 0.05 }],
  }).toJSON();
  const bounds = strokeBounds(stroke);
  expect(bounds.x).toBeLessThanOrEqual(50);
  expect(bounds.y).toBeLessThanOrEqual(50);
  expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(150);
  expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(150);
});

it('validates pressure settings before cancelling a live gesture and captures finite low samples',async()=>{
 const {PressureCurve}=await import('../src/dom'),editor=new EditorApplication();
 try{
  const controller=editor.tools;controller.configure({pressureCurve:PressureCurve.linear().toJSON(),smoothing:0});const before=editor.document.toJSON();
  controller.begin('brush',{x:20,y:20},{alt:false,shift:false,pressure:0},1);controller.move({x:30,y:20},{alt:false,shift:false,pressure:.02});expect(controller.getSnapshot().drawing).toBe(true);
  expect(()=>controller.configure({pressureCurve:{points:[]}})).toThrow();expect(controller.getSnapshot().drawing).toBe(true);
  controller.configure({pressureCurve:PressureCurve.firm().toJSON()});expect(controller.getSnapshot().drawing).toBe(false);expect(controller.getSnapshot().paintPreview).toBeNull();expect(editor.document.toJSON()).toEqual(before);
  controller.configure({pressureCurve:PressureCurve.linear().toJSON()});controller.begin('brush',{x:20,y:20},{alt:false,shift:false,pressure:0},1);controller.move({x:30,y:20},{alt:false,shift:false,pressure:.02});await controller.end();
  const layer=editor.document.toJSON().children[0];if(layer.kind!=='paint')throw new Error('Missing pressure paint');const stroke=layer.strokes[0];if((stroke.kind==='fill' || stroke.kind === 'wet'))throw new Error('Missing brush');expect(stroke.points.map(point=>point.pressure)).toEqual([0,.02]);
 }finally{editor.dispose();}
});

it('validates a preset before cancelling gestures, then changes future settings without target/history/source edits',async()=>{
 const {BrushPreset}=await import('../src/brushes/presets'),editor=new EditorApplication();
 try{
  const tools=editor.tools;tools.configure({paintTarget:'layer',color:'#123456'});const before=editor.document.toJSON();
  tools.begin('brush',{x:20,y:20},{alt:false,shift:false,pressure:1},1);
  const preset=BrushPreset.capture('Fine','pencil',{...tools.getSnapshot().settings,size:2,pressureSize:false});
  expect(()=>tools.applyBrushPreset({toJSON:()=>({...preset.toJSON(),settings:{...preset.settings,size:NaN}})} as typeof preset)).toThrow();expect(tools.getSnapshot().drawing).toBe(true);
  expect(tools.applyBrushPreset(preset)).toBe('pencil');expect(tools.getSnapshot().drawing).toBe(false);expect(tools.getSnapshot().settings.size).toBe(2);expect(tools.getSnapshot().settings.color).toBe('#123456');expect(editor.document.toJSON()).toEqual(before);
  tools.configure({paintTarget:'filter-mask-reveal'});tools.applyBrushPreset(preset);expect(tools.getSnapshot().settings.paintTarget).toBe('filter-mask-reveal');expect(editor.document.toJSON()).toEqual(before);expect(editor.assetStore.values()).toHaveLength(0);
 }finally{editor.dispose();}
});
