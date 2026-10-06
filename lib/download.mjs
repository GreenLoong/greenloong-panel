import {mkdir,readFile,writeFile,rename,unlink,stat} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ROOT} from './system.mjs';
import {currentDownloadSession} from './download-session.mjs';
import {githubRelease} from './github-release.mjs';
const cache=path.join(ROOT,'data','downloads'),pending=new Map();
export async function hashFile(file,algorithm='sha256'){const h=createHash(algorithm);for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}
async function retryTransfer(name,url,options,transfer){
 const session=currentDownloadSession(),record=session?.record(name,url),attempts=options.attempts||2;let attempt=1;
 for(;;){
  await session?.wait();options.signal?.throwIfAborted();record?.restart(attempt,attempts);
  try{return await transfer(record,session);}
  catch(e){
   if(session?.cancelled)throw session.cancelError;
   if(options.signal?.aborted)throw options.signal.reason;
   if(session?.paused){record?.update({status:'paused'});await session.wait();attempt=1;continue;}
   if(e.code==='GITHUB_RATE_LIMIT'){record?.update({status:'failed',error:e.message});throw e;}
   if(attempt<attempts&&!['INTEGRITY','LIMIT'].includes(e.code)){options.log?.(`下载暂时中断，重试 ${attempt}/${attempts-1}：${name}；${e.message}`);record?.update({status:'retrying',error:e.message});attempt++;continue;}
   record?.update({status:'failed',error:e.message});
   if(!session||options.propagateFailure)throw e;
   session.stop('下载未完成：'+e.message+'。可以重新下载，或结束当前任务。');await session.wait();attempt=1;
  }
 }
}
async function receive(url,{record,session,signal,idleTimeoutMs,totalTimeoutMs,limit=1024*1024*1024},consume){
 const control=new AbortController(),idle=session?.options.idleTimeoutMs||idleTimeoutMs||30000,total=session?.options.totalTimeoutMs||totalTimeoutMs||900000;let idleTimer;
 const reset=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>control.abort(Object.assign(Error(`连续 ${idle/1000} 秒未收到下载数据`),{code:'DOWNLOAD_IDLE_TIMEOUT'})),idle);};
 const signals=[control.signal,AbortSignal.timeout(total),session?.signal,signal].filter(Boolean),combined=AbortSignal.any(signals);reset();
 try{
  const r=await fetch(url,{signal:combined,headers:{'User-Agent':'GreenLoongInstaller/0.12'}});
  if(!r.ok){if(new URL(url).hostname==='api.github.com'&&[403,429].includes(r.status)&&(r.headers.get('x-ratelimit-remaining')==='0'||r.status===429||r.headers.get('retry-after'))){const retryAt=Math.max(Date.now()+60000,Number(r.headers.get('x-ratelimit-reset')||0)*1000,Date.now()+Number(r.headers.get('retry-after')||0)*1000);throw Object.assign(Error('GitHub API 限流，预计恢复时间：'+new Date(retryAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})),{code:'GITHUB_RATE_LIMIT',retryAt});}throw Error(`HTTP ${r.status}：${record?'下载请求失败':'下载失败'}`);}
  if(!r.body)throw Error('服务器未返回下载内容。');
  const size=Number(r.headers.get('content-length')),totalBytes=Number.isFinite(size)&&size>0&&!r.headers.get('content-encoding')?size:null;
  if(size>limit)throw Object.assign(Error('下载体积超过限制'),{code:'LIMIT'});
  record?.update({status:'downloading',total:totalBytes});let received=0,last=0;
  const bound=new Transform({transform(b,e,cb){reset();received+=b.length;if(Date.now()-last>=400){record?.update({bytes:received});last=Date.now();}cb(received>limit?Object.assign(Error('下载体积超过限制'),{code:'LIMIT'}):null,b);}});
  await consume(Readable.fromWeb(r.body),bound);clearTimeout(idleTimer);combined.throwIfAborted();record?.update({bytes:received,status:'verifying'});
  return {received,signal:combined};
 }catch(e){if(combined.aborted&&!session?.paused&&!session?.cancelled&&e.name==='AbortError')throw combined.reason;throw e;}finally{clearTimeout(idleTimer);}
}
export async function getText(url,{name='读取下载信息（'+new URL(url).hostname+'）',...options}={}){
 return retryTransfer(name,url,options,async(record,session)=>{const chunks=[];const result=await receive(url,{record,session,...options,limit:16*1024*1024},(source,bound)=>pipeline(source,bound,async stream=>{for await(const b of stream)chunks.push(b);}));result.signal.throwIfAborted();let value=Buffer.concat(chunks).toString('utf8');if(options.parseJSON){try{value=JSON.parse(value);}catch{throw Error('下载信息格式不正确：'+new URL(url).hostname);}}record?.update({status:'completed',total:result.received});return value;});
}
export async function getJson(url,options={}){return getText(url,{...options,parseJSON:true});}
export async function getReleaseRedirect(url){return retryTransfer('查询官方版本入口',url,{propagateFailure:true},async(record,session)=>{const signal=AbortSignal.any([AbortSignal.timeout(15000),session?.signal].filter(Boolean));const r=await fetch(url,{method:'HEAD',redirect:'manual',signal});if(r.status>=400)throw Error('官方发布页响应 HTTP '+r.status);signal.throwIfAborted();record?.update({status:'completed',total:0});return r;});}
export async function download(url,name,options={}){
 if(new URL(url).protocol!=='https:')throw Error('下载地址必须使用 HTTPS');
 if(path.basename(name)!==name||['.','..'].includes(name)||name.includes(':'))throw Error('下载文件名无效。');
 const key=name+'|'+(options.hash||url);if(pending.has(key))return pending.get(key);
 const task=retryTransfer(name,url,options,async(record,session)=>{
  const {hash,algorithm='sha256',limit=1024*1024*1024}=options;await mkdir(cache,{recursive:true});const file=path.join(cache,name);record?.update({status:'checking-cache'});
  if(await stat(file).catch(()=>false)){
   let verified=hash&&await hashFile(file,algorithm)===hash.toLowerCase();
   if(!hash){let receipt={};try{receipt=JSON.parse(await readFile(file+'.json','utf8'));}catch{}verified=receipt.url===url&&receipt.sha256===await hashFile(file);}
   if(verified){session?.signal.throwIfAborted();record?.update({status:'cached',bytes:(await stat(file)).size,total:(await stat(file)).size});return file;}
  }
  options.log?.('下载 '+name);record?.update({status:'connecting'});
  try{
   const result=await receive(url,{...options,limit,record,session},(source,bound)=>pipeline(source,bound,createWriteStream(file+'.part')));
   const actual=await hashFile(file+'.part',algorithm);result.signal.throwIfAborted();if(hash&&actual!==hash.toLowerCase())throw Object.assign(Error('下载文件校验不一致：'+name),{code:'INTEGRITY'});
   await rename(file+'.part',file);await writeFile(file+'.json',JSON.stringify({url,sha256:await hashFile(file),verifiedAgainstPublisher:!!hash}));record?.update({status:'completed',total:result.received});return file;
  }catch(e){await unlink(file+'.part').catch(()=>{});throw e;}
 });pending.set(key,task);try{return await task;}finally{pending.delete(key);}
}
export async function releaseAsset(repo,pattern,log=()=>{}){
 const title=repo.split('/')[1];log('正在读取 '+title+' 官方下载信息…');
 const r=await githubRelease(repo,{getJson,getText,log,request:getReleaseRedirect}),asset=r.assets.find(a=>pattern.test(a.name));
 if(!asset)throw Error('官方发布中找不到 Windows 下载文件');let hash=asset.digest?.startsWith('sha256:')?asset.digest.slice(7):undefined;
 const sums=r.assets.find(a=>a.name==='checksums.txt');if(!hash&&sums){const line=(await getText(sums.browser_download_url,{name:title+' 校验清单',log})).split('\n').find(l=>l.trim().endsWith(asset.name));if(line)hash=line.trim().split(/\s+/)[0];}
 const file=await download(asset.browser_download_url,title+'-'+r.tag_name+'-'+asset.name,{hash,log});return {file,version:r.tag_name,verified:!!hash};
}
