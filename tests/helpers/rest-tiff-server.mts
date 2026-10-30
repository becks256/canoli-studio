import {createApiServer} from '../../server/app';
import {AdjustmentLayer} from '../../src/dom';
const server=createApiServer({authToken:'rest-native-browser',precisionCacheDirectory:process.env.CANOLI_TEST_TIFF_CACHE});
server.listen(0,'127.0.0.1',()=>{
  const address=server.address();if(!address||typeof address==='string')throw new Error('Missing native API test address.');
  process.send?.({port:address.port,tone:new AdjustmentLayer({name:'REST linear exposure',adjustment:{kind:'tone',exposure:1,contrast:0,saturation:0}}).toJSON()});
});
server.once('error',error=>{console.error(error);process.exitCode=1;});
const close=()=>server.close(()=>{if(process.connected)process.disconnect?.();});
process.once('SIGTERM',close);process.once('SIGINT',close);
