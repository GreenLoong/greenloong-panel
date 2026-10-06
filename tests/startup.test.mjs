import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {minecraftStatus,waitForMinecraft} from '../lib/minecraft-status.mjs';
import {addressesMatch,verifyStartupDNS} from '../lib/startup-dns.mjs';
test('IPv6 equivalence and stale duplicate addresses are distinguished',()=>{
 assert.equal(addressesMatch(['2001:db8::1'],'2001:0db8:0:0:0:0:0:1'),true);
 assert.equal(addressesMatch(['2001:db8::1','2001:db8::2'],'2001:db8::1'),false);
 assert.equal(addressesMatch([],'2001:db8::1'),false);
});
test('changed dynamic address triggers sync and rereads provider, while public cache stays a warning',async()=>{
 let synced=0,reads=0;const result=await verifyStartupDNS({current:'2001:db8::2',readProvider:async()=>({addresses:[++reads===1?'2001:db8::1':'2001:db8::2'],proxied:false}),readPublic:async()=>({addresses:['2001:db8::1']}),sync:async()=>synced++});
 assert.equal(synced,1);assert.equal(reads,2);assert.equal(result.recordVerified,true);assert.equal(result.publicVerified,false);assert.match(result.warning,/缓存/);
});
test('matching live records never trigger an unnecessary DNS write',async()=>{
 const result=await verifyStartupDNS({current:'2001:db8::2',readProvider:async()=>({addresses:['2001:db8::2'],proxied:false}),readPublic:async()=>({addresses:['2001:db8::2']}),sync:async()=>assert.fail('unexpected sync')});assert.equal(result.publicVerified,true);
});
test('failed sync cannot claim a stale or proxied record is ready',async()=>{
 await assert.rejects(verifyStartupDNS({current:'2001:db8::2',readProvider:async()=>({addresses:['2001:db8::2'],proxied:true}),readPublic:async()=>assert.fail('must not check public yet'),sync:async()=>{}}),/同步后/);
});
test('a running process is not called ready until Minecraft responds',async()=>{
 let time=0,probes=0;const result=await waitForMinecraft({port:25565,readStatus:async()=>({status:3}),probe:async()=>{if(++probes<3)throw Error('still loading');return {version:{name:'1.20.1'},players:{online:0}};},now:()=>time,sleep:async ms=>{time+=ms;}});assert.equal(probes,3);assert.equal(result.ready,true);
});
test('startup exits and timeouts are reported without killing the managed instance',async()=>{
 await assert.rejects(waitForMinecraft({port:25565,readStatus:async()=>({status:0}),probe:async()=>assert.fail('no process')}),/进程已退出/);
 let time=0;await assert.rejects(waitForMinecraft({port:25565,readStatus:async()=>({status:3}),probe:async()=>{throw Error('loading');},timeout:3000,now:()=>time,sleep:async ms=>{time+=ms;}}),/仍由 MCSManager 管理/);
});
test('Minecraft probe rejects an unrelated TCP service',async()=>{
 const server=net.createServer(socket=>{socket.on('error',()=>{});socket.resume();socket.end('HTTP/1.1 200 OK\r\n\r\n');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{await assert.rejects(minecraftStatus(server.address().port));}finally{await new Promise(r=>server.close(r));}
});
