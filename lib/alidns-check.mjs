import {createHmac,randomUUID} from 'node:crypto';
const encode=v=>encodeURIComponent(String(v)).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export function zoneFromSOA(domain,result){
 return [...(result.Answer||[]),...(result.Authority||[])].filter(r=>r.type===6).map(r=>r.name.replace(/\.$/,'').toLowerCase()).find(zone=>zone.includes('.')&&(domain===zone||domain.endsWith('.'+zone)));
}
async function queryRecords(auth,domain){
 const soa=await fetch('https://dns.alidns.com/resolve?name='+encodeURIComponent(domain)+'&type=SOA',{signal:AbortSignal.timeout(8000)});if(!soa.ok)throw Error('暂时无法确认域名所属解析区域');
 const zone=zoneFromSOA(domain,await soa.json());if(!zone)throw Error('无法确认域名所属解析区域，请检查域名');
 const rr=domain===zone?'@':domain.slice(0,-zone.length-1);
 const params={Action:'DescribeDomainRecords',DomainName:zone,RRKeyWord:rr,PageSize:'100',Format:'JSON',Version:'2015-01-09',AccessKeyId:auth.id,SignatureMethod:'HMAC-SHA1',SignatureVersion:'1.0',SignatureNonce:randomUUID(),Timestamp:new Date().toISOString().replace(/\.\d{3}Z$/,'Z')};
 const query=Object.keys(params).sort().map(k=>encode(k)+'='+encode(params[k])).join('&');
 const signature=createHmac('sha1',auth.secret+'&').update('GET&%2F&'+encode(query)).digest('base64');
 const r=await fetch('https://alidns.aliyuncs.com/?'+query+'&Signature='+encode(signature),{signal:AbortSignal.timeout(15000)}),j=await r.json();
 if(j.Code){
  if(j.Code==='Forbidden.RAM')throw Error('当前阿里云 RAM 用户缺少云解析权限（Forbidden.RAM），请授权后重试。');
  if(j.Code.includes('InvalidAccessKey'))throw Error('阿里云 AccessKey ID 无效，请在本地检查。');
  if(j.Code.includes('Signature'))throw Error('阿里云密钥签名验证失败，请检查本地填写的 Secret。');
  throw Error('阿里云解析查询失败：'+j.Code);
 }
 if(Number(j.TotalCount)>100)throw Error('匹配的 DNS 记录较多，请先在 DNS 控制台核对该子域名。');
 return (j.DomainRecords?.Record||[]).filter(rec=>rec.RR===rr);
}
export async function aliyunAAAA(auth,domain){return (await queryRecords(auth,domain)).filter(rec=>rec.Type==='AAAA'&&rec.Status?.toUpperCase()==='ENABLE').map(rec=>rec.Value);}
export async function aliyunRecordSet(auth,domain){const records=await queryRecords(auth,domain);return {addresses:records.filter(r=>r.Type==='AAAA'&&r.Status?.toUpperCase()==='ENABLE').map(r=>r.Value),allAddresses:records.filter(r=>r.Type==='AAAA').map(r=>r.Value),ipv4:records.filter(r=>r.Type==='A').map(r=>r.Value),cnames:records.filter(r=>r.Type==='CNAME').map(r=>r.Value)};}
