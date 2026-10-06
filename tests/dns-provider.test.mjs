import test from 'node:test';
import assert from 'node:assert/strict';
import {providerFromNameservers,configContainsDomain,cloudflareCredentials} from '../lib/dns-provider.mjs';
test('domain registrar is not used to infer DNS provider',()=>{assert.equal(providerFromNameservers(['kim.ns.cloudflare.com','kianchau.ns.cloudflare.com']),'cloudflare');assert.equal(providerFromNameservers(['dns1.hichina.com.','dns2.hichina.com.']),'alidns');assert.equal(providerFromNameservers(['ns.cloudflare.com.evil.example']),'unsupported');});
test('ddns-go DNS-only Cloudflare query parameters retain domain identity',()=>assert.equal(configContainsDomain({ipv6:{domains:['mc.example.xyz?proxied=false']}},'mc.example.xyz'),true));
test('Aliyun secret is never reused as a Cloudflare token',()=>assert.throws(()=>cloudflareCredentials({}, {dnsconf:[{dns:{name:'alidns',secret:'aliyun-secret'},ipv6:{domains:['mc.example.xyz']}}]},'mc.example.xyz'),/Cloudflare API Token/));
