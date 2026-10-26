import {textPathSchema,type TextPathData,type TextPathInput} from '../core/text-path';

/** Immutable authored baseline value. Attached text mutations go through
 * TextLayer commands; a returned value never mutates its source document. */
export class TextPath {
 private readonly data:TextPathData;
 constructor(options:TextPathInput){this.data=textPathSchema.parse(options);for(const point of this.data.points){Object.freeze(point.in);Object.freeze(point.out);Object.freeze(point);}Object.freeze(this.data.points);Object.freeze(this.data);Object.freeze(this);}
 get points(){return structuredClone(this.data.points);}
 get closed(){return this.data.closed;}
 get startOffset(){return this.data.startOffset;}
 get baselineOffset(){return this.data.baselineOffset;}
 get reverse(){return this.data.reverse;}
 with(changes:Partial<TextPathInput>):TextPath{return new TextPath({...this.data,...changes});}
 toJSON():TextPathData{return structuredClone(this.data);}
}
