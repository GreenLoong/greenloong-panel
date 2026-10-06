import {readdir,readFile,lstat,realpath,mkdir,copyFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {ROOT,ps,validPort} from './system.mjs';
import {inspectJar} from './inspect.mjs';
import {javaFor} from './analyze.mjs';
import {DATA,installJava,installPanel,startPanel,registerServerConfig,saveJson,startSavedServer} from './deploy.mjs';
const within=(root,p)=>{const r=path.relative(root,p);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
function properties(text){return Object.fromEntries(text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(s=>s.trim()&&!/^\s*[#!]/.test(s)).map(s=>{const i=s.indexOf('=');return [s.slice(0,i).trim(),s.slice(i+1).trim()];}));}
export async function inspectExistingServer(directory){
 if(!path.isAbsolute(directory))throw Error('请选择完整的服务端文件夹路径。');
 const dir=await realpath(directory),entries=await readdir(dir,{withFileTypes:true});
 if(!entries.some(e=>e.name==='server.properties'))throw Error('这个目录没有 server.properties，请选择服务端根目录。');
 const propertiesText=await readFile(path.join(dir,'server.properties'),'utf8'),props=properties(propertiesText),candidates=[],warnings=[];
 let count=0,bytes=0;const records=[];
 async function scan(folder,relative=''){
  for(const e of await readdir(folder,{withFileTypes:true})){const p=path.join(folder,e.name),n=relative?relative+'/'+e.name:e.name,info=await lstat(p);
   if(info.isSymbolicLink())throw Error('服务端包含目录链接／符号链接：'+n+'。请先将链接内容整理成普通文件夹再导入。');
   if(info.isDirectory())await scan(p,n);else if(info.isFile()){count++;bytes+=info.size;if(count>150000)throw Error('服务端文件过多，请整理后再导入。');records.push(n+'\0'+info.size+'\0'+info.mtimeMs);
    const m=/^libraries\/net\/(minecraftforge\/forge|neoforged\/neoforge)\/([^/]+)\/win_args\.txt$/i.exec(n);
    if(m){const v=/^(1\.\d+(?:\.\d+)?)-(.+)$/.exec(m[2]);candidates.push({key:n,kind:m[1].startsWith('minecraftforge')?'forge':'neoforge',mc:v?.[1]||null,loaderVersion:v?.[2]||m[2],args:['@'+n,'nogui']});}
   }
  }
 }
 await scan(dir);
 for(const e of entries.filter(e=>e.isFile()&&/\.jar$/i.test(e.name))){
  const file=path.join(dir,e.name);if((await stat(file)).size>1024**3){warnings.push('根目录 JAR 过大，未自动检查：'+e.name);continue;}
  try{const j=await inspectJar(await readFile(file));if(j.main&&!j.installer){const named=/forge-(1\.\d+(?:\.\d+)?)-([\d.]+)/i.exec(e.name);candidates.push({key:e.name,kind:j.core||'java',mc:j.mc||named?.[1]||null,loaderVersion:j.loaderVersion||named?.[2]||'',args:['-jar',e.name,'nogui'],main:j.main});}}catch{warnings.push('无法识别 JAR 元数据：'+e.name);}
 }
 const jvmArgs=[];let memory=8;
 if(entries.some(e=>e.name==='user_jvm_args.txt')){
  const text=await readFile(path.join(dir,'user_jvm_args.txt'),'utf8');jvmArgs.push('@user_jvm_args.txt');const x=/-Xmx(\d+)([GM])/i.exec(text);if(x)memory=Math.ceil(Number(x[1])/(x[2].toUpperCase()==='M'?1024:1));
 }
 // Read scripts only as evidence; no shell commands from an old installation are executed.
 const scripts=[];
 for(const e of entries.filter(e=>e.isFile()&&/\.(bat|cmd|sh|ps1)$/i.test(e.name))){if((await stat(path.join(dir,e.name))).size>262144)continue;const text=await readFile(path.join(dir,e.name),'utf8');scripts.push({name:e.name,text});}
 let selected=null;const hits=candidates.filter(c=>scripts.some(s=>s.text.includes(c.key)||s.text.includes(c.key.replaceAll('/','\\'))));
 if(hits.length===1)selected=hits[0];else if(candidates.length===1)selected=candidates[0];
 if(selected){
  for(const script of scripts){const line=script.text.split(/\r?\n/).find(l=>/\bjava(?:\.exe)?\b/i.test(l)&&l.includes(selected.key));if(!line)continue;
   const before=line.slice(0,line.indexOf(selected.key)),x=/-Xmx(\d+)([GM])/i.exec(before);if(x)memory=Math.ceil(Number(x[1])/(x[2].toUpperCase()==='M'?1024:1));
   const flags=before.match(/(?:"[^"\r\n]*"|[^\s"]+)/g)||[];
   for(const flag of flags.map(t=>t.replace(/^"|"$/g,''))){if(/^-(?:D|XX:|X(?!m[xs]))/.test(flag)&&!/[<>|&%$`]/.test(flag)&&!jvmArgs.includes(flag))jvmArgs.push(flag);}
   break;
  }
 }
 const fingerprint=createHash('sha256').update(records.sort().join('\n')).digest('hex');
 const eula=await readFile(path.join(dir,'eula.txt'),'utf8').catch(()=> '');
 if(scripts.length)warnings.push('原启动脚本仅用于识别入口，不直接执行；自定义备份、代理等附加脚本需要另行配置。');
 if(!/^\s*eula\s*=\s*true\s*$/mi.test(eula))warnings.push('原服务端尚未确认 EULA，导入后启动前需在服务端目录完成确认。');
 if(!candidates.length)warnings.push('未找到可用的 Java 服务端入口。请确认原服务端核心已安装完整。');
 if(!selected&&candidates.length>1)warnings.push('发现多个启动入口，请选择原服务器使用的入口。');
 return {directory:dir,name:path.basename(dir),candidates,selectedKey:selected?.key||'',mc:selected?.mc||'',java:selected?.mc?javaFor(selected.mc):null,memory:Math.min(24,Math.max(2,memory)),port:validPort(props['server-port']||25565),world:props['level-name']||'world',eula:/^\s*eula\s*=\s*true\s*$/mi.test(eula),jvmArgs,fileCount:count,bytes,fingerprint,warnings};
}
export async function copyExistingServer(source,destination){
 const src=await realpath(source),dest=path.resolve(destination);if(within(src,dest)||within(dest,src))throw Error('导入目录不能与原服务器目录互相包含。');
 await mkdir(dest,{recursive:false});let files=0;
 async function copy(from,to){for(const e of await readdir(from,{withFileTypes:true})){const p=path.join(from,e.name),q=path.join(to,e.name),info=await lstat(p);if(info.isSymbolicLink())throw Error('复制期间出现目录链接，请停止旧服务后重试。');if(info.isDirectory()){await mkdir(q);await copy(p,q);}else if(info.isFile()){await copyFile(p,q,1);const fresh=await stat(p);if(fresh.size!==info.size||fresh.mtimeMs!==info.mtimeMs)throw Error('复制期间原服务器文件发生变化，请停止旧服务后重试。');files++;}}}
 await copy(src,dest);return files;
}
export async function importExistingServer(plan,input,log=()=>{},deps={}){
 const report=await (deps.inspect||inspectExistingServer)(plan.directory);
 if(report.fingerprint!==plan.fingerprint)throw Error('分析后原服务器文件发生变化，请停止旧服务并重新分析。');
 const core=report.candidates.find(c=>c.key===(input.existingCore||report.selectedKey));if(!core)throw Error('请选择可识别的服务端启动入口。');
 const mc=String(input.existingMC||core.mc||report.mc||'').trim(),java=Number(input.existingJava||javaFor(mc));
 if(![8,16,17,21,25].includes(java))throw Error('无法确定 Java 版本，请选择原服务器使用的 Java 版本。');
 if(input.existingStart&&!report.eula)throw Error('原服务端 eula.txt 尚未确认，请先在原服务端完成 EULA 确认；也可以取消“导入后启动”。');
 const port=validPort(input.existingPort||report.port),memory=Number(input.existingMemory||report.memory);
 if(!Number.isInteger(memory)||memory<2||memory>24)throw Error('服务端内存应为 2～24 GB。');
 const recordsPath=deps.recordsPath||path.join(DATA,'existing-imports.json');
 const records=JSON.parse(await readFile(recordsPath,'utf8').catch(()=> '[]'));
 const importKey=createHash('sha256').update(JSON.stringify([report.directory.toLowerCase(),report.fingerprint,core.key,java,port,memory])).digest('hex');
 const previous=records.find(r=>r.key===importKey&&/^[a-f0-9-]{36}$/.test(r.id));
 if(previous){
  const previousDir=path.join(DATA,'servers',previous.id),cfg=JSON.parse(await readFile(path.join(previousDir,'greenloong.json'),'utf8').catch(()=> 'null'));
  if(cfg?.imported&&await stat(path.join(ROOT,cfg.javaRelative)).catch(()=>false)){
   await (deps.panel||installPanel)(log);await (deps.startPanel||startPanel)(log);
   const instance=await (deps.register||registerServerConfig)(cfg,input,log,true);log('这个服务端已导入，复用原管理实例和存档。');
   const savedNetwork=JSON.parse(await readFile(path.join(DATA,'network.json'),'utf8').catch(()=> 'null'));
   const warning=savedNetwork?.port!==cfg.port?'请使用“应用域名和防火墙配置”放行导入服务器的游戏端口 '+cfg.port+'。':null;
   if(input.existingStart){const started=await (deps.start||startSavedServer)(input,log);return {...started,imported:true,reused:true,networkError:[started.networkError,warning].filter(Boolean).join(' ')||null};}
   return {imported:true,reused:true,instance,config:cfg,sourcePreserved:true,networkError:warning};
  }
 }
 if((await (deps.ports||(()=>ps('ports',{ports:[report.port,port]})))()).conflicts.length)throw Error('旧游戏端口或目标端口仍被占用，请先正常停止旧服务器，再导入；不会强制结束旧进程。');
 const id=randomUUID(),directory=path.join(DATA,'servers',id);await mkdir(path.dirname(directory),{recursive:true});
 log(`正在复制原服务器，${report.fileCount} 个文件，保留全部存档、模组和配置…`);
 await (deps.copy||copyExistingServer)(report.directory,directory);
 const copied=await readFile(path.join(directory,'server.properties'),'utf8');
 if(port!==report.port){const lines=copied.split(/\r?\n/).filter(l=>!/^\s*server-port\s*=/.test(l));await saveText(path.join(directory,'server.properties'),lines.join('\n')+'\nserver-port='+port+'\n');}
 const javaExe=await (deps.java||installJava)(java,log);
 const cfg={id,mc:mc||'原服务端版本',ready:true,loader:core.kind,loaderVersion:core.loaderVersion||'',selectedCore:core.kind,java,port,memory,directory:path.relative(ROOT,directory),javaRelative:path.relative(ROOT,javaExe),args:core.args,jvmArgs:report.jvmArgs,status:'imported-not-started',imported:true,sourceDirectory:report.directory,sourceFingerprint:report.fingerprint};
 await saveJson(path.join(directory,'greenloong.json'),cfg);
 await (deps.panel||installPanel)(log);await (deps.startPanel||startPanel)(log);
 // Register before selecting the new server; registration failure leaves the previous selection intact.
 const instance=await (deps.register||registerServerConfig)(cfg,input,log,true);
 await saveJson(recordsPath,[...records.filter(r=>r.key!==importKey),{key:importKey,id}]);
 log('原服务端已导入 MCSManager，原目录保留。');
 const network=JSON.parse(await readFile(path.join(DATA,'network.json'),'utf8').catch(()=> 'null'));
 const networkError=network?.port!==port?'请使用“应用域名和防火墙配置”放行导入服务器的游戏端口 '+port+'。':null;
 if(input.existingStart){const result=await (deps.start||startSavedServer)(input,log);return {...result,imported:true,networkError:[result.networkError,networkError].filter(Boolean).join(' ')||null};}
 return {imported:true,instance,config:cfg,sourcePreserved:true,networkError};
}
async function saveText(file,text){const {writeFile}=await import('node:fs/promises');await writeFile(file,text,'utf8');}
