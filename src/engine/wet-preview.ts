import type { AssetStore } from '../core/assets';
import type { EditorCommand } from '../core/commands';
import { freeze } from '../core/immutable';
import type { DocumentData } from '../core/model';
import type { WetPaintStroke } from '../dom';

export interface WetPreviewOwner { isCurrent(): boolean; }

/** A prepared viewport prefix owns its decoded assets independently of the
 * running gesture. Render jobs retain a lease before asynchronous preparation;
 * retiring the tool's reference cannot close pixels still used by that job. */
export class WetPaintPreview {
  private references = 1;
  private retired = false;
  private closed = false;
  readonly document: DocumentData;
  readonly command: EditorCommand;
  constructor(
    readonly owner: WetPreviewOwner,
    readonly hostAssets: AssetStore,
    readonly assets: AssetStore,
    document: DocumentData,
    command: EditorCommand,
    readonly operation: WetPaintStroke,
    readonly version: number,
  ) { this.document = freeze(document); this.command = freeze(command); }
  get isDisposed() { return this.closed; }
  isCurrent() { return !this.closed && this.owner.isCurrent(); }
  retain(): () => void {
    if (this.closed) throw new Error('Wet-paint preview is disposed.');
    this.references++; let released = false;
    return () => { if (!released) { released = true; this.release(); } };
  }
  private release() { if (--this.references === 0) { this.closed = true; this.assets.dispose(); } }
  /** Release the creator's reference once. Render leases remain independent. */
  dispose() { if (!this.retired) { this.retired = true; this.release(); } }
}
