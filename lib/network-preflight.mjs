import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT,ps,run,validPort} from './system.mjs';
import {detectDNSProvider,cloudflareAAAA,cloudflareCredentials,configContainsDomain} from './dns-provider.mjs';
import {aliyunRecordSet} from './alidns-check.mjs';
const canonical=ip=>{try{return new URL('http://['+ip+']/').hostname;}catch{return '';}};
export function classifyDomain(addresses,current,known=[]){const allowed=new Set([current,...known].map(canonical).filter(Boolean));return addresses.filter(a=>!allowed.has(canonical(a)));}
export function classifyDdns(service,root){if(!service.exists)return 'absent';if(!service.readable)return 'unknown';return service.exe&&service.config&&path.resolve(service.exe).toLowerCase().startsWith(path.join(root,'data','ddns').toLowerCase()+path.sep)&&path.resolve(service.config).toLowerCase()===path.join(root,'data','private','ddns.yaml').toLowerCase()?'owned':'foreign';}
export async function inspectDdns(domain){
 const raw=JSON.parse(await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'scripts','inspect-ddns.ps1')]));
 const ownership=classifyDdns(raw,ROOT);let domains=[],canTakeover=false;
 if(ownership==='foreign'&&/greenloong/i.test(raw.exe||'')){try{const old=JSON.parse(await readFile(raw.config,'utf8'));domains=[...new Set((old.dnsconf||[]).flatMap(c=>[...(c.ipv4?.domains||[]),...(c.ipv6?.domains||[])]).map(d=>d.split('?')[0]))];canTakeover=domains.length===1;}catch{}}
 return {...raw,ownership,domains,canTakeover};
}
export async function networkPreview(input){
 const domain=String(input.domain||'').trim().toLowerCase(),port=validPort(input.port);if(!/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(domain))throw Error('请输入完整域名。');
 const [network,service,storedText,savedText]=await Promise.all([ps('network'),inspectDdns(domain),readFile(path.join(ROOT,'data/private/ddns.yaml'),'utf8').catch(()=> 'null'),readFile(path.join(ROOT,'data/network.json'),'utf8').catch(()=> 'null')]);
 const stored=JSON.parse(storedText),saved=JSON.parse(savedText),conf=stored?.dnsconf?.find(c=>configContainsDomain(c,domain)),guid=input.interfaceGuid||/-InterfaceGuid\s+"([^"]+)"/.exec(conf?.ipv6.cmd||'')?.[1]||network.addresses.find(a=>!a.temporary)?.guid;
 const local=network.addresses.find(a=>a.guid===guid&&!a.temporary);if(!local)throw Error('所选网卡没有稳定公网 IPv6，请重新检测网络。');
 const authority=await detectDNSProvider(domain);if(authority.provider==='unsupported')throw Error('当前 DNS 服务商暂未支持。');
 const auth=authority.provider==='cloudflare'?cloudflareCredentials(input,stored,domain):input.accessId&&input.accessSecret?{id:input.accessId,secret:input.accessSecret}:conf?.dns?.name==='alidns'?conf.dns:null;
 if(!auth?.secret)throw Error('请先填写对应 DNS 服务商的密钥。');
 const records=authority.provider==='cloudflare'?await cloudflareAAAA(auth.secret,authority.zone,domain):await aliyunRecordSet(auth,domain);
 const addresses=records.allAddresses||records.addresses,known=[...network.addresses.filter(a=>!a.temporary).map(a=>a.address),...(network.machineId&&saved?.domain===domain&&saved?.machineId===network.machineId?saved?.knownAddresses||[]:[])],conflicting=classifyDomain(addresses,local.address,known);
 const ticket=createHash('sha256').update(JSON.stringify([domain,local.address,[...addresses].sort(),service.binaryPath||'',service.domains])).digest('hex');
 return {domain,port,currentIPv6:local.address,interfaceGuid:guid,machineId:network.machineId,authority,addresses,conflicting,service,ticket,otherRecordTypes:!!(records.ipv4?.length||records.cnames?.length)};
}
export function assertNetworkPreview(preflight,input){
 if(preflight.otherRecordTypes)throw Error('这个游戏域名已有 A／CNAME 记录，请使用另一个子域名，或先在 DNS 管理中核对记录。');
 if(preflight.service.ownership==='unknown')throw Error('已有 ddns-go 服务，但当前无法核实服务路径，请用当前 Windows 管理员账户重新检测。');
 if(preflight.service.ownership==='foreign'&&(!preflight.service.canTakeover||!input.takeOverDdns||input.networkTicket!==preflight.ticket))throw Error('检测到另一份平台的 ddns-go：'+(preflight.service.config||'配置路径未读取')+'。请先检查网络冲突；单一游戏域名的旧版绿龙服务可明确选择接管，其他服务需要先在原配置中处理。');
 if(preflight.conflicting.length&&(!input.takeOverDomain||input.networkTicket!==preflight.ticket))throw Error('域名目前指向未识别地址：'+preflight.conflicting.join(', ')+'；当前 IPv6：'+preflight.currentIPv6+'。请使用另一个子域名，或确认旧电脑同域名 DDNS 已停止后明确选择迁移。');
}
