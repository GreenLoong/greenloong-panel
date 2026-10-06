import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from '../lib/system.mjs';
import {classifyDomain,classifyDdns,assertNetworkPreview} from '../lib/network-preflight.mjs';
import {githubRelease} from '../lib/github-release.mjs';
test('unknown foreign AAAA requires attention but this host and its saved dynamic address are allowed',()=>{
 assert.deepEqual(classifyDomain(['2001:db8::1'],'2001:db8::1'),[]);assert.deepEqual(classifyDomain(['2001:db8::1'],'2001:db8::2',['2001:db8::1']),[]);assert.deepEqual(classifyDomain(['2001:db8::3'],'2001:db8::2',['2001:db8::1']),['2001:db8::3']);assert.deepEqual(classifyDomain(['2001:0db8:0:0:0:0:0:1'],'2001:db8::1'),[]);
});
test('DDNS ownership uses both executable and exact configuration paths',()=>{
 const service={exists:true,readable:true,exe:path.join(ROOT,'data/ddns/v6/ddns-go.exe'),config:path.join(ROOT,'data/private/ddns.yaml')};assert.equal(classifyDdns(service,ROOT),'owned');assert.equal(classifyDdns({...service,config:path.join(ROOT,'old/private/ddns.yaml')},ROOT),'foreign');assert.equal(classifyDdns({exists:true,readable:false},ROOT),'unknown');assert.equal(classifyDdns({exists:false},ROOT),'absent');
});
test('foreign domain and old service changes require consent tied to the inspected snapshot',()=>{
 const p={currentIPv6:'2001:db8::1',ticket:'checked',conflicting:['2001:db8::2'],service:{ownership:'foreign',canTakeover:true,config:'old config'}};
 assert.throws(()=>assertNetworkPreview(p,{}),/ddns-go/);assert.throws(()=>assertNetworkPreview(p,{takeOverDdns:true,networkTicket:'checked'}),/未识别地址/);assert.throws(()=>assertNetworkPreview(p,{takeOverDdns:true,takeOverDomain:true,networkTicket:'stale'}),/ddns-go/);assert.doesNotThrow(()=>assertNetworkPreview(p,{takeOverDdns:true,takeOverDomain:true,networkTicket:'checked'}));
});
test('GitHub quota fallback uses official release page then cache without repeating the API call',async t=>{
 const cacheDir=await mkdtemp(path.join(ROOT,'data/github-test-'));t.after(async()=>{assert.ok(path.resolve(cacheDir).startsWith(path.join(ROOT,'data','github-test-')));await rm(cacheDir,{recursive:true,force:true});});let calls=0;
 const options={cacheDir,getJson:async()=>{calls++;throw Object.assign(Error('rate limited'),{code:'GITHUB_RATE_LIMIT',retryAt:Date.now()+3600000});},getText:async()=>'<a href="/MCSManager/MCSManager/releases/download/v10.19.0/mcsmanager_windows_release.zip">download</a>',request:async()=>({headers:new Headers({location:'https://github.com/MCSManager/MCSManager/releases/tag/v10.19.0'})})};
 const a=await githubRelease('MCSManager/MCSManager',options),b=await githubRelease('MCSManager/MCSManager',options);assert.equal(calls,1);assert.equal(a.tag_name,'v10.19.0');assert.equal(b.assets[0].name,'mcsmanager_windows_release.zip');assert.ok(b.assets[0].browser_download_url.startsWith('https://github.com/MCSManager/MCSManager/'));
});
