import type { DocumentData, LayerData } from "../core/model";
import type { Point } from "../core/drawing";
import { maskTransform } from "../core/masks";
import { layerTransform } from "../core/spatial";
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
  const world = selected ? layerTransform(document, selected.id) : null;
  const pending = controller.pendingStroke;
  const editingMask = state.settings.penEditTarget === "mask";
  const mask = selected?.mask;
  const pathTransform =
    editingMask && mask && world ? maskTransform(mask, world) : world;
  const localPaths = editingMask
    ? mask?.kind === "vector"
      ? mask.paths.map((path, index) => ({ ...path, id: `mask-${index}` }))
      : []
    : selected?.kind === "vector"
      ? selected.paths
      : [];
  // Transform geometry, not the SVG control group: handles retain screen size.
  const paths = pathTransform
    ? localPaths.map((path) => ({
        ...path,
        points: path.points.map((point) => ({
          ...point,
          ...pathTransform.point(point),
          in: pathTransform.point(point.in),
          out: pathTransform.point(point.out),
        })),
      }))
    : [];
  const selectedAnchor = controller.selectedMaskAnchor;
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
          <circle
            cx={state.healingStroke.points[0].x}
            cy={state.healingStroke.points[0].y}
            r={
              (state.healingStroke.size / 2) *
              (state.healingStroke.pressureSize === false
                ? 1
                : state.healingStroke.points[0].pressure)
            }
            fill="var(--color-accent)"
          />
          <polyline
            points={state.healingStroke.points
              .map((point) => `${point.x},${point.y}`)
              .join(" ")}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={state.healingStroke.size}
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
              {r.shape === "rectangle" ? (
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
      {tool === "pen" && pathTransform && paths.length > 0 && (
        <g data-testid="pen-controls">
          {editingMask &&
            paths.map((path, pathIndex) => (
              <path
                key={`outline-${path.id}`}
                fill="none"
                stroke="#d5e79b"
                strokeWidth={1 / zoom}
                strokeDasharray={
                  pathIndex === controller.maskContourIndex
                    ? `${4 / zoom} ${3 / zoom}`
                    : undefined
                }
                d={
                  `M ${path.points[0].x} ${path.points[0].y} ` +
                  path.points
                    .map((p, i) => {
                      const next = path.points[(i + 1) % path.points.length];
                      return `C ${p.out.x} ${p.out.y} ${next.in.x} ${next.in.y} ${next.x} ${next.y}`;
                    })
                    .join(" ") +
                  " Z"
                }
              />
            ))}
          {paths.flatMap((path, pathIndex) =>
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
                  fill={
                    (
                      editingMask
                        ? selectedAnchor?.layerId === selected?.id &&
                          selectedAnchor?.pathIndex === pathIndex &&
                          selectedAnchor?.index === index
                        : index === 0
                    )
                      ? "#d5e79b"
                      : "#202523"
                  }
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
      {cursor &&
        ["brush", "pencil", "clone", "heal", "dodge", "burn"].includes(
          tool,
        ) && (
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
