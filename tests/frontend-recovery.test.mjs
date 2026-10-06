import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
async function harness(fetch){
 const ids=['domain','port','memory','mc','loader','loaderVersion','serverPack','eula','ddns','firewall','nic','accessId','accessSecret','apiKey','curseKey','coreMode','state','logs','analysis','manual','corePlan','pack','check','analyze','deploy','panel','network','import','all','smoke','dnsProvider','cloudflareToken','dnsAuthority','aliyunFields','cloudflareFields','startServer','stopServer','existingDirectory','existingZIP','existingReport','existingOptions','existingCore','existingMC','existingJava','existingPort','existingMemory','existingStart','chooseExisting','analyzeExisting','analyzeExistingZIP','importExisting','gameState','controlPortInfo','checkControlPort','panelNotice','panelDirect','panelLoginState','panelUsername','panelPassword','panelCode','savePanelLogin','forgetPanelLogin','openPanel','downloadProgress','downloadButtons','downloadSummary','downloadItems','downloadStop','downloadRetry','downloadCancel','downloadIdleSeconds','downloadTotalMinutes','previewNetwork','networkConflictReport','ddnsTakeoverOption','domainTakeoverOption','takeOverDdns','takeOverDomain'];
 const makeElement=()=>({value:'',checked:false,textContent:'',disabled:false,options:[],files:[],children:[],replaceChildren(){this.children=[];},append(...items){this.children.push(...items);},removeAttribute(){}});
 const elements=Object.fromEntries(ids.map(id=>[id,makeElement()]));
 Object.assign(elements.port,{value:'25565'});Object.assign(elements.memory,{value:'8'});Object.assign(elements.coreMode,{value:'native'});
 const timers=[],calls=[],session=new Map(),windows=[];
 const context=vm.createContext({TypeError,URLSearchParams,console,window:{open:(url,name)=>{const w={location:{href:url},close(){this.closed=true;}};windows.push(w);return w;}},document:{getElementById:id=>elements[id],createElement:makeElement,querySelectorAll:()=>[]},location:{hash:'#session',pathname:'/',search:''},history:{replaceState(){}},sessionStorage:{getItem:k=>session.get(k),setItem:(k,v)=>session.set(k,v)},setInterval(){},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},fetch:async(url,options={})=>{calls.push({url,method:options.method||'GET',body:options.body});return fetch(url,options);}});
 vm.runInContext(source,context);await tick();await tick();return {elements,timers,calls,windows};
}
const reply=data=>({ok:true,json:async()=>data});
const idle={busy:false,logs:['实例已由面板接管'],error:null,result:{instanceUuid:'one',status:3}};
test('Failed to fetch recovers by reading status without retrying a deployment POST',async()=>{
 const h=await harness(async(url,options)=>{if(options.method==='POST')throw new TypeError('Failed to fetch');return reply(url.endsWith('/upload')?null:idle);});
 await h.elements.all.onclick();assert.equal(h.elements.state.textContent,'正在恢复连接');
 await h.timers.shift()();assert.equal(h.elements.state.textContent,'步骤完成');assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert.ok(h.elements.logs.textContent.includes('接管并运行'));
});
test('initial page outage restores upload and job state when the connection returns',async()=>{
 let first=true;const h=await harness(async url=>{if(first){first=false;throw new TypeError('Failed to fetch');}return reply(url.endsWith('/upload')?null:idle);});
 assert.equal(h.elements.state.textContent,'正在恢复连接');await h.timers.shift()();await tick();assert.equal(h.elements.state.textContent,'上次操作记录');assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
});
test('opening a page with old ready logs does not start the server or open another window',async()=>{
 const h=await harness(async url=>reply(url.endsWith('/upload')?null:url.endsWith('/game-state')?{state:'stopped',message:'已停止',port:25565}:{...idle,result:{ready:true,instanceUuid:'one'}}));
 assert.equal(h.calls.filter(c=>c.method==='POST').length,0);assert.equal(h.windows.length,0);assert.match(h.elements.gameState.textContent,/已停止/);assert.match(h.elements.logs.textContent,/上次操作记录/);
});
test('a deliberate start creates a popup immediately, confirms the start and then opens MCSManager',async()=>{
 const h=await harness(async url=>reply(url.endsWith('/upload')?null:url.endsWith('/panel-access')?{authenticated:true,url:'http://127.0.0.1:23333/#/instances'}:idle));
 await h.elements.startServer.onclick();await tick();assert.equal(h.windows.length,1);const start=h.calls.find(c=>c.url==='/api/start-managed');assert.equal(JSON.parse(start.body).confirmedStart,true);assert.equal(h.windows[0].location.href,'http://127.0.0.1:23333/#/instances');assert.match(h.elements.panelNotice.textContent,/已登录/);
});
test('partial network setup retains entered credentials and displays the pending step',async()=>{
 const h=await harness(async url=>reply(url.endsWith('/upload')?null:{...idle,result:{config:{selectedCore:'forge',mc:'1.20.1'},managed:{status:3},networkError:'管理员配置待完成'}}));
 h.elements.accessSecret.value='local-only-placeholder';await h.elements.all.onclick();assert.equal(h.elements.accessSecret.value,'local-only-placeholder');assert.equal(h.elements.state.textContent,'服务端已部署，网络配置待完成');
});
test('one click stop explicitly confirms shutdown, opens no popup and displays stopped state',async()=>{
 const stopped={busy:false,logs:['世界保存完成，服务器已关闭'],error:null,result:{stopped:true,saveVerified:true,portReleased:true}};
 const h=await harness(async url=>reply(url.endsWith('/upload')?null:stopped));await h.elements.stopServer.onclick();
 assert.equal(h.windows.length,0);assert.equal(JSON.parse(h.calls.find(c=>c.url==='/api/stop-managed').body).confirmedStop,true);assert.equal(h.elements.state.textContent,'服务器已关闭');assert.match(h.elements.logs.textContent,/保存完成/);
});
test('paused transfers expose retry and finish controls, known bytes and zero current speed',async()=>{
 const data={...idle,busy:true,downloads:{paused:true,reason:'连续 30 秒未收到数据',canStop:false,items:[{name:'MCSManager.zip',host:'github.com',status:'paused',bytes:1024,total:2048,speedBytesPerSecond:0,elapsedSeconds:35,idleSeconds:0,attempt:2,maxAttempts:2}]}};
 const h=await harness(async url=>reply(url.endsWith('/upload')?null:data));assert.equal(h.elements.downloadRetry.disabled,false);assert.equal(h.elements.downloadCancel.disabled,false);assert.equal(h.elements.downloadStop.disabled,true);assert.equal(h.elements.downloadProgress.hidden,false);assert.match(h.elements.downloadSummary.textContent,/30 秒/);assert.equal(h.elements.downloadItems.children.length,1);
});
