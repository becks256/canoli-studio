import type { DistributionAxis, DistributionMode } from "../core/layer-layout";
import { AffineTransform } from "../core/affine";
import type { Document, Layer } from "./index";
import { findParent, isLocked } from "../core/model";
import {
  layerTransform,
  layerBounds,
  unionBounds,
  parentSpaceDelta,
} from "../core/spatial";
export type LayerAlignment =
  "left" | "center" | "right" | "top" | "middle" | "bottom";
/** Document-owned layer selection, independent of the pixel marquee. */
export class LayerSelection {
  constructor(private readonly document: Document) {}
  get layers() {
    return this.document.selectedLayers;
  }
  get activeLayer() {
    return this.document.selectedLayer;
  }
  select(layers: Layer[], mode: "replace" | "add" | "remove" = "replace") {
    this.document.selectLayers(layers, mode);
  }
  clear() {
    this.select([]);
  }
  get rootLayers() {
    const doc = this.document.toJSON();
    const layers = this.layers,
      ids = new Set(layers.map((layer) => layer.id));
    return layers.filter((layer) => {
      let parent = findParent(doc.children, layer.id);
      while (parent) {
        if (ids.has(parent)) return false;
        parent = findParent(doc.children, parent);
      }
      return true;
    });
  }
  get bounds() {
    const doc = this.document.toJSON();
    return unionBounds(
      this.rootLayers.flatMap((layer) => {
        const bounds = layerBounds(doc, layer.id);
        return bounds ? [bounds] : [];
      }),
    );
  }
  private editableRoots() {
    const layers = this.rootLayers,
      doc = this.document.toJSON();
    if (layers.some((layer) => isLocked(doc, layer.id)))
      throw new Error("Selection contains a locked layer.");
    return layers;
  }
  translate(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error("Translation must be finite.");
    const layers = this.editableRoots(),
      snapshot = this.document.toJSON();
    this.document.transaction("Move selected layers", () => {
      for (const layer of layers) {
        const delta = parentSpaceDelta(snapshot, layer.id, { x, y });
        layer.update({ x: layer.x + delta.x, y: layer.y + delta.y });
      }
    });
  }
  /** Rotate selected roots in canvas space around their shared geometric center. */
  rotate(degrees: number) {
    if (!Number.isFinite(degrees)) throw new Error("Rotation must be finite.");
    if (degrees % 360 === 0) return;
    this.transformAroundCenter(
      AffineTransform.rotation(((degrees % 360) * Math.PI) / 180),
      "Rotate selected layers",
    );
  }
  /** Positive factors scale editable artwork in canvas space; y defaults to x. */
  scale(x: number, y = x) {
    if (![x, y].every((value) => Number.isFinite(value) && value > 0))
      throw new Error("Scale factors must be finite and positive.");
    if (x === 1 && y === 1) return;
    this.transformAroundCenter(
      AffineTransform.scale(x, y),
      "Scale selected layers",
    );
  }
  private transformAroundCenter(transform: AffineTransform, label: string) {
    const layers = this.editableRoots(),
      snapshot = this.document.toJSON();
    if (!layers.length) return;
    const bounds = layers.map((layer) => layerBounds(snapshot, layer.id));
    if (bounds.some((value) => !value))
      throw new Error("Every transformed layer must have geometric bounds.");
    const union = unionBounds(bounds.map((value) => value!))!;
    const around = transform.around({
      x: union.x + union.width / 2,
      y: union.y + union.height / 2,
    });
    const changes = layers.map((layer) => {
      const parent = findParent(snapshot.children, layer.id);
      const world = around.multiply(layerTransform(snapshot, layer.id)!);
      return {
        layer,
        transform: parent
          ? layerTransform(snapshot, parent)!.inverse().multiply(world)
          : world,
      };
    });
    this.document.transaction(label, () => {
      for (const { layer, transform } of changes) layer.transform = transform;
    });
  }
  align(alignment: LayerAlignment) {
    if (
      !["left", "center", "right", "top", "middle", "bottom"].includes(
        alignment,
      )
    )
      throw new Error("Unknown layer alignment.");
    const layers = this.editableRoots(),
      doc = this.document.toJSON();
    const items = layers.map((layer) => ({
      layer,
      bounds: layerBounds(doc, layer.id),
    }));
    if (items.some((item) => !item.bounds))
      throw new Error("Every aligned layer must have geometric bounds.");
    const bounds = unionBounds(items.map((item) => item.bounds!));
    if (!bounds) return;
    this.document.transaction("Align selected layers", () => {
      for (const { layer, bounds: b } of items) {
        const dx =
          alignment === "left"
            ? bounds.x - b!.x
            : alignment === "right"
              ? bounds.x + bounds.width - b!.x - b!.width
              : alignment === "center"
                ? bounds.x + bounds.width / 2 - b!.x - b!.width / 2
                : 0;
        const dy =
          alignment === "top"
            ? bounds.y - b!.y
            : alignment === "bottom"
              ? bounds.y + bounds.height - b!.y - b!.height
              : alignment === "middle"
                ? bounds.y + bounds.height / 2 - b!.y - b!.height / 2
                : 0;
        const delta = parentSpaceDelta(doc, layer.id, { x: dx, y: dy });
        layer.update({ x: layer.x + delta.x, y: layer.y + delta.y });
      }
    });
  }
  flip(axis: DistributionAxis) {
    this.document._dispatch({
      type: "layer.flip",
      ids: this.rootLayers.map((layer) => layer.id),
      axis,
    });
  }
  distribute(axis: DistributionAxis, mode: DistributionMode = "gaps") {
    this.document._dispatch({
      type: "layer.distribute",
      ids: this.rootLayers.map((layer) => layer.id),
      axis,
      mode,
    });
  }
  remove() {
    const layers = this.editableRoots();
    this.document.transaction("Delete selected layers", () => {
      for (const layer of layers) layer.remove();
    });
  }
}
