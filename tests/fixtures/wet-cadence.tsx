import { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { EditorApplication } from '../../src/editor';
import type { WetPaintPreview } from '../../src/engine/wet-preview';
import { useCanvasRenderer } from '../../src/ui/hooks/useCanvasRenderer';

/** Mount the real renderer hook with independently prepared native prefixes.
 * Its frame clock is controlled without blocking pointer sample batching. */
export function createWetCadenceHarness(editor: EditorApplication) {
  const element = document.createElement('div'); element.dataset.testid = 'wet-cadence-fixture'; Object.assign(element.style, { position: 'fixed', top: '0', left: '0', zIndex: '99999' }); document.body.append(element);
  const root = createRoot(element), region = { x: 0, y: 0, width: 128, height: 96 };
  const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame, prepare = editor.renderer.prepareViewport;
  const held = new Map<number, FrameRequestCallback>(); let next = 10_000_000, starts = 0, rendering = false;
  editor.renderer.prepareViewport = function (...args) { if (args[2]?.region === region) starts++; return prepare.apply(this, args); };
  function View({ frame }: { frame: WetPaintPreview | null }) {
    const host = useRef<HTMLDivElement>(null);
    const result = useCanvasRenderer({ editor, viewDocument: frame?.document ?? editor.document._read(), assets: frame?.assets ?? editor.assetStore, renderRegion: region, zoom: 1, paintPreview: undefined, wetPreview: frame, backendState: editor.renderer.getBackendSnapshot(), displayHost: host, onError: error => { throw new Error(error); } });
    rendering = result.rendering;
    return <div ref={host} />;
  }
  const restore = () => {
    window.requestAnimationFrame = request; window.cancelAnimationFrame = cancel;
    const callbacks = [...held.values()]; held.clear(); callbacks.forEach(callback => request.call(window, callback));
  };
  return {
    get starts() { return starts; }, get rendering() { return rendering; },
    show(frame: WetPaintPreview | null) { flushSync(() => root.render(<View frame={frame} />)); },
    pause() {
      starts = 0;
      window.requestAnimationFrame = callback => { const id = ++next; held.set(id, callback); return id; };
      window.cancelAnimationFrame = id => { if (!held.delete(id)) cancel.call(window, id); };
    },
    releaseFrame() { const callbacks = [...held.values()]; held.clear(); const at = performance.now(); callbacks.forEach(callback => callback(at)); },
    restore,
    pixel(x: number) { const canvas = element.querySelector('canvas'); return canvas ? [...canvas.getContext('2d')!.getImageData(x, 40, 1, 1).data] : []; },
    dispose() { restore(); flushSync(() => root.unmount()); editor.renderer.prepareViewport = prepare; element.remove(); },
  };
}
