import {mkdir,rename,stat} from 'node:fs/promises';
import path from 'node:path';
export function clientCrashFiles(text){
 const result=[];
 for(const match of text.matchAll(/^-- MOD ([a-zA-Z0-9_.-]+) --\s*$([\s\S]*?)(?=^-- MOD |^-- System Details|$(?![\s\S]))/gm)){
  const block=match[2],file=/^\s*Mod File:\s*.*[\\/]mods[\\/]([^\\/\r\n]+\.jar)\s*$/m.exec(block)?.[1]?.trim();
  const invalidClient=/Attempted to load class net\/minecraft\/client\/\S+ for invalid dist DEDICATED_SERVER/.test(block)||/(?:NoClassDefFoundError: net\/minecraft\/client\/|ClassNotFoundException: net\.minecraft\.client\.)/.test(block);
  if(file&&invalidClient&&!/[\x00-\x1f:]/.test(file)&&file!=='..')result.push({file,modId:match[1],evidence:'Forge 启动失败报告：引用了服务端不存在的 Minecraft 客户端类'});
 }
 return result;
}
export async function isolateCrashMods(files,serverDir,quarantine,log){
 const moved=[];await mkdir(quarantine,{recursive:true});
 for(const item of files){
  if(path.basename(item.file)!==item.file)throw Error('错误报告中的模组文件路径无效');
  const from=path.join(serverDir,'mods',item.file),to=path.join(quarantine,item.file);
  if(!await stat(from).catch(()=>null))continue;
  if(await stat(to).catch(()=>null))throw Error('隔离目录中已存在同名文件：'+item.file);
  await rename(from,to);moved.push(item);log('根据启动错误隔离客户端引用：'+item.file);
 }
 return moved;
}
