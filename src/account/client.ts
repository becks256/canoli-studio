import {z} from 'zod';
const viewSchema=z.object({configured:z.boolean(),csrf:z.string().nullable(),user:z.object({id:z.string(),name:z.string().nullable(),email:z.string().nullable()}).nullable(),pending:z.object({id:z.string(),kind:z.enum(['create','link']),name:z.string().nullable(),email:z.string().nullable(),expires:z.number()}).nullable(),signingIn:z.boolean(),notice:z.string().nullable()});
export type AccountView=z.infer<typeof viewSchema>;
const empty:AccountView={configured:false,csrf:null,user:null,pending:null,signingIn:false,notice:null};
export interface AccountState {view:AccountView;loading:boolean;error:string;resetRequired:boolean}
/** UI identity state, separate from the public editor DOM and isolated command services. */
export class AccountClient {
 private state:AccountState={view:empty,loading:false,error:'',resetRequired:false};private listeners=new Set<()=>void>();private pending?:Promise<void>;private mutating=false;private popup:Window|null=null;
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(patch:Partial<AccountState>){this.state={...this.state,...patch};for(const listener of this.listeners)listener();}
 async refresh(){if(this.mutating)return;if(this.pending)return this.pending;this.pending=this.load().finally(()=>{this.pending=undefined;});return this.pending;}
 private async load(){this.publish({loading:true,error:''});try{
  const response=await fetch('/auth/session',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10_000)});if(!response.headers.get('content-type')?.includes('application/json')){this.publish({view:empty,resetRequired:false});return;}
  if(response.status===401){this.publish({resetRequired:true});return;}if(!response.ok)throw new Error('Account status is unavailable. Try again.');this.publish({view:viewSchema.parse(await response.json()),resetRequired:false});
 }catch{this.publish({error:'Account status is unavailable. Try again.'});}finally{this.publish({loading:false});}}
 start(intent:'signin'|'link'){
  if(!this.state.view.configured||!this.state.view.csrf)return;this.popup=window.open('','canoli-account-signin','popup,width=600,height=740');if(!this.popup){this.publish({error:'Allow a sign-in window for Canoli, then try again. Your artwork stays open.'});return;}
  const form=document.createElement('form');form.method='POST';form.action='/auth/openai';form.target='canoli-account-signin';for(const[name,value]of Object.entries({csrf:this.state.view.csrf,intent})){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);}document.body.append(form);form.submit();form.remove();this.publish({view:{...this.state.view,signingIn:true},error:''});
 }
 async action(kind:'confirm'|'cancel'|'signout'|'reset'){
  const view=this.state.view;if(kind!=='reset'&&!view.csrf||this.mutating)return;this.mutating=true;this.publish({loading:true,error:''});try{
   await this.pending;const response=await fetch('/auth/'+kind,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({csrf:view.csrf??'',...(kind==='confirm'?{pendingId:view.pending?.id}:{})}),signal:AbortSignal.timeout(10_000)});if(!response.ok)throw new Error('The account action could not be completed. Refresh and try again.');if(kind==='cancel'||kind==='signout'){this.popup?.close();this.popup=null;}await this.load();
  }catch{this.publish({error:'The account action could not be completed. Refresh and try again.'});}finally{this.mutating=false;this.publish({loading:false});}
 }
}
