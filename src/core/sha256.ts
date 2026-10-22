// Incremental byte-oriented SHA-256, FIPS 180-4 sections 4.2.2, 5 and 6.2.
// https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf
// Used for local file integrity; this is not a validated cryptographic module.
const K=new Uint32Array([
 0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
 0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
 0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
 0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
 0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
 0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
 0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
 0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotate=(x:number,n:number)=>(x>>>n)|(x<<(32-n));
export class Sha256 {
 private readonly state=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
 private readonly words=new Uint32Array(64);
 private readonly tail=new Uint8Array(64);
 private used=0;private bytes=0;private finished=false;
 update(input:Uint8Array):this{
  if(this.finished)throw new Error('SHA-256 is already finalized.');
  if(!(input instanceof Uint8Array)||!Number.isSafeInteger(this.bytes+input.byteLength))throw new Error('Invalid SHA-256 byte extent.');
  this.bytes+=input.byteLength;let offset=0;
  if(this.used){const count=Math.min(64-this.used,input.length);this.tail.set(input.subarray(0,count),this.used);this.used+=count;offset+=count;if(this.used===64){this.block(this.tail,0);this.used=0;}}
  for(;offset+64<=input.length;offset+=64)this.block(input,offset);
  if(offset<input.length){this.tail.set(input.subarray(offset),0);this.used=input.length-offset;}
  return this;
 }
 digest():string{
  if(this.finished)throw new Error('SHA-256 is already finalized.');this.finished=true;
  this.tail[this.used++]=0x80;
  if(this.used>56){this.tail.fill(0,this.used);this.block(this.tail,0);this.used=0;}
  this.tail.fill(0,this.used,56);new DataView(this.tail.buffer).setBigUint64(56,BigInt(this.bytes)*8n);this.block(this.tail,0);
  return Array.from(this.state,value=>value.toString(16).padStart(8,'0')).join('');
 }
 private block(input:Uint8Array,offset:number){
  const w=this.words;for(let i=0;i<16;i++){const p=offset+i*4;w[i]=(input[p]<<24)|(input[p+1]<<16)|(input[p+2]<<8)|input[p+3];}
  for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=w[i-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+w[i-7]+(rotate(y,17)^rotate(y,19)^(y>>>10));}
  const state=this.state;let a=state[0],b=state[1],c=state[2],d=state[3],e=state[4],f=state[5],g=state[6],h=state[7];
  for(let i=0;i<64;i++){const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
  state[0]+=a;state[1]+=b;state[2]+=c;state[3]+=d;state[4]+=e;state[5]+=f;state[6]+=g;state[7]+=h;
 }
}
