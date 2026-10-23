import {z} from 'zod';
import {accountExportSchema} from './protocol';
const viewSchema=z.object({configured:z.boolean(),csrf:z.string().nullable(),user:z.object({id:z.string(),name:z.string().nullable(),email:z.string().nullable()}).nullable(),pending:z.object({id:z.string(),kind:z.enum(['create','link']),name:z.string().nullable(),email:z.string().nullable(),expires:z.number()}).nullable(),signingIn:z.boolean(),notice:z.string().nullable(),verificationExpiresIn:z.number().min(0).max(300000).default(0)});
export type AccountView=z.infer<typeof viewSchema>;
const empty:AccountView={configured:false,csrf:null,user:null,pending:null,signingIn:false,notice:null,verificationExpiresIn:0};
export interface AccountState {view:AccountView;loading:boolean;error:string;resetRequired:boolean;verificationDeadline:number;message:string}
/** UI identity state, separate from the public editor DOM and isolated command services. */
export class AccountClient {
 private state:AccountState={view:empty,loading:false,error:'',resetRequired:false,verificationDeadline:0,message:''};private listeners=new Set<()=>void>();private pending?:Promise<boolean>;private mutating=false;private popup:Window|null=null;
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(patch:Partial<AccountState>){this.state={...this.state,...patch};for(const listener of this.listeners)listener();}
 async refresh(){if(this.mutating)return;if(this.pending)return this.pending;this.pending=this.load().finally(()=>{this.pending=undefined;});return this.pending;}
 private async load():Promise<boolean>{this.publish({loading:true,error:''});try{
  const response=await fetch('/auth/session',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10_000)});if(!response.headers.get('content-type')?.includes('application/json')){this.publish({view:empty,resetRequired:false,verificationDeadline:0});return false;}
  if(response.status===401){this.publish({view:empty,resetRequired:true,verificationDeadline:0});return false;}if(!response.ok)throw new Error('Account status is unavailable. Try again.');const view=viewSchema.parse(await response.json());this.publish({view,verificationDeadline:view.user?Date.now()+view.verificationExpiresIn:0,resetRequired:false});return true;
 }catch{this.publish({error:'Account status is unavailable. Try again.'});return false;}finally{this.publish({loading:false});}}
 start(intent:'signin'|'link'|'reauthenticate'){
  if(!this.state.view.configured||!this.state.view.csrf||this.mutating)return;this.popup=window.open('','canoli-account-signin','popup,width=600,height=740');if(!this.popup){this.publish({error:'Allow a sign-in window for Canoli, then try again. Your artwork stays open.'});return;}
  const form=document.createElement('form');form.method='POST';form.action='/auth/openai';form.target='canoli-account-signin';for(const[name,value]of Object.entries({csrf:this.state.view.csrf,intent})){const input=document.createElement('input');input.type='hidden';input.name=name;input.value=value;form.append(input);}document.body.append(form);form.submit();form.remove();this.publish({view:{...this.state.view,signingIn:true},error:'',message:''});
 }
 async action(kind:'confirm'|'cancel'|'signout'|'reset'|'export'|'delete',options:{confirmation?:string}={}){
  const view=this.state.view;if(kind!=='reset'&&!view.csrf||this.mutating)return;this.mutating=true;this.publish({loading:true,error:'',message:''});try{
   await this.pending;const response=await fetch('/auth/'+kind,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({csrf:view.csrf??'',...(kind==='confirm'?{pendingId:view.pending?.id}:{}),...(kind==='delete'?{confirmation:options.confirmation}:{})}),signal:AbortSignal.timeout(10_000)});
   if(response.status===409){const error=await response.json();if(error.code==='VERIFICATION_REQUIRED'){await this.load();this.publish({verificationDeadline:0,error:'Verify your current ChatGPT sign-in before continuing.'});return;}}
   if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error('The account action could not be completed. Refresh and try again.');
   if(kind==='export'){
    const data=accountExportSchema.parse(await response.json());if(!view.user||data.account.id!==view.user.id||!await this.load()||this.state.view.user?.id!==view.user.id)throw new Error('The account changed before the export was ready.');
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download='canoli-account.json';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);this.publish({message:'Account data downloaded. Save local artwork separately with Save project.'});return;
   }
   if(kind!=='reset')z.object({ok:z.literal(true)}).strict().parse(await response.json());
   if(kind==='cancel'||kind==='signout'||kind==='delete'){this.popup?.close();this.popup=null;}
   if(kind==='delete')this.publish({view:{...empty,configured:true},verificationDeadline:0,resetRequired:false,message:'Your Canoli account was deleted. Local artwork remains open.'});
   await this.load();
  }catch{if(kind==='delete')await this.load();this.publish({error:'The account action could not be completed. Refresh and try again.'});}finally{this.mutating=false;this.publish({loading:false});}
 }
}
