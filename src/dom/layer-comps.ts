import { z } from "zod";
import type { Document } from "./index";
import { id } from "../core/model";
import {
  captureLayerComp,
  layerCompOptionsSchema,
  planLayerComp,
} from "../core/layer-comps";
import type { LayerCompData, LayerCompOptions } from "../core/layer-comps";

export class LayerComp {
  readonly id = id();
  private owner?: Document;
  private initialName: string;
  private initialOptions: LayerCompOptions;
  constructor(options: { name?: string } & Partial<LayerCompOptions> = {}) {
    this.initialName = z
      .string()
      .min(1)
      .max(240)
      .parse(options.name ?? "Layer comp");
    this.initialOptions = layerCompOptionsSchema.parse({
      visibility: options.visibility ?? true,
      position: options.position ?? true,
      appearance: options.appearance ?? true,
    });
  }
  private data(): LayerCompData {
    const data = this.owner
      ?.getSnapshot()
      .document.layerComps?.find((comp) => comp.id === this.id);
    if (!data) throw new Error("Layer comp is not attached to this document.");
    return data;
  }
  get name(): string {
    return this.owner ? this.data().name : this.initialName;
  }
  set name(name: string) {
    name = z.string().min(1).max(240).parse(name);
    if (this.owner)
      this.owner._dispatch({
        type: "layerComp.set",
        comp: { ...this.toJSON(), name },
      });
    else this.initialName = name;
  }
  get options(): LayerCompOptions {
    return structuredClone(
      this.owner ? this.data().options : this.initialOptions,
    );
  }
  toJSON(): LayerCompData {
    return structuredClone(this.data());
  }
  apply(): { missingLayerIds: string[] } {
    const comp = this.toJSON();
    const { missingLayerIds } = planLayerComp(this.owner!.toJSON(), comp);
    this.owner!._dispatch({ type: "layerComp.apply", id: this.id });
    return { missingLayerIds };
  }
  recapture(): void {
    const current = this.toJSON();
    this.owner!._dispatch({
      type: "layerComp.set",
      comp: captureLayerComp(
        this.owner!.toJSON(),
        current.name,
        current.options,
        this.id,
      ),
    });
  }
  remove(): void {
    this.data();
    this.owner!._dispatch({ type: "layerComp.remove", id: this.id });
  }
  /** @internal */
  _add(document: Document): void {
    if (this.owner) throw new Error("Layer comp is already attached.");
    document._dispatch({
      type: "layerComp.set",
      comp: captureLayerComp(
        document.toJSON(),
        this.name,
        this.options,
        this.id,
      ),
    });
    this.owner = document;
  }
  /** @internal */
  static _attached(document: Document, data: LayerCompData): LayerComp {
    const comp = new LayerComp({ name: data.name, ...data.options });
    Object.defineProperty(comp, "id", { value: data.id });
    comp.owner = document;
    return comp;
  }
}

export class LayerCompCollection implements Iterable<LayerComp> {
  constructor(private readonly document: Document) {}
  get length(): number {
    return this.document.getSnapshot().document.layerComps?.length ?? 0;
  }
  get items(): LayerComp[] {
    return (this.document.getSnapshot().document.layerComps ?? []).map((data) =>
      LayerComp._attached(this.document, data),
    );
  }
  [Symbol.iterator](): Iterator<LayerComp> {
    return this.items[Symbol.iterator]();
  }
  at(index: number): LayerComp | undefined {
    return this.items.at(index);
  }
  getById(id: string): LayerComp | undefined {
    return this.items.find((comp) => comp.id === id);
  }
  add(comp: LayerComp): LayerComp {
    if (!(comp instanceof LayerComp))
      throw new Error("Expected a LayerComp constructor instance.");
    comp._add(this.document);
    return comp;
  }
}
