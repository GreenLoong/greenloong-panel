import test from 'node:test';
import assert from 'node:assert/strict';
import {zoneFromSOA} from '../lib/alidns-check.mjs';
test('DNS zone derives from authoritative SOA, including multi-label suffixes',()=>{assert.equal(zoneFromSOA('mc.example.com.cn',{Authority:[{name:'example.com.cn.',type:6}]}),'example.com.cn');assert.equal(zoneFromSOA('mc.example.com',{Answer:[{name:'example.com.',type:6}]}),'example.com');});
test('unrelated or top-level SOA is not mistaken for the user domain',()=>{assert.equal(zoneFromSOA('mc.example.xyz',{Authority:[{name:'xyz.',type:6}]}),undefined);assert.equal(zoneFromSOA('mc.example.xyz',{Authority:[{name:'other.xyz.',type:6}]}),undefined);});
