import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
const storage=new AsyncLocalStorage();
export const currentDownloadSession=()=>storage.getStore();
export function downloadOptions(input={}){
 const idle=Number(input.downloadIdleSeconds||30),total=Number(input.downloadTotalMinutes||15);
 if(!Number.isInteger(idle)||idle<5||idle>300||!Number.isInteger(total)||total<1||total>120)throw Error('下载无数据超时应为 5～300 秒，单文件最长时间应为 1～120 分钟。');
 return {idleTimeoutMs:idle*1000,totalTimeoutMs:total*60000};
}
export function createDownloadSession(input={},onChange=()=>{}){
 const records=new Map(),id=randomUUID();let options=downloadOptions(input),controller=new AbortController(),paused=false,cancelled=false,reason='',waiters=[];
 const cancelError=Object.assign(Error('下载任务已取消，已完成文件保留。'),{code:'DOWNLOAD_CANCELLED'});
 const snapshot=()=>{const now=Date.now(),items=[...records.values()].map(r=>{
  const running=['connecting','downloading','retrying'].includes(r.status),idleSeconds=running?Math.max(0,(now-r.lastDataAt)/1000):0;
  const baseline=r.samples.find(s=>s.at>=now-4000)||r.samples.at(-1)||{at:r.startedAt,bytes:0};
  const speed=r.status==='downloading'&&now-r.lastDataAt<1500?Math.max(0,(r.bytes-baseline.bytes)/Math.max(.001,(now-baseline.at)/1000)):0;
  const {samples,lastDataAt,finishedAt,...safe}=r;return {...safe,speedBytesPerSecond:Math.round(speed),idleSeconds:Math.round(idleSeconds),elapsedSeconds:Math.round(((finishedAt||now)-r.startedAt)/1000)};
 });const live=items.filter(r=>!['completed','cached'].includes(r.status)),recent=items.filter(r=>['completed','cached'].includes(r.status)).slice(-Math.max(1,16-live.length));return {id,paused,cancelled,reason,options,canStop:!paused&&!cancelled&&items.some(r=>['connecting','downloading','retrying'].includes(r.status)),items:[...live,...recent].slice(0,16)};};
 const emit=()=>onChange(snapshot());
 const session={id,get signal(){return controller.signal;},get options(){return options;},get paused(){return paused;},get cancelled(){return cancelled;},cancelError,snapshot,
  run:fn=>storage.run(session,fn),
  record(name,url){const rid=randomUUID(),now=Date.now(),r={id:rid,name,host:new URL(url).hostname,status:'connecting',bytes:0,total:null,attempt:1,maxAttempts:2,startedAt:now,lastDataAt:now,samples:[{at:now,bytes:0}],error:null};records.set(rid,r);emit();return {update(patch){Object.assign(r,patch);if(['completed','cached','failed','cancelled'].includes(patch.status))r.finishedAt=Date.now();if(patch.bytes!==undefined){const at=Date.now();r.lastDataAt=at;r.samples.push({at,bytes:r.bytes});r.samples=r.samples.filter(s=>s.at>=at-6000).slice(-100);}emit();},restart(attempt,maxAttempts){const at=Date.now();Object.assign(r,{status:'connecting',bytes:0,total:null,attempt,maxAttempts,startedAt:at,lastDataAt:at,samples:[{at,bytes:0}],error:null,finishedAt:null});emit();}};},
  stop(message='已停止当前下载，点击“重新下载”继续；也可结束当前任务。'){
   if(cancelled||paused)return;paused=true;reason=message;controller.abort(Object.assign(Error(message),{code:'DOWNLOAD_PAUSED'}));for(const r of records.values()){if(['connecting','downloading','retrying','verifying','checking-cache'].includes(r.status)){r.status='paused';r.finishedAt=Date.now();}}emit();
  },
  resume(input){if(cancelled)throw cancelError;if(input)options=downloadOptions(input);paused=false;reason='';controller=new AbortController();for(const r of records.values())if(r.status==='paused')r.error=null;const pending=waiters;waiters=[];pending.forEach(w=>w.resolve());emit();},
  cancel(){cancelled=true;paused=false;reason=cancelError.message;controller.abort(cancelError);for(const r of records.values())if(!['completed','cached'].includes(r.status))r.status='cancelled';const pending=waiters;waiters=[];pending.forEach(w=>w.reject(cancelError));emit();},
  async wait(){if(cancelled)throw cancelError;if(paused)await new Promise((resolve,reject)=>waiters.push({resolve,reject}));if(cancelled)throw cancelError;},
  close(){clearInterval(timer);emit();}
 };
 const timer=setInterval(emit,1000);timer.unref();return session;
}
