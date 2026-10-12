import type { EditorApplication } from './editor';
import { MarqueeSelection, RasterLayer, PaintLayer } from './dom';
import { layerBounds } from './core/spatial';
import type { SelectionOperation } from './core/drawing';
import { retouchSampleDocument, retouchViewDocument, sampleRetouchRegion } from './engine/retouch-sampling';
import type { DocumentData } from './core/model';
import type { LayerData } from './core/model';
import { release } from './engine/canvas';

/** A clicked thumbnail remains useful when its layer or ancestors are hidden. */
export function transparencySource(document: DocumentData, layerId: string): DocumentData {
  const source = retouchViewDocument(document, { mode: 'current-layer', layerId });
  const reveal = (nodes: LayerData[]): LayerData[] => nodes.map(layer =>
    layer.kind === 'group' ? { ...layer, visible: true, children: reveal(layer.children) }
      : layer.visible ? layer : { ...layer, visible: true });
  return { ...source, selection: null, children: reveal(source.children) };
}

/** Native-resolution pixel operations; sources and clipboard bytes are immutable. */
export class RasterEditing {
  private clipboard?: { blob: Blob; x: number; y: number; name: string };
  constructor(private editor: EditorApplication) {}
  get canPaste() { return !!this.clipboard; }
  private async capture(layerId = this.editor.document.selectedLayer?.id, includePaint = false) {
    const document = this.editor.document, assets = this.editor.assetStore;
    const layer = layerId ? document.getLayer(layerId) : null;
    if (!(layer instanceof RasterLayer) && !(includePaint && layer instanceof PaintLayer))
      throw new Error(includePaint ? 'Select an image or paint layer first.' : 'Select an imported raster image first.');
    const snapshot = document.getSnapshot(), selectedId = snapshot.selectedId;
    const alive = assets.captureLifetime();
    const assertCurrent = () => {
      alive();
      if (this.editor.document !== document || document.getSnapshot().revision !== snapshot.revision || document.getSnapshot().selectedId !== selectedId)
        throw new Error('The document or selected layer changed while reading pixels. Try again.');
    };
    const bounds = layerBounds(snapshot.document, layer.id) ?? { x: 0, y: 0, width: 1, height: 1 };
    const x = Math.max(0, Math.floor(bounds.x)), y = Math.max(0, Math.floor(bounds.y));
    const width = Math.min(document.width, Math.ceil(bounds.x + bounds.width)) - x;
    const height = Math.min(document.height, Math.ceil(bounds.y + bounds.height)) - y;
    if (width <= 0 || height <= 0) throw new Error('The image is outside the canvas.');
    const region = { x, y, width, height };
    const source = includePaint ? transparencySource(snapshot.document, layer.id)
      : retouchSampleDocument(snapshot.document, { mode: 'current-layer', layerId: layer.id });
    const pixels = await sampleRetouchRegion(source, assets, this.editor.renderer, region);
    assertCurrent();
    return { document, assets, layer, snapshot, assertCurrent, region, pixels };
  }
  /** Bounded preview allocation, independent of source resolution. */
  async thumbnail(source: DocumentData, layerId: string): Promise<string> {
    const assets = this.editor.assetStore;
    const alive = assets.captureLifetime();
    const bounds = layerBounds(source, layerId) ?? { x: 0, y: 0, width: 1, height: 1 };
    const scale = Math.min(1, 64 / Math.max(bounds.width, bounds.height));
    const canvas = await this.editor.renderer.render(source, assets, {
      region: bounds,
      outputSize: { width: Math.max(1, Math.ceil(bounds.width * scale)), height: Math.max(1, Math.ceil(bounds.height * scale)) },
      cache: true,
    });
    try { alive(); return canvas.toDataURL('image/png'); }
    finally { release(canvas); }
  }
  async loadTransparency(layerId?: string): Promise<void> {
    const captured = await this.capture(layerId, true);
    const { pixels, region, document } = captured;
    const coverage = await this.editor.renderer.processor.selectionCoverage(pixels, { width: region.width, height: region.height });
    captured.assertCurrent();
    document.selection = new MarqueeSelection({ ...region, shape: 'pixels', coverage });
  }
  async wand(point: { x: number; y: number }, options: { tolerance?: number; contiguous?: boolean; operation?: 'replace' | SelectionOperation } = {}): Promise<void> {
    const settings = { ...options }, click = { ...point };
    const captured = await this.capture();
    const { region, pixels, document } = captured;
    const coverage = await this.editor.renderer.processor.selectionCoverage(pixels, {
      width: region.width, height: region.height,
      wand: { x: click.x-region.x, y: click.y-region.y, tolerance: settings.tolerance, contiguous: settings.contiguous },
    });
    const next = new MarqueeSelection({ ...region, shape: 'pixels', coverage });
    captured.assertCurrent();
    document.selection = settings.operation && settings.operation !== 'replace'
      ? (document.selection ?? new MarqueeSelection()).combine(next, settings.operation) : next;
  }
  async copy(): Promise<void> {
    const captured = await this.capture();
    const { region, pixels, snapshot } = captured;
    const copied = await this.editor.renderer.processor.clipboardPixels(pixels, { ...region, selection: snapshot.document.selection });
    captured.assertCurrent();
    this.clipboard = { blob: copied.blob, x: region.x+copied.x, y: region.y+copied.y, name: captured.layer.name };
  }
  async paste(): Promise<void> {
    const copied = this.clipboard;
    if (!copied) throw new Error('Copy image pixels first.');
    const document = this.editor.document, assets = this.editor.assetStore, revision = document.getSnapshot().revision;
    const alive = assets.captureLifetime();
    const asset = await assets.add(copied.blob, `${copied.name} copy`, undefined, false);
    let committed = false;
    try {
      alive();
      if (document !== this.editor.document || revision !== document.getSnapshot().revision) throw new Error('The document changed while pasting. Try again.');
      const layer = new RasterLayer({ name: `${copied.name.slice(0,230)} copy`, assetId: asset.id, width: asset.width, height: asset.height, x: copied.x, y: copied.y });
      document.transaction('Paste pixels', () => { document.layers.add(layer); });
      document.selectedLayer = layer;
      committed = true;
    } finally { if (!committed) assets.remove(asset.id); }
  }
}
