import {vectorGradientSchema} from './vector-gradient';
import {vectorStrokeSchema,vectorStrokeValues,vectorStrokeData} from './vector-stroke';
import type { VectorPathData } from './drawing';

/** SVG numbers retain the full round-trip precision of authored coordinates. */
export function svgNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('SVG coordinates must be finite.');
  return String(value);
}

/** Attribute text never becomes markup. Reject characters XML 1.0 cannot encode. */
export function svgAttribute(value: string): string {
  for (const character of value) {
    const c = character.codePointAt(0)!;
    if (!(c === 9 || c === 10 || c === 13 ||
      (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) ||
      (c >= 0x10000 && c <= 0x10ffff)))
      throw new Error('SVG attributes contain a character XML 1.0 cannot represent.');
  }
  return value.replace(/[&<>"'\t\n\r]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
    '\t': '&#9;', '\n': '&#10;', '\r': '&#13;',
  })[c]!);
}

/** Bounded path fragments permit host export to yield even within a large path. */
export function* svgPathCommands(path: Pick<VectorPathData, 'points' | 'closed' | 'subpaths'>): Generator<string> {
  if (!path.points.length) return;
  const n = svgNumber, first = path.points[0];
  let parts = [`M ${n(first.x)} ${n(first.y)}`];
  const count = path.points.length, limit = path.closed ? count : count - 1;
  for (let i = 0; i < limit; i++) {
    const current = path.points[i], next = path.points[(i + 1) % count];
    const linear = current.out.x === current.x && current.out.y === current.y &&
      next.in.x === next.x && next.in.y === next.y;
    parts.push(linear ? `L ${n(next.x)} ${n(next.y)}` :
      `C ${n(current.out.x)} ${n(current.out.y)}, ${n(next.in.x)} ${n(next.in.y)}, ${n(next.x)} ${n(next.y)}`);
    if (parts.length === 256) { yield parts.join(' ') + ' '; parts = []; }
  }
  if (path.closed) parts.push('Z');
  if (parts.length) yield parts.join(' ');
  for (const contour of path.subpaths ?? []) { yield ' '; yield* svgPathCommands(contour); }
}

export function formatSvgPathD(path: Pick<VectorPathData, 'points' | 'closed' | 'subpaths'>): string {
  return [...svgPathCommands(path)].join('').trimEnd();
}

export function* svgPathElements(path: VectorPathData,gradientId=`canoli-gradient-${Array.from(path.id,c=>c.codePointAt(0)!.toString(16)).join("-")}`): Generator<string> {
  if (path.fillRule !== undefined && path.fillRule !== 'nonzero' && path.fillRule !== 'evenodd') throw new Error('Invalid path fill rule.');
  // Paint is a literal color, never a URL or arbitrary CSS from a raw caller.
  for (const color of [path.fill, path.stroke])
    if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color))
      throw new Error('SVG path paint must be a six-digit hex color or null.');
  const style=vectorStrokeValues(vectorStrokeSchema.parse(vectorStrokeData(path)));
  if(!/^[a-zA-Z][\w-]*$/.test(gradientId))throw new Error('Invalid generated gradient ID.');
  const gradient=path.fillGradient?vectorGradientSchema.parse(path.fillGradient):null;
  if(gradient&&path.closed){
    const n=svgNumber,t=gradient.transform,transform=t?` gradientTransform="matrix(${[t.a,t.b,t.c,t.d,t.e,t.f].map(n).join(' ')})"`:'';
    const geometry=gradient.kind==='linear'?`x1="${n(gradient.start.x)}" y1="${n(gradient.start.y)}" x2="${n(gradient.end.x)}" y2="${n(gradient.end.y)}"`:`fx="${n(gradient.start.x)}" fy="${n(gradient.start.y)}" fr="${n(gradient.start.radius)}" cx="${n(gradient.end.x)}" cy="${n(gradient.end.y)}" r="${n(gradient.end.radius)}"`;
    const tag=gradient.kind==='linear'?'linearGradient':'radialGradient';
    yield `<defs><${tag} id="${gradientId}" gradientUnits="userSpaceOnUse" color-interpolation="sRGB" spreadMethod="pad" ${geometry}${transform}>`;
    for(const stop of gradient.stops)yield `<stop offset="${n(stop.position)}" stop-color="${stop.color}" stop-opacity="${n(stop.opacity??1)}" />`;
    yield `</${tag}></defs>`;
  }
  const fill = path.closed ? gradient?`url(#${gradientId})`:path.fill??'none' : 'none';
  const stroke = path.stroke && path.strokeWidth > 0 ? path.stroke : 'none';
  yield path.fillRule === undefined ? '<path d="' : `<path fill-rule="${path.fillRule}" d="`;
  yield* svgPathCommands(path);
  yield `" fill="${fill}" stroke="${stroke}" stroke-width="${svgNumber(path.strokeWidth > 0 ? path.strokeWidth : 1)}" stroke-linecap="${style.strokeCap}" stroke-linejoin="${style.strokeJoin}" stroke-miterlimit="${svgNumber(style.strokeMiterLimit)}" stroke-dasharray="${style.strokeDashArray.length?style.strokeDashArray.map(svgNumber).join(' '):'none'}" stroke-dashoffset="${svgNumber(style.strokeDashOffset)}" />`;
}

export function exportPathSvg(path: VectorPathData): string {
  return [...svgPathElements(path)].join('');
}
