import { authoredMetadataSchema, emptyMetadata } from "../core/metadata";
import type { AuthoredMetadataData } from "../core/metadata";
import type { Layer } from "./index";

/** Authored layer metadata is separate from immutable embedded file declarations. */
export class LayerMetadata {
  private data: AuthoredMetadataData;
  private layer?: Layer;
  constructor(values: Partial<AuthoredMetadataData> = {}) {
    this.data = authoredMetadataSchema.parse({ ...emptyMetadata(), ...values });
  }
  static _attached(layer: Layer) {
    const value = new LayerMetadata();
    value.layer = layer;
    return value;
  }
  toJSON(): AuthoredMetadataData {
    return structuredClone(
      this.layer
        ? (this.layer.toJSON().metadata ?? emptyMetadata())
        : this.data,
    );
  }
  update(values: Partial<AuthoredMetadataData>) {
    const next = authoredMetadataSchema.parse({ ...this.toJSON(), ...values });
    if (this.layer) this.layer.update({ metadata: next });
    else this.data = next;
  }
  reset() {
    if (this.layer) this.layer.update({ metadata: null });
    else this.data = emptyMetadata();
  }
  get title() {
    return this.toJSON().title;
  }
  set title(value: string) {
    this.update({ title: value });
  }
  get description() {
    return this.toJSON().description;
  }
  set description(value: string) {
    this.update({ description: value });
  }
  get altText() {
    return this.toJSON().altText;
  }
  set altText(value: string) {
    this.update({ altText: value });
  }
  get creator() {
    return this.toJSON().creator;
  }
  set creator(value: string) {
    this.update({ creator: value });
  }
  get copyright() {
    return this.toJSON().copyright;
  }
  set copyright(value: string) {
    this.update({ copyright: value });
  }
  get license() {
    return this.toJSON().license;
  }
  set license(value: string) {
    this.update({ license: value });
  }
  get keywords() {
    return this.toJSON().keywords;
  }
  set keywords(value: string[]) {
    this.update({ keywords: value });
  }
}
