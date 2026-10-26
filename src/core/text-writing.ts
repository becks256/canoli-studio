import {z} from 'zod';

export const writingModeSchema=z.enum(['horizontal-tb','vertical-rl','vertical-lr']);
export const textOrientationSchema=z.enum(['mixed','upright','sideways']);
export type WritingMode=z.infer<typeof writingModeSchema>;
export type TextOrientation=z.infer<typeof textOrientationSchema>;
/** Private native layout settings, separate from logical source and affine placement. */
export const textWritingSchema=z.object({mode:writingModeSchema.default('horizontal-tb'),orientation:textOrientationSchema.default('mixed')}).strict();
export type TextWriting=z.output<typeof textWritingSchema>;
export type TextWritingInput=z.input<typeof textWritingSchema>;
export const verticalWriting=(writing?:Readonly<TextWriting>)=>!!writing&&writing.mode!=='horizontal-tb';
export function applyNativeTextWriting(node:SVGTextElement,writing?:Readonly<TextWriting>){
 if(!writing)return;
 if(verticalWriting(writing)&&(typeof CSS==='undefined'||!CSS.supports('writing-mode',writing.mode)||!CSS.supports('text-orientation',writing.orientation)))throw new Error('Native vertical text is unavailable on this browser.');
 node.style.writingMode=writing.mode;
 node.style.textOrientation=writing.orientation;
}
