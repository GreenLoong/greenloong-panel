import {readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ROOT,ps} from './system.mjs';
import {detectDNSProvider,cloudflareAAAA,configContainsDomain} from './dns-provider.mjs';
import {aliyunRecordSet} from './alidns-check.mjs';
import {checkAAAA} from './dns-check.mjs';
import {classifyDomain} from './network-preflight.mjs';
const DATA=path.join(ROOT,'data');
const canonical=ip=>{try{return new URL(`http://[${ip}]/`).hostname;}catch{return '';}};
export function addressesMatch(addresses,current){const expected=canonical(current);return !!expected&&addresses.length>0&&addresses.every(a=>canonical(a)===expected);}
export async function verifyStartupDNS({current,readProvider,readPublic,sync,log=()=>{},validateProvider=()=>{}}){
 let provider=await readProvider();
 validateProvider(provider);
 if(provider.proxied||!addressesMatch(provider.addresses,current)){
  log('域名记录与本机 IPv6 不一致，正在让 ddns-go 立即同步…');await sync();provider=await readProvider();
 }
 if(provider.proxied||!addressesMatch(provider.addresses,current))throw Error('ddns-go 同步后记录仍与本机 IPv6 不一致，请检查 DNS 权限、重复 AAAA 记录和代理状态。');
 log('DNS 服务商记录已核验：'+current+'。');
 const publicDNS=await readPublic();
 if(!addressesMatch(publicDNS.addresses,current))return {current,recordVerified:true,publicVerified:false,warning:publicDNS.error||'DNS 服务商记录已更新，公网解析缓存尚未同步；朋友可能需要稍后重新连接。'};
 log('公网 AAAA 解析也与本机 IPv6 一致。');return {current,recordVerified:true,publicVerified:true};
}
async function syncDDNS(exe,cfg,secrets){
 return new Promise((resolve,reject)=>{
  const child=spawn(exe,['-c',cfg,'-noweb','-f','60'],{cwd:ROOT,windowsHide:true});let output='',done=false;
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);child.kill();error?reject(error):resolve();};
  const timer=setTimeout(()=>{for(const secret of secrets.filter(Boolean))output=output.split(secret).join('[已隐藏]');finish(Error('ddns-go 本次同步未完成：'+(output.trim().split(/\r?\n/).slice(-3).join('；')||'请检查网络连接')));},45000);
  const collect=b=>{output=(output+b.toString()).slice(-12000);if(/(?:新增|更新)域名解析[^\n]*成功|DNS 记录没有变化/.test(output))finish();};
  child.stdout.on('data',collect);child.stderr.on('data',collect);child.on('error',e=>finish(Error('无法启动 ddns-go：'+e.message)));child.on('close',()=>{if(!done)finish(Error('ddns-go 同步进程提前退出。'));});
 });
}
export async function refreshSavedDNS(log=()=>{}){
 const readSaved=async file=>{try{return JSON.parse(await readFile(path.join(DATA,file),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw Error('无法读取已保存的域名配置（'+(e.code||'文件格式错误')+'），请重新应用网络配置。');}};
 const network=await readSaved('network.json');
 const stored=await readSaved(path.join('private','ddns.yaml'));
 const conf=stored?.dnsconf?.find(c=>configContainsDomain(c,network?.domain));
 if(!network?.domain||!conf)throw Error('尚未保存域名/DDNS 配置，请在“绑定域名”中完成设置。');
 const guid=/-InterfaceGuid\s+"(\{?[a-f0-9-]{36}\}?)"/i.exec(conf.ipv6.cmd||'')?.[1];
 if(!guid)throw Error('未找到用于 DDNS 的已保存网卡，请重新检测网络并应用域名配置。');
 const n=await ps('network'),current=n.addresses.find(a=>a.guid.toLowerCase().replace(/[{}]/g,'')===guid.toLowerCase().replace(/[{}]/g,'')&&!a.temporary)?.address;
 if(!current)throw Error('用于 DDNS 的网卡当前没有稳定公网 IPv6，请检查网络连接。');
 log('当前网卡公网 IPv6：'+current+'。');
 const service=await ps('ddns-state');if(!service.running)log('提醒：ddns-go 开机服务未运行，本次会核验域名；请应用网络配置恢复后台自动更新。');
 const authority=await detectDNSProvider(network.domain);
 if(authority.provider!==conf.dns.name)throw Error('域名实际 DNS 服务商与已保存的 ddns-go 配置不一致，请重新绑定域名。');
 const request=JSON.parse(await readFile(path.join(DATA,'admin-request.json'),'utf8').catch(()=> 'null'));
 const readProvider=()=>authority.provider==='cloudflare'?cloudflareAAAA(conf.dns.secret,authority.zone,network.domain):aliyunRecordSet(conf.dns,network.domain);
 const known=[...n.addresses.filter(a=>!a.temporary).map(a=>a.address),...(n.machineId&&network.machineId===n.machineId?network.knownAddresses||[]:[])];
 const result=await verifyStartupDNS({current,readProvider,readPublic:()=>checkAAAA(network.domain),log,validateProvider:provider=>{if(provider.ipv4?.length||provider.cnames?.length)throw Error('域名存在其他类型解析，请先核对绑定设置。');const foreign=classifyDomain(provider.allAddresses||provider.addresses,current,known);if(foreign.length)throw Error('域名指向未识别地址 '+foreign.join(', ')+'，可能已被另一台电脑更新；请回到绑定域名页面检查并确认迁移。');},sync:async()=>{
  const exe=request?.ddnsExe;
  if(!exe||!path.resolve(exe).startsWith(path.join(DATA,'ddns')+path.sep)||!await stat(exe).catch(()=>false))throw Error('ddns-go 程序缺失，请重新应用域名配置。');
  await syncDDNS(exe,path.join(DATA,'private','ddns.yaml'),[conf.dns.id,conf.dns.secret]);
 }});
 if(result.recordVerified)await writeFile(path.join(DATA,'network.json'),JSON.stringify({...network,machineId:n.machineId,knownAddresses:[...new Set([...known,current])].slice(-8)}),'utf8');
 if(!service.running)result.warning=[result.warning,'ddns-go 后台服务未运行，后续地址变化需要恢复服务。'].filter(Boolean).join(' ');
 return {...result,domain:network.domain,serviceRunning:service.running};
}
