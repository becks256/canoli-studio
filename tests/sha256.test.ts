import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {Sha256} from '../src/core/sha256';

it('matches independent native SHA-256 across padding, subviews and arbitrary streaming boundaries',()=>{
 for(const length of [0,1,3,55,56,57,63,64,65,119,120,127,128,129,1024,1048577]){
  const backing=new Uint8Array(length+17);for(let i=0;i<backing.length;i++)backing[i]=(i*17+(i>>>4)*31)%256;const bytes=backing.subarray(7,length+7),before=bytes.slice(),expected=createHash('sha256').update(bytes).digest('hex');
  for(const step of (length>100000?[2047,1048576]:[1,7,55,64,65,2047,1048576])){const hash=new Sha256();for(let i=0;i<bytes.length;i+=step)hash.update(bytes.subarray(i,i+step));hash.update(new Uint8Array());expect(hash.digest()).toBe(expected);expect(()=>hash.digest()).toThrow(/finalized/);expect(()=>hash.update(bytes)).toThrow(/finalized/);}
  expect(Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).equals(before)).toBe(true);
 }
});
it('matches published empty/abc and million-a vectors',()=>{
 expect(new Sha256().digest()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');expect(new Sha256().update(new TextEncoder().encode('abc')).digest()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');expect(new Sha256().update(new Uint8Array(1000000).fill(97)).digest()).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});
