import type { DocumentData, LayerData } from "../core/model";
import type { Point } from "../core/drawing";
import { layerOrigin } from "../core/spatial";
import type { Tool, ToolController } from "../tools";

export function CanvasOverlays({
  document,
  selected,
  tool,
  zoom,
  controller,
  cursor,
}: {
  document: DocumentData;
  selected?: LayerData;
  tool: Tool;
  zoom: number;
  controller: ToolController;
  cursor: Point | null;
}) {
  const state = controller.getSnapshot();
  const origin = selected ? layerOrigin(document, selected.id) : null;
  const pending = controller.pendingStroke;
  return (
    <svg
      className="drawing-overlay"
      width={document.width * zoom}
      height={document.height * zoom}
      viewBox={`0 0 ${document.width} ${document.height}`}
      aria-hidden="true"
    >
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
      {document.selection?.regions.map((r, index) =>
        r.shape === "rectangle" ? (
          <rect
            key={index}
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
      {tool === "pen" && selected?.kind === "vector" && origin && (
        <g transform={`translate(${origin.x} ${origin.y})`}>
          {selected.paths.flatMap((path) =>
            path.points.map((p, index) => (
              <g key={`${path.id}:${index}`}>
                <line
                  x1={p.in.x}
                  y1={p.in.y}
                  x2={p.out.x}
                  y2={p.out.y}
                  stroke="#d5e79b"
                  strokeWidth={1 / zoom}
                />
                <circle
                  cx={p.in.x}
                  cy={p.in.y}
                  r={3 / zoom}
                  fill="#202523"
                  stroke="#d5e79b"
                  strokeWidth={1 / zoom}
                />
                <circle
                  cx={p.out.x}
                  cy={p.out.y}
                  r={3 / zoom}
                  fill="#202523"
                  stroke="#d5e79b"
                  strokeWidth={1 / zoom}
                />
                <rect
                  x={p.x - 4 / zoom}
                  y={p.y - 4 / zoom}
                  width={8 / zoom}
                  height={8 / zoom}
                  fill={index === 0 ? "#d5e79b" : "#202523"}
                  stroke="#d5e79b"
                  strokeWidth={1 / zoom}
                />
              </g>
            )),
          )}
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
      {cursor && ["brush", "pencil", "clone"].includes(tool) && (
        <g>
          <circle
            cx={cursor.x}
            cy={cursor.y}
            r={state.settings.size / 2}
            fill="none"
            stroke="#101810"
            strokeWidth={2 / zoom}
          />
          <circle
            cx={cursor.x}
            cy={cursor.y}
            r={state.settings.size / 2}
            fill="none"
            stroke="white"
            strokeWidth={1 / zoom}
          />
        </g>
      )}
    </svg>
  );
}
