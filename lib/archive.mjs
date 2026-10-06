import {open, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {inflateRawSync} from 'node:zlib';

// Read central-directory entries first; never execute files from uploaded archives.
export function safeRelative(name) {
  const n=name.replaceAll('\\','/');
  if (!n || n.startsWith('/') || /[:\x00-\x1f]/.test(n) || n.split('/').some(p=>p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw Error('压缩包包含不安全路径');
  return n;
}
export async function readZip(file) {
  const f=await source(file);
  try {
    const size=(await f.stat()).size;
    if(size<22) throw Error('不是有效的 ZIP／MRPACK 文件');
    const tail=Buffer.alloc(Math.min(size,65557)); await f.read(tail,0,tail.length,size-tail.length);
    let e=-1;
    for(let i=tail.length-22;i>=0;i--) if(tail.readUInt32LE(i)===0x06054b50 && i+22+tail.readUInt16LE(i+20)===tail.length){e=i;break;}
    if(e<0) throw Error('压缩包目录损坏');
    const count=tail.readUInt16LE(e+10), len=tail.readUInt32LE(e+12), offset=tail.readUInt32LE(e+16);
    if(count===65535||offset===0xffffffff||len>32*1024*1024||tail.readUInt16LE(e+4)!==0||offset+len>size) throw Error('暂不支持 ZIP64／分卷或超大压缩包');
    const central=Buffer.alloc(len);await f.read(central,0,len,offset);
    let at=0,total=0;const entries=[],seen=new Set();
    for(let i=0;i<count;i++){
      if(at+46>len||central.readUInt32LE(at)!==0x02014b50)throw Error('ZIP 目录无效');
      const n=central.readUInt16LE(at+28),x=central.readUInt16LE(at+30),c=central.readUInt16LE(at+32);
      if(at+46+n+x+c>len)throw Error('ZIP 目录被截断');
      const name=safeRelative(central.subarray(at+46,at+46+n).toString('utf8'));
      const entry={name,method:central.readUInt16LE(at+10),flags:central.readUInt16LE(at+8),crc:central.readUInt32LE(at+16),compressed:central.readUInt32LE(at+20),size:central.readUInt32LE(at+24),offset:central.readUInt32LE(at+42)};
      const unixMode=central.readUInt32LE(at+38)>>>16;
      if((unixMode&0xf000)===0xa000||entry.flags&1||![0,8].includes(entry.method))throw Error('不支持加密文件、链接或该压缩算法');
      if(seen.has(name.toLowerCase())) throw Error('压缩包存在重复或大小写冲突的路径');seen.add(name.toLowerCase());
      total+=entry.size;
      if(entry.size>512*1024*1024||total>8*1024*1024*1024||entry.size>Math.max(entry.compressed,1)*3000)throw Error('压缩包展开体积超过限制');
      entries.push(entry);at+=46+n+x+c;
    }
    return {file,entries};
  } finally {await f.close();}
}
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(b){let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export async function readEntry(zip,entry,max=512*1024*1024){
  if(entry.size>max||entry.compressed>max)throw Error('文件超过读取限制');
  const f=await source(zip.file);
  try{
    const h=Buffer.alloc(30);await f.read(h,0,30,entry.offset);
    if(h.readUInt32LE(0)!==0x04034b50)throw Error('ZIP 文件头无效');
    const b=Buffer.alloc(entry.compressed),pos=entry.offset+30+h.readUInt16LE(26)+h.readUInt16LE(28);
    const r=await f.read(b,0,b.length,pos);if(r.bytesRead!==b.length)throw Error('ZIP 文件被截断');
    const out=entry.method===0?b:inflateRawSync(b,{maxOutputLength:Math.max(1,entry.size)});
    if(out.length!==entry.size||crc32(out)!==entry.crc)throw Error('压缩包文件校验失败');return out;
  } finally{await f.close();}
}
async function source(file){if(!Buffer.isBuffer(file))return open(file,'r');return {stat:async()=>({size:file.length}),read:async(b,o,l,p)=>({bytesRead:file.copy(b,o,p,p+l)}),close:async()=>{}};}
export async function extract(zip,dest,select=(e)=>e.name){
  for(const e of zip.entries){const n=select(e);if(!n||n.endsWith('/'))continue;const safe=safeRelative(n);const target=path.resolve(dest,safe);if(!target.startsWith(path.resolve(dest)+path.sep))throw Error('解压路径越界');await mkdir(path.dirname(target),{recursive:true});await writeFile(target,await readEntry(zip,e),{flag:'wx'});}
}
