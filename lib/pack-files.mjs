import {safeRelative} from './archive.mjs';
export function trustedPackDownloads(file){
 const hosts=new Set(['cdn.modrinth.com','github.com','raw.githubusercontent.com','edge.forgecdn.net','mediafilez.forgecdn.net']);
 return (file.downloads||[]).filter(u=>{try{const url=new URL(u);return url.protocol==='https:'&&hosts.has(url.hostname)&&!url.username&&!url.password;}catch{return false;}});
}
export function serverManifestFiles(manifest,allowed){
 const files=[],seen=new Set();
 for(const file of manifest.files||[]){
  if(file.env?.server==='unsupported')continue;
  const n=safeRelative(file.path);if(!allowed(n))continue;
  const key=n.toLowerCase();if(seen.has(key))throw Error('清单包含重复的服务端文件：'+n);seen.add(key);
  const urls=trustedPackDownloads(file);if(!urls.length)throw Error('文件下载来源不在支持范围：'+n);
  const algorithm=file.hashes?.sha512?'sha512':'sha1',hash=file.hashes?.[algorithm];
  if(!hash||!(algorithm==='sha512'?/^[a-f0-9]{128}$/i:/^[a-f0-9]{40}$/i).test(hash))throw Error('文件没有可验证的哈希：'+n);
  files.push({path:n,urls,algorithm,hash});
 }
 return files;
}
export async function parallelFiles(items,limit,action){
 let cursor=0,failed;
 async function worker(){while(!failed&&cursor<items.length){const i=cursor++;try{await action(items[i],i);}catch(e){failed||=e;}}}
 await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
 if(failed)throw failed;
}
