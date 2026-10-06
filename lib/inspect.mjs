import {readZip,readEntry} from './archive.mjs';
export async function inspectJar(buffer){
 const zip=await readZip(buffer),get=async name=>{const e=zip.entries.find(e=>e.name.toLowerCase()===name.toLowerCase());return e?(await readEntry(zip,e,4*1024*1024)).toString('utf8'):null;};
 const manifest=(await get('META-INF/MANIFEST.MF')||'').replace(/\r?\n /g,'');
 const main=/^Main-Class:\s*(.+)$/mi.exec(manifest)?.[1].trim();
 const fabric=await get('fabric.mod.json'),quilt=await get('quilt.mod.json');
 let environment='unknown',id='',depends={};
 if(fabric){const m=JSON.parse(fabric);environment=m.environment==='client'?'client':m.environment==='server'?'server':'both';id=m.id;depends=m.depends||{};}
 if(quilt){const m=JSON.parse(quilt);environment=m.minecraft?.environment==='client'?'client':'unknown';id=m.quilt_loader?.id||'';}
 let core=null;
 if(main&&/io\.papermc\.paperclip|com\.destroystokyo\.paperclip/.test(main))core='paper';
 else if(main&&/org\.bukkit\.craftbukkit\.Main|org\.spigotmc/.test(main))core='spigot';
 else if(main&&/mohist/i.test(main))core='mohist';
 else if(main&&/fabricmc.*ServerLauncher/i.test(main))core='fabric';
 else if(main&&/ServerLaunchWrapper|ServerMain/i.test(main)&&/forge/i.test(main))core='forge';
 else if(main&&/net\.minecraft\.(server\.Main|bundler\.Main)/.test(main))core='vanilla';
 else if(main&&/org\.spongepowered/.test(main))core='spongeforge';
 let mc=null,loaderVersion=null;
 const version=await get('version.json');if(version){try{const v=JSON.parse(version);if(/^1\.\d/.test(v.id))mc=v.id;}catch{}}
 const installer=await get('install_profile.json');
 if(installer){try{const p=JSON.parse(installer);mc||=p.minecraft||p.versionInfo?.inheritsFrom;const m=/forge[:\/-](?:1\.\d+(?:\.\d+)?-)?([\d.]+)/.exec(p.path||p.version||'');loaderVersion=m?.[1];}catch{}}
 const forge=/^Forge-Version:\s*(.+)$/mi.exec(manifest);if(forge)loaderVersion=forge[1].trim();
 return {main,core,mc,loaderVersion,installer:!!installer,environment,id,depends,spongePlugin:!!await get('META-INF/sponge_plugins.json')||!!await get('mcmod.info')&&/spongeapi/i.test(manifest),bukkitPlugin:!!await get('plugin.yml')};
}
export async function inspectContents(zip,root=''){
 const existing=[],mods=[],evidence=[],loaders={};let mc=null;
 for(const e of zip.entries){
  const n=e.name.slice(root.length);if(!e.name.startsWith(root))continue;
  const arg=/^libraries\/net\/(minecraftforge\/forge|neoforged\/neoforge)\/([^/]+)\/win_args\.txt$/.exec(n);
  if(arg){let version=arg[2];const match=/^(1\.\d+(?:\.\d+)?)-(.+)$/.exec(version);if(match){mc=match[1];version=match[2];}const loader=arg[1].startsWith('minecraftforge')?'forge':'neoforge';loaders[loader]=version;existing.push({kind:loader,argsFile:n,complete:'needs-startup-check'});evidence.push('发现服务端加载器参数文件');}
  if(!/\.jar$/i.test(n))continue;
  const isMod=/(^|\/)mods\/[^/]+\.jar$/i.test(n),isPlugin=/^plugins\/[^/]+\.jar$/i.test(n),isRoot=!n.includes('/');
  if(!isMod&&!isPlugin&&!isRoot)continue;
  try{
   const info=await inspectJar(await readEntry(zip,e));
   if(isMod||isPlugin)mods.push({path:e.name,relative:n,...info});
   if(isRoot&&info.core&&!info.installer){existing.push({kind:info.core,jar:n,main:info.main});evidence.push('发现可识别的服务端 JAR 入口');mc||=info.mc;if(info.loaderVersion)loaders[info.core]=info.loaderVersion;const named=/^forge-(1\.\d+(?:\.\d+)?)-([\d.]+)/i.exec(n);if(named&&info.core==='forge'){mc||=named[1];loaders.forge||=named[2];evidence.push('Forge 版本从已识别核心文件名读取，启动时再次验证');}}
   if(info.installer){mc||=info.mc;evidence.push('发现安装器（安装器不等于已安装的服务端核心）');}
  }catch(err){mods.push({path:e.name,relative:n,environment:'unknown',error:'JAR 元数据无法读取：'+err.message});}
 }
 const names=zip.entries.map(e=>e.name.slice(root.length));
 for(const e of zip.entries.filter(e=>e.name.startsWith(root)&&/versions\/[^/]+\/[^/]+\.json$/.test(e.name))){
  try{const v=JSON.parse((await readEntry(zip,e,4*1024*1024)).toString('utf8'));mc||=v.inheritsFrom||(/^1\.\d+(?:\.\d+)?$/.test(v.id)?v.id:null);for(const l of v.libraries||[]){let m;if(m=/^net\.minecraftforge:forge:(?:1\.\d+(?:\.\d+)?-)?([\d.]+)/.exec(l.name))loaders.forge=m[1];if(m=/^net\.fabricmc:fabric-loader:(.+)/.exec(l.name))loaders.fabric=m[1];if(m=/^net\.neoforged:neoforge:(.+)/.exec(l.name))loaders.neoforge=m[1];}}catch{}
 }
 const serverClues=names.some(n=>/^(server\.properties|eula\.txt)$/.test(n))||existing.length>0;
 const clientClues=names.some(n=>/^(options\.txt|servers\.dat|instance\.cfg|mmc-pack\.json)$/.test(n)||/^versions\//.test(n));
 if(serverClues)evidence.push('存在服务端配置或启动结构');if(clientClues)evidence.push('存在客户端配置或启动器结构');
 return {existing,mods,mc,loaders,evidence,type:serverClues?(clientClues?'mixed':'server'):clientClues?'client':'unknown'};
}
