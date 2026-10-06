import net from 'node:net';
function vi(n){n>>>=0;const a=[];do{let b=n&127;n>>>=7;if(n)b|=128;a.push(b);}while(n);return Buffer.from(a);}
function frame(b){return Buffer.concat([vi(b.length),b]);}
function readVi(b,at){let n=0;for(let i=0;i<5;i++){if(at+i>=b.length)return null;const v=b[at+i];n|=(v&127)<<(i*7);if(!(v&128))return {value:n>>>0,next:at+i+1};}throw Error('Invalid Minecraft packet');}
export function minecraftStatus(port,host='127.0.0.1'){
 return new Promise((resolve,reject)=>{
  const socket=net.connect({host,port}),name=Buffer.from(host);let data=Buffer.alloc(0),finished=false;
  const timer=setTimeout(()=>socket.destroy(Error('Minecraft status timeout')),2000);
  const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(result);};
  socket.on('error',e=>finish(e));socket.on('close',()=>{if(!finished)finish(Error('Minecraft closed status connection'));});
  socket.on('connect',()=>{const p=Buffer.alloc(2);p.writeUInt16BE(port);socket.write(frame(Buffer.concat([vi(0),vi(-1),vi(name.length),name,p,vi(1)])));socket.write(frame(vi(0)));});
  socket.on('data',b=>{try{data=Buffer.concat([data,b]);if(data.length>1048576)throw Error('Minecraft status too large');const len=readVi(data,0);if(!len||data.length<len.next+len.value)return;const id=readVi(data,len.next);if(!id||id.value!==0)throw Error('Invalid Minecraft status response');const size=readVi(data,id.next);if(!size||size.next+size.value!==len.next+len.value)throw Error('Invalid Minecraft status length');const j=JSON.parse(data.subarray(size.next,size.next+size.value).toString('utf8'));if(!j.version||!j.players)throw Error('Not a Minecraft status response');finish(null,j);}catch(e){finish(e);}});
 });
}
export async function waitForMinecraft({port,readStatus,log=()=>{},probe=minecraftStatus,timeout=600000,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),signal}){
 const started=now();let nextLog=started;
 while(now()-started<timeout){
  signal?.throwIfAborted();
  const state=await readStatus();
  if(![2,3].includes(state.status))throw Error('服务器启动进程已退出，请打开 MCSManager 实例控制台查看报错。');
  try{const response=await probe(port);return {ready:true,version:response.version.name,players:response.players.online};}catch{}
  if(now()>=nextLog){log('服务器正在加载模组和世界，请稍候…');nextLog=now()+30000;}
  await sleep(1500);
 }
 throw Error('等待服务器就绪超过 10 分钟，进程仍由 MCSManager 管理，请查看实例控制台；再次点击启动不会重复创建进程。');
}
