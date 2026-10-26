import {pointerPenTilt,type PenTiltData} from '../core/brush-tip';
import type { AffineTransform } from "../core/affine";
import type { LayerPatch } from "../core/commands";
import type { Point, Rect } from "../core/drawing";
import { measureTextBounds } from "../core/model";
import type {TextStyle} from '../core/text-style';
import type {CharacterRangeData} from '../core/text-ranges';

/**
 * Triggers a browser file download using an ephemeral object URL anchor.
 */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Sanitizes a document name for safe filesystem usage.
 */
export function fileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_") || "Untitled";
}

export interface ResizeDragState {
  handle: "nw" | "ne" | "sw" | "se";
  layerX: number;
  layerY: number;
  layerWidth: number;
  layerHeight: number;
  layerFontSize?: number;
  layerText?: string;
  layerFontFamily?: string;
  layerLineHeight?: number;
  layerTextStyle?: TextStyle&{textPath?:import('../core/text-path').TextPathData|null;textPathOrigin?:{x:number;y:number};characterRanges?:readonly CharacterRangeData[];color?:string;align?:'left'|'center'|'right'};
  layerKind: "raster" | "text";
  /** Expanded ink bounds; logical image geometry still addresses its source. */
  layerContentBounds?: Rect;
}

/**
 * Computes layer position and dimension patch during corner resize handle dragging.
 */
export function computeResizePatch(
  drag: ResizeDragState,
  dx: number,
  dy: number,
  shiftKey: boolean,
  transforms?: { world: AffineTransform; local: AffineTransform },
): LayerPatch {
  if (transforms) {
    const inverse = transforms.world.inverse();
    const patch = computeResizePatch(
      drag,
      inverse.a * dx + inverse.c * dy,
      inverse.b * dx + inverse.d * dy,
      shiftKey,
    );
    const offsetX = (patch.x ?? drag.layerX) - drag.layerX;
    const offsetY = (patch.y ?? drag.layerY) - drag.layerY;
    return {
      ...patch,
      x:
        drag.layerX +
        transforms.local.a * offsetX +
        transforms.local.c * offsetY,
      y:
        drag.layerY +
        transforms.local.b * offsetX +
        transforms.local.d * offsetY,
    };
  }
  if (drag.layerKind === 'raster' && drag.layerContentBounds) {
    const bounds = drag.layerContentBounds;
    const frame = computeResizePatch({ ...drag, layerContentBounds: undefined, layerWidth: bounds.width, layerHeight: bounds.height }, dx, dy, shiftKey);
    const minimum = Math.max(1 / drag.layerWidth, 1 / drag.layerHeight);
    let sx = Math.max(1 / drag.layerWidth, frame.width! / bounds.width), sy = Math.max(1 / drag.layerHeight, frame.height! / bounds.height);
    if (shiftKey) sx = sy = Math.max(minimum, sx, sy);
    const anchorX = bounds.x + (drag.handle.includes('w') ? bounds.width : 0), anchorY = bounds.y + (drag.handle.includes('n') ? bounds.height : 0);
    return { width: drag.layerWidth * sx, height: drag.layerHeight * sy, x: drag.layerX + anchorX * (1 - sx), y: drag.layerY + anchorY * (1 - sy) };
  }
  const {
    handle,
    layerX,
    layerY,
    layerWidth,
    layerHeight,
    layerFontSize,
    layerText,
    layerFontFamily,
    layerLineHeight,
    layerKind,
  } = drag;

  let effectiveDx = dx;
  let effectiveDy = dy;
  if (handle === "nw") {
    effectiveDx = -dx;
    effectiveDy = -dy;
  } else if (handle === "ne") {
    effectiveDx = dx;
    effectiveDy = -dy;
  } else if (handle === "sw") {
    effectiveDx = -dx;
    effectiveDy = dy;
  } else if (handle === "se") {
    effectiveDx = dx;
    effectiveDy = dy;
  }

  let newWidth: number;
  let newHeight: number;

  if (shiftKey && layerWidth > 0 && layerHeight > 0) {
    const scale =
      Math.abs(effectiveDx) > Math.abs(effectiveDy)
        ? (layerWidth + effectiveDx) / layerWidth
        : (layerHeight + effectiveDy) / layerHeight;
    const clampedScale = Math.max(1 / Math.min(layerWidth, layerHeight), scale);
    newWidth = Math.max(1, Math.round(layerWidth * clampedScale));
    newHeight = Math.max(1, Math.round(layerHeight * clampedScale));
  } else {
    newWidth = Math.max(1, Math.round(layerWidth + effectiveDx));
    newHeight = Math.max(1, Math.round(layerHeight + effectiveDy));
  }

  let newX = layerX;
  let newY = layerY;

  if (handle === "nw" || handle === "sw") {
    newX = layerX + layerWidth - newWidth;
  }
  if (handle === "nw" || handle === "ne") {
    newY = layerY + layerHeight - newHeight;
  }

  newX = Math.max(
    -Number.MAX_SAFE_INTEGER,
    Math.min(Number.MAX_SAFE_INTEGER, newX),
  );
  newY = Math.max(
    -Number.MAX_SAFE_INTEGER,
    Math.min(Number.MAX_SAFE_INTEGER, newY),
  );
  newWidth = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, newWidth));
  newHeight = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, newHeight));

  if (layerKind === "text" && layerFontSize && (layerText || drag.layerTextStyle?.wrapWidth != null||drag.layerTextStyle?.textPath)) {
    if (drag.layerTextStyle?.wrapWidth != null) {
      const wrapWidth = Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, layerWidth+effectiveDx));
      const bounds = measureTextBounds(layerText??'', layerFontSize, layerFontFamily??'sans-serif', layerLineHeight??1.2, {...drag.layerTextStyle, wrapWidth});
      return {wrapWidth,
        x: Math.max(-Number.MAX_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, handle==='nw'||handle==='sw'?layerX+layerWidth-bounds.width:layerX)),
        y: Math.max(-Number.MAX_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, handle==='nw'||handle==='ne'?layerY+layerHeight-bounds.height:layerY))};
    }
    const scale =
      Math.abs(effectiveDx) > Math.abs(effectiveDy)
        ? (layerWidth + effectiveDx) / layerWidth
        : (layerHeight + effectiveDy) / layerHeight;
    const clampedScale = Math.max(0.05, scale);
    const newFontSize = Math.max(
      1,
      Math.min(
        Number.MAX_SAFE_INTEGER,
        Math.round(layerFontSize * clampedScale),
      ),
    );
    const characterRanges=drag.layerTextStyle?.characterRanges?.map(range=>({...range,format:{...range.format,...(range.format.fontSize===undefined?{}:{fontSize:Math.max(1,Math.min(Number.MAX_SAFE_INTEGER,range.format.fontSize*newFontSize/layerFontSize))})}}));
    const originalPath=drag.layerTextStyle?.textPath,ratio=newFontSize/layerFontSize,textPath=originalPath?{...originalPath,startOffset:originalPath.startOffset*ratio,baselineOffset:originalPath.baselineOffset*ratio,points:originalPath.points.map(p=>({x:p.x*ratio,y:p.y*ratio,in:{x:p.in.x*ratio,y:p.in.y*ratio},out:{x:p.out.x*ratio,y:p.out.y*ratio}}))}:undefined;
    const newBounds = measureTextBounds(
      layerText??'',
      newFontSize,
      layerFontFamily ?? "sans-serif",
      layerLineHeight ?? 1.2,
      {...drag.layerTextStyle,...(textPath?{textPath}:{}),...(characterRanges===undefined?{}:{characterRanges})},
    );
    let textX = layerX;
    let textY = layerY;
    if (handle === "nw" || handle === "sw") {
      textX = layerX + layerWidth - newBounds.width;
    }
    if (handle === "nw" || handle === "ne") {
      textY = layerY + layerHeight - newBounds.height;
    }
    if(textPath){const before=drag.layerTextStyle?.textPathOrigin??{x:0,y:0},after=newBounds.origin??{x:0,y:0};textX+=before.x-after.x;textY+=before.y-after.y;}
    return {
      ...(textPath?{textPath}:{}),
      x: Math.max(
        -Number.MAX_SAFE_INTEGER,
        Math.min(Number.MAX_SAFE_INTEGER, (textPath?textX:Math.round(textX))),
      ),
      y: Math.max(
        -Number.MAX_SAFE_INTEGER,
        Math.min(Number.MAX_SAFE_INTEGER, (textPath?textY:Math.round(textY))),
      ),
      fontSize: newFontSize,
      ...(characterRanges===undefined?{}:{characterRanges}),
    };
  }

  return {
    x: newX,
    y: newY,
    width: newWidth,
    height: newHeight,
  };
}

/**
 * Transforms pointer client coordinates into document canvas coordinates.
 */
export function canvasPoint(
  event: { clientX: number; clientY: number },
  rect: { left: number; top: number },
  zoom: number,
): Point {
  return {
    x: (event.clientX - rect.left) / zoom,
    y: (event.clientY - rect.top) / zoom,
  };
}

export interface ToolModifier {
  tilt?:PenTiltData;
  alt: boolean;
  shift: boolean;
  pressure: number;
}

/**
 * Extracts modifier keys and pressure from pointer/mouse events.
 */
export function modifiers(event: {
  altKey: boolean;
  shiftKey: boolean;
  pointerType?: string;
  pressure?: number;
  tiltX?:number;tiltY?:number;altitudeAngle?:number;azimuthAngle?:number;
},preservePenPressure=false,captureTilt=false): ToolModifier {
  return {
    ...(captureTilt&&event.pointerType==='pen'?{tilt:pointerPenTilt(event)}:{}),
    alt: event.altKey,
    shift: event.shiftKey,
    pressure: event.pointerType === "pen"
      ? preservePenPressure
        ? Number.isFinite(event.pressure)?Math.max(0,Math.min(1,event.pressure!)):.05
        : event.pressure || 0.05
      : 1,
  };
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Computes the visible bounding region of the document within the current viewport and pan/zoom state.
 */
export function computeVisibleRegion(
  documentSize: { width: number; height: number },
  viewportSize: { width: number; height: number },
  pan: { x: number; y: number },
  zoom: number,
): Region {
  const x = Math.max(
    0,
    Math.min(
      documentSize.width - 1,
      Math.floor(
        documentSize.width / 2 - (viewportSize.width / 2 + pan.x) / zoom,
      ),
    ),
  );
  const y = Math.max(
    0,
    Math.min(
      documentSize.height - 1,
      Math.floor(
        documentSize.height / 2 - (viewportSize.height / 2 + pan.y) / zoom,
      ),
    ),
  );
  const right = Math.min(
    documentSize.width,
    Math.ceil(documentSize.width / 2 + (viewportSize.width / 2 - pan.x) / zoom),
  );
  const bottom = Math.min(
    documentSize.height,
    Math.ceil(
      documentSize.height / 2 + (viewportSize.height / 2 - pan.y) / zoom,
    ),
  );
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

/**
 * Calculates the zoom level required to fit the document comfortably inside the viewport box.
 */
export function calculateFitZoom(
  documentSize: { width: number; height: number },
  boxSize: { width: number; height: number },
  padding = 120,
): number {
  return Math.max(
    Number.MIN_VALUE,
    Math.min(
      1,
      (boxSize.width - padding) / documentSize.width,
      (boxSize.height - padding) / documentSize.height,
    ),
  );
}
