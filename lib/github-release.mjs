import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from './system.mjs';
const pending=new Map(),base=path.join(ROOT,'data','github-release-cache');
export async function githubRelease(repo,{getJson,getText,request=fetch,log=()=>{},cacheDir=base,now=Date.now}={}){
 if(!/^[\w.-]+\/[\w.-]+$/.test(repo))throw Error('GitHub 项目名称无效。');
 const key=cacheDir+'|'+repo;if(pending.has(key))return pending.get(key);
 const task=(async()=>{
  await mkdir(cacheDir,{recursive:true});const file=path.join(cacheDir,repo.replace('/','--')+'.json');let saved;try{saved=JSON.parse(await readFile(file,'utf8'));}catch{}
  if(saved?.repo===repo&&Array.isArray(saved.release?.assets)&&now()-saved.savedAt<6*3600000){log('使用 '+repo.split('/')[1]+' 的本机版本信息缓存。');return saved.release;}
  let quota;try{quota=JSON.parse(await readFile(path.join(cacheDir,'quota.json'),'utf8'));}catch{}
  try{
   if(quota?.until>now())throw Object.assign(Error('GitHub API 仍在限流等待期'),{code:'GITHUB_RATE_LIMIT'});
   const release=await getJson('https://api.github.com/repos/'+repo+'/releases/latest',{name:repo.split('/')[1]+' 官方发布信息',log,propagateFailure:true});
   if(!release.tag_name||!Array.isArray(release.assets))throw Error('GitHub 版本信息不完整。');
   await writeFile(file,JSON.stringify({repo,release,savedAt:now()}));return release;
  }catch(e){
   if(e.code==='DOWNLOAD_CANCELLED'||e.code==='DOWNLOAD_PAUSED')throw e;
   if(e.code==='GITHUB_RATE_LIMIT'&&e.retryAt)await writeFile(path.join(cacheDir,'quota.json'),JSON.stringify({until:e.retryAt}));
   log((e.code==='GITHUB_RATE_LIMIT'?'GitHub API 额度已耗尽':'GitHub API 暂时不可用')+'，改用官方发布页面读取下载地址。');
   try{
    const response=await request('https://github.com/'+repo+'/releases/latest',{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(15000)});
    const location=response.headers.get('location'),tagURL=location?new URL(location,'https://github.com'):new URL(response.url||'https://github.com/'+repo+'/releases/latest');
    const prefix='/'+repo+'/releases/tag/';if(tagURL.origin!=='https://github.com'||!tagURL.pathname.startsWith(prefix))throw Error('官方发布页未提供版本地址。');
    const tag=decodeURIComponent(tagURL.pathname.slice(prefix.length));if(!/^[\w.+-]{1,100}$/.test(tag))throw Error('官方版本标识无法识别。');
    const html=await getText('https://github.com/'+repo+'/releases/expanded_assets/'+encodeURIComponent(tag),{name:repo.split('/')[1]+' 官方下载列表',log,propagateFailure:true});
    const assets=[];for(const m of html.matchAll(/href="([^"]+)"/g)){const u=new URL(m[1].replaceAll('&amp;','&'),'https://github.com');if(u.origin==='https://github.com'&&u.pathname.startsWith('/'+repo+'/releases/download/'+encodeURIComponent(tag)+'/'))assets.push({name:decodeURIComponent(u.pathname.split('/').at(-1)),browser_download_url:u.href});}
    if(!assets.length)throw Error('官方发布页未找到下载文件。');const release={tag_name:tag,assets};await writeFile(file,JSON.stringify({repo,release,savedAt:now(),source:'official-web'}));return release;
   }catch(failure){
    if(failure.code==='DOWNLOAD_CANCELLED'||failure.code==='DOWNLOAD_PAUSED')throw failure;
    if(saved?.repo===repo&&Array.isArray(saved.release?.assets)){log('官网查询失败，沿用已缓存版本 '+saved.release.tag_name+'；下载仍来自官方地址。');return saved.release;}
    throw Error('GitHub API 和官方发布页都未能读取。请等待限流恢复或检查网络后重试。'+(e.retryAt?' API 恢复时间：'+new Date(e.retryAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):''));
   }
  }
 })();pending.set(key,task);try{return await task;}finally{pending.delete(key);}
}
