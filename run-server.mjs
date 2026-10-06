import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {ROOT,ps} from './lib/system.mjs';
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
const conflicts=(await ps('ports',{ports:[config.port]})).conflicts;
if(conflicts.length){console.error('端口冲突，启动已取消：',conflicts);process.exit(1);}
const p=spawn(path.join(ROOT,config.javaRelative),[`-Xms2G`,`-Xmx${config.memory}G`,...config.args],{cwd:path.join(ROOT,config.directory),stdio:'inherit',windowsHide:true});
p.on('error',e=>{console.error(e.message);process.exit(1);});p.on('exit',code=>process.exit(code||0));
