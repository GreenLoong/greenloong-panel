import {Resolver} from 'node:dns/promises';
export async function checkAAAA(domain){
 const resolver=new Resolver({timeout:2500,tries:1});
 try{return {addresses:await resolver.resolve6(domain),source:'local',error:null};}
 catch(e){
  if(['ENOTFOUND','ENODATA'].includes(e.code))return {addresses:[],source:'local',error:null};
  try{const r=await fetch('https://dns.alidns.com/resolve?name='+encodeURIComponent(domain)+'&type=AAAA',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('DNS lookup failed');const result=await r.json();if(![0,3].includes(result.Status))throw Error('DNS resolver unavailable');return {addresses:(result.Answer||[]).filter(a=>a.type===28).map(a=>a.data),source:'AliDNS HTTPS',error:null};}
  catch{return {addresses:[],source:'unavailable',error:'DNS 查询暂时不可用，不能据此判断域名是否已解析。'};}
 }
}
