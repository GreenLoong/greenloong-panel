import path from 'node:path';
import {run} from './system.mjs';
export function classifyControlPort(raw,{root,branded=false}={}){
 if(!raw.occupied)return {...raw,kind:'free',message:'18640 未被占用。'};
 const owners=raw.owners||[],platform=owners.find(p=>/node(?:\.exe)?$/i.test(p.name||'')&&p.script&&/^server\.(mjs|js)$/i.test(path.basename(p.script))&&/greenloong/i.test(p.exe||p.script));
 if(branded&&platform){const same=path.resolve(path.dirname(platform.script)).toLowerCase()===path.resolve(root).toLowerCase();return {...raw,kind:same?'same-platform':'old-platform',message:(same?'本目录的绿龙平台已在后台运行':'检测到另一份绿龙平台仍在后台运行')+'，PID：'+platform.pid+'；程序：'+platform.script+'。',platform};}
 if(branded)return {...raw,kind:'platform-unverified',message:'18640 的页面看起来属于绿龙平台，但目前无法核实其进程路径；会使用其他控制端口。'};
 return {...raw,kind:'other',message:'18640 已被其他程序占用'+(owners[0]?'，PID：'+owners[0].pid+'；程序：'+(owners[0].exe||owners[0].name):'，当前账户未能读取进程信息')+'。'};
}
export async function inspectControlPort(root){
 const raw=JSON.parse(await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts','inspect-control-port.ps1'),'-Port','18640']));
 let branded=false;if(raw.occupied){try{const r=await fetch('http://127.0.0.1:18640/',{signal:AbortSignal.timeout(1500)});if(r.ok){const text=(await r.text()).slice(0,262144);branded=/<title>[^<]*(?:\u9752\u9f99|绿龙|Minecraft 开服助手)/i.test(text)&&/GREENLOONG|开服助手/i.test(text);}}catch{}}
 return classifyControlPort(raw,{root,branded});
}
