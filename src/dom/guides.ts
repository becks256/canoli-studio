import type { Document } from "./index";
import { id } from "../core/model";
import { guideSchema, type GuideData } from "../core/guides";

/** Immutable guide value. Attached edits are made through Document.guides. */
export class Guide {
  readonly id: string;
  readonly orientation: GuideData["orientation"];
  readonly position: number;
  constructor(options: {
    id?: string;
    orientation: GuideData["orientation"];
    position: number;
  }) {
    const data = guideSchema.parse({ ...options, id: options.id ?? id() });
    this.id = data.id;
    this.orientation = data.orientation;
    this.position = data.position;
    Object.freeze(this);
  }
  toJSON(): GuideData {
    return {
      id: this.id,
      orientation: this.orientation,
      position: this.position,
    };
  }
}

export class GuideCollection {
  constructor(private readonly document: Document) {}
  get length() {
    return this.document.getSnapshot().document.guides?.length ?? 0;
  }
  get items(): Guide[] {
    return (this.document.getSnapshot().document.guides ?? []).map(
      (data) => new Guide(data),
    );
  }
  add(guide: Guide): Guide {
    if (!(guide instanceof Guide))
      throw new Error("Expected a Guide constructor instance.");
    this.document._dispatch({
      type: "document.guides",
      guides: [...this.items.map((item) => item.toJSON()), guide.toJSON()],
    });
    return guide;
  }
  update(
    id: string,
    options: Partial<Pick<GuideData, "orientation" | "position">>,
  ): Guide {
    const current = this.items;
    const index = current.findIndex((guide) => guide.id === id);
    if (index < 0) throw new Error("Guide not found.");
    const updated = new Guide({ ...current[index].toJSON(), ...options, id });
    current[index] = updated;
    this.document._dispatch({
      type: "document.guides",
      guides: current.map((guide) => guide.toJSON()),
    });
    return updated;
  }
  remove(id: string): void {
    const current = this.items;
    if (!current.some((guide) => guide.id === id))
      throw new Error("Guide not found.");
    this.document._dispatch({
      type: "document.guides",
      guides: current
        .filter((guide) => guide.id !== id)
        .map((guide) => guide.toJSON()),
    });
  }
  clear(): void {
    if (this.length)
      this.document._dispatch({ type: "document.guides", guides: [] });
  }
}
