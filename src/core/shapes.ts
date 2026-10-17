import {vectorFillData,type VectorFillOptions} from './vector-gradient';
import {vectorStrokeData,type VectorStrokeOptions} from './vector-stroke';
import {parseSvgContours} from './svg-path-import';
/**
 * Vector shape primitives, SVG path serialization, and SVG parsing
 * for Ticket T16 / F07 ("Vector and shape editing").
 *
 * Implements:
 * - Accurate cubic Bézier approximations for Rectangles, Rounded Rectangles, Ellipses, and Polygons
 * - Bidirectional SVG path import/export preserving exact control handles and geometry
 * - Standalone SVG document generator for vector layers
 */

import { id } from "./model";
import type { PathAnchor, Point, Rect, VectorPathData } from "./drawing";
export { formatSvgPathD, exportPathSvg } from "./svg-path";
export { exportVectorLayerSvg } from "./svg-export";

// Standard cubic Bézier constant for 90-degree circular arc: 4 * (sqrt(2) - 1) / 3
export const KAPPA = 0.5522847498307936;

export interface ShapeOptions extends VectorStrokeOptions, VectorFillOptions {
  fill?: string | null;
  stroke?: string | null;
  strokeWidth?: number;
}

/**
 * Creates a rectangle VectorPathData.
 * If cornerRadius > 0, constructs rounded corners using smooth cubic Béziers.
 */
export function createRectanglePath(
  rect: Rect,
  cornerRadius = 0,
  options: ShapeOptions = {},
): VectorPathData {
  const { x, y, width: w, height: h } = rect;
  const stroke = options.stroke === undefined ? "#d5e79b" : options.stroke;
  const strokeWidth = options.strokeWidth ?? 2;
  const fill = options.fill ?? null;

  if (cornerRadius <= 0) {
    const points: PathAnchor[] = [
      { x, y, in: { x, y }, out: { x, y } },
      { x: x + w, y, in: { x: x + w, y }, out: { x: x + w, y } },
      {
        x: x + w,
        y: y + h,
        in: { x: x + w, y: y + h },
        out: { x: x + w, y: y + h },
      },
      { x, y: y + h, in: { x, y: y + h }, out: { x, y: y + h } },
    ];
    return {
      id: id(),
      points,
      closed: true,
      fill,
      stroke,
      strokeWidth,
      ...vectorStrokeData(options),
    ...vectorFillData(options),
    };
  }

  // Rounded rectangle with 8 anchors and cubic Bézier corner handles
  const r = Math.min(cornerRadius, w / 2, h / 2);
  const k = r * KAPPA;

  const points: PathAnchor[] = [
    // Top edge, left to right
    { x: x + r, y, in: { x: x + r - k, y }, out: { x: x + r, y } },
    { x: x + w - r, y, in: { x: x + w - r, y }, out: { x: x + w - r + k, y } },
    // Right edge, top to bottom
    {
      x: x + w,
      y: y + r,
      in: { x: x + w, y: y + r - k },
      out: { x: x + w, y: y + r },
    },
    {
      x: x + w,
      y: y + h - r,
      in: { x: x + w, y: y + h - r },
      out: { x: x + w, y: y + h - r + k },
    },
    // Bottom edge, right to left
    {
      x: x + w - r,
      y: y + h,
      in: { x: x + w - r + k, y: y + h },
      out: { x: x + w - r, y: y + h },
    },
    {
      x: x + r,
      y: y + h,
      in: { x: x + r, y: y + h },
      out: { x: x + r - k, y: y + h },
    },
    // Left edge, bottom to top
    { x, y: y + h - r, in: { x, y: y + h - r + k }, out: { x, y: y + h - r } },
    { x, y: y + r, in: { x, y: y + r }, out: { x, y: y + r - k } },
  ];

  return {
    id: id(),
    points,
    closed: true,
    fill,
    stroke,
    strokeWidth,
    ...vectorStrokeData(options),
    ...vectorFillData(options),
  };
}

/**
 * Creates an ellipse VectorPathData inside the specified bounding box.
 * Uses 4 cubic Bézier segments with standard circular/elliptical Kappa approximation.
 */
export function createEllipsePath(
  rect: Rect,
  options: ShapeOptions = {},
): VectorPathData {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rx = Math.max(0.1, rect.width / 2);
  const ry = Math.max(0.1, rect.height / 2);
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;

  const points: PathAnchor[] = [
    // Top anchor
    {
      x: cx,
      y: cy - ry,
      in: { x: cx - kx, y: cy - ry },
      out: { x: cx + kx, y: cy - ry },
    },
    // Right anchor
    {
      x: cx + rx,
      y: cy,
      in: { x: cx + rx, y: cy - ky },
      out: { x: cx + rx, y: cy + ky },
    },
    // Bottom anchor
    {
      x: cx,
      y: cy + ry,
      in: { x: cx + kx, y: cy + ry },
      out: { x: cx - kx, y: cy + ry },
    },
    // Left anchor
    {
      x: cx - rx,
      y: cy,
      in: { x: cx - rx, y: cy + ky },
      out: { x: cx - rx, y: cy - ky },
    },
  ];

  return {
    id: id(),
    points,
    closed: true,
    fill: options.fill ?? null,
    stroke: options.stroke === undefined ? "#d5e79b" : options.stroke,
    strokeWidth: options.strokeWidth ?? 2,
    ...vectorStrokeData(options),
    ...vectorFillData(options),
  };
}

/**
 * Creates a regular polygon VectorPathData with N sides.
 */
export function createPolygonPath(
  center: Point,
  radius: number,
  sides: number,
  options: ShapeOptions = {},
): VectorPathData {
  const count = Math.max(3, Math.min(128, Math.round(sides)));
  const r = Math.max(1, radius);
  const points: PathAnchor[] = [];

  // Start with top vertex (angle -PI/2)
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const px = Math.round((center.x + r * Math.cos(angle)) * 100) / 100;
    const py = Math.round((center.y + r * Math.sin(angle)) * 100) / 100;
    points.push({
      x: px,
      y: py,
      in: { x: px, y: py },
      out: { x: px, y: py },
    });
  }

  return {
    id: id(),
    points,
    closed: true,
    fill: options.fill ?? null,
    stroke: options.stroke === undefined ? "#d5e79b" : options.stroke,
    strokeWidth: options.strokeWidth ?? 2,
    ...vectorStrokeData(options),
    ...vectorFillData(options),
  };
}

/** Single-contour SVG path conversion. Invalid or compound data rejects explicitly. */
export function parseSvgPath(d:string):(Point & {in?:Point;out?:Point})[]{
 const {contours}=parseSvgContours(d);
 if(contours.length>1)throw new Error('VectorPath accepts one SVG contour. Import the SVG document for compound geometry.');
 return contours[0]?.points??[];
}
