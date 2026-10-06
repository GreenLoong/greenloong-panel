import {readFile,mkdir,rename,readdir} from 'node:fs/promises';
import path from 'node:path';
import {inspectJar} from './inspect.mjs';
import {download} from './download.mjs';
import {createHash} from 'node:crypto';
export async function curseFiles(manifest,key,log){
 if(!key)throw Error('此 CurseForge 客户端包需要 API Key 下载模组，或改用包含完整模组文件的 ZIP');
 const files=[];
 for(const f of manifest.files||[]){
  if(!Number.isInteger(f.projectID)||!Number.isInteger(f.fileID))throw Error('CurseForge 清单项目编号无效');
  const r=await fetch(`https://api.curseforge.com/v1/mods/${f.projectID}/files/${f.fileID}`,{headers:{'x-api-key':key},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error(`CurseForge 文件信息读取失败（HTTP ${r.status}），请检查 API Key`);
  const item=(await r.json()).data;if(!item?.downloadUrl)throw Error(`作者未允许自动下载：项目 ${f.projectID}／文件 ${f.fileID}。请使用作者的完整服务端包。`);
  const u=new URL(item.downloadUrl);if(u.protocol!=='https:'||!u.hostname.endsWith('.forgecdn.net'))throw Error('CurseForge 返回了未支持的下载来源');
  const hash=item.hashes?.find(h=>h.algo===1);if(!hash)throw Error('CurseForge 下载文件缺少 SHA-1 校验值');
  if(!/\.jar$/i.test(item.fileName)||/[\\/:]/.test(item.fileName))throw Error('清单含有非模组文件，需要人工处理：'+item.fileName);
  files.push({file:await download(item.downloadUrl,hash.value+'.jar',{hash:hash.value,algorithm:'sha1',log}),name:item.fileName});
 }
 return files;
}
export async function filterClientMods(dir,quarantine,log){
 const mods=path.join(dir,'mods'),removed=[],remaining=[];
 const scanned=[];
 for(const name of await readdir(mods).catch(()=>[])){
  if(!name.endsWith('.jar'))continue;
  let info,hash;try{const bytes=await readFile(path.join(mods,name));hash=createHash('sha1').update(bytes).digest('hex');info=await inspectJar(bytes);}catch{remaining.push({name,environment:'unknown'});continue;}
  scanned.push({name,hash,info});
 }
 // Forge metadata often does not declare the mod's runtime side. Match exact
 // file hashes to Modrinth projects; only explicit server_side=unsupported removes.
 const unknown=scanned.filter(m=>m.info.environment==='unknown');
 if(unknown.length)try{
  const versions={};
  for(let i=0;i<unknown.length;i+=200){const r=await fetch('https://api.modrinth.com/v2/version_files',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'GreenLoongInstaller/0.1'},body:JSON.stringify({hashes:unknown.slice(i,i+200).map(m=>m.hash),algorithm:'sha1'}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('unavailable');Object.assign(versions,await r.json());}
  const ids=[...new Set(Object.values(versions).map(v=>v.project_id))],projects=[];
  for(let i=0;i<ids.length;i+=100){const r=await fetch('https://api.modrinth.com/v2/projects?ids='+encodeURIComponent(JSON.stringify(ids.slice(i,i+100))),{headers:{'User-Agent':'GreenLoongInstaller/0.1'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('unavailable');projects.push(...await r.json());}
  const unsupported=new Set(projects.filter(p=>p.server_side==='unsupported').map(p=>p.id));
  for(const m of unknown)if(unsupported.has(versions[m.hash]?.project_id)){m.info.environment='client';m.info.sideEvidence='Modrinth exact file hash + server_side=unsupported';}
 }catch{log('在线端别信息未能完整取得；未确定模组保留，交给试启动检查。');}
 for(const {name,info} of scanned){
  if(info.environment==='client'){await mkdir(quarantine,{recursive:true});await rename(path.join(mods,name),path.join(quarantine,name));removed.push({name,id:info.id});log('排除仅客户端模组：'+name);}else remaining.push({name,...info});
 }
 const removedIds=new Set(removed.map(m=>m.id).filter(Boolean));
 const broken=remaining.flatMap(m=>Object.keys(m.depends||{}).filter(id=>removedIds.has(id)).map(id=>`${m.name} 依赖已排除的 ${id}`));
 if(broken.length)throw Error('转换后有依赖冲突，需要调整整合包：'+broken.join('；'));
 return {removed,uncertain:remaining.filter(m=>m.environment==='unknown').map(m=>m.name)};
}
