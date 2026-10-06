import test from 'node:test';
import assert from 'node:assert/strict';
import {clientCrashFiles} from '../lib/client-crash.mjs';
test('isolate only explicitly identified failed mods using unavailable client classes',()=>{
 const log=`-- MOD visuals --\nDetails:\n Mod File: D:/server/mods/visuals.jar\n Failure message: failed\n java.lang.RuntimeException: Attempted to load class net/minecraft/client/Minecraft for invalid dist DEDICATED_SERVER\n-- MOD gameplay --\nDetails:\n Mod File: D:/server/mods/gameplay.jar\n java.lang.NoClassDefFoundError: missing/Dependency\n-- System Details --\n`;
 assert.deepEqual(clientCrashFiles(log).map(x=>x.file),['visuals.jar']);
});
test('client warnings outside a failed MOD section do not quarantine gameplay',()=>assert.deepEqual(clientCrashFiles('WARN Attempted to load class net/minecraft/client/Minecraft for invalid dist DEDICATED_SERVER\nMod File: D:/server/mods/gameplay.jar'),[]));
test('Windows-style Mod File paths and client ClassNotFound are handled',()=>{const log='-- MOD search --\nDetails:\n Mod File: D:\\server\\mods\\search.jar\n Exception message: java.lang.ClassNotFoundException: net.minecraft.client.searchtree.SuffixArray\n-- System Details --\n';assert.equal(clientCrashFiles(log)[0].file,'search.jar');});
