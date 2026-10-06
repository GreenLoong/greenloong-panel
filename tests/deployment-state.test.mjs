import test from 'node:test';
import assert from 'node:assert/strict';
import {reuseDeployment} from '../lib/deployment-state.mjs';
const cfg={sourceUpload:'pack.zip',port:25565,memory:8,status:'startup-test-passed',panelInstance:'instance'};
test('repeat deployment reuses verified same upload rather than creating another world',()=>assert.equal(reuseDeployment(cfg,'D:/uploads/pack.zip',{port:'25565',memory:'8'}),cfg));
test('a different upload is prepared separately',()=>assert.equal(reuseDeployment(cfg,'D:/uploads/other.zip',{port:25565,memory:8}),null));
test('changed settings require an explicit existing-instance update',()=>assert.throws(()=>reuseDeployment(cfg,'D:/uploads/pack.zip',{port:25566,memory:8}),/现有实例/));
test('unverified or unregistered server is never treated as reusable completed deployment',()=>{assert.equal(reuseDeployment({...cfg,status:'prepared-not-tested'},'pack.zip',{port:25565,memory:8}),null);assert.equal(reuseDeployment({...cfg,panelInstance:null},'pack.zip',{port:25565,memory:8}),null);});
