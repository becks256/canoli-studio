import {readFileSync,existsSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {AccountStore,type AuthTransaction} from '../../../server/auth/store';
import type {VerifiedIdentity} from '../../../server/auth/oidc';
const input=JSON.parse(readFileSync(process.argv[2],'utf8'))as{database:string;transaction:AuthTransaction;identity:VerifiedIdentity;gate:string},store=new AccountStore(input.database);process.stdout.write('ready\n');const deadline=Date.now()+5000;while(!existsSync(input.gate)){if(Date.now()>deadline)throw new Error('Account fixture timed out.');await delay(5);}let accepted=false;try{store.accept(input.transaction,input.identity);accepted=true;}catch{/* Deleted account authority cannot be recreated by an old attempt. */}finally{store.close();}process.stdout.write(JSON.stringify({accepted})+'\n');
