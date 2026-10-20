import type { AssetStore } from '../src/core/assets';
import type { WetAssetProvider, WetImageSource } from '../src/core/wet-assets';
import { openPngRows } from './png-rows';

/** The existing explicit headless sRGB8 PNG decoder supplies the same native
 * alpha invariant as browser decoding, without claiming browser synchronization. */
export function wetServerAssets(assets: AssetStore, check: () => void = () => {}): WetAssetProvider {
  const lifetime = assets.captureLifetime();
  return {
    get(id) { const source = assets.get(id); return { blob: source.blob, width: source.width, height: source.height, identity: source }; },
    check() { lifetime(); check(); },
    async *alpha(source: WetImageSource) {
      check(); lifetime(); const bytes = new Uint8Array(await source.blob.arrayBuffer()); check(); lifetime(); const image = openPngRows(bytes);
      if (image.width !== source.width || image.height !== source.height) throw new Error('Wet-paint PNG dimensions changed.');
      for await (const strip of image.strips) { check(); lifetime(); const alpha = new Uint8Array(strip.width * strip.height); for (let p = 0; p < alpha.length; p++) alpha[p] = strip.pixels[p * 4 + 3]; yield alpha; }
    },
  };
}
