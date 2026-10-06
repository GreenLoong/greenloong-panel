import {readZip,readEntry} from './archive.mjs';
import {inspectContents} from './inspect.mjs';

export function javaFor(mc){
  const m=/^1\.(\d+)(?:\.(\d+))?$/.exec(mc||'');
  if(!m) return null;
  const minor=Number(m[1]),patch=Number(m[2]||0);
  return minor>20||(minor===20&&patch>=5)?21:minor>=18?17:minor===17?16:8;
}
export function chooseCore(mc,loaders,plugin='none'){
  const selected=Object.entries(loaders).filter(([k,v])=>['forge','fabric','neoforge','quilt'].includes(k)&&v);
  if(selected.length!==1)return {ready:false,reason:selected.length?'检测到多个加载器，不能自动选择。':'未找到准确的加载器版本，请补充。'};
  const [loader,version]=selected[0],java=javaFor(mc);
  if(!java)return {ready:false,reason:'此 Minecraft 版本尚未建立 Java 兼容规则，请人工核实。'};
  if(plugin!=='none')return {ready:false,loader,loaderVersion:version,java,reason:'所选插件平台需要另行核对版本和模组兼容性。'};
  if(loader==='quilt')return {ready:false,loader,loaderVersion:version,java,reason:'已识别 Quilt；当前版本暂未实现其自动安装。'};
  return {ready:true,loader,loaderVersion:version,java,reason:`整合包声明 ${loader} ${version}，保留原加载器和精确版本最稳妥。`};
}
export async function analyzePack(file){
  const zip=await readZip(file),find=n=>zip.entries.filter(e=>e.name===n||e.name.endsWith('/'+n));
  const reports=[];
  for(const name of ['modrinth.index.json','manifest.json','minecraftinstance.json']){
    for(const e of find(name)){
      let m;try{m=JSON.parse((await readEntry(zip,e,4*1024*1024)).toString('utf8').replace(/^\uFEFF/,''));}catch{throw Error('整合包元数据损坏：'+e.name);}
      if(name==='modrinth.index.json'&&m.game==='minecraft'){
        const d=m.dependencies||{}, loaders={forge:d.forge,fabric:d['fabric-loader'],neoforge:d.neoforge,quilt:d['quilt-loader']};
        reports.push({format:'modrinth',name:m.name||'Modrinth 整合包',mc:d.minecraft,loaders,root:e.name.slice(0,-name.length),manifest:m});
      }
      if(name==='manifest.json'&&m.minecraft?.version){
        const loaders={};for(const l of m.minecraft.modLoaders||[]){const match=/^(forge|fabric|neoforge|quilt)-(.+)$/.exec(l.id||'');if(match)loaders[match[1]]=match[2];}
        reports.push({format:'curseforge',name:m.name||'CurseForge 整合包',mc:m.minecraft.version,loaders,root:e.name.slice(0,-name.length),manifest:m});
      }
      if(name==='minecraftinstance.json'&&m.baseModLoader){
        const b=m.baseModLoader,id=b.name||'',match=/^(forge|fabric|neoforge|quilt)-(.+)$/.exec(id);
        if(match)reports.push({format:'serverzip',name:'本地整合包',mc:b.minecraftVersion,loaders:{[match[1]]:match[2]},root:e.name.slice(0,-name.length),manifest:m});
      }
    }
  }
  if(reports.length>1)throw Error('发现多个整合包清单，请仅上传单个整合包');
  let root='';
  const wrapper=zip.entries.filter(e=>!e.name.endsWith('/')).map(e=>e.name.split('/')[0]);
  if(wrapper.length&&new Set(wrapper).size===1&&!['mods','config','versions','libraries','overrides'].includes(wrapper[0])&&zip.entries.some(e=>e.name.includes('/')))root=wrapper[0]+'/';
  const report=reports[0]||{format:'unknown',name:'本地整合包',mc:'',loaders:{},root,manifest:{}};
  const contents=await inspectContents(zip,report.root);
  report.contents=contents;report.mc||=contents.mc;report.loaders={...contents.loaders,...Object.fromEntries(Object.entries(report.loaders).filter(([k,v])=>v))};
  report.packType=contents.type;
  if(report.packType==='unknown'&&['curseforge','modrinth'].includes(report.format))report.packType='client';
  report.typeEvidence=contents.evidence;
  if(report.packType==='client'&&!contents.evidence.length)report.typeEvidence.push('分发清单格式，没有发现已安装的服务端结构；按客户端导出包处理');
  report.existingCore=contents.existing.find(c=>c.argsFile)||contents.existing.find(c=>c.kind!=='vanilla')||contents.existing[0]||null;
  report.clientOnly=contents.mods.filter(m=>m.environment==='client').map(m=>m.path);
  report.uncertainMods=contents.mods.filter(m=>m.environment==='unknown').map(m=>m.path);
  report.warnings=[];
  report.core=chooseCore(report.mc,report.loaders);
  report.modCount=zip.entries.filter(e=>/(^|\/)mods\/[^/]+\.jar$/i.test(e.name)).length;
  if(report.format==='modrinth'){
    const files=report.manifest.files||[];report.modCount=files.filter(f=>f.path?.startsWith('mods/')).length;
    report.excluded=files.filter(f=>f.env?.server==='unsupported').map(f=>f.path);
    report.warnings.push('只自动跳过清单明确标为服务端不支持的文件；其他模组仍需启动验证。');
  }
  if(report.format==='curseforge'&&(report.manifest.files||[]).length){report.warnings.push('这是 CurseForge 分发清单，不是核心。转换时需要 CurseForge API Key 下载模组；禁止自动下载的条目会报告缺失。');}
  if(!report.mc||!Object.keys(report.loaders).length)report.warnings.push('没有可靠的版本清单。请填写作者提供的 MC 版本和加载器版本。');
  report.warnings.push(`明确仅客户端模组：${report.clientOnly.length}；端别不明模组：${report.uncertainMods.length}（保留并等待试启动验证）。`);
  report.warnings.push('不会执行整合包内附带的 BAT、PS1、EXE 或安装脚本。');
  return report;
}
