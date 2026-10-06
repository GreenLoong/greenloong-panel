import {zoneFromSOA} from './alidns-check.mjs';
export function providerFromNameservers(names){
 if(names.length&&names.every(n=>n.toLowerCase().replace(/\.$/,'').endsWith('.ns.cloudflare.com')))return 'cloudflare';
 if(names.length&&names.every(n=>/\.(hichina|alidns)\.com\.?$/i.test(n)))return 'alidns';
 return 'unsupported';
}
async function lookup(name,type){const r=await fetch('https://dns.alidns.com/resolve?name='+encodeURIComponent(name)+'&type='+type,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('DNS 服务商查询失败');return r.json();}
export async function detectDNSProvider(domain){
 const zone=zoneFromSOA(domain,await lookup(domain,'SOA'));if(!zone)throw Error('无法确认域名的权威 DNS 区域');
 const ns=await lookup(zone,'NS'),nameservers=(ns.Answer||[]).filter(r=>r.type===2).map(r=>r.data.replace(/\.$/,''));
 return {zone,nameservers,provider:providerFromNameservers(nameservers)};
}
export function configContainsDomain(conf,domain){return (conf.ipv6?.domains||[]).some(d=>d.split('?')[0]===domain);}
export function cloudflareCredentials(input,stored,domain){
 if(input.cloudflareToken?.trim())return {id:'',secret:input.cloudflareToken.trim()};
 const saved=stored?.dnsconf?.find(c=>c.dns?.name==='cloudflare'&&configContainsDomain(c,domain))?.dns;
 if(saved?.secret)return {id:'',secret:saved.secret};
 throw Error('此域名使用 Cloudflare DNS，请在本地填写 Cloudflare API Token。');
}
async function cloudflareGet(url,token){
 const r=await fetch(url,{headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)}),j=await r.json();
 if(!r.ok||!j.success)throw Error('Cloudflare Token 验证失败，请确认对应域名的 Zone Read 和 DNS Edit 权限。');return j.result;
}
export async function cloudflareAAAA(token,zone,domain){
 const zones=await cloudflareGet('https://api.cloudflare.com/client/v4/zones?name='+encodeURIComponent(zone)+'&status=active',token),found=zones.find(z=>z.name===zone);
 if(!found)throw Error('Cloudflare Token 没有访问这个域名的权限。');
 const records=await cloudflareGet('https://api.cloudflare.com/client/v4/zones/'+found.id+'/dns_records?name='+encodeURIComponent(domain),token),aaa=records.filter(r=>r.name===domain&&r.type==='AAAA');
 return {addresses:aaa.filter(r=>!r.proxied).map(r=>r.content),allAddresses:aaa.map(r=>r.content),ipv4:records.filter(r=>r.type==='A').map(r=>r.content),cnames:records.filter(r=>r.type==='CNAME').map(r=>r.content),proxied:aaa.some(r=>r.proxied)};
}
