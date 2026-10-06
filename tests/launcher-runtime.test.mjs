import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {ROOT} from '../lib/system.mjs';
import {listenLauncher,localLauncherURL,probeLauncher,launcherRootId,launcherProof} from '../lib/launcher-runtime.mjs';
import {classifyControlPort} from '../lib/control-port.mjs';
test('cached URLs reject external hosts, credentials and unrelated local ports',()=>{
 const hash='a'.repeat(64);assert.ok(localLauncherURL('http://127.0.0.1:18641/#'+hash));for(const u of ['https://127.0.0.1:18640/#'+hash,'http://evil.example:18640/#'+hash,'http://127.0.0.1:23333/#'+hash,'http://user:pass@127.0.0.1:18640/#'+hash])assert.equal(localLauncherURL(u),null);
});
test('genuine occupied listener causes fallback without stopping the existing service',async()=>{
 const blocker=http.createServer((req,res)=>res.end('existing service')),server=http.createServer((req,res)=>res.end('GreenLoong'));const first=await listenLauncher(blocker);try{const port=await listenLauncher(server,{preferredPort:first});assert.ok(port>first);assert.equal(await(await fetch('http://127.0.0.1:'+first)).text(),'existing service');assert.equal(server.address().address,'127.0.0.1');}finally{await Promise.all([new Promise(r=>blocker.close(r)),new Promise(r=>server.close(r))]);}
});
test('an unrecognized service never receives the local session token',async()=>{
 let calls=0;const result=await probeLauncher('http://127.0.0.1:18640/#'+'a'.repeat(64),ROOT,{request:async(url,options)=>{calls++;assert.equal(options.headers,undefined);return {ok:true,json:async()=>({application:'Other'})};}});assert.equal(result,null);assert.equal(calls,1);
});
test('same-root process proves its identity before authenticated status reuse',async()=>{
 const token='a'.repeat(64),id=launcherRootId(ROOT);const result=await probeLauncher('http://127.0.0.1:18640/#'+token,ROOT,{request:async(url,options)=>{if(url.includes('identity')){assert.equal(options.headers,undefined);const nonce=new URL(url).searchParams.get('nonce');return {ok:true,json:async()=>({application:'GreenLoongLauncher',rootId:id,port:18640,proof:launcherProof(token,nonce,id)})};}assert.equal(options.headers['X-GreenLoong-Token'],token);return {ok:true,json:async()=>({application:'GreenLoongLauncher',root:ROOT,port:18640,pid:1})};}});assert.equal(result.port,18640);
});
test('another copy is not reused even if its token was copied with data',async()=>{
 const result=await probeLauncher('http://127.0.0.1:18640/#'+'a'.repeat(64),ROOT,{request:async(url,options)=>{assert.equal(options.headers,undefined);return {ok:true,json:async()=>({application:'GreenLoongLauncher',rootId:launcherRootId(path.join(ROOT,'other')),port:18640,proof:'b'.repeat(64)})};}});assert.equal(result,null);
});
test('port detection distinguishes current copy, old copy, other apps and incomplete metadata',()=>{
 const owner={pid:123,name:'node.exe',exe:path.join(ROOT,'runtime/node.exe'),script:path.join(ROOT,'server.mjs')},raw={occupied:true,owners:[owner]};assert.equal(classifyControlPort(raw,{root:ROOT,branded:true}).kind,'same-platform');assert.equal(classifyControlPort(raw,{root:path.join(ROOT,'new-copy'),branded:true}).kind,'old-platform');assert.equal(classifyControlPort(raw,{root:ROOT,branded:false}).kind,'other');assert.equal(classifyControlPort({occupied:true,owners:[]},{root:ROOT,branded:true}).kind,'platform-unverified');assert.equal(classifyControlPort({occupied:false},{root:ROOT}).kind,'free');
});
