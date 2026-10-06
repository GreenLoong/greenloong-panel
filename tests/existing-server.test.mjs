import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {DATA} from '../lib/deploy.mjs';
import {ROOT} from '../lib/system.mjs';
import {inspectExistingServer,copyExistingServer,importExistingServer} from '../lib/existing-server.mjs';
async function cleanup(dir){const p=path.resolve(dir);assert.ok(p.startsWith(path.resolve(DATA)+path.sep));await rm(p,{recursive:true,force:true});}
async function fixture(t){
 const base=await mkdtemp(path.join(DATA,'existing-test-')),source=path.join(base,'old');t.after(()=>cleanup(base));await mkdir(source);
 const args=path.join(source,'libraries/net/minecraftforge/forge/1.20.1-47.4.13');await mkdir(args,{recursive:true});await writeFile(path.join(args,'win_args.txt'),'net.minecraftforge.bootstrap.ForgeBootstrap');
 await writeFile(path.join(source,'server.properties'),'server-port=25566\nlevel-name=MyWorld\nonline-mode=false\nwhite-list=true\n');await writeFile(path.join(source,'eula.txt'),'eula=true\n');
 await writeFile(path.join(source,'user_jvm_args.txt'),'-Xmx6G\n-Dexample=keep\n');await writeFile(path.join(source,'run.bat'),'java @user_jvm_args.txt @libraries/net/minecraftforge/forge/1.20.1-47.4.13/win_args.txt nogui\n');
 for(const f of ['MyWorld/level.dat','MyWorld_nether/DIM-1/r.0.0.mca','mods/example.jar','plugins/config.yml','whitelist.json']){await mkdir(path.dirname(path.join(source,f)),{recursive:true});await writeFile(path.join(source,f),'original-'+f);}
 return {base,source};
}
test('existing Forge directory detects Java, exact core, port, memory and custom world without conversion',async t=>{
 const {source}=await fixture(t),r=await inspectExistingServer(source);assert.equal(r.mc,'1.20.1');assert.equal(r.java,17);assert.equal(r.port,25566);assert.equal(r.memory,6);assert.equal(r.world,'MyWorld');assert.equal(r.candidates[0].loaderVersion,'47.4.13');assert.deepEqual(r.jvmArgs,['@user_jvm_args.txt']);assert.equal(r.eula,true);
});
test('full copy preserves custom worlds, plugins, whitelist and properties byte for byte',async t=>{
 const {base,source}=await fixture(t),dest=path.join(base,'copy');await copyExistingServer(source,dest);
 for(const file of ['server.properties','MyWorld/level.dat','MyWorld_nether/DIM-1/r.0.0.mca','whitelist.json','plugins/config.yml'])assert.deepEqual(await readFile(path.join(dest,file)),await readFile(path.join(source,file)));
 await assert.rejects(copyExistingServer(source,path.join(source,'nested')),/互相包含/);
});
test('a running old server or stale analysis never copies or starts a second instance',async t=>{
 const {source}=await fixture(t),r=await inspectExistingServer(source);const deps={ports:async()=>({conflicts:[{port:25566}]}),copy:async()=>assert.fail('must not copy')};
 await assert.rejects(importExistingServer(r,{},()=>{},deps),/正常停止旧服务器/);await writeFile(path.join(source,'new-file.txt'),'changed');await assert.rejects(importExistingServer(r,{},()=>{},deps),/文件发生变化/);
});
test('import retains old content and failed registration leaves current server selection intact',async t=>{
 const {base,source}=await fixture(t),plan=await inspectExistingServer(source);let cfg;
 const before=await readFile(path.join(DATA,'last-server.json'),'utf8').catch(()=>null);
 const deps={recordsPath:path.join(base,'records.json'),ports:async()=>({conflicts:[]}),java:async()=>process.execPath,panel:async()=>{},startPanel:async()=>{},register:async c=>{cfg=c;t.after(()=>cleanup(path.join(ROOT,c.directory)));throw Error('registration failed');}};
 await assert.rejects(importExistingServer(plan,{},()=>{},deps),/registration failed/);assert.equal(await readFile(path.join(DATA,'last-server.json'),'utf8').catch(()=>null),before);assert.deepEqual(await readFile(path.join(ROOT,cfg.directory,'server.properties')),await readFile(path.join(source,'server.properties')));
});
test('successful same-source reimport reuses the same copied world instead of forking it',async t=>{
 const {base,source}=await fixture(t),plan=await inspectExistingServer(source);let copies=0;
 const deps={recordsPath:path.join(base,'records.json'),ports:async()=>({conflicts:[]}),copy:async(s,d)=>{copies++;t.after(()=>cleanup(d));return copyExistingServer(s,d);},java:async()=>process.execPath,panel:async()=>{},startPanel:async()=>{},register:async c=>({instanceUuid:c.id})};
 const first=await importExistingServer(plan,{},()=>{},deps);await writeFile(path.join(ROOT,first.config.directory,'MyWorld/level.dat'),'new progress');const second=await importExistingServer(plan,{},()=>{},deps);assert.equal(copies,1);assert.equal(second.reused,true);assert.equal(second.config.id,first.config.id);assert.equal(await readFile(path.join(ROOT,second.config.directory,'MyWorld/level.dat'),'utf8'),'new progress');
});
