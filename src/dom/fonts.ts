import type {Document} from './index';
import {documentFontUsage,fontFamilyRequestSchema} from '../core/font-management';

/** Font requests used by this document and all of its stored embedded scopes. */
export class DocumentFonts {
  constructor(private readonly document:Document){}
  get items(){return documentFontUsage(this.document._read());}
  replace(from:string,to:string):void{
    this.document._dispatch({type:'document.font.replace',from:fontFamilyRequestSchema.parse(from),to:fontFamilyRequestSchema.parse(to)});
  }
}
