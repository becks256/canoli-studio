import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ChatGptHub} from './hub';
import {startChatGptBridge} from './http';
import {createChatGptMcpServer} from './mcp';

async function main(){
 const hub=new ChatGptHub(),bridge=await startChatGptBridge(hub),mcp=createChatGptMcpServer(hub,bridge.origin);let closing=false;
 const close=async()=>{if(closing)return;closing=true;try{await bridge.close();}finally{await mcp.close();}};
 mcp.server.onclose=()=>{void close();};process.once('SIGINT',()=>{void close();});process.once('SIGTERM',()=>{void close();});process.stdin.once('end',()=>{void close();});
 await mcp.connect(new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:2_100_000}));
}
void main().catch(error=>{process.stderr.write('Canoli Studio MCP failed: '+(error instanceof Error?error.message:String(error))+'\n');process.exitCode=1;});
