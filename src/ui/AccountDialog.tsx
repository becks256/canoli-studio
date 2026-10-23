import {useEffect,useId,useSyncExternalStore} from 'react';
import {UserRound,X} from 'lucide-react';
import {AccountClient} from '../account/client';
import {Dialog} from './Dialog';
import {Button,IconButton} from './controls';
export function AccountButton({client,onOpen}:{client:AccountClient;onOpen():void}){const{view}=useSyncExternalStore(client.subscribe,client.getSnapshot);return <IconButton label="Account" shortcutId="account" title={view.user?'Canoli account · '+(view.user.name??view.user.email??'Signed in'):'Canoli account'} onClick={onOpen}><UserRound size={17}/></IconButton>;}
export function AccountDialog({client,onClose}:{client:AccountClient;onClose():void}){
 const id=useId(),{view,loading,error,resetRequired}=useSyncExternalStore(client.subscribe,client.getSnapshot);
 useEffect(()=>{void client.refresh();const refresh=()=>void client.refresh(),message=(event:MessageEvent)=>{if(event.origin===location.origin&&event.data?.type==='canoli:account-changed')refresh();};window.addEventListener('focus',refresh);window.addEventListener('message',message);return()=>{window.removeEventListener('focus',refresh);window.removeEventListener('message',message);};},[client]);
 useEffect(()=>{if(!view.signingIn)return;const timer=setInterval(()=>void client.refresh(),2000);return()=>clearInterval(timer);},[client,view.signingIn]);
 return <Dialog titleId={id} className="account-dialog" localEscape onClose={onClose}>
  <div className="dialog-heading"><div><span className="section-caption">CANOLI STUDIO</span><h2 id={id}>Account</h2></div><IconButton label="Close Account" onClick={onClose}><X size={18}/></IconButton></div>
  <div className="account-dialog-body">
   {loading&&<p role="status">Checking your account…</p>}{error&&<p role="alert">{error}</p>}{view.notice&&<p role="alert">{view.notice}</p>}
   {loading&&!view.csrf?<p>Loading sign-in options…</p>:resetRequired?<><p>Your account session needs to be refreshed.</p><Button disabled={loading} onClick={()=>void client.action('reset')}>Refresh account session</Button></>:!view.configured?<p>Sign-in is not configured on this installation. You can keep editing and saving locally.</p>:<>
    {view.user?<><h3>{view.user.name??'Your Canoli account'}</h3>{view.user.email&&<p>{view.user.email}</p>}<p>Signed in to Canoli Studio. Your local documents stay on this browser.</p></>:<><h3>Sign in to Canoli Studio</h3><p>Use your ChatGPT identity to create or access your Canoli account. Your artwork stays open while you sign in in a separate window.</p></>}
    {view.user&&!view.pending&&!view.signingIn&&<p>Link another ChatGPT sign-in to this account.</p>}{view.pending?<section aria-label="Confirm Canoli account"><h3>{view.pending.kind==='create'?'Create your Canoli account':'Link this sign-in method'}</h3><p>Verified ChatGPT identity: {view.pending.name??view.pending.email??'ChatGPT account'}</p>{view.pending.email&&view.pending.name&&<p>{view.pending.email}</p>}<p>{view.pending.kind==='create'?'Create a separate Canoli account for this identity. To link an existing Canoli account, cancel and sign in to that account first. Matching email addresses do not link accounts.':'Confirm that you want to use this ChatGPT identity to sign in to your current Canoli account.'}</p><Button variant="primary" disabled={loading} onClick={()=>void client.action('confirm')}>{view.pending.kind==='create'?'Create Canoli account':'Link this ChatGPT sign-in'}</Button><Button disabled={loading} onClick={()=>void client.action('cancel')}>Cancel account confirmation</Button></section>:view.signingIn?<><p role="status">Finish signing in in the separate window.</p><Button disabled={loading} onClick={()=>void client.action('cancel')}>Cancel sign-in</Button></>:<Button variant="primary" disabled={loading} onClick={()=>client.start(view.user?'link':'signin')}>Continue with ChatGPT</Button>}
    {view.user&&<Button variant="subtle" disabled={loading} onClick={()=>void client.action('signout')}>Sign out of Canoli</Button>}
    <p className="field-hint">Sign-in shares identity details with Canoli. Document connections and ChatGPT plan usage have separate permissions. Signing out of Canoli leaves your local artwork open.</p>
   </>}
   <Button variant="subtle" disabled={loading} onClick={()=>void client.refresh()}>Refresh account status</Button>
   <a href="/developer/sign-in-with-chatgpt.html" target="_blank" rel="noreferrer">Sign-in setup and privacy</a>
  </div><div className="dialog-actions"><Button onClick={onClose}>Done</Button></div>
 </Dialog>;
}
