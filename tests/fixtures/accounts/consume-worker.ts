import {readFileSync,existsSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {AccountStore} from '../../../server/auth/store';
const input=JSON.parse(readFileSync(process.argv[2],'utf8'))as{database:string;cookie:string;state:string;gate:string},store=new AccountStore(input.database);process.stdout.write('ready\n');
const deadline=Date.now()+5000;while(!existsSync(input.gate)){if(Date.now()>deadline)throw new Error('Account fixture gate timed out.');await delay(5);}
let accepted=false;try{const session=store.browser(input.cookie);if(session){store.consume(session,input.state);accepted=true;}}catch{/* A one-use callback has exactly one winner. */}finally{store.close();}process.stdout.write(JSON.stringify({accepted})+'\n');
