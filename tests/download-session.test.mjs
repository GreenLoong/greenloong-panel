import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from '../lib/system.mjs';
import {download,getJson} from '../lib/download.mjs';
import {createDownloadSession,downloadOptions} from '../lib/download-session.mjs';
const payload=Buffer.from('download session fixture'),hash=createHash('sha256').update(payload).digest('hex');
function fixture(t){const name='download-session-'+randomUUID()+'.bin',file=path.join(ROOT,'data/downloads',name),original=globalThis.fetch;t.after(async()=>{globalThis.fetch=original;for(const x of ['','.json','.part'])await unlink(file+x).catch(()=>{});});return {name,file};}
const waitUntil=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Expected download state did not appear');};
test('known and unknown sizes are reported without exposing signed URLs',async t=>{
 const {name}=fixture(t),states=[],session=createDownloadSession({},s=>states.push(s));t.after(()=>session.close());globalThis.fetch=async()=>new Response(payload,{headers:{'content-length':String(payload.length)}});
 await session.run(()=>download('https://vendor.example/file?private-token=secret',name,{hash}));const r=session.snapshot().items.at(-1);assert.equal(r.bytes,payload.length);assert.equal(r.total,payload.length);assert.equal(r.status,'completed');assert.ok(states.some(s=>s.items.some(r=>r.status==='verifying')));assert.equal(JSON.stringify(states).includes('private-token'),false);
});
test('stop interrupts and cleans partial bytes, retry continues the same caller without repeating previous work',async t=>{
 const {name,file}=fixture(t),session=createDownloadSession();t.after(()=>session.close());let calls=0,previousSteps=0;
 globalThis.fetch=async(url,{signal})=>{if(++calls===1)return new Response(new ReadableStream({start(c){c.enqueue(payload.subarray(0,4));signal.addEventListener('abort',()=>c.error(signal.reason),{once:true});}}));return new Response(payload);};
 const work=session.run(async()=>{previousSteps++;return download('https://vendor.example/file',name,{hash});});await waitUntil(()=>session.snapshot().items.some(r=>r.bytes===4));session.stop();await new Promise(r=>setTimeout(r,30));await assert.rejects(readFile(file+'.part'));assert.equal(session.paused,true);session.resume();await work;assert.equal(calls,2);assert.equal(previousSteps,1);assert.deepEqual(await readFile(file),payload);
});
test('ending a paused task rejects it and never retries automatically',async t=>{
 const {name,file}=fixture(t),session=createDownloadSession();t.after(()=>session.close());let calls=0;globalThis.fetch=async(url,{signal})=>{calls++;return new Response(new ReadableStream({start(c){c.enqueue(Buffer.from('part'));signal.addEventListener('abort',()=>c.error(signal.reason),{once:true});}}));};
 const work=session.run(()=>download('https://vendor.example/file',name));const failure=assert.rejects(work,e=>e.code==='DOWNLOAD_CANCELLED');await waitUntil(()=>session.snapshot().items.some(r=>r.bytes===4));session.stop();await new Promise(r=>setTimeout(r,20));session.cancel();await failure;assert.equal(calls,1);await assert.rejects(readFile(file+'.part'));await assert.rejects(readFile(file));
});
test('failed automatic retries wait for a deliberate user retry instead of hanging invisibly',async t=>{
 const {name}=fixture(t),session=createDownloadSession();t.after(()=>session.close());let calls=0;globalThis.fetch=async()=>{if(++calls<=2)return new Response('',{status:503});return new Response(payload);};
 const work=session.run(()=>download('https://vendor.example/file',name,{hash}));await waitUntil(()=>session.paused);assert.equal(calls,2);assert.match(session.snapshot().reason,/503/);session.resume();await work;assert.equal(calls,3);
});
test('metadata requests participate in cancellation and timeout settings are bounded',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);const session=createDownloadSession();t.after(()=>session.close());globalThis.fetch=async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 const work=session.run(()=>getJson('https://vendor.example/metadata'));const failure=assert.rejects(work,e=>e.code==='DOWNLOAD_CANCELLED');await waitUntil(()=>session.snapshot().canStop);session.cancel();await failure;assert.throws(()=>downloadOptions({downloadIdleSeconds:301}));assert.throws(()=>downloadOptions({downloadTotalMinutes:121}));
});
test('invalid metadata is retried before the caller proceeds',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);let calls=0;globalThis.fetch=async()=>new Response(++calls===1?'not json':'{"ready":true}');assert.deepEqual(await getJson('https://vendor.example/metadata'),{ready:true});assert.equal(calls,2);
});
