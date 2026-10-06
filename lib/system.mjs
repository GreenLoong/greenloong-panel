import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function run(exe,args,options={}){
 return new Promise((resolve,reject)=>{
  const p=spawn(exe,args,{windowsHide:true,...options,stdio:['pipe','pipe','pipe']});let out='',err='';
  p.stdout.on('data',b=>{out+=b.toString();if(out.length>4e6)out=out.slice(-4e6);});p.stderr.on('data',b=>{err+=b.toString();if(err.length>1e6)err=err.slice(-1e6);});
  p.on('error',reject);p.on('close',code=>code===0?resolve(out):reject(Error(err.trim()||out.trim()||`进程退出：${code}`)));
  p.stdin.end(options.input||'');
 });
}
export async function ps(action,data={}){
 const output=await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'scripts','windows.ps1'),'-Action',action],{input:JSON.stringify(data)});
 return JSON.parse(output.replace(/^\uFEFF/,''));
}
export function validPort(v){const p=Number(v);if(!Number.isInteger(p)||p<1024||p>65535||[23333,24444,9876].includes(p)||(p>=18640&&p<=18660))throw Error('游戏端口应为 1024～65535，且不能使用面板保留端口。');return p;}
