import {mkdir,readFile,writeFile,copyFile,readdir,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {ROOT,run,ps,validPort} from './system.mjs';
import {readZip,extract,safeRelative} from './archive.mjs';
import {download,getJson,releaseAsset,hashFile} from './download.mjs';
import {resolveCorePlan,downloadCore} from './core-catalog.mjs';
import {curseFiles,filterClientMods} from './convert.mjs';
import {serverManifestFiles,parallelFiles} from './pack-files.mjs';
import {aliyunAAAA} from './alidns-check.mjs';
import {detectDNSProvider,cloudflareAAAA,cloudflareCredentials,configContainsDomain} from './dns-provider.mjs';
import {waitForMinecraft} from './minecraft-status.mjs';
import {refreshSavedDNS} from './startup-dns.mjs';
import {stopManagedInstance} from './managed-stop.mjs';
import {networkPreview,assertNetworkPreview} from './network-preflight.mjs';
export const DATA=path.join(ROOT,'data');
export async function saveJson(p,data){await mkdir(path.dirname(p),{recursive:true});await writeFile(p,JSON.stringify(data,null,2),'utf8');}
export async function findFile(dir,predicate){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isFile()&&predicate(e.name,p))return p;if(e.isDirectory()){const found=await findFile(p,predicate);if(found)return found;}}return null;}
export async function installPanel(log){
 const location=path.join(DATA,'panel.json');const existing=JSON.parse(await readFile(location,'utf8').catch(()=>'null'));if(existing&&await stat(existing.web).catch(()=>false))return existing;
 const r=await releaseAsset('MCSManager/MCSManager',/^mcsmanager_windows_release\.zip$/,log);
 log('MCSManager 下载已校验，正在解压安装…');
 const dir=path.join(DATA,'mcsmanager',r.version+'-'+randomUUID().slice(0,8));await mkdir(dir,{recursive:true});await extract(await readZip(r.file),dir);
 const web=await findFile(dir,(n,p)=>n==='app.js'&&/web/i.test(p)),daemon=await findFile(dir,(n,p)=>n==='app.js'&&/daemon/i.test(p));
 if(!web||!daemon)throw Error('MCSManager 发布包结构改变，请检查官方安装包');
 await saveJson(path.join(path.dirname(web),'data','SystemConfig','config.json'),{httpIp:'127.0.0.1',httpPort:23333,language:'zh_cn',enableApiKey:'ONLY_ADMIN'});
 await saveJson(path.join(path.dirname(daemon),'data','Config','global.json'),{ip:'127.0.0.1',port:24444,key:randomUUID().replaceAll('-',''),language:'zh_cn'});
 const config={web,daemon,version:r.version};await saveJson(location,config);log('MCSManager 已安装，首次打开需创建管理员账号。');return config;
}
export async function startPanel(log){
 const cfg=JSON.parse(await readFile(path.join(DATA,'panel.json'),'utf8'));
 const conflicts=(await ps('ports',{ports:[23333,24444]})).conflicts;
 const roles=[['daemon',cfg.daemon,24444],['web',cfg.web,23333]];
 const responds=async port=>{try{const r=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(1000)});return r.ok&&(await r.text()).includes(port===24444?'MCSManager Daemon':'MCSManager');}catch{return false;}};
 const missing=[];
 for(const role of roles){if(conflicts.some(c=>c.port===role[2])){if(!await responds(role[2]))throw Error(`端口 ${role[2]} 已被其他服务占用，请检查端口冲突。`);}else missing.push(role);}
 if(!missing.length){log('MCSManager 已运行，继续使用现有面板和节点。');return {url:'http://127.0.0.1:23333/'};}
 // MCSManager uses on-disk bind settings, not an --ip CLI argument.
 const temporary=path.join(DATA,'tmp');await mkdir(temporary,{recursive:true});
 let startupError;
 for(const [role,script] of missing){
  const dir=path.dirname(script),configFile=path.join(dir,'data',role==='web'?'SystemConfig':'Config',role==='web'?'config.json':'global.json');
  const settings=JSON.parse(await readFile(configFile,'utf8').catch(()=>'{}'));
  if(role==='web'){settings.httpIp='127.0.0.1';settings.httpPort=23333;settings.enableApiKey='ONLY_ADMIN';}else{settings.ip='127.0.0.1';settings.port=24444;settings.key||=randomUUID().replaceAll('-','');}
  await saveJson(configFile,settings);
  const p=spawn(path.join(dir,'node_app.exe'),[script],{cwd:dir,windowsHide:true,detached:true,stdio:'ignore',env:{...process.env,TEMP:temporary,TMP:temporary}});p.on('error',e=>{startupError=e;});p.unref();log(role==='daemon'?'正在启动 MCSManager 节点…':'正在启动 MCSManager 面板…');
 }
 log('面板启动请求已提交，正在等待本机端口响应。');
 for(let n=0;n<40;n++){if(startupError)throw Error('MCSManager 启动失败：'+startupError.message);if((await Promise.all(roles.map(r=>responds(r[2])))).every(Boolean))return {url:'http://127.0.0.1:23333/'};await new Promise(r=>setTimeout(r,500));}
 throw Error('面板未在预期时间内响应，请检查其日志。');
}
export async function setupNetwork(input,log){
 const port=validPort(input.port),domain=String(input.domain||'').trim().toLowerCase();
 if(!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))throw Error('请输入完整域名，例如 mc.example.com');
 // DNS and firewall configuration is valid while the game server is listening.
 // Port ownership is checked when preparing or starting a server, not here.
 const request=path.join(DATA,'admin-request.json');
 const oldRequest=JSON.parse(await readFile(request,'utf8').catch(()=>'null'));
 const oldResult=JSON.parse((await readFile(request+'.result','utf8').catch(()=>'null')).replace(/^\uFEFF/,''));
 let ddnsExe,ddnsConfig,configChanged=false,preflight;
 if(input.ddns){
  preflight=await networkPreview(input);
  assertNetworkPreview(preflight,input);
  const stored=JSON.parse(await readFile(path.join(DATA,'private','ddns.yaml'),'utf8').catch(()=> 'null'));
  const authority=await detectDNSProvider(domain),provider=authority.provider;
  if(provider==='unsupported')throw Error('此域名的 DNS 服务商暂不在自动部署支持范围内。');
  if(input.dnsProvider&&input.dnsProvider!=='auto'&&input.dnsProvider!==provider)throw Error('所选服务商与域名实际的 DNS 服务器不一致，请先确认解析服务商。');
  const auth=provider==='cloudflare'?cloudflareCredentials(input,stored,domain):networkCredentials(input,stored,domain);
  if(provider==='cloudflare')await cloudflareAAAA(auth.secret,authority.zone,domain);else await aliyunAAAA(auth,domain);
  log('实际 DNS 服务商：'+(provider==='cloudflare'?'Cloudflare':'阿里云')+'。');
  const network=await ps('network');
  const savedCommand=stored?.dnsconf?.find(c=>configContainsDomain(c,domain))?.ipv6?.cmd||'';
  const savedGuid=/-InterfaceGuid\s+"([^"]+)"/.exec(savedCommand)?.[1];
  const targetGuid=input.interfaceGuid||savedGuid||network.addresses.find(a=>!a.temporary)?.guid;
  const candidate=network.addresses.find(a=>a.guid===targetGuid&&!a.temporary);if(!candidate)throw Error('所选网卡没有可用的非临时公网 IPv6 地址，请重新检测并选择网卡。');
  if(preflight.service.ownership==='owned'&&await stat(preflight.service.exe).catch(()=>false))ddnsExe=preflight.service.exe;
  else if(oldRequest?.ddnsExe&&path.resolve(oldRequest.ddnsExe).startsWith(path.join(DATA,'ddns')+path.sep)&&await stat(oldRequest.ddnsExe).catch(()=>false))ddnsExe=oldRequest.ddnsExe;
  else{const r=await releaseAsset('jeessy2/ddns-go',/windows_x86_64\.zip$/,log);const dir=path.join(DATA,'ddns',r.version);if(!await stat(path.join(dir,'ddns-go.exe')).catch(()=>false)){await mkdir(dir,{recursive:true});await extract(await readZip(r.file),dir);}ddnsExe=path.join(dir,'ddns-go.exe');}
  const secretDir=path.join(DATA,'private');ddnsConfig=path.join(secretDir,'ddns.yaml');
  const script=path.join(ROOT,'scripts','get-ip.ps1');
  const cmd=`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${script}" -InterfaceGuid "${candidate.guid}"`;
  // JSON is a YAML-compatible representation; ddns-go's yaml.v3 decoder accepts it.
  const retained=(stored?.dnsconf||[]).map(c=>({...c,ipv4:{...c.ipv4,domains:(c.ipv4?.domains||[]).filter(d=>d.split('?')[0]!==domain)},ipv6:{...c.ipv6,domains:(c.ipv6?.domains||[]).filter(d=>d.split('?')[0]!==domain)}})).filter(c=>c.ipv4.domains.length||c.ipv6.domains.length);
  const desired={dnsconf:[...retained,{name:'Minecraft IPv6',ipv4:{enable:false},ipv6:{enable:true,gettype:'cmd',cmd,domains:[provider==='cloudflare'?domain+'?proxied=false':domain]},dns:{name:provider,id:auth.id,secret:auth.secret},ttl:'600'}],user:{username:'',password:''},notallowwanaccess:true,lang:'zh'};
  const previous=JSON.parse(await readFile(ddnsConfig,'utf8').catch(()=> 'null'));configChanged=JSON.stringify(previous)!==JSON.stringify(desired);
  if(configChanged){await mkdir(secretDir,{recursive:true});await ps('protect',{path:secretDir});await saveJson(ddnsConfig,desired);}
 }
 const desiredRequest={port,domain,firewall:!!input.firewall,ddns:!!input.ddns,ddnsExe,ddnsConfig,...(preflight?.service.ownership==='foreign'?{takeOverDdns:true,expectedServiceBinaryPath:preflight.service.binaryPath,expectedLegacyDomain:preflight.service.domains[0]}:{} )};
 const applied=networkRequestAlreadyApplied(oldRequest,desiredRequest,oldResult,configChanged);await saveJson(request,desiredRequest);
 if(applied)log('已复用已应用的网络配置，ddns-go 继续自动更新地址。');
 else if(input.firewall||input.ddns){log('等待 Windows 管理员授权：创建游戏端口规则／注册 DDNS 服务。');try{await ps('elevate',{request});}catch(e){const result=JSON.parse((await readFile(request+'.result','utf8').catch(()=>'{}')).replace(/^\uFEFF/,''));throw Error(result.error||e.message);}}
 const oldNetwork=JSON.parse(await readFile(path.join(DATA,'network.json'),'utf8').catch(()=> 'null'));
 await saveJson(path.join(DATA,'network.json'),{domain,port,interfaceGuid:preflight?.interfaceGuid||input.interfaceGuid,machineId:preflight?.machineId,knownAddresses:preflight?[...new Set([...(oldNetwork?.domain===domain&&oldNetwork?.machineId===preflight.machineId?oldNetwork.knownAddresses||[]:[]),preflight.currentIPv6])].slice(-8):[]});
 log('本机配置完成。DNS 更新和路由器外网入站仍需验证。');return {domain,port};
}
export function networkRequestAlreadyApplied(oldRequest,desired,result,configChanged){return !configChanged&&result?.ok===true&&JSON.stringify(oldRequest)===JSON.stringify(desired);}
export function networkCredentials(input,stored,domain){
 if(input.accessId&&input.accessSecret)return {id:input.accessId,secret:input.accessSecret};
 const saved=stored?.dnsconf?.find(c=>c.dns?.name==='alidns'&&c.ipv6?.domains?.includes(domain))?.dns;
 if(saved?.id&&saved?.secret&&(!input.accessId||input.accessId===saved.id))return {id:input.accessId||saved.id,secret:input.accessSecret||saved.secret};
 throw Error('首次配置或更换 AccessKey ID 时，请在本地填写完整的阿里云 ID 和对应 Secret。');
}
export async function installJava(version,log){
 const dir=path.join(DATA,'java',String(version));const existing=await findFile(dir,n=>n==='java.exe').catch(()=>null);if(existing)return existing;
 const assets=await getJson(`https://api.adoptium.net/v3/assets/latest/${version}/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse`);
 const pkg=assets[0]?.binary?.package;if(!pkg)throw Error('找不到对应的 Java Windows 版本');
 const zip=await download(pkg.link,pkg.name,{hash:pkg.checksum,log});await mkdir(dir,{recursive:true});await extract(await readZip(zip),dir);const java=await findFile(dir,n=>n==='java.exe');if(!java)throw Error('Java 安装包无 java.exe');return java;
}
export async function deployPack(file,report,input,log){
 const port=validPort(input.port),memory=Number(input.memory);if(!Number.isInteger(memory)||memory<2||memory>24)throw Error('内存应为 2～24 GB');
 if(!input.eula)throw Error('请阅读并确认 Minecraft EULA');
 const conflicts=(await ps('ports',{ports:[port]})).conflicts;if(conflicts.length)throw Error('游戏端口被占用，无法部署到此端口');
 const plan=await resolveCorePlan(report,input);if(!plan.ready)throw Error(plan.reason);
 const {mc,core,selected}=plan;log(plan.reason);
 const id=randomUUID(),dir=path.join(DATA,'servers',id);await mkdir(dir,{recursive:true});
 log(`选择 ${core.loader} ${core.loaderVersion}，Minecraft ${mc}，Java ${core.java}`);
 const zip=await readZip(file);
 // Allow only server content, never imported launchers, credentials or binaries.
 const allowed=n=>/^(mods|plugins|config|defaultconfigs|kubejs|scripts|datapacks|resourcepacks|world)\//i.test(n)||/^(server\.properties|pack\.png)$/i.test(n);
 const copy=(prefix)=>extract(zip,dir,e=>{if(!e.name.startsWith(prefix))return null;const n=e.name.slice(prefix.length);return allowed(n)?n:null;});
 if(report.format==='modrinth'){
  const files=serverManifestFiles(report.manifest,allowed);let completed=0;
  log(`客户端清单包：准备 ${files.length} 个服务端文件，最多同时下载 4 个。`);
  await parallelFiles(files,4,async f=>{
   let downloaded,lastError;
   for(const url of f.urls){try{downloaded=await download(url,f.hash+'.jar',{hash:f.hash,algorithm:f.algorithm,log:()=>{}});break;}catch(e){lastError=e;}}
   if(!downloaded)throw Error('下载文件失败：'+path.basename(f.path)+'；'+lastError.message);
   const target=path.join(dir,f.path);await mkdir(path.dirname(target),{recursive:true});await copyFile(downloaded,target);completed++;
   log(`准备文件 ${completed}/${files.length}：${path.basename(f.path)}`);
  });
  const common=path.join(DATA,'staging',id+'-common');await mkdir(common,{recursive:true});await extract(zip,common,e=>{const p=report.root+'overrides/';const n=e.name.startsWith(p)?e.name.slice(p.length):'';return n&&allowed(n)?n:null;});await copyTree(common,dir);
  // server-overrides takes precedence; stage separately to preserve duplicate-file checks.
  const over=path.join(DATA,'staging',id);await mkdir(over,{recursive:true});await extract(zip,over,e=>{const p=report.root+'server-overrides/';const n=e.name.startsWith(p)?e.name.slice(p.length):'';return n&&allowed(n)?n:null;});
  await copyTree(over,dir);
 }else if(report.format==='curseforge'){
  await copy(report.root+(report.manifest.overrides||'overrides')+'/');
  await mkdir(path.join(dir,'mods'),{recursive:true});
  for(const f of await curseFiles(report.manifest,input.curseKey,log))await copyFile(f.file,path.join(dir,'mods',f.name));
 }else await copy(report.root);
 const conversion=await filterClientMods(dir,path.join(DATA,'quarantine',id),log);
 await saveJson(path.join(dir,'conversion-report.json'),{packType:report.packType,existingCore:report.existingCore,selected,conversion,excludedManifestFiles:report.excluded||[],validation:'not-started'});
 const java=await installJava(core.java,log);let args;
 if(report.existingCore){
  const saved=report.existingCore;
  await extract(zip,dir,e=>{if(!e.name.startsWith(report.root))return null;const n=e.name.slice(report.root.length);return n.startsWith('libraries/')||(!n.includes('/')&&n.endsWith('.jar'))?n:null;});
  args=saved.argsFile?['@'+saved.argsFile,'nogui']:['-jar',saved.jar,'nogui'];
 }else if(plan.kind==='mohist'){
  await copyFile(await downloadCore(selected,log),path.join(dir,'server.jar'));args=['-jar','server.jar','nogui'];
 }else if(core.loader==='fabric'){
  const installers=await getJson('https://meta.fabricmc.net/v2/versions/installer');const installer=installers.find(i=>i.stable)||installers[0];if(!installer)throw Error('找不到官方 Fabric 安装器');
  const url=`https://meta.fabricmc.net/v2/versions/loader/${mc}/${core.loaderVersion}/${installer.version}/server/jar`;
  await copyFile(await download(url,`fabric-${mc}-${core.loaderVersion}.jar`,{log}),path.join(dir,'server.jar'));args=['-jar','server.jar','nogui'];
 }else{
  const v=core.loader==='forge'?`${mc}-${core.loaderVersion}`:core.loaderVersion;
  const url=core.loader==='forge'?`https://maven.minecraftforge.net/net/minecraftforge/forge/${v}/forge-${v}-installer.jar`:`https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`;
  const installer=await download(url,`${core.loader}-${v}-installer.jar`,{log});log('正在运行官方加载器安装器，可能需要数分钟。');
  await run(java,['-jar',installer,'--installServer',dir],{cwd:dir});
  const argfile=await findFile(path.join(dir,'libraries'),n=>n==='win_args.txt').catch(()=>null);
  if(argfile)args=['@'+path.relative(dir,argfile),'nogui'];
  else{const jar=await findFile(dir,n=>/^forge-.*\.jar$/.test(n)&&!n.includes('installer'));if(!jar)throw Error('未找到加载器启动文件');args=['-jar',path.relative(dir,jar),'nogui'];}
  if(plan.kind==='spongeforge'){await mkdir(path.join(dir,'mods'),{recursive:true});await copyFile(await downloadCore(selected,log),path.join(dir,'mods','spongeforge-'+selected.version+'.jar'));}
 }
 const propsPath=path.join(dir,'server.properties');let props=await readFile(propsPath,'utf8').catch(()=>'');
 for(const [k,v] of Object.entries({'server-ip':'','server-port':port,'enable-rcon':'false','enable-query':'false','online-mode':'true','max-players':'10','view-distance':'8','simulation-distance':'6'})){props=props.split(/\r?\n/).filter(l=>!l.startsWith(k+'=')).join('\n');props+=`\n${k}=${v}`;}
 await writeFile(propsPath,props.trim()+'\n');await writeFile(path.join(dir,'eula.txt'),'eula=true\n');
 const config={id,mc,...core,selectedCore:plan.kind,sourceUpload:path.basename(file),port,memory,javaRelative:path.relative(ROOT,java),args,directory:path.relative(ROOT,dir),status:'prepared-not-tested'};
 await saveJson(path.join(dir,'greenloong.json'),config);
 const launcher=`@echo off\r\ncd /d "%~dp0"\r\n"%~dp0..\\..\\..\\runtime\\node.exe" "%~dp0..\\..\\..\\run-server.mjs" "%~dp0greenloong.json"\r\n`;
 await writeFile(path.join(dir,'start.cmd'),launcher,'ascii');await saveJson(path.join(DATA,'last-server.json'),config);
 log('服务器文件已准备，尚未启动验证。可导入 MCSManager 后启动查看日志。');return config;
}
async function copyTree(from,to){for(const e of await readdir(from,{withFileTypes:true})){const s=path.join(from,e.name),d=path.join(to,e.name);if(e.isDirectory()){await mkdir(d,{recursive:true});await copyTree(s,d);}else await copyFile(s,d);}}
export async function importPanel(input={},log=()=>{}){
 const cfg=JSON.parse(await readFile(path.join(DATA,'last-server.json'),'utf8'));
 return registerServerConfig(cfg,input,log);
}
export async function registerServerConfig(cfg,input={},log=()=>{},select=false){
 const api=await panelClient(input);
 let daemon;
 for(let i=0;i<(select?40:1);i++){const daemons=await api('/api/service/remote_services');const list=Array.isArray(daemons)?daemons:daemons.data;daemon=list?.find(d=>d.available&&['127.0.0.1','localhost','::1'].includes(d.ip));if(daemon)break;await new Promise(r=>setTimeout(r,750));}
 if(!daemon)throw Error('MCSManager 尚未连接本机节点，请先在面板完成初始化。');
 const cwd=path.join(ROOT,cfg.directory);
 const existing=daemon.instances?.find(i=>i.config?.cwd&&path.resolve(i.config.cwd).toLowerCase()===path.resolve(cwd).toLowerCase());
 const body=panelInstanceConfig(cfg);
 const result=existing?{instanceUuid:existing.instanceUuid,nickname:existing.config.nickname,existing:true}:await api('/api/instance?daemonId='+encodeURIComponent(daemon.uuid),'POST',body);
 const updateOldWrapper=existing&&/start\.cmd/i.test(existing.config.startCommand||'');
 if(existing&&(updateOldWrapper||(process.platform==='win32'&&existing.config.terminalOption?.pty!==false))){
  if(existing.status!==0)throw Error('需要先正常停止实例，才能更新旧启动方式。');
  await api('/api/instance?daemonId='+encodeURIComponent(daemon.uuid)+'&uuid='+encodeURIComponent(existing.instanceUuid),'PUT',{...existing.config,startCommand:body.startCommand,terminalOption:{...existing.config.terminalOption,pty:body.terminalOption.pty}});
 }
 const latest=JSON.parse(await readFile(path.join(DATA,'last-server.json'),'utf8').catch(()=> 'null'));
 if(select||latest?.id===cfg.id){const selected={...(select?cfg:latest),panelInstance:result.instanceUuid,panelDaemon:daemon.uuid};await saveJson(path.join(cwd,'greenloong.json'),selected);await saveJson(path.join(DATA,'last-server.json'),selected);}
 log(existing?'服务器实例已在 MCSManager 中，继续使用现有实例。':'已自动创建 MCSManager 实例：'+result.nickname);
 return {instanceUuid:result.instanceUuid,daemonId:daemon.uuid,nickname:result.nickname,existing:!!existing};
}
async function panelClient(input){
 const apiKey=await panelApiKey(input.apiKey);
 return async(route,method='GET',body)=>{const u=new URL('http://127.0.0.1:23333'+route);u.searchParams.set('apikey',apiKey);const r=await fetch(u,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});const j=await r.json();if(j.status!==200)throw Error('MCSManager API 操作失败，请确认管理员 API Key 和节点连接。');return j.data;};
}
export async function startSavedServer(input={},log=()=>{},{signal}={}){
 signal?.throwIfAborted();
 const cfg=JSON.parse(await readFile(path.join(DATA,'last-server.json'),'utf8').catch(()=> 'null'));
 if(!cfg?.ready||!cfg.directory||!cfg.javaRelative)throw Error('尚无可启动的已部署服务器，请先完成一键部署。');
 if(!await stat(path.join(ROOT,cfg.directory)).catch(()=>false)||!await stat(path.join(ROOT,cfg.javaRelative)).catch(()=>false))throw Error('已部署服务器或 Java 文件缺失，请检查是否移动或删除了数据目录。');
 log(`正在启动已部署的 Minecraft ${cfg.mc}，端口 ${cfg.port}。`);
 await startPanel(log);
 signal?.throwIfAborted();
 const api=await panelClient(input);
 let connected=false;
 for(let i=0;i<40;i++){const daemons=await api('/api/service/remote_services');const list=Array.isArray(daemons)?daemons:daemons.data;if(list?.some(d=>d.available&&['127.0.0.1','localhost','::1'].includes(d.ip))){connected=true;break;}if(i===0)log('正在等待面板连接本机节点…');await new Promise(r=>setTimeout(r,750));}
 if(!connected)throw Error('面板尚未连接本机节点，请打开 MCSManager 检查节点状态。');
 signal?.throwIfAborted();
 const managed=await startManagedServer(input,log,{signal});
 signal?.throwIfAborted();
 let dns=null,networkError=null;
 try{dns=await refreshSavedDNS(log);if(dns.warning){networkError=dns.warning;log(networkError);}}catch(e){networkError=e.message;log('服务器继续加载，域名检查需要处理：'+e.message);}
 const query=`daemonId=${encodeURIComponent(managed.daemonId)}&uuid=${encodeURIComponent(managed.instanceUuid)}`;
 signal?.throwIfAborted();
 const ready=await waitForMinecraft({port:cfg.port,readStatus:()=>api('/api/instance?'+query),log,signal});
 const network=JSON.parse(await readFile(path.join(DATA,'network.json'),'utf8').catch(()=> 'null'));
 const address=network?.domain?(cfg.port===25565?network.domain:`${network.domain}:${cfg.port}`):null;
 log('服务器已就绪，可以开始连接。'+(address?' 地址：'+address:''));
 return {...managed,...ready,address,port:cfg.port,dns,networkError};
}
export async function managedServerState(){
 const cfg=JSON.parse(await readFile(path.join(DATA,'last-server.json'),'utf8').catch(()=> 'null'));
 if(!cfg)return {state:'undeployed',message:'尚无已部署服务器'};
 try{const api=await panelClient({}),daemons=await api('/api/service/remote_services');const list=Array.isArray(daemons)?daemons:daemons.data;
  const daemon=list?.find(d=>d.uuid===cfg.panelDaemon);if(!daemon?.available)return {state:'unavailable',message:'MCSManager 节点未连接，当前运行状态待确认'};
  const instance=daemon.instances?.find(i=>i.instanceUuid===cfg.panelInstance);
  if(!instance)return {state:'unavailable',message:'未找到对应管理实例'};
  const state=instance.status===3?'running':instance.status===2?'starting':instance.status===0?'stopped':'stopping';
  return {state,message:{running:'运行中',starting:'正在启动',stopped:'已停止',stopping:'正在停止'}[state],port:cfg.port};
 }catch{return {state:'unavailable',message:'MCSManager 尚未运行，当前运行状态待确认'};}
}
export async function stopSavedServer(input={},log=()=>{}){
 const cfg=JSON.parse(await readFile(path.join(DATA,'last-server.json'),'utf8').catch(()=> 'null'));
 if(!cfg)throw Error('尚无已部署服务器可关闭。');
 const client=await panelClient(input),api=async(...args)=>{try{return await client(...args);}catch{throw Error('无法通过 MCSManager 确认服务器状态，请先打开管理面板检查本机节点连接。');}};
 return stopManagedInstance({cfg,root:ROOT,api,log,portFree:async port=>!(await ps('ports',{ports:[port]})).conflicts.some(c=>c.protocol==='TCP')});
}
export async function startManagedServer(input={},log=()=>{},{signal}={}){
 signal?.throwIfAborted();
 const instance=await importPanel(input,log),api=await panelClient(input);
 const query=`daemonId=${encodeURIComponent(instance.daemonId)}&uuid=${encodeURIComponent(instance.instanceUuid)}`;
 let detail=await api('/api/instance?'+query);
 if(![2,3].includes(detail.status)){
  const cfg=JSON.parse(await readFile(path.join(DATA,'last-server.json'),'utf8'));
  if((await ps('ports',{ports:[cfg.port]})).conflicts.length)throw Error(`端口 ${cfg.port} 已被其他进程占用，实例已保留但未重复启动。请正常关闭旧服务器后再启动。`);
  signal?.throwIfAborted();
  await api('/api/protected_instance/open?'+query);
  for(let i=0;i<20;i++){signal?.throwIfAborted();await new Promise(r=>setTimeout(r,500));detail=await api('/api/instance?'+query);if(detail.status===3&&i>=5)break;if(i>2&&detail.status===0)throw Error('MCSManager 启动进程退出，请查看实例控制台。');}
 }
 if(![2,3].includes(detail.status))throw Error('实例尚未进入启动状态，请查看 MCSManager 控制台。');
 log('MCSManager 已接管服务端进程，可在应用实例中查看控制台和停止服务器。');
 return {...instance,status:detail.status,url:'http://127.0.0.1:23333/#/instances'};
}
export function panelInstanceConfig(cfg){
 if(!cfg.javaRelative||!Array.isArray(cfg.args))throw Error('服务端启动参数缺失，请先准备核心');
 const quote=s=>'"'+String(s).replaceAll('"','\\"')+'"';
 const command=[quote(path.join(ROOT,cfg.javaRelative)),'-Dfile.encoding=UTF-8',...(cfg.jvmArgs||[]).map(quote),'-Xms2G',`-Xmx${cfg.memory}G`,...cfg.args.map(quote)].join(' ');
 return {nickname:`Minecraft ${cfg.mc} · ${cfg.selectedCore||cfg.loader} · ${cfg.id.slice(0,8)}`,startCommand:command,stopCommand:'stop',stopTimeout:0,cwd:path.join(ROOT,cfg.directory),type:'minecraft/java',processType:'general',endTime:0,basePort:cfg.port,tag:['GreenLoong'],eventTask:{autoStart:false,autoRestart:false},terminalOption:{haveColor:true,pty:process.platform!=='win32'},ie:'utf8',oe:'utf8',pingConfig:{ip:'127.0.0.1',port:cfg.port,type:1}};
}
async function panelApiKey(provided){
 if(provided){if(!/^[a-zA-Z0-9_-]{8,200}$/.test(provided))throw Error('MCSManager API Key 格式不正确');return provided;}
 const panel=JSON.parse(await readFile(path.join(DATA,'panel.json'),'utf8'));
 const dir=path.join(path.dirname(panel.web),'data','User'),keys=[];
 for(const name of await readdir(dir).catch(()=>[])){if(!name.endsWith('.json'))continue;const user=JSON.parse(await readFile(path.join(dir,name),'utf8'));if(user.permission===10&&user.apiKey)keys.push(user.apiKey);}
 if(keys.length!==1)throw Error('请先在 MCSManager 创建管理员账号并启用 API Key；有多个管理员时，请在部署页面指定用于管理的 API Key。');
 return keys[0];
}
