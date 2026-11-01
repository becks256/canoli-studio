import createFontDecoder from './canoli_font_decoder.js';
import wasmBinary from './canoli_font_decoder.wasm';
export default ()=>createFontDecoder({wasmBinary});
