import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {download} from '../lib/download.mjs';
import {ROOT} from '../lib/system.mjs';
const payload=Buffer.from('verified test payload'),hash=createHash('sha256').update(payload).digest('hex');
function prepare(t){const name='test-'+randomUUID()+'.bin',file=path.join(ROOT,'data','downloads',name),original=globalThis.fetch;t.after(async()=>{globalThis.fetch=original;for(const suffix of ['','.json','.part'])await unlink(file+suffix).catch(()=>{});});return {name,file};}
test('stalled response body times out, cleans partial file and retries',async t=>{
 const {name,file}=prepare(t);let calls=0;
 globalThis.fetch=async(url,{signal})=>{calls++;if(calls===1)return new Response(new ReadableStream({start(controller){controller.enqueue(payload.subarray(0,4));signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}}));return new Response(payload);};
 await download('https://vendor.example/fixture',name,{hash,idleTimeoutMs:30,attempts:2});assert.equal(calls,2);assert.deepEqual(await readFile(file),payload);
});
test('failed integrity never installs or repeatedly downloads corrupt content',async t=>{
 const {name,file}=prepare(t);let calls=0;globalThis.fetch=async()=>{calls++;return new Response('corrupt');};
 await assert.rejects(()=>download('https://vendor.example/fixture',name,{hash,attempts:2}),/校验不一致/);assert.equal(calls,1);await assert.rejects(()=>readFile(file));
});
test('parallel requests for same cache entry share one verified download',async t=>{
 const {name}=prepare(t);let calls=0;globalThis.fetch=async()=>{calls++;return new Response(payload);};
 const [a,b]=await Promise.all([download('https://vendor.example/fixture',name,{hash}),download('https://vendor.example/fixture',name,{hash})]);assert.equal(a,b);assert.equal(calls,1);
});
