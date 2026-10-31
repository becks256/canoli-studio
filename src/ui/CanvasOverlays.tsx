import {maskPathMapping} from '../core/mask-path';
import {ProjectivePenControls} from './ProjectivePenControls';
import {symmetryMatrices} from '../core/brush-symmetry';
import {activePerspective,perspectiveLocalQuad} from '../core/perspective';
import {BrushSymmetryGuides} from './BrushSymmetryDialog';
import { useSelectionOutlines } from "./hooks/useSelectionOutlines";
import { memo, useSyncExternalStore } from "react";
import type { DocumentData, LayerData } from "../core/model";
import type { Point, Rect } from "../core/drawing";
import {paintStampSize,paintStampGeometry} from '../core/paint-stamps';
import { maskTransform } from "../core/masks";
import { layerTransform } from "../core/spatial";
import type { Tool, ToolController } from "../tools";

export function CanvasOverlays({
  viewportWindow,
  document,
  selected,
  tool,
  zoom,
  controller,
  cursorStore,
  showBrushCursor = true,
  onError,
}: {
  viewportWindow?: Rect|null;
  document: DocumentData;
  selected?: LayerData;
  tool: Tool;
  zoom: number;
  controller: ToolController;
  showBrushCursor?: boolean;
  onError?(message: string): void;
  cursorStore: { getSnapshot(): Point | null; subscribe(listener: () => void): () => void };
}) {
  const selectionOutlines = useSelectionOutlines(document.selection, onError);
  const cursor = useSyncExternalStore(cursorStore.subscribe, cursorStore.getSnapshot);
  const state = controller.getSnapshot();
  const world = selected ? layerTransform(document, selected.id) : null;
  const pending = controller.pendingStroke;
  const editingMask = state.settings.penEditTarget === "mask";
  const editingTextPath = !editingMask && selected?.kind === 'text' && !!selected.textPath;
  const mask = selected?.mask;
  const maskMapping=editingMask&&mask&&selected?maskPathMapping(document,selected.id,mask):null;
  const nonlinear=!!maskMapping?.projection;
  const pathTransform = nonlinear?world:
    editingMask && mask && world ? maskTransform(mask, world) : world;
  // SVG implementations may round local coordinates and translations
  // separately to float precision. Keep the former absolute-coordinate path
  // when cancellation could lose a visible fraction of a screen pixel.
  // This is a display-precision fallback, never a document-coordinate limit.
  const sharePenTranslation = !!pathTransform &&
    Math.max(Math.abs(pathTransform.e), Math.abs(pathTransform.f)) * zoom * 2 ** -23 <= 1 / 1024;
  const localPaths = editingMask
    ? mask?.kind === "vector"
      ? mask.paths.map((path, index) => ({ ...path, closed:true, id: `mask-${index}` }))
      : []
    : selected?.kind === "vector"
      ? selected.paths.flatMap(path => [path, ...(path.subpaths ?? []).map(contour => ({ ...contour, id: `${path.id}/${contour.id}` }))])
      : selected?.kind === 'text' && selected.textPath
        ? [{...selected.textPath,id:'text-baseline'}]
      : [];
  const penWindow=tool==="pen"&&pathTransform&&localPaths.length>0?viewportWindow:null;
  const clipOffsetX=sharePenTranslation?pathTransform?.e??0:0,clipOffsetY=sharePenTranslation?pathTransform?.f??0:0;
  const penProjection=nonlinear&&maskMapping?maskMapping.relativeTo({x:clipOffsetX,y:clipOffsetY}):null;
  const projectedClip=penWindow?{x:penWindow.x-clipOffsetX,y:penWindow.y-clipOffsetY,width:penWindow.width,height:penWindow.height}:{x:-clipOffsetX-32/zoom,y:-clipOffsetY-32/zoom,width:document.width+64/zoom,height:document.height+64/zoom};
  const selectedAnchor = controller.selectedMaskAnchor;
  const selectedTextAnchor = controller.selectedTextPathAnchor;
  return (
    <svg
      className="drawing-overlay"
      width={document.width * zoom}
      height={document.height * zoom}
      viewBox={`0 0 ${document.width} ${document.height}`}
      aria-hidden="true"
    >
      {(["smudge","mixer","brush","pencil","eraser","clone","heal","dodge","burn"].includes(tool))&&<BrushSymmetryGuides data={state.settings.symmetry} width={document.width} height={document.height}/>}
      {selected&&(selected.kind==='raster'||selected.kind==='smart-object')&&world&&activePerspective(selected.perspective)&&<polygon data-testid="perspective-outline" points={perspectiveLocalQuad(selected.width,selected.height,selected.perspective).map(p=>world.point(p)).map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--color-accent)" strokeWidth={1/zoom}/>}
      <defs>
        <pattern
          id="selection-hatch"
          width={8 / zoom}
          height={8 / zoom}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width={8 / zoom} height={8 / zoom} fill="white" />
          <rect width={4 / zoom} height={8 / zoom} fill="#152019" />
        </pattern>
      </defs>
      {state.lassoPoints && <path data-testid="lasso-preview" d={state.lassoPoints.map((p,i)=>`${i ? "L" : "M"}${p.x} ${p.y}`).join(" ")+" Z"} fill="none" stroke="url(#selection-hatch)" strokeWidth={1.5/zoom} strokeDasharray={`${5/zoom} ${3/zoom}`} />}
      {state.quickSelectionPoints&&<g data-testid="quick-selection-seeds" fill="none" stroke="white" opacity={.4}>
        <circle cx={state.quickSelectionPoints[0].x} cy={state.quickSelectionPoints[0].y} r={state.settings.quickSize/2} fill="white" stroke="none"/>
        <polyline points={state.quickSelectionPoints.map(point=>`${point.x},${point.y}`).join(' ')} strokeWidth={state.settings.quickSize} strokeLinecap="round" strokeLinejoin="round"/>
      </g>}
      {controller.drawingPolygonLasso && state.lassoPoints?.slice(0, controller.polygonLassoPointCount).map((point, index) => (
        <circle key={index} cx={point.x} cy={point.y} r={(index === 0 ? 4 : 2.5)/zoom}
          fill="var(--color-app)" stroke="var(--color-accent)" strokeWidth={1.5/zoom} />
      ))}
      {document.selection?.regions.map((r, index) =>
        r.shape === "pixels" ? (
          <g key={index} transform={r.transform ? `matrix(${r.transform.a} ${r.transform.b} ${r.transform.c} ${r.transform.d} ${r.transform.e} ${r.transform.f})` : undefined}>
            <path data-testid="pixel-selection-outline" d={selectionOutlines[index] ?? ""} transform={`translate(${r.x} ${r.y}) scale(${r.width/r.coverage!.width} ${r.height/r.coverage!.height})`}
              fill="none" stroke={r.operation === "subtract" ? "#f5aea0" : "url(#selection-hatch)"} strokeWidth={1.5 / zoom} strokeDasharray={`${5/zoom} ${3/zoom}`} />
          </g>
        ) : r.shape === "rectangle" ? (
          <rect
            key={index}
            transform={
              r.transform
                ? `matrix(${r.transform.a} ${r.transform.b} ${r.transform.c} ${r.transform.d} ${r.transform.e} ${r.transform.f})`
                : undefined
            }
            x={r.x}
            y={r.y}
            width={r.width}
            height={r.height}
            fill="none"
            stroke={
              r.operation === "subtract" ? "#f5aea0" : "url(#selection-hatch)"
            }
            strokeWidth={1.5 / zoom}
            strokeDasharray={`${5 / zoom} ${3 / zoom}`}
          />
        ) : (
          <ellipse
            key={index}
            transform={
              r.transform
                ? `matrix(${r.transform.a} ${r.transform.b} ${r.transform.c} ${r.transform.d} ${r.transform.e} ${r.transform.f})`
                : undefined
            }
            cx={r.x + r.width / 2}
            cy={r.y + r.height / 2}
            rx={r.width / 2}
            ry={r.height / 2}
            fill="none"
            stroke={
              r.operation === "subtract" ? "#f5aea0" : "url(#selection-hatch)"
            }
            strokeWidth={1.5 / zoom}
            strokeDasharray={`${5 / zoom} ${3 / zoom}`}
          />
        ),
      )}
      {tool === "heal" && state.healingStroke && (
        <g data-testid="healing-stroke-preview" opacity={0.35}>
          {state.healingStroke.tip||state.healingStroke.symmetry ? [state.healingStroke.points[0],...(state.healingStroke.points.length>1?[state.healingStroke.points.at(-1)!]:[])].flatMap(point=>symmetryMatrices(state.healingStroke!.symmetry).map((copy,i)=>i?{...point,copy}:point)).map((point,index)=>{
            const shape=paintStampGeometry(state.healingStroke!,point);
            return <ellipse key={index} rx={shape.rx} ry={shape.ry} transform={`matrix(${shape.a} ${shape.b} ${shape.c} ${shape.d} ${shape.cx} ${shape.cy})`} fill="var(--color-accent)"/>;
          }) : <circle
            cx={state.healingStroke.points[0].x}
            cy={state.healingStroke.points[0].y}
            r={
              paintStampSize(state.healingStroke,state.healingStroke.points[0])/2
            }
            fill="var(--color-accent)"
          />}
          <polyline
            points={state.healingStroke.points
              .map((point) => `${point.x},${point.y}`)
              .join(" ")}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={(state.healingStroke.tip||state.healingStroke.symmetry)?1.5/zoom:state.healingStroke.size}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
      {tool === "patch" && state.patchOffset && (
        <g
          data-testid={
            state.settings.patchDirection === "destination"
              ? "patch-destination-outline"
              : "patch-donor-outline"
          }
          transform={`translate(${state.patchOffset.x} ${state.patchOffset.y})`}
        >
          {document.selection?.regions.map((r, index) => (
            <g
              key={index}
              transform={
                r.transform
                  ? `matrix(${r.transform.a} ${r.transform.b} ${r.transform.c} ${r.transform.d} ${r.transform.e} ${r.transform.f})`
                  : undefined
              }
            >
              {r.shape === "pixels" ? (
                <path d={selectionOutlines[index] ?? ""} transform={`translate(${r.x} ${r.y}) scale(${r.width/r.coverage!.width} ${r.height/r.coverage!.height})`}
                  fill="none" stroke="var(--color-accent)" strokeWidth={2/zoom} />
              ) : r.shape === "rectangle" ? (
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.width}
                  height={r.height}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={2 / zoom}
                  strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                />
              ) : (
                <ellipse
                  cx={r.x + r.width / 2}
                  cy={r.y + r.height / 2}
                  rx={r.width / 2}
                  ry={r.height / 2}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={2 / zoom}
                  strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                />
              )}
            </g>
          ))}
        </g>
      )}
      {tool === "pen" && pathTransform && localPaths.length > 0 && (
        <g data-testid="pen-controls" data-viewport-x={penWindow?.x} data-viewport-y={penWindow?.y} data-viewport-width={penWindow?.width} data-viewport-height={penWindow?.height} transform={`translate(${sharePenTranslation ? pathTransform.e : 0} ${sharePenTranslation ? pathTransform.f : 0})`}>
          {localPaths.map((path, pathIndex) => penProjection?<ProjectivePenControls key={path.id} points={path.points} matrix={penProjection} clip={projectedClip} zoom={zoom} contour={pathIndex===controller.maskContourIndex}
            active={selectedAnchor?.layerId===selected?.id&&selectedAnchor?.pathIndex===pathIndex?selectedAnchor.index:-1} onError={onError}/>: (
            <PenPathControls key={path.id} points={path.points}
              clipLeft={penWindow?penWindow.x-clipOffsetX:undefined} clipTop={penWindow?penWindow.y-clipOffsetY:undefined}
              clipRight={penWindow?penWindow.x+penWindow.width-clipOffsetX:undefined} clipBottom={penWindow?penWindow.y+penWindow.height-clipOffsetY:undefined}
              a={pathTransform.a} b={pathTransform.b} c={pathTransform.c}
              d={pathTransform.d} e={sharePenTranslation ? 0 : pathTransform.e} f={sharePenTranslation ? 0 : pathTransform.f}
              zoom={zoom} outline={editingMask || editingTextPath} closed={path.closed}
              contour={pathIndex === controller.maskContourIndex}
              active={editingMask ? (selectedAnchor?.layerId === selected?.id &&
                selectedAnchor?.pathIndex === pathIndex ? selectedAnchor.index : -1) : editingTextPath ? selectedTextAnchor?.index ?? -1 : 0}
            />
          ))}
        </g>
      )}
      {tool === "clone" && state.cloneSource && (
        <g
          className="clone-source-marker"
          transform={`translate(${state.cloneSource.x} ${state.cloneSource.y})`}
          stroke="#d5e79b"
          strokeWidth={1.5 / zoom}
        >
          <circle r={6 / zoom} fill="none" />
          <path
            d={`M ${-10 / zoom} 0 H ${10 / zoom} M 0 ${-10 / zoom} V ${10 / zoom}`}
          />
        </g>
      )}
      {tool === "clone" && pending && (
        <polyline
          points={pending.points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke="#d5e79b"
          strokeOpacity={0.45}
          strokeWidth={pending.size}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {showBrushCursor && cursor &&
        ["smudge", "mixer", "brush", "pencil", "eraser", "clone", "heal", "dodge", "burn", "quick-select"].includes(
          tool,
        ) && (
          <g>
            <circle
              cx={cursor.x}
              cy={cursor.y}
              r={(tool==='quick-select'?state.settings.quickSize:state.settings.size) / 2}
              fill="none"
              stroke="#101810"
              strokeWidth={2 / zoom}
            />
            <circle
              cx={cursor.x}
              cy={cursor.y}
              r={(tool==='quick-select'?state.settings.quickSize:state.settings.size) / 2}
              fill="none"
              stroke="white"
              strokeWidth={1 / zoom}
            />
          </g>
        )}
    </svg>
  );
}


// Numeric props let unchanged controls skip SVG reconciliation even when a
// preview reconstructs the path DTOs or the cursor publishes a new position.
// Compare fields directly to avoid two Object.keys arrays per anchor update.
type PenClipEdges={clipLeft?:number;clipTop?:number;clipRight?:number;clipBottom?:number};

const PenAnchor = memo(function PenAnchor({
  x, y, inX, inY, outX, outY, zoom, active,clipLeft,clipTop,clipRight,clipBottom,
}: {
  x: number; y: number; inX: number; inY: number;
  outX: number; outY: number; zoom: number; active: boolean;
}&PenClipEdges) {
  // The footprint includes both handles and their joining line, even when
  // the anchor itself is outside the view. Retain every element and index;
  // only groups wholly outside the padded view suppress browser paint work.
  const radius=5/zoom,left=Math.min(x,inX,outX)-radius,top=Math.min(y,inY,outY)-radius,
    right=Math.max(x,inX,outX)+radius,bottom=Math.max(y,inY,outY)+radius;
  const outside=clipLeft!==undefined&&clipTop!==undefined&&clipRight!==undefined&&clipBottom!==undefined&&
    Number.isFinite(left)&&Number.isFinite(top)&&Number.isFinite(right)&&Number.isFinite(bottom)&&
    (right<clipLeft||bottom<clipTop||left>clipRight||top>clipBottom);
  return <g display={outside?'none':undefined}>
    <line x1={inX} y1={inY} x2={outX} y2={outY} stroke="#d5e79b" strokeWidth={1 / zoom} />
    <circle cx={inX} cy={inY} r={3 / zoom} fill="#202523" stroke="#d5e79b" strokeWidth={1 / zoom} />
    <circle cx={outX} cy={outY} r={3 / zoom} fill="#202523" stroke="#d5e79b" strokeWidth={1 / zoom} />
    <rect x={x - 4 / zoom} y={y - 4 / zoom} width={8 / zoom} height={8 / zoom}
      fill={active ? "#d5e79b" : "#202523"} stroke="#d5e79b" strokeWidth={1 / zoom} />
  </g>;
}, (previous, next) =>
  previous.x === next.x && previous.y === next.y &&
  previous.inX === next.inX && previous.inY === next.inY &&
  previous.outX === next.outX && previous.outY === next.outY &&
  previous.zoom === next.zoom && previous.active === next.active &&
  previous.clipLeft===next.clipLeft&&previous.clipTop===next.clipTop&&previous.clipRight===next.clipRight&&previous.clipBottom===next.clipBottom,
);


type PenPathProps = PenClipEdges & {
  points: readonly { x: number; y: number; in: Point; out: Point }[];
  a: number; b: number; c: number; d: number; e: number; f: number;
  zoom: number; outline: boolean; contour: boolean; active: number; closed?: boolean;
};
// Keep handles in the document plane so scaling/shearing artwork does not
// change their screen size. Translation alone belongs on the shared group:
// moving a layer must not rewrite every anchor/handle coordinate in the DOM.
const PenPathControls = memo(function PenPathControls(props: PenPathProps) {
  const { a, b, c, d, e, f, zoom, outline, contour } = props;
  const coordinate = (p: Point) => `${a*p.x+c*p.y+e} ${b*p.x+d*p.y+f}`;
  const points = props.points;
  return <g>
    {outline && points.length > 0 && <path fill="none" stroke="#d5e79b"
      strokeWidth={1/zoom} strokeDasharray={contour ? `${4/zoom} ${3/zoom}` : undefined}
      d={`M ${coordinate(points[0])} ` + points.map((p,i) => {
        if(props.closed === false && i === points.length-1)return '';
        const next = points[(i+1)%points.length];
        return `C ${coordinate(p.out)} ${coordinate(next.in)} ${coordinate(next)}`;
      }).join(" ") + (props.closed === false ? '' : ' Z')} />}
    {points.length <= PEN_CONTROL_BLOCK ? penAnchors(props, 0) :
      Array.from({length: Math.ceil(points.length / PEN_CONTROL_BLOCK)}, (_, block) =>
        <PenControlBlock key={block} {...props} start={block * PEN_CONTROL_BLOCK}
          points={points.slice(block * PEN_CONTROL_BLOCK, (block + 1) * PEN_CONTROL_BLOCK)} />)}
  </g>;
}, samePenGeometry);

const PEN_CONTROL_BLOCK = 64;
type PenControlBlockProps = PenPathProps & {start: number};

// A changed anchor must not recreate every React element in a long path.
// Blocks add no SVG wrappers, omit no controls and preserve drawing order.
function penAnchors({points, a, b, c, d, e, f, zoom, active,clipLeft,clipTop,clipRight,clipBottom}: PenPathProps, start: number) {
  return points.map((point, offset) =>
    <PenAnchor key={start + offset} x={a*point.x+c*point.y+e} y={b*point.x+d*point.y+f}
      inX={a*point.in.x+c*point.in.y+e} inY={b*point.in.x+d*point.in.y+f}
      outX={a*point.out.x+c*point.out.y+e} outY={b*point.out.x+d*point.out.y+f}
      zoom={zoom} active={start + offset === active} clipLeft={clipLeft} clipTop={clipTop} clipRight={clipRight} clipBottom={clipBottom} />);
}

const PenControlBlock = memo(function PenControlBlock(props: PenControlBlockProps) {
  return <>{penAnchors(props, props.start)}</>;
}, (previous, next) => {
  if (previous.start !== next.start || previous.a !== next.a || previous.b !== next.b ||
      previous.c !== next.c || previous.d !== next.d || previous.e !== next.e ||
      previous.f !== next.f || previous.zoom !== next.zoom || previous.clipLeft!==next.clipLeft||previous.clipTop!==next.clipTop||previous.clipRight!==next.clipRight||previous.clipBottom!==next.clipBottom) return false;
  if (previous.points.length !== next.points.length) return false;
  const end = previous.start + previous.points.length;
  const activeHere = (value: PenControlBlockProps) =>
    value.active >= value.start && value.active < end ? value.active : -1;
  if (activeHere(previous) !== activeHere(next)) return false;
  for (let i = 0; i < previous.points.length; i++) {
    const p = previous.points[i], q = next.points[i];
    if (p !== q && (p.x !== q.x || p.y !== q.y || p.in.x !== q.in.x || p.in.y !== q.in.y ||
        p.out.x !== q.out.x || p.out.y !== q.out.y)) return false;
  }
  return true;
});

function samePenGeometry(previous: PenPathProps, next: PenPathProps) {
  if(previous.clipLeft!==next.clipLeft||previous.clipTop!==next.clipTop||previous.clipRight!==next.clipRight||previous.clipBottom!==next.clipBottom)return false;
  if (previous.a!==next.a || previous.b!==next.b || previous.c!==next.c ||
      previous.d!==next.d || previous.e!==next.e || previous.f!==next.f ||
      previous.zoom!==next.zoom || previous.outline!==next.outline ||
      previous.contour!==next.contour || previous.active!==next.active || previous.closed!==next.closed) return false;
  if (previous.points===next.points) return true;
  return previous.points.length===next.points.length && previous.points.every((p,i) => {
    const q=next.points[i];
    return p.x===q.x && p.y===q.y && p.in.x===q.in.x && p.in.y===q.in.y &&
      p.out.x===q.out.x && p.out.y===q.out.y;
  });
}
