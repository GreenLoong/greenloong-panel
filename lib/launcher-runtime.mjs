import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
export const launcherRootId=root=>createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex');
export const launcherProof=(token,nonce,rootId)=>createHmac('sha256',token).update(nonce+'\n'+rootId).digest('hex');
export const LAUNCHER_PORT_MIN=18640,LAUNCHER_PORT_MAX=18660;
export function launcherPortAllowed(port){return Number.isInteger(port)&&port>=LAUNCHER_PORT_MIN&&port<=LAUNCHER_PORT_MAX;}
export function localLauncherURL(value){try{const u=new URL(value.trim());if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||u.pathname!=='/'||u.search||!launcherPortAllowed(Number(u.port))||!/^#[a-f0-9]{64}$/.test(u.hash))return null;return u;}catch{return null;}}
export async function listenLauncher(server,{preferredPort=LAUNCHER_PORT_MIN,maxPort=LAUNCHER_PORT_MAX}={}){
 if(!launcherPortAllowed(preferredPort)||!launcherPortAllowed(maxPort)||maxPort<preferredPort)throw Error('控制面板端口范围无效。');
 for(let port=preferredPort;port<=maxPort;port++){
  try{await new Promise((resolve,reject)=>{const fail=e=>{server.off('listening',ok);reject(e);},ok=()=>{server.off('error',fail);resolve();};server.once('error',fail);server.once('listening',ok);server.listen(port,'127.0.0.1');});return port;}
  catch(e){if(!['EADDRINUSE','EACCES'].includes(e.code))throw e;}
 }
 throw Error(`控制面板端口 ${preferredPort}–${maxPort} 都无法使用，请查看 data/launcher-startup.log。`);
}
export async function atomicText(file,text){const {rename}=await import('node:fs/promises');const temporary=file+'.'+process.pid+'.tmp';await writeFile(temporary,text);await rename(temporary,file);}
export async function probeLauncher(url,root,{request=fetch}={}){
 const parsed=localLauncherURL(url);if(!parsed)return null;
 try{
  const nonce=randomBytes(16).toString('hex'),id=launcherRootId(root),r0=await request(parsed.origin+'/api/launcher-identity?nonce='+nonce,{signal:AbortSignal.timeout(1000)});if(!r0.ok)return null;const publicInfo=await r0.json();
  if(publicInfo.application!=='GreenLoongLauncher'||publicInfo.rootId!==id||publicInfo.port!==Number(parsed.port)||!/^\w{64}$/.test(publicInfo.proof||'')||!timingSafeEqual(Buffer.from(publicInfo.proof),Buffer.from(launcherProof(parsed.hash.slice(1),nonce,id))))return null;
  const r=await request(parsed.origin+'/api/launcher-info',{headers:{'X-GreenLoong-Token':parsed.hash.slice(1)},signal:AbortSignal.timeout(1000)});if(!r.ok)return null;const info=await r.json();if(info.application!=='GreenLoongLauncher'||path.resolve(info.root).toLowerCase()!==path.resolve(root).toLowerCase()||info.port!==Number(parsed.port))return null;return {...info,url:parsed.href};
 }catch{return null;}
}
export async function ensureLauncher({root,exe=process.execPath,request=fetch,timeout=45000,legacyOwner=async()=>false,log=()=>{}}){
 const data=path.join(root,'data'),urlFile=path.join(data,'launcher-url.txt'),tokenFile=path.join(data,'session-token.txt'),markerFile=path.join(data,'launcher-starting.json');await mkdir(data,{recursive:true});
 const cached=await readFile(urlFile,'utf8').catch(()=>''),parsed=localLauncherURL(cached);
 const found=await probeLauncher(cached,root,{request});if(found)return found;
 if(parsed&&await legacyOwner(parsed))return {url:parsed.href,port:Number(parsed.port),legacy:true};
 async function discover(){const token=(await readFile(tokenFile,'utf8').catch(()=> '')).trim();if(!/^[a-f0-9]{64}$/.test(token))return null;
  const checks=await Promise.all(Array.from({length:21},(_,i)=>probeLauncher(`http://127.0.0.1:${18640+i}/#${token}`,root,{request})));return checks.find(Boolean)||null;
 }
 const recovered=await discover();if(recovered){await atomicText(urlFile,recovered.url);return recovered;}
 let marker;try{marker=JSON.parse(await readFile(markerFile,'utf8'));}catch{}let starting=false;
 if(marker&&Date.now()-marker.startedAt<90000&&Number.isInteger(marker.pid)){try{process.kill(marker.pid,0);starting=true;}catch{}}
 let child;
 if(!starting){
  log('正在启动绿龙控制面板；默认端口占用时会自动选择其他端口。');
  const {openSync,closeSync}=await import('node:fs');const output=openSync(path.join(data,'launcher-startup.log'),'a');
  try{child=spawn(exe,[path.join(root,'server.mjs')],{cwd:root,windowsHide:true,detached:true,stdio:['ignore',output,output]});}finally{closeSync(output);}
  let spawnError;child.on('error',e=>{spawnError=e;});await new Promise(r=>setImmediate(r));if(spawnError)throw Error('无法启动绿龙平台：'+spawnError.message);
  child.unref();await atomicText(markerFile,JSON.stringify({pid:child.pid,startedAt:Date.now()}));
 }
 const began=Date.now();let scannedAt=0;
 while(Date.now()-began<timeout){
  const value=await readFile(urlFile,'utf8').catch(()=>''),ready=await probeLauncher(value,root,{request});if(ready)return ready;
  if(Date.now()-scannedAt>=2000){scannedAt=Date.now();const ready=await discover();if(ready){await atomicText(urlFile,ready.url);return ready;}}
  if(child?.exitCode!==null&&child?.exitCode!==undefined)throw Error('绿龙后台启动失败，请查看 data/launcher-startup.log。');
  await new Promise(r=>setTimeout(r,250));
 }
 throw Error('绿龙后台未在 45 秒内就绪，请查看 data/launcher-startup.log；再次打开会继续检查启动进程。');
}
