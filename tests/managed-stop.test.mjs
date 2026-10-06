import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {stopManagedInstance} from '../lib/managed-stop.mjs';
import {ROOT} from '../lib/system.mjs';
import {waitForMinecraft} from '../lib/minecraft-status.mjs';
const cfg={panelInstance:'one',panelDaemon:'local',directory:'data/servers/test',port:25565};
const detail=status=>({status,config:{cwd:path.resolve(ROOT,cfg.directory),stopCommand:'stop',stopTimeout:120}});
test('normal stop disables forced timeout, waits for exit and verifies fresh save output',async()=>{
 let stopping=false,reads=0,time=0;const calls=[];
 const api=async(route,method='GET',body)=>{calls.push({route,method,body});if(route.includes('/outputlog'))return stopping?'old log\nAll dimensions are saved':'old log';if(method==='PUT')return {};if(route.includes('/protected_instance/stop')){stopping=true;return {};}return detail(stopping&&++reads>2?0:3);};
 const result=await stopManagedInstance({cfg,root:ROOT,api,portFree:async()=>true,now:()=>time,sleep:async ms=>{time+=ms;}});
 assert.equal(result.stopped,true);assert.equal(result.saveVerified,true);assert.equal(time,2000);assert.deepEqual(calls.find(c=>c.method==='PUT').body,{stopCommand:'stop',stopTimeout:0});assert.equal(calls.filter(c=>c.route.includes('/protected_instance/stop')).length,1);assert.equal(calls.some(c=>/kill|\/open/.test(c.route)),false);
});
test('already stopped is a no-op and does not claim this request saved anything',async()=>{
 const calls=[];const result=await stopManagedInstance({cfg,root:ROOT,api:async route=>{calls.push(route);return detail(0);},portFree:async()=>true});assert.equal(result.alreadyStopped,true);assert.equal(result.saveVerified,undefined);assert.equal(calls.length,1);
});
test('wrong instance directory and occupied ports cannot be called a successful shutdown',async()=>{
 await assert.rejects(stopManagedInstance({cfg,root:ROOT,api:async()=>({status:3,config:{cwd:path.resolve(ROOT,'other-world')}}),portFree:async()=>true}),/目录.*不一致/);
 await assert.rejects(stopManagedInstance({cfg,root:ROOT,api:async()=>detail(0),portFree:async()=>false}),/端口仍被占用/);
});
test('a shutdown timeout never calls kill or claims the process is stopped',async()=>{
 let time=0;const calls=[];
 await assert.rejects(stopManagedInstance({cfg,root:ROOT,api:async(route,method)=>{calls.push(route);if(route.includes('/outputlog'))return '';return detail(method==='PUT'?3:3);},portFree:async()=>true,timeout:3000,now:()=>time,sleep:async ms=>{time+=ms;}}),/尚不能确认已关闭/);assert.equal(calls.some(c=>c.includes('kill')),false);
});
test('historical save markers are not treated as proof of a new save',async()=>{
 let stopped=false;const result=await stopManagedInstance({cfg,root:ROOT,portFree:async()=>true,api:async(route,method)=>{if(route.includes('/outputlog'))return 'All dimensions are saved\nold start';if(route.includes('/protected_instance/stop')){stopped=true;return {};}return detail(stopped?0:3);}});assert.equal(result.saveVerified,false);
});
test('startup readiness can be cancelled before probing or opening any game port',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(waitForMinecraft({port:25565,signal:controller.signal,readStatus:async()=>assert.fail('cancelled startup must not continue'),probe:async()=>assert.fail('cancelled startup must not probe')}),e=>e.name==='AbortError');
});
