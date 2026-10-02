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
import type { VectorLayerData } from "./model";

// Standard cubic Bézier constant for 90-degree circular arc: 4 * (sqrt(2) - 1) / 3
export const KAPPA = 0.5522847498307936;

export interface ShapeOptions {
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
  };
}

/**
 * Converts a VectorPathData to an SVG path `d` attribute string.
 */
export function formatSvgPathD(
  path: Pick<VectorPathData, "points" | "closed">,
): string {
  if (path.points.length === 0) return "";
  const first = path.points[0];
  const parts: string[] = [`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`];
  const count = path.points.length;
  const limit = path.closed ? count : count - 1;

  for (let i = 0; i < limit; i++) {
    const current = path.points[i];
    const next = path.points[(i + 1) % count];
    const isLinear =
      current.out.x === current.x &&
      current.out.y === current.y &&
      next.in.x === next.x &&
      next.in.y === next.y;

    if (isLinear) {
      parts.push(`L ${next.x.toFixed(2)} ${next.y.toFixed(2)}`);
    } else {
      parts.push(
        `C ${current.out.x.toFixed(2)} ${current.out.y.toFixed(2)}, ${next.in.x.toFixed(2)} ${next.in.y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`,
      );
    }
  }

  if (path.closed) {
    parts.push("Z");
  }

  return parts.join(" ");
}

/**
 * Generates an SVG `<path>` element string for a single VectorPathData.
 */
export function exportPathSvg(path: VectorPathData): string {
  const d = formatSvgPathD(path);
  const fill = path.fill && path.closed ? path.fill : "none";
  const stroke = path.stroke && path.strokeWidth > 0 ? path.stroke : "none";
  const strokeWidth = path.strokeWidth > 0 ? path.strokeWidth : 1;

  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`;
}

/**
 * Generates a complete, valid SVG document for a VectorLayerData.
 */
export function exportVectorLayerSvg(
  layer: VectorLayerData,
  width: number,
  height: number,
): string {
  const pathElements = layer.paths
    .map((p) => `    ${exportPathSvg(p)}`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <g id="${layer.id}" opacity="${layer.opacity}">
${pathElements}
  </g>
</svg>`;
}

/**
 * Parses SVG path `d` data string into an array of PathAnchors with in/out control points.
 * Supports commands: M, L, H, V, C, S, Z (both absolute and relative).
 */
export function parseSvgPath(
  d: string,
): (Point & { in?: Point; out?: Point })[] {
  const anchors: (Point & { in?: Point; out?: Point })[] = [];
  const tokens = d.match(/([a-df-z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/gi);
  if (!tokens || tokens.length === 0) return anchors;

  let cursor = 0;
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let prevControlX = 0;
  let prevControlY = 0;
  let lastCommand = "";

  const readNum = (): number => {
    if (cursor >= tokens.length) return 0;
    const num = parseFloat(tokens[cursor++]);
    return isNaN(num) ? 0 : num;
  };

  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (/^[a-df-z]$/i.test(token)) {
      lastCommand = tokens[cursor++];
    }

    const isRel = lastCommand === lastCommand.toLowerCase();
    const cmd = lastCommand.toUpperCase();

    if (cmd === "M") {
      const x = readNum() + (isRel ? currentX : 0);
      const y = readNum() + (isRel ? currentY : 0);
      currentX = startX = x;
      currentY = startY = y;
      prevControlX = x;
      prevControlY = y;
      anchors.push({ x, y, in: { x, y }, out: { x, y } });
      // Implicit subsequent pairs after M are treated as L commands
      lastCommand = isRel ? "l" : "L";
    } else if (cmd === "L") {
      const x = readNum() + (isRel ? currentX : 0);
      const y = readNum() + (isRel ? currentY : 0);
      currentX = x;
      currentY = y;
      prevControlX = x;
      prevControlY = y;
      anchors.push({ x, y, in: { x, y }, out: { x, y } });
    } else if (cmd === "H") {
      const x = readNum() + (isRel ? currentX : 0);
      currentX = x;
      prevControlX = x;
      prevControlY = currentY;
      anchors.push({
        x,
        y: currentY,
        in: { x, y: currentY },
        out: { x, y: currentY },
      });
    } else if (cmd === "V") {
      const y = readNum() + (isRel ? currentY : 0);
      currentY = y;
      prevControlX = currentX;
      prevControlY = y;
      anchors.push({
        x: currentX,
        y,
        in: { x: currentX, y },
        out: { x: currentX, y },
      });
    } else if (cmd === "C") {
      const cp1x = readNum() + (isRel ? currentX : 0);
      const cp1y = readNum() + (isRel ? currentY : 0);
      const cp2x = readNum() + (isRel ? currentX : 0);
      const cp2y = readNum() + (isRel ? currentY : 0);
      const x = readNum() + (isRel ? currentX : 0);
      const y = readNum() + (isRel ? currentY : 0);

      if (anchors.length > 0) {
        anchors[anchors.length - 1].out = { x: cp1x, y: cp1y };
      }
      anchors.push({ x, y, in: { x: cp2x, y: cp2y }, out: { x, y } });
      currentX = x;
      currentY = y;
      prevControlX = cp2x;
      prevControlY = cp2y;
    } else if (cmd === "S") {
      // Smooth cubic curve: cp1 is reflection of prevControl across current point
      const cp1x = 2 * currentX - prevControlX;
      const cp1y = 2 * currentY - prevControlY;
      const cp2x = readNum() + (isRel ? currentX : 0);
      const cp2y = readNum() + (isRel ? currentY : 0);
      const x = readNum() + (isRel ? currentX : 0);
      const y = readNum() + (isRel ? currentY : 0);

      if (anchors.length > 0) {
        anchors[anchors.length - 1].out = { x: cp1x, y: cp1y };
      }
      anchors.push({ x, y, in: { x: cp2x, y: cp2y }, out: { x, y } });
      currentX = x;
      currentY = y;
      prevControlX = cp2x;
      prevControlY = cp2y;
    } else if (cmd === "Z") {
      currentX = startX;
      currentY = startY;
      prevControlX = startX;
      prevControlY = startY;
      if (
        anchors.length > 1 &&
        Math.hypot(
          anchors[anchors.length - 1].x - anchors[0].x,
          anchors[anchors.length - 1].y - anchors[0].y,
        ) < 0.05
      ) {
        anchors[0].in = anchors[anchors.length - 1].in;
        anchors.pop();
      }
    } else {
      // Skip unrecognized token to avoid infinite loop
      cursor++;
    }
  }

  return anchors;
}
