import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,run} from './lib/system.mjs';
import {ensureLauncher} from './lib/launcher-runtime.mjs';
import {inspectControlPort} from './lib/control-port.mjs';
const action=process.argv.includes('--start')?'start':process.argv.includes('--stop')?'stop':'open';
async function legacyOwner(url){
 try{const pid=Number((await readFile(path.join(ROOT,'data','launcher-pid.txt'),'utf8')).trim());if(!Number.isInteger(pid)||pid<1)return false;
  const owned=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if($p){@{exe=$p.ExecutablePath;cmd=$p.CommandLine} | ConvertTo-Json -Compress}`]);const p=JSON.parse(owned);
  if(path.resolve(p.exe).toLowerCase()!==path.resolve(process.execPath).toLowerCase()||!p.cmd.includes(path.join(ROOT,'server.mjs')))return false;
  const r=await fetch(url.origin+'/api/status',{headers:{'X-GreenLoong-Token':url.hash.slice(1)},signal:AbortSignal.timeout(1500)}),j=await r.json();return r.ok&&typeof j.busy==='boolean'&&Array.isArray(j.logs);
 }catch{return false;}
}
try{
 let diagnostic;try{diagnostic=await inspectControlPort(ROOT);}catch{diagnostic={kind:'unknown',message:'当前账户暂时无法读取端口占用信息，会继续检查可用控制端口。'};}if(diagnostic.occupied||diagnostic.kind==='unknown')console.log(diagnostic.message);
 const info=await ensureLauncher({root:ROOT,legacyOwner,log:console.log}),u=new URL(info.url),headers={'X-GreenLoong-Token':u.hash.slice(1),'Content-Type':'application/json'};
 const {atomicText}=await import('./lib/launcher-runtime.mjs');await atomicText(path.join(ROOT,'data','control-port-info.json'),JSON.stringify({...diagnostic,selectedPort:info.port,checkedAt:Date.now()}));
 if(action!=='open'){const route=action==='start'?'start-managed':'stop-managed';const r=await fetch(u.origin+'/api/'+route,{method:'POST',headers,body:JSON.stringify(action==='start'?{confirmedStart:true}:{confirmedStop:true}),signal:AbortSignal.timeout(10000)}),j=await r.json();if(!r.ok)throw Error(j.error||'操作未提交。');}
 console.log('绿龙控制面板地址：'+u.origin+'。');
 if(!process.argv.includes('--no-browser')){if(action==='start')u.searchParams.set('openPanel','1');await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$launchUrl=[Console]::In.ReadToEnd().Trim(); Start-Process -FilePath $launchUrl"],{input:u.href});}
}catch(e){console.error(e.message);process.exitCode=1;}
