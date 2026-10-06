import http from 'node:http';
import {mkdir,readFile,writeFile,unlink,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {ROOT,ps,validPort} from './lib/system.mjs';
import {analyzePack} from './lib/analyze.mjs';
import {DATA,installPanel,startPanel,setupNetwork,deployPack,importPanel,startManagedServer,startSavedServer,managedServerState,stopSavedServer} from './lib/deploy.mjs';
import {panelLoginInfo,savePanelLogin,forgetPanelLogin,accessPanel} from './lib/panel-login.mjs';
import {resolveCorePlan} from './lib/core-catalog.mjs';
import {smoke} from './lib/smoke.mjs';
import {reuseDeployment} from './lib/deployment-state.mjs';
import {checkAAAA} from './lib/dns-check.mjs';
import {aliyunAAAA} from './lib/alidns-check.mjs';
import {detectDNSProvider,cloudflareAAAA,configContainsDomain} from './lib/dns-provider.mjs';
import {inspectExistingServer,importExistingServer} from './lib/existing-server.mjs';
import {readZip,extract} from './lib/archive.mjs';
import {run} from './lib/system.mjs';
import {listenLauncher,atomicText,launcherRootId,launcherProof} from './lib/launcher-runtime.mjs';
import {inspectControlPort} from './lib/control-port.mjs';
import {createDownloadSession,downloadOptions} from './lib/download-session.mjs';
import {networkPreview,assertNetworkPreview} from './lib/network-preflight.mjs';
let port=18640;
await mkdir(DATA,{recursive:true});
// Keep the local session valid through a service restart or ordinary page reload.
const tokenPath=path.join(DATA,'session-token.txt');
let token=(await readFile(tokenPath,'utf8').catch(()=>'')).trim();
if(!/^[a-f0-9]{64}$/.test(token)){token=randomBytes(32).toString('hex');await writeFile(tokenPath,token);}
let upload=null,job={busy:false,logs:[],error:null,result:null};
let existingPlan=null;
try{existingPlan=JSON.parse(await readFile(path.join(DATA,'existing-state.json'),'utf8'));if(!await stat(existingPlan.report.directory).catch(()=>false))existingPlan=null;}catch{}
async function rememberExisting(directory,source){const report=await inspectExistingServer(directory);existingPlan={id:randomUUID(),report,source};await writeFile(path.join(DATA,'existing-state.json'),JSON.stringify(existingPlan));return existingPlan;}
try{const saved=JSON.parse(await readFile(path.join(DATA,'job-state.json'),'utf8'));job={...saved,busy:false};if(saved.busy){job.error='部署工具已重启，上一任务状态需要确认；现有实例和文件已保留。';job.logs.push(job.error);}}catch{}
try{const saved=JSON.parse(await readFile(path.join(DATA,'upload-state.json'),'utf8'));if(/^[a-f0-9-]+\.zip$/.test(saved.file)){const file=path.join(DATA,'uploads',saved.file),info=await stat(file),report=saved.report&&saved.size===info.size&&saved.mtimeMs===info.mtimeMs?saved.report:await analyzePack(file);report.resolution=await resolveCorePlan(report);upload={file,report};await writeFile(path.join(DATA,'upload-state.json'),JSON.stringify({file:saved.file,report,size:info.size,mtimeMs:info.mtimeMs}));}}catch{}
let persistQueue=Promise.resolve();
function persistJob(){const snapshot=JSON.stringify(job);persistQueue=persistQueue.then(()=>writeFile(path.join(DATA,'job-state.json'),snapshot)).catch(()=>{});return persistQueue;}
const log=s=>{job.logs.push(new Date().toLocaleTimeString('zh-CN')+' '+s);if(job.logs.length>200)job.logs.shift();persistJob();};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
async function body(req){let b='';for await(const c of req){b+=c;if(b.length>200000)throw Error('请求过大');}return JSON.parse(b||'{}');}
let startController,startCompletion,downloadSession,requestedDownloadOptions={};
function startJob(fn,kind='work',replace=false){if(job.busy&&!replace)throw Error('已有任务正在运行');job={busy:true,kind,startedAt:Date.now(),logs:[],error:null,result:null};const session=downloadSession=createDownloadSession(requestedDownloadOptions,snapshot=>{job.downloads=snapshot;persistJob();});if(kind==='start-managed')startController.signal.addEventListener('abort',()=>session.cancel(),{once:true});persistJob();return (async()=>{try{job.result=await session.run(fn);}catch(e){if(e.name==='AbortError'||(job.stopQueued&&e.code==='DOWNLOAD_CANCELLED'))log('启动已取消，继续执行正常停服。');else if(e.code==='DOWNLOAD_CANCELLED'){job.cancelled=true;log(e.message);}else{job.error=e.message;log('未完成：'+e.message);}}finally{session.close();job.busy=!!job.stopQueued;await persistJob();}})();}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!==`127.0.0.1:${port}`)return json(res,403,{error:'Host rejected'});
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  const origin=`http://127.0.0.1:${port}`,u=new URL(req.url,origin);
  if(req.method==='GET'&&u.pathname==='/api/launcher-identity'){const nonce=u.searchParams.get('nonce')||'';if(!/^[a-f0-9]{32}$/.test(nonce))return json(res,400,{error:'Invalid launcher probe'});const rootId=launcherRootId(ROOT);return json(res,200,{application:'GreenLoongLauncher',rootId,port,proof:launcherProof(token,nonce,rootId)});}
  if(req.method==='GET'&&u.pathname==='/panel-opening'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>正在打开 MCSManager</title><body style="font-family:Microsoft YaHei;padding:40px"><h2>正在启动并打开 MCSManager…</h2><p>此页面会在管理面板就绪后自动跳转。启动进度可在开服助手中查看。</p></body></html>');}
  if(req.method==='GET'&&['/','/app.js','/style.css'].includes(u.pathname)){
   const file=u.pathname==='/'?'index.html':u.pathname.slice(1),type=file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'text/css';
   res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store'});return res.end(await readFile(path.join(ROOT,'public',file)));
  }
  if(req.headers['x-greenloong-token']!==token||(req.headers.origin&&req.headers.origin!==origin))return json(res,403,{error:'请从启动器打开此页面'});
  if(req.method==='GET'&&u.pathname==='/api/status')return json(res,200,job);
  if(req.method==='GET'&&u.pathname==='/api/network-settings'){const saved=JSON.parse(await readFile(path.join(DATA,'network.json'),'utf8').catch(()=> 'null'));return json(res,200,saved?{domain:saved.domain,port:saved.port,interfaceGuid:saved.interfaceGuid}:null);}
  if(req.method==='GET'&&u.pathname==='/api/control-port')return json(res,200,JSON.parse(await readFile(path.join(DATA,'control-port-info.json'),'utf8').catch(()=> 'null')));
  if(req.method==='GET'&&u.pathname==='/api/launcher-info')return json(res,200,{application:'GreenLoongLauncher',root:ROOT,pid:process.pid,port,version:'0.12.0'});
  if(req.method==='GET'&&u.pathname==='/api/game-state')return json(res,200,await managedServerState());
  if(req.method==='GET'&&u.pathname==='/api/panel-login-state')return json(res,200,await panelLoginInfo());
  if(req.method==='GET'&&u.pathname==='/api/upload')return json(res,200,upload?.report||null);
  if(req.method==='GET'&&u.pathname==='/api/existing')return json(res,200,existingPlan);
  if(req.method==='GET'&&u.pathname==='/api/authority'){const domain=u.searchParams.get('domain')||'';if(!/^[a-z0-9.-]+$/.test(domain))throw Error('域名格式不正确');return json(res,200,await detectDNSProvider(domain));}
  if(req.method!=='POST')return json(res,404,{error:'Not found'});
  if(job.busy&&!['/api/check','/api/authority','/api/panel-access','/api/stop-managed','/api/control-port-detect','/api/download-stop','/api/download-retry','/api/download-cancel'].includes(u.pathname))throw Error('请等待当前任务完成');
  if(u.pathname==='/api/existing-upload'){
   const id=randomUUID(),file=path.join(DATA,'uploads',id+'-existing.zip');await mkdir(path.dirname(file),{recursive:true});let size=0;
   job={busy:true,logs:['正在检查现有服务端 ZIP…'],error:null,result:null};await persistJob();
   try{await pipeline(req,new Transform({transform(b,e,cb){size+=b.length;cb(size>2*1024**3?Error('上传限制为 2 GB，大存档请使用本地目录导入'):null,b);}}),createWriteStream(file,{flags:'wx'}));
    const zip=await readZip(file),names=zip.entries.filter(e=>!e.name.endsWith('/')).map(e=>e.name),tops=new Set(names.map(n=>n.split('/')[0]));
    const prefix=tops.size===1&&names.every(n=>n.includes('/'))?[...tops][0]+'/':'';
    const dest=path.join(DATA,'import-staging',id);await mkdir(dest,{recursive:true});await extract(zip,dest,e=>e.name.startsWith(prefix)?e.name.slice(prefix.length):null);
    const result=await rememberExisting(dest,'zip');job.logs.push('现有服务端分析完成，导入会保留完整内容。');return json(res,200,result);
   }catch(e){job.error=e.message;throw e;}finally{job.busy=false;await persistJob();}
  }
  if(u.pathname==='/api/upload'){
   const id=randomUUID();await mkdir(path.join(DATA,'uploads'),{recursive:true});const file=path.join(DATA,'uploads',id+'.zip');let size=0;
   job={busy:true,logs:['正在分析新整合包…'],error:null,result:null};upload=null;await unlink(path.join(DATA,'upload-state.json')).catch(()=>{});
   try{await pipeline(req,new Transform({transform(b,e,cb){size+=b.length;cb(size>2*1024*1024*1024?Error('上传限制为 2 GB'):null,b);}}),createWriteStream(file,{flags:'wx'}));const report=await analyzePack(file);report.resolution=await resolveCorePlan(report);upload={file,report};const info=await stat(file);await writeFile(path.join(DATA,'upload-state.json'),JSON.stringify({file:path.basename(file),report,size:info.size,mtimeMs:info.mtimeMs}));job.logs=['分析完成：'+report.resolution.reason];return json(res,200,report);}catch(e){await unlink(file).catch(()=>{});job.error=e.message;throw e;}finally{job.busy=false;}
  }
  const input=await body(req);
  if(['panel','all','deploy','network','start-managed','existing-import'].includes(u.pathname.slice(5))){downloadOptions(input);requestedDownloadOptions={downloadIdleSeconds:input.downloadIdleSeconds,downloadTotalMinutes:input.downloadTotalMinutes};}
  switch(u.pathname){
   case '/api/network-preview':{const result=await networkPreview(input);const {binaryPath,...safeService}=result.service;return json(res,200,{...result,service:safeService});}
   case '/api/download-stop':if(!job.busy||!downloadSession?.snapshot().canStop)throw Error('当前没有正在传输的下载。');downloadSession.stop();log('已停止当前下载，等待重新下载或结束任务。');return json(res,200,{paused:true});
   case '/api/download-retry':if(!job.busy||!downloadSession?.paused)throw Error('当前没有等待重试的下载。');downloadSession.resume(input);log('正在重新下载未完成文件，已完成文件继续使用。');return json(res,200,{resumed:true});
   case '/api/download-cancel':if(!job.busy||(!downloadSession?.paused&&!downloadSession?.snapshot().canStop))throw Error('当前没有可取消的下载任务。');downloadSession.cancel();return json(res,200,{cancelled:true});
   case '/api/control-port-detect':{const info={...await inspectControlPort(ROOT),selectedPort:port,checkedAt:Date.now()};await atomicText(path.join(DATA,'control-port-info.json'),JSON.stringify(info));return json(res,200,info);}
   case '/api/panel-access':{if(!job.busy){await installPanel(()=>{});await startPanel(()=>{});}const result=await accessPanel(req.headers.cookie||'');if(result.cookies.length)res.setHeader('Set-Cookie',result.cookies);const {cookies,...safe}=result;return json(res,200,safe);}
   case '/api/panel-save-login':{const result=await savePanelLogin(input);res.setHeader('Set-Cookie',result.cookies);return json(res,200,{authenticated:true,message:'登录验证成功，已使用当前 Windows 账户加密保存。'});}
   case '/api/panel-forget-login':return json(res,200,await forgetPanelLogin());
   case '/api/existing-folder':return json(res,200,JSON.parse(await run('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'scripts','select-server-folder.ps1')])));
   case '/api/existing-analyze':{
    job={busy:true,logs:['正在检查已有服务端目录…'],error:null,result:null};await persistJob();
    try{const result=await rememberExisting(String(input.directory||''),'directory');job.logs.push('现有服务端分析完成，导入会保留完整内容。');return json(res,200,result);}catch(e){job.error=e.message;throw e;}finally{job.busy=false;await persistJob();}
   }
   case '/api/existing-import':if(!existingPlan||existingPlan.id!==input.existingPlanId)throw Error('请先分析要导入的服务端。');startJob(()=>importExistingServer(existingPlan.report,input,log));break;
   case '/api/plan':if(!upload)throw Error('请先上传整合包');return json(res,200,await resolveCorePlan(upload.report,input));
   case '/api/authority':if(!/^[a-z0-9.-]+$/.test(input.domain||''))throw Error('域名格式不正确');return json(res,200,await detectDNSProvider(input.domain));
   case '/api/reset-status':job={busy:false,logs:[],error:null,result:null};await persistJob();return json(res,200,{ok:true});
   case '/api/check':{const port=validPort(input.port);const [network,ports]=await Promise.all([ps('network'),ps('ports',{ports:[port,23333,24444]})]);const dns=/^[a-z0-9.-]+$/.test(input.domain||'')?await checkAAAA(input.domain):{addresses:[],error:'域名格式不正确'};let providerDns=[],providerError=null,authority=null;try{authority=await detectDNSProvider(input.domain);const saved=JSON.parse(await readFile(path.join(DATA,'private','ddns.yaml'),'utf8').catch(()=> 'null'));const conf=saved?.dnsconf?.find(c=>configContainsDomain(c,input.domain));if(conf&&conf.dns.name!==authority.provider)providerError='实际 DNS 服务商与 ddns-go 配置不一致，需要更新实际服务商中的记录。';else if(conf&&!dns.addresses.length){if(authority.provider==='alidns')providerDns=await aliyunAAAA(conf.dns,input.domain);if(authority.provider==='cloudflare')providerDns=(await cloudflareAAAA(conf.dns.secret,authority.zone,input.domain)).addresses;}}catch(e){providerError=e.message;}return json(res,200,{...network,...ports,memoryGB:Math.round(os.totalmem()/1024**3),dns:dns.addresses,dnsError:dns.error,providerDns,providerError,authority,externalReachability:'未验证：需要另一条 IPv6 网络上的玩家测试'});}
   case '/api/panel':startJob(async()=>{await installPanel(log);return startPanel(log);});break;
   case '/api/network':startJob(()=>setupNetwork(input,log));break;
   case '/api/deploy':if(!upload)throw Error('请先上传整合包');startJob(()=>deployPack(upload.file,upload.report,input,log));break;
   case '/api/all':if(!upload)throw Error('请先上传整合包');startJob(async()=>{if(input.ddns)assertNetworkPreview(await networkPreview(input),input);const previous=JSON.parse(await readFile(path.join(DATA,'last-server.json'),'utf8').catch(()=>'null'));let config=reuseDeployment(previous,upload.file,input),validation;if(config){log('同一整合包已有已验证实例，复用现有服务器和存档。');validation={status:'startup-test-passed',reused:true};}else config=await deployPack(upload.file,upload.report,input,log);await installPanel(log);const panel=await startPanel(log);log('正在注册 MCSManager 实例，启动检查期间请等待。');const instance=await importPanel(input,log);if(!validation)validation=await smoke(log);let networkError=null;try{await setupNetwork(input,log);}catch(e){networkError=e.message;log(networkError);}const managed=await startManagedServer(input,log);log('服务端已交给 MCSManager 管理。外网连通性仍需验证。');return {config,instance,validation,panel,managed,networkError};});break;
   case '/api/start-managed':if(input.confirmedStart!==true)throw Error('请点击“一键启动服务器”按钮来确认开服。');startController=new AbortController();startCompletion=startJob(()=>startSavedServer(input,log,{signal:startController.signal}),'start-managed');break;
   case '/api/stop-managed':{
    if(input.confirmedStop!==true)throw Error('请点击“一键关闭服务器”按钮来确认关服。');
    if(job.busy){
     if(job.kind!=='start-managed')throw Error('请等待部署、导入或当前停止任务完成，再关闭服务器。');
     if(!job.stopQueued){job.stopQueued=true;log('已请求取消启动，随后正常停止服务器并等待保存。');startController?.abort();void startCompletion.then(()=>startJob(()=>stopSavedServer(input,log),'stop-managed',true));}
    }else startJob(()=>stopSavedServer(input,log),'stop-managed');
    break;
   }
   case '/api/import':startJob(()=>importPanel(input,log));break;
   case '/api/smoke':startJob(()=>smoke(log));break;
   default:return json(res,404,{error:'Not found'});
  }
  return json(res,202,{ok:true});
 }catch(e){json(res,400,{error:e.message});}
});
server.requestTimeout=30*60*1000;
try{port=await listenLauncher(server);const url=`http://127.0.0.1:${port}/#${token}`;await atomicText(path.join(DATA,'launcher-url.txt'),url);await atomicText(path.join(DATA,'launcher-pid.txt'),String(process.pid));console.log('本地部署工具已启动，控制面板端口：'+port+'。请通过 Launch.cmd 打开浏览器。');}catch(e){console.error('部署工具无法启动：'+e.message);process.exit(1);}
