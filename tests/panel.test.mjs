import test from 'node:test';
import assert from 'node:assert/strict';
import {panelInstanceConfig} from '../lib/deploy.mjs';
test('managed instance uses the chosen port, normal stop command and no expiration',()=>{
 const cfg=panelInstanceConfig({id:'abcdefgh-1234',mc:'1.20.1',selectedCore:'forge',directory:'data/servers/test',port:25566,javaRelative:'data/java/bin/java.exe',args:['@libraries/win_args.txt','nogui'],memory:8});
 assert.equal(cfg.basePort,25566);assert.equal(cfg.pingConfig.port,25566);assert.equal(cfg.endTime,0);assert.equal(cfg.stopCommand,'stop');assert.equal(cfg.type,'minecraft/java');assert.equal(cfg.eventTask.autoStart,false);assert.match(cfg.startCommand,/java\.exe/);assert.match(cfg.startCommand,/-Xmx8G/);assert.doesNotMatch(cfg.startCommand,/cmd\.exe|start\.cmd|run-server/);if(process.platform==='win32')assert.equal(cfg.terminalOption.pty,false);
});
