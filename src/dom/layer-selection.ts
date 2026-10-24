import type { DistributionAxis, DistributionMode, LayerAlignment, AlignmentTarget } from "../core/layer-layout";
import { AffineTransform } from "../core/affine";
import {Layer,type Document} from "./index";
import { findParent, isLocked } from "../core/model";
import {
  layerTransform,
  layerBounds,
  unionBounds,
  parentSpaceDelta,
} from "../core/spatial";
export type {LayerAlignment} from '../core/layer-layout';
export type LayerAlignmentReference='selection'|'canvas'|Layer;
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
    const doc = this.document._read();
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
    const doc = this.document._read();
    return unionBounds(
      this.rootLayers.flatMap((layer) => {
        const bounds = layerBounds(doc, layer.id);
        return bounds ? [bounds] : [];
      }),
    );
  }
  private editableRoots() {
    const layers = this.rootLayers,
      doc = this.document._read();
    if (layers.some((layer) => isLocked(doc, layer.id)))
      throw new Error("Selection contains a locked layer.");
    return layers;
  }
  translate(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error("Translation must be finite.");
    const layers = this.editableRoots(),
      snapshot = this.document._read();
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
      snapshot = this.document._read();
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
  align(alignment:LayerAlignment,reference:LayerAlignmentReference='selection') {
    let target:AlignmentTarget;
    if(typeof reference==='string')target={type:reference};
    else{
      if(!(reference instanceof Layer)||reference.document!==this.document||!reference.isAttached)throw new Error('The alignment key must be an attached layer from this document.');
      target={type:'layer',id:reference.id};
    }
    this.document._dispatch({type:'layer.align',ids:this.layers.map(layer=>layer.id),alignment,target});
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
