import {existsSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {AccountStore} from '../../../server/auth/store';
const [database,gate,token]=process.argv.slice(2);process.stdout.write('ready\n');const deadline=Date.now()+5000;
while(!existsSync(gate)){if(Date.now()>deadline)throw new Error('Migration fixture timed out.');await delay(5);}
const store=new AccountStore(database);try{const session=store.browser(token);if(!session)throw new Error('Legacy session lost.');process.stdout.write(JSON.stringify({id:session.userId,verificationExpiresIn:store.view(session).verificationExpiresIn})+'\n');}finally{store.close();}
