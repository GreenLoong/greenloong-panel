import test from 'node:test';
import assert from 'node:assert/strict';
import {authenticatePanel,panelSessionCookies,panelTargetURL} from '../lib/panel-login.mjs';
import path from 'node:path';
import {run,ROOT} from '../lib/system.mjs';
const reply=(data,cookies=[])=>({json:async()=>data,headers:{getSetCookie:()=>cookies}});
test('panel links contain only instance identifiers, never login secrets',()=>{
 const url=panelTargetURL({panelInstance:'test&next=evil',panelDaemon:'daemon'});assert.ok(url.startsWith('http://127.0.0.1:23333/#/instances/terminal?'));assert.ok(url.includes('test%26next%3Devil'));assert.equal(panelTargetURL(null),'http://127.0.0.1:23333/#/instances');
});
test('an existing official browser session is reused without decrypting or sending a password',async()=>{
 const calls=[];const result=await authenticatePanel({cookie:'koa.sess=active; other-app=private; koa.sess.sig=signed',readCredentials:async()=>assert.fail('unneeded password read'),request:async(url,opts)=>{calls.push({url,opts});return reply({status:200,data:{permission:10}});}});assert.equal(result.authenticated,true);assert.equal(calls.length,1);assert.equal(calls[0].opts.headers.Cookie,'koa.sess=active; koa.sess.sig=signed');
});
test('fresh authentication uses the official password API and preserves signed HttpOnly cookies',async()=>{
 const result=await authenticatePanel({credentials:{username:'local-test',password:'fake-password'},request:async(url,opts)=>{assert.equal(url,'http://127.0.0.1:23333/api/auth/login');assert.equal(opts.method,'POST');assert.equal(JSON.parse(opts.body).password,'fake-password');return reply({status:200,data:'test-session-token'},['koa.sess=test; Path=/; HttpOnly','koa.sess.sig=signed; Path=/; HttpOnly']);}});assert.equal(result.authenticated,true);assert.equal(result.cookies.length,2);assert.equal(JSON.stringify(result).includes('fake-password'),false);assert.equal(JSON.stringify(result).includes('test-session-token'),false);
});
test('missing credentials and two-factor challenges never produce an authenticated result',async()=>{
 const missing=await authenticatePanel({readCredentials:async()=>null,request:async()=>assert.fail('no login request without credentials')});assert.equal(missing.authenticated,false);
 const mfa=await authenticatePanel({credentials:{username:'test',password:'fake'},request:async()=>reply({status:200,data:'NEED_2FA'})});assert.equal(mfa.authenticated,false);assert.deepEqual(mfa.cookies,[]);
});
test('failed passwords are rejected and unrelated local cookies are never relayed',async()=>{
 await assert.rejects(authenticatePanel({credentials:{username:'test',password:'fake'},request:async()=>reply({status:500,data:'bad password'})}),/登录失败/);
 assert.deepEqual(panelSessionCookies({getSetCookie:()=>['unrelated=secret','koa.sess=ok; HttpOnly','koa.sess.sig=signed; HttpOnly']}),['koa.sess=ok; HttpOnly','koa.sess.sig=signed; HttpOnly']);
});
test('current MCSManager random UUID cookie names and their signatures are retained',async()=>{
 const name='11111111-2222-4333-8444-555555555555',cookies=[name+'=test; Path=/; HttpOnly',name+'.sig=signed; Path=/; HttpOnly'];
 assert.deepEqual(panelSessionCookies({getSetCookie:()=>cookies}),cookies);
 const r=await authenticatePanel({cookie:name+'=test; '+name+'.sig=signed',request:async(url,opts)=>{assert.ok(opts.headers.Cookie.includes(name+'.sig='));return reply({status:200,data:{permission:10}});},readCredentials:async()=>assert.fail('must reuse live cookie')});assert.equal(r.authenticated,true);
});
test('Windows current-user encryption round trips without storing plaintext',async t=>{
 if(process.platform!=='win32')return;
 const identity=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().Name']);
 if(/\\CodexSandbox(?:Offline|Online)\s*$/i.test(identity)){t.skip('Sandbox service account has no loaded Windows profile; run this test as the desktop user.');return;}
 const script=path.join(ROOT,'scripts/panel-credentials.ps1'),plain=JSON.stringify({username:'本机测试账号',password:'fake-test-password'});
 const encrypt=await run('powershell.exe',['-NoProfile','-NonInteractive','-File',script,'-Action','protect'],{input:plain});assert.ok(encrypt.length>50);assert.equal(encrypt.includes('fake-test-password'),false);
 const decrypt=await run('powershell.exe',['-NoProfile','-NonInteractive','-File',script,'-Action','unprotect'],{input:encrypt});assert.equal(decrypt,plain);
});
