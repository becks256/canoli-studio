import { coverageOutline, type PixelCoverage } from '../core/pixel-selection';
self.onmessage = ({data}: MessageEvent<PixelCoverage[]>) => {
  try { self.postMessage({paths:data.map(coverageOutline)}); }
  catch(error) { self.postMessage({error:error instanceof Error ? error.message : 'Selection outline failed.'}); }
};
