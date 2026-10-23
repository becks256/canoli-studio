import {expect,type Page} from '@playwright/test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {resolve} from 'node:path';
import type {DocumentData} from '../../src/core/model';

export interface ConnectedView {document:DocumentData;revision:number;canUndo:boolean;canRedo:boolean;history:{past:string[];future:string[]};selectedIds:string[];interactionPending:boolean}
export async function chatGptClient(){
 const plugin=resolve('integrations/chatgpt/marketplace/plugins/canoli-studio'),transport=new StdioClientTransport({command:process.execPath,args:[resolve(plugin,'server/index.mjs')],cwd:plugin,stderr:'pipe'}),client=new Client({name:'canoli-browser-integration-test',version:'1.0.0'});await client.connect(transport);
 return{client,async close(){await client.close();await transport.close();}};
}
export async function connectChatGpt(page:Page,client:Client,write=false){
 const pairing=await client.callTool({name:'canoli_begin_connection',arguments:{}}),code=(pairing.structuredContent as{connectionCode:string}).connectionCode;
 let dialog=page.getByRole('dialog',{name:'ChatGPT connection',exact:true});if(!await dialog.count())await page.getByRole('button',{name:'ChatGPT connection',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'ChatGPT connection',exact:true});await dialog.getByLabel('Canoli connection code',{exact:true}).fill(code);await dialog.getByRole('checkbox',{name:'Allow edits and undo/redo in this document',exact:true}).setChecked(write);await dialog.getByRole('button',{name:'Connect selected document',exact:true}).click();await expect(dialog.getByLabel('Canoli connection code',{exact:true})).toHaveValue('');await expect(dialog.getByText(write?'Connected · reading and editing allowed':'Connected · read-only',{exact:true}).last()).toBeVisible();await dialog.getByRole('button',{name:'Done',exact:true}).click();
 const result=await client.callTool({name:'canoli_list_documents',arguments:{}}),connections=(result.structuredContent as{connections:{connectionId:string}[]}).connections;expect(connections).toHaveLength(1);return connections[0].connectionId;
}
export async function readConnected(client:Client,connectionId:string):Promise<ConnectedView>{const result=await client.callTool({name:'canoli_read_document',arguments:{connectionId}});expect(result.isError).not.toBe(true);return(result.structuredContent as{ok:true;value:ConnectedView}).value;}
export async function scriptedCanoliArtwork(page:Page){
 await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();await page.getByLabel('Script code',{exact:true}).fill("document.resize(400,300);const layer=document.layers.add(new PaintLayer({name:'Target',x:40,y:30}));layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:120,height:90},color:'#ff0000'}));document.selectedLayer=layer;print('Connected artwork ready');");await page.getByRole('button',{name:'Run script',exact:true}).click();await expect(page.getByLabel('Script output')).toContainText('Connected artwork ready');await page.getByRole('button',{name:'Close scripts',exact:true}).click();
}
