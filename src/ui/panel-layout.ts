export interface PanelWidths {
  layers: number;
  inspector: number;
}
export const PANEL_LAYOUT_KEY = "luma.panel-widths.v1";
export const PANEL_MIN = { layers: 190, inspector: 230 };
export const PANEL_MAX = 480;
// Two-column tool rail, two resize handles, and the minimum canvas column.
export const PANEL_RESERVED_WIDTH = 88 + 12 + 200;
export function defaultPanelWidths(viewport: number): PanelWidths {
  return viewport <= 1100
    ? { layers: 190, inspector: 230 }
    : viewport >= 1600
      ? { layers: 250, inspector: 285 }
      : { layers: 230, inspector: 268 };
}
export function fitPanelWidths(
  input: PanelWidths,
  viewport: number,
  visible:Record<keyof PanelWidths,boolean>={layers:true,inspector:true},
): PanelWidths {
  const widths = {
    layers: Math.max(PANEL_MIN.layers, Math.min(PANEL_MAX, input.layers)),
    inspector: Math.max(
      PANEL_MIN.inspector,
      Math.min(PANEL_MAX, input.inspector),
    ),
  };
  const excess =
    (visible.layers?widths.layers:0) +
    (visible.inspector?widths.inspector:0) -
    (Math.max(760, viewport) - panelReservedWidth(visible));
  if (excess > 0) {
    const available =
      (visible.layers?widths.layers-PANEL_MIN.layers:0) + (visible.inspector?widths.inspector-PANEL_MIN.inspector:0);
    const reduction = Math.ceil(
      (excess * (visible.layers?widths.layers - PANEL_MIN.layers:0)) / available,
    );
    widths.layers -= reduction;
    widths.inspector -= excess - reduction;
  }
  return {
    layers: Math.round(widths.layers),
    inspector: Math.round(widths.inspector),
  };
}
export function panelReservedWidth(visible:Record<keyof PanelWidths,boolean>):number{
 return 88+200+6*(Number(visible.layers)+Number(visible.inspector));
}
export function readPanelWidths(
  storage: Pick<Storage, "getItem">,
): PanelWidths | null {
  const raw = storage.getItem(PANEL_LAYOUT_KEY);
  if (raw === null) return null;
  const saved = JSON.parse(raw);
  if (
    !saved ||
    saved.version !== 1 ||
    !Number.isFinite(saved.layers) ||
    !Number.isFinite(saved.inspector) ||
    saved.layers < PANEL_MIN.layers ||
    saved.inspector < PANEL_MIN.inspector ||
    saved.layers > PANEL_MAX ||
    saved.inspector > PANEL_MAX
  )
    throw new Error(
      "Saved panel widths are invalid. Resize a panel to save a new layout.",
    );
  return { layers: saved.layers, inspector: saved.inspector };
}
