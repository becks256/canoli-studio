import { alphaChannelSchema, type AlphaChannelData, type ChannelLoadOptions, type ChannelLoadControl } from '../core/alpha-channels';
import { id } from '../core/model';
import { Document, MarqueeSelection } from './index';

/** Stable-ID channel handles use the same attached command boundary as layers. */
export class AlphaChannel {
  readonly id: string;
  private owner?: Document;
  private initial: AlphaChannelData;
  constructor(options: {name?:string;selection?:MarqueeSelection} = {}) {
    if(options.selection !== undefined && !(options.selection instanceof MarqueeSelection))throw new Error('Expected a MarqueeSelection constructor instance.');
    this.id=id();
    this.initial=alphaChannelSchema.parse({id:this.id,name:options.name??'Alpha channel',selection:options.selection?.toJSON()??{regions:[]}});
  }
  private read(): AlphaChannelData {
    if(!this.owner)return this.initial;
    const data=this.owner.getSnapshot().document.alphaChannels?.find(channel=>channel.id===this.id);
    if(!data)throw new Error('Alpha channel is no longer attached to this document.');
    return data;
  }
  private write(data:AlphaChannelData):void {
    const next=alphaChannelSchema.parse(data);
    if(this.owner){this.read();this.owner._dispatch({type:'alphaChannel.set',channel:next});}
    else this.initial=next;
  }
  get name(){return this.read().name;}
  set name(name:string){this.write({...this.read(),name});}
  get selection(){return new MarqueeSelection(this.read().selection);}
  set selection(selection:MarqueeSelection){
    if(!(selection instanceof MarqueeSelection))throw new Error('Expected a MarqueeSelection constructor instance.');
    this.write({...this.read(),selection:selection.toJSON()});
  }
  toJSON():AlphaChannelData{return structuredClone(this.read());}
  captureSelection():void {
    this.read();const selection=this.owner?.selection;
    if(!selection)throw new Error('Create a selection before updating an alpha channel.');
    this.selection=selection;
  }
  async load(options:ChannelLoadOptions={},control:ChannelLoadControl={}):Promise<void> {
    this.read();if(!this.owner)throw new Error('Attach the alpha channel before loading it.');
    await this.owner._loadAlphaChannel(this.id,options,control);
  }
  duplicate(name=`${this.name} copy`.slice(0,240)):AlphaChannel {
    const copy=new AlphaChannel({name,selection:this.selection});
    return this.owner?this.owner.alphaChannels.add(copy):copy;
  }
  move(direction:'up'|'down'):void {
    this.read();if(!this.owner)throw new Error('Attach the alpha channel before moving it.');
    this.owner._dispatch({type:'alphaChannel.reorder',id:this.id,direction});
  }
  remove():void {
    this.read();if(!this.owner)throw new Error('Alpha channel is not attached.');
    this.owner._dispatch({type:'alphaChannel.remove',id:this.id});
  }
  /** @internal */
  _add(document:Document):void {
    if(this.owner)throw new Error('Alpha channel is already attached.');
    document._dispatch({type:'alphaChannel.set',channel:this.toJSON()});this.owner=document;
  }
  /** @internal */
  static _attached(document:Document,data:AlphaChannelData):AlphaChannel {
    const channel=new AlphaChannel({name:data.name});Object.defineProperty(channel,'id',{value:data.id});channel.owner=document;return channel;
  }
}

export class AlphaChannelCollection implements Iterable<AlphaChannel> {
  constructor(private readonly document:Document){}
  get length(){return this.document.getSnapshot().document.alphaChannels?.length??0;}
  get items(){return (this.document.getSnapshot().document.alphaChannels??[]).map(data=>AlphaChannel._attached(this.document,data));}
  [Symbol.iterator](){return this.items[Symbol.iterator]();}
  at(index:number){return this.items.at(index);}
  getById(id:string){return this.items.find(channel=>channel.id===id);}
  add(channel:AlphaChannel):AlphaChannel {
    if(!(channel instanceof AlphaChannel))throw new Error('Expected an AlphaChannel constructor instance.');
    channel._add(this.document);return channel;
  }
  capture(name='Alpha channel'):AlphaChannel {
    const selection=this.document.selection;
    if(!selection)throw new Error('Create a selection before saving an alpha channel.');
    return this.add(new AlphaChannel({name,selection}));
  }
}
