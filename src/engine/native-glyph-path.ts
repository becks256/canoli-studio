/** Private resolved SVG baseline paint, not a public path mutation model.
 * Immutable path data is shared across glyphs rather than copying all anchors. */
export interface NativeGlyphPath {readonly data:string;readonly startOffset:number;readonly baselineOffset:number}
export function snapshotGlyphPath(path:NativeGlyphPath):Readonly<NativeGlyphPath>{
 if(typeof path.data!=='string'||!path.data.trim()||![path.startOffset,path.baselineOffset].every(Number.isFinite))throw new Error('Invalid native glyph baseline.');
 return Object.freeze({data:path.data,startOffset:path.startOffset,baselineOffset:path.baselineOffset});
}
