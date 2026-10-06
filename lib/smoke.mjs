import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {ROOT,ps,run} from './system.mjs';
import {DATA,saveJson} from './deploy.mjs';
import {clientCrashFiles,isolateCrashMods} from './client-crash.mjs';
export async function smoke(log){
 const cfg=JSON.parse(await readFile(path.join(DATA,'last-server.json'),'utf8')),dir=path.join(ROOT,cfg.directory);
 const reportFile=path.join(dir,'conversion-report.json');
 for(let attempt=1;attempt<=3;attempt++){
  try{const result=await smokeOnce(log);const report=JSON.parse(await readFile(reportFile,'utf8'));report.validation='startup-test-passed';await saveJson(reportFile,report);return result;}
  catch(error){
   const logfile=path.join(dir,'startup-test.log'),text=await readFile(logfile,'utf8').catch(()=>'');await copyFile(logfile,path.join(dir,`startup-test-attempt-${attempt}.log`)).catch(()=>{});
   const candidates=clientCrashFiles(text);if(!candidates.length||attempt===3)throw error;
   const isolated=await isolateCrashMods(candidates,dir,path.join(DATA,'quarantine',cfg.id,'startup'),log);if(!isolated.length)throw error;
   const report=JSON.parse(await readFile(reportFile,'utf8'));report.runtimeExcluded=[...(report.runtimeExcluded||[]),...isolated];await saveJson(reportFile,report);
   log(`已保留失败日志并隔离 ${isolated.length} 个明确引用客户端类的模组，进行第 ${attempt+1} 次检查。`);
  }
 }
}
async function smokeOnce(log){
 const cfg=JSON.parse(await readFile(path.join(DATA,'last-server.json'),'utf8'));
 if((await ps('ports',{ports:[cfg.port]})).conflicts.length)throw Error('先停止正在使用游戏端口的服务端，再进行试启动');
 const dir=path.join(ROOT,cfg.directory),properties=path.join(dir,'server.properties'),original=await readFile(properties,'utf8');
 await writeFile(properties,original.replace(/^server-ip=.*$/m,'server-ip=127.0.0.1'));
 log('试启动只监听本机；等待服务端完成初始化，随后自动发送 stop 保存退出。');
 const stream=createWriteStream(path.join(dir,'startup-test.log'));let done=false,timedOut=false,output='';
 try{
  await new Promise((resolve,reject)=>{
   const p=spawn(path.join(ROOT,cfg.javaRelative),['-Xms2G',`-Xmx${cfg.memory}G`,...cfg.args],{cwd:dir,windowsHide:true,stdio:['pipe','pipe','pipe']});
   let stopping=false,killTimer;
   const stop=()=>{if(stopping)return;stopping=true;p.stdin.write('stop\n');killTimer=setTimeout(()=>{run('taskkill.exe',['/PID',String(p.pid),'/T','/F']).catch(()=>{});},30000);};
   const timer=setTimeout(()=>{timedOut=true;log('首次启动等待超过 10 分钟，正在停止测试进程。');stop();},600000);
   const progress=setInterval(()=>log('服务端仍在初始化；完整输出保存在 startup-test.log。'),20000);
   const onData=b=>{stream.write(b);output=(output+b.toString()).slice(-100000);if(!done&&/Done \([\d.,]+s\)!/.test(output)){done=true;log('检测到服务端启动完成，开始正常关服。');stop();}};
   p.stdout.on('data',onData);p.stderr.on('data',onData);p.stdin.on('error',()=>{});
   const clear=()=>{clearTimeout(timer);clearTimeout(killTimer);clearInterval(progress);};
   p.on('error',e=>{clear();reject(e);});p.on('close',code=>{clear();if(done&&code===0&&!timedOut)resolve();else reject(Error(timedOut?'首次启动超过 10 分钟，请查看日志后重试':'服务端未通过启动检查，请查看 startup-test.log；可能需要移除客户端模组或修复依赖。'));});
  });
  const latest=JSON.parse(await readFile(path.join(DATA,'last-server.json'),'utf8'));cfg.panelInstance=latest.id===cfg.id?latest.panelInstance:cfg.panelInstance;cfg.panelDaemon=latest.id===cfg.id?latest.panelDaemon:cfg.panelDaemon;
  cfg.status='startup-test-passed';await saveJson(path.join(DATA,'last-server.json'),cfg);await saveJson(path.join(dir,'greenloong.json'),cfg);
  log('启动检查通过。尚未验证外网连接、玩家进入世界或多人负载。');return {status:cfg.status,log:path.join(dir,'startup-test.log')};
 }finally{await new Promise(resolve=>stream.end(resolve));await writeFile(properties,original);}
}
