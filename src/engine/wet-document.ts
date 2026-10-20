import type { AssetStore } from '../core/assets';
import type { BrushStrokeData } from '../core/drawing';
import { freeze } from '../core/immutable';
import type { DocumentData } from '../core/model';
import type { RetouchSamplingOptions } from '../core/retouch/types';
import type { PixelProcessor } from './processor';
import { captureRasterExportSources } from './raster-export-source';
import type { DocumentRenderer } from './renderer';
import { retouchSampleDocument, sampleRetouchRegion } from './retouch-sampling';
import { prepareWetStroke, type WetStrokeOptions, type WetStrokeResult } from './wet-stroke';
import { createWetStrokeSession, type WetStrokeSession } from './wet-session';

/** Trusted internal preparation over a captured rendered composition/branch.
 * It publishes no document command or asset. Callers still own revision guards
 * and must commit the returned replacement through the shared command boundary. */
export function prepareDocumentWetStroke(document: DocumentData, assets: AssetStore, renderer: DocumentRenderer, processor: PixelProcessor, stroke: BrushStrokeData, sampling: RetouchSamplingOptions, options: Omit<WetStrokeOptions, 'assets'> = {}): Promise<WetStrokeResult> {
  const captured = capturedSource(document, assets, renderer, sampling, options);
  return prepareWetStroke(stroke, captured.read, processor, captured.options);
}

/** Read-only retained replay over captured rendered pixels; authoring still
 * requires a neutral target adapter and current revision/ownership validation. */
export function createDocumentWetStrokeSession(document: DocumentData, assets: AssetStore, renderer: DocumentRenderer, processor: PixelProcessor, stroke: BrushStrokeData, sampling: RetouchSamplingOptions, options: Omit<WetStrokeOptions, 'assets'> = {}): Promise<WetStrokeSession> {
  const captured = capturedSource(document, assets, renderer, sampling, options);
  return createWetStrokeSession(stroke, captured.read, processor, captured.options);
}

function capturedSource(document: DocumentData, assets: AssetStore, renderer: DocumentRenderer, sampling: RetouchSamplingOptions, options: Omit<WetStrokeOptions, 'assets'>) {
  const snapshot = freeze(retouchSampleDocument(document, sampling));
  const signal = options.signal;
  const checkSources = captureRasterExportSources(snapshot, assets, { signal }, 'wet-paint preparation');
  const external = options.check;
  const check = () => { external?.(); checkSources(); };
  check();
  const read = async (region: import('../core/drawing').Rect) => {
    check(); const pixels = await sampleRetouchRegion(snapshot, assets, renderer, region, signal); check(); return pixels;
  };
  return { read, options: { ...options, assets, signal, check } };
}
