import {getJson,download} from './download.mjs';
import {chooseCore} from './analyze.mjs';
export async function findAlternativeCores(mc,forge,prefer='auto'){
 if(!mc||!forge)return {candidates:[],errors:['缺少 Minecraft／Forge 精确版本']};
 const errors=[],candidates=[];
 if(prefer!=='spongeforge')try{
  const j=await getJson(`https://mohistmc.com/api/v2/projects/mohist/${encodeURIComponent(mc)}/builds`);
  const b=(j.builds||[]).filter(b=>b.forgeVersion===forge&&b.url&&b.fileSha256).sort((a,b)=>b.createdAt-a.createdAt)[0];
  if(b)candidates.push({kind:'mohist',mc,forge,version:String(b.id||b.number||b.gitSha),url:b.url,hash:b.fileSha256,algorithm:'sha256',reason:'Minecraft 和 Forge 版本均与整合包精确匹配'});
 }catch{errors.push('Mohist 官方列表暂不可用或不支持此版本');}
 if(prefer!=='mohist')try{
  const endpoint='https://dl-api.spongepowered.org/v2/groups/org.spongepowered/artifacts/spongeforge';
  const j=await getJson(`${endpoint}/versions?tags=${encodeURIComponent('minecraft:'+mc)}&recommended=true&limit=100`);
  const build=Object.entries(j.artifacts||{}).find(([v,b])=>b.tagValues?.minecraft===mc&&(b.tagValues?.forge===forge||b.tagValues?.forge===forge.split('.').at(-1)));
  if(build){const detail=await getJson(endpoint+'/versions/'+encodeURIComponent(build[0]));const a=detail.assets?.find(a=>a.extension==='jar'&&a.classifier==='');if(a)candidates.push({kind:'spongeforge',mc,forge,version:build[0],url:a.downloadUrl,hash:a.sha1,algorithm:'sha1',reason:'Sponge 官方推荐构建，MC／Forge 版本匹配'});}
 }catch{errors.push('SpongeForge 官方列表暂不可用或不支持此版本');}
 if(!candidates.length)errors.push(`SpongeForge／Mohist 中没有找到 Minecraft ${mc}、Forge ${forge} 对应的构建；可改选“原加载器”安装官方 Forge ${forge}。`);
 candidates.sort((a,b)=>(a.kind==='spongeforge'?0:1)-(b.kind==='spongeforge'?0:1));
 return {candidates,errors};
}
export async function downloadCore(candidate,log){
 const url=new URL(candidate.url);if(!['mohistmc.com','repo.spongepowered.org'].includes(url.hostname))throw Error('核心下载来源异常');
 return download(candidate.url,`${candidate.kind}-${candidate.mc}-${candidate.version}.jar`,{hash:candidate.hash,algorithm:candidate.algorithm,log});
}
export async function resolveCorePlan(report,input={},lookup=findAlternativeCores){
 const mode=input.coreMode||'native';
 if(!['native','spongeforge','mohist','sponge-or-mohist'].includes(mode))return {ready:false,reason:'请选择有效的服务端方案'};
 let mc=report.mc,loaders=report.loaders||{};
 if(!mc||!Object.values(loaders).some(Boolean)){
  if(!input.serverPack)return {ready:false,reason:'版本信息不足，请补充并确认作者提供的版本信息'};
  mc=input.mc;loaders={[input.loader]:input.loaderVersion};
 }
 const core=chooseCore(mc,loaders);if(!core.ready)return core;
 if(!/^1\.\d+(?:\.\d+)?$/.test(mc||'')||!/^\d[a-zA-Z0-9.+_-]{0,70}$/.test(core.loaderVersion))return {ready:false,reason:'Minecraft 或加载器版本格式不正确'};
 if(report.packType==='mixed')return {ready:false,reason:'包内同时存在客户端和服务端结构，请拆分后再导入'};
 if(report.existingCore)return {ready:true,mc,core,kind:report.existingCore.kind,source:'existing',reason:`保留包内已有的 ${report.existingCore.kind} 服务端，使用其启动入口。`};
 if(mode==='native')return {ready:true,mc,core,kind:core.loader,source:'official',reason:`安装官方 ${core.loader} ${core.loaderVersion}（Minecraft ${mc}），与整合包声明一致。`};
 if(core.loader!=='forge')return {ready:false,reason:`此包使用 ${core.loader}，所选 ${mode==='sponge-or-mohist'?'SpongeForge／Mohist':mode} 方案不适用于该加载器；请选择“原加载器”。`};
 const available=await lookup(mc,core.loaderVersion,mode==='sponge-or-mohist'?'auto':mode),selected=available.candidates[0];
 if(!selected)return {ready:false,mc,core,reason:available.errors.join('；')};
 return {ready:true,mc,core,kind:selected.kind,source:'catalog',selected,reason:`安装 ${selected.kind} ${selected.version}；${selected.reason}。`};
}
