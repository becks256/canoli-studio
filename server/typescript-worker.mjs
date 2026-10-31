import {isMainThread} from 'node:worker_threads';
import {register} from 'tsx/esm/api';

// Each trusted native worker owns its loader and module cache. Scoped tsImport
// namespaces can turn Node builtins into file URLs on newer Node releases.
// Never register this loader in the API host or the isolated scripting runtime.
if(isMainThread)throw new Error('The native TypeScript loader requires a worker thread.');
register();
