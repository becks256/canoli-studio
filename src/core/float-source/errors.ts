export class FloatCacheError extends Error{
 readonly name='FloatCacheError';
 constructor(message:string,readonly identity?:{key:string;buildId:unknown}){super(message);}
}
