import {DEFAULT_COLOR_SETTINGS} from '../core/color/color-settings';
import type { Document } from "../dom";
import type { AssetStore } from "../core/assets";
import { id } from "../core/model";
import { RecoveryController } from "../core/recovery-controller";
import type { StandardRgbSpaceId, SoftProofOptions } from "../core/color/types";

/** Owns one editable document's durable sources and ephemeral workspace state. */
export class DocumentSession {
  readonly id = id();
  readonly recovery = new RecoveryController();
  savedRevision = 0;
  view = { zoom: 0.5, pan: { x: 0, y: 0 }, initialized: false };
  colorProfile: StandardRgbSpaceId = "srgb";
  softProof: SoftProofOptions | null = null;
  colorSettings = DEFAULT_COLOR_SETTINGS;
  colorWarnings:readonly string[]=[];
  private unsubscribe: () => void;
  constructor(
    readonly document: Document,
    readonly assets: AssetStore,
    private readonly changed: () => void,
  ) {
    document.assetStore = assets;
    let observed = document.getSnapshot().document;
    this.unsubscribe = document.subscribe(() => {
      const current = document.getSnapshot().document;
      if (current !== observed) {
        observed = current;
        if(current.precision==='float32'&&this.colorSettings.proof){
          this.colorSettings=Object.freeze({...this.colorSettings,proof:null});this.softProof=null;
          this.colorWarnings=Object.freeze([...this.colorWarnings,'Soft proofing is disabled for float editing until its precision integration is available.']);
        }
        this.recovery.schedule(this.id, current, assets);
      }
      changed();
    });
  }
  get dirty() {
    return this.savedRevision !== this.document.getSnapshot().revision;
  }
  viewChanged() {
    this.changed();
  }
  dispose() {
    this.unsubscribe();
    this.recovery.dispose();
    this.assets.dispose();
  }
}
