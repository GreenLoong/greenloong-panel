import {readFile,writeFile,mkdir,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,run} from './system.mjs';
const BASE='http://127.0.0.1:23333',DATA=path.join(ROOT,'data'),secretFile=path.join(DATA,'private','panel-login.json');
// v10.19 uses a randomly generated UUID v4 session-cookie name on each web restart.
const sessionCookie=/^(?:koa\.sess|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})(?:\.sig)?=/i;
const exists=async()=>JSON.parse(await readFile(secretFile,'utf8').catch(()=> 'null'));
export function panelTargetURL(cfg){return cfg?.panelInstance&&cfg?.panelDaemon?BASE+'/#/instances/terminal?daemonId='+encodeURIComponent(cfg.panelDaemon)+'&instanceId='+encodeURIComponent(cfg.panelInstance):BASE+'/#/instances';}
export function panelSessionCookies(headers){return headers.getSetCookie().filter(c=>sessionCookie.test(c));}
export async function panelLoginInfo(){
 const saved=await exists();let username=saved?.username||'';
 if(!username){try{const panel=JSON.parse(await readFile(path.join(DATA,'panel.json'),'utf8')),dir=path.join(path.dirname(panel.web),'data','User');const admins=[];for(const f of await readdir(dir)){if(!f.endsWith('.json'))continue;const u=JSON.parse(await readFile(path.join(dir,f),'utf8'));if(u.permission===10)admins.push(u.userName);}if(admins.length===1)username=admins[0];}catch{}}
 return {saved:!!saved?.encrypted,username};
}
async function crypt(action,input){return run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'scripts','panel-credentials.ps1'),'-Action',action],{input});}
async function storedCredentials(){const saved=await exists();if(!saved?.encrypted)return null;try{return JSON.parse(await crypt('unprotect',saved.encrypted));}catch{throw Error('保存的登录信息不能由当前 Windows 账户解密，请重新保存账号密码。');}}
export async function authenticatePanel({cookie='',credentials=null,request=fetch,readCredentials=storedCredentials}={}){
 const headers={'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'};
 const mcsmCookies=cookie.split(';').map(c=>c.trim()).filter(c=>sessionCookie.test(c)).join('; ');
 if(mcsmCookies)headers.Cookie=mcsmCookies;
 // Retain a valid official MCSManager session before attempting password login.
 if(!credentials){try{const r=await request(BASE+'/api/auth/',{headers,signal:AbortSignal.timeout(4000)}),j=await r.json();if(j.status===200&&j.data?.permission>0)return {authenticated:true,cookies:panelSessionCookies(r.headers)};}catch{}}
 const auth=credentials||await readCredentials();
 if(!auth)return {authenticated:false,cookies:[],message:'尚未保存自动登录信息。首次在部署页面填写 MCSManager 账号密码并保存。'};
 const r=await request(BASE+'/api/auth/login',{method:'POST',headers:credentials?{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'}:headers,body:JSON.stringify({username:auth.username,password:auth.password,...(auth.code?{code:auth.code}:{})}),signal:AbortSignal.timeout(10000)}),j=await r.json();
 if(j.data==='NEED_2FA')return {authenticated:false,cookies:[],message:'MCSManager 需要二次验证，请在管理面板完成登录。'};
 if(j.status!==200||typeof j.data!=='string'||!j.data||j.data==='NEED_2FA')throw Error('MCSManager 登录失败，请检查已保存的账号密码；不会修改原账号。');
 const cookies=panelSessionCookies(r.headers);if(!cookies.length)throw Error('MCSManager 没有返回浏览器登录会话，请直接在管理面板登录。');
 return {authenticated:true,cookies};
}
export async function savePanelLogin(input){
 const username=String(input.username||'').trim(),password=String(input.password||'');
 if(!username||!password||username.length>200||password.length>1000)throw Error('请在本地填写完整的 MCSManager 账号和密码。');
 const auth={username,password,code:String(input.code||'').trim()};
 const login=await authenticatePanel({credentials:auth});if(!login.authenticated)throw Error(login.message);
 // Save only after the official login succeeds. TOTP codes are never saved.
 const encrypted=await crypt('protect',JSON.stringify({username,password}));await mkdir(path.dirname(secretFile),{recursive:true});await writeFile(secretFile,JSON.stringify({username,encrypted:encrypted.trim()}),'utf8');
 return login;
}
export async function forgetPanelLogin(){await unlink(secretFile).catch(e=>{if(e.code!=='ENOENT')throw e;});return {saved:false};}
export async function accessPanel(cookie=''){
 let ready=false;
 for(let i=0;i<40;i++){try{const r=await fetch(BASE+'/',{signal:AbortSignal.timeout(1000)});if(r.ok&&(await r.text()).includes('MCSManager')){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,750));}
 if(!ready)throw Error('MCSManager 还未响应，请稍后点击“打开 MCSManager”。');
 const cfg=JSON.parse(await readFile(path.join(DATA,'last-server.json'),'utf8').catch(()=> 'null'));
 let auth;try{auth=await authenticatePanel({cookie});}catch(e){auth={authenticated:false,cookies:[],message:e.message};}
 return {...auth,url:panelTargetURL(cfg)};
}
