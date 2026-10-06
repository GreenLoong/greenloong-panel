const $=id=>document.getElementById(id);
const token=location.hash.slice(1)||sessionStorage.getItem('greenloong-session')||'';
const panelAutoOpen=new URLSearchParams(location.search||'').get('openPanel')==='1';
if(token)sessionStorage.setItem('greenloong-session',token);
history.replaceState(null,'',location.pathname);
let busy=false,hasUpload=false,reconnectAttempts=0,reconnectTimer;
let existingPlanId='',networkTicket='';
const bytesText=n=>{if(!Number.isFinite(n)||n<0)return '—';const u=['B','KB','MB','GB'];let i=0;while(n>=1024&&i<3){n/=1024;i++;}return n.toFixed(i?1:0)+' '+u[i];};
function renderDownloads(j){
 const d=j.downloads,items=d?.items||[];$('downloadProgress').hidden=!items.length;$('downloadButtons').hidden=!items.length;
 $('downloadStop').disabled=!j.busy||!d?.canStop;$('downloadRetry').disabled=!j.busy||!d?.paused;$('downloadCancel').disabled=!j.busy||(!d?.paused&&!d?.canStop);
 if(!items.length)return;
 const running=items.filter(r=>['connecting','downloading','retrying'].includes(r.status));
 $('downloadSummary').textContent=d.paused?d.reason:d.cancelled?'下载任务已结束，已完成文件保留。':running.length?`当前 ${running.length} 项传输 · 合计 ${bytesText(running.reduce((n,r)=>n+r.speedBytesPerSecond,0))}/s`:'下载已结束，后续安装进度见操作日志。';
 $('downloadItems').replaceChildren();const labels={connecting:'等待服务器响应',downloading:'正在下载',retrying:'正在自动重试',verifying:'处理／校验已下载内容','checking-cache':'核验本机缓存',completed:'下载完成',cached:'使用已校验缓存',paused:'已停止，等待重新下载',failed:'下载失败',cancelled:'已取消'};
 for(const r of items){const row=document.createElement('div');row.className='download-row';const title=document.createElement('div');title.className='download-name';title.textContent=r.name;const bar=document.createElement('progress');bar.max=100;if(r.total)bar.value=['completed','cached'].includes(r.status)?100:Math.min(99,100*r.bytes/r.total);else bar.removeAttribute('value');const details=document.createElement('p');details.className='hint';details.textContent=`${labels[r.status]||r.status} · ${bytesText(r.bytes)} / ${r.total?bytesText(r.total):'大小未知'} · ${bytesText(r.speedBytesPerSecond)}/s\n${r.host} · 第 ${r.attempt}/${r.maxAttempts} 次 · 已用 ${r.elapsedSeconds} 秒`+(r.idleSeconds>=5?` · ${r.idleSeconds} 秒未收到数据`:'')+(r.error?'\n'+r.error:'');row.append(title,bar,details);$('downloadItems').append(row);}
}
const values=()=>({domain:$('domain').value,port:$('port').value,memory:$('memory').value,mc:$('mc').value,loader:$('loader').value,loaderVersion:$('loaderVersion').value,serverPack:$('serverPack').checked,eula:$('eula').checked,ddns:$('ddns').checked,firewall:$('firewall').checked,interfaceGuid:$('nic').value,accessId:$('accessId').value,accessSecret:$('accessSecret').value,apiKey:$('apiKey').value,curseKey:$('curseKey').value,coreMode:$('coreMode').value,dnsProvider:$('dnsProvider').value,cloudflareToken:$('cloudflareToken').value,downloadIdleSeconds:$('downloadIdleSeconds').value,downloadTotalMinutes:$('downloadTotalMinutes').value,takeOverDdns:$('takeOverDdns').checked,takeOverDomain:$('takeOverDomain').checked,networkTicket});
async function api(url,data,raw=false){const r=await fetch('/api/'+url,{method:'POST',headers:{'X-GreenLoong-Token':token,...(raw?{}:{'Content-Type':'application/json'})},body:raw?data:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw Error(result.error);return result;}
function error(e){$('state').textContent='需要处理';$('logs').textContent=e.message;}
function disable(b){busy=b;document.querySelectorAll('button').forEach(x=>x.disabled=b);$('coreMode').disabled=b;$('dnsProvider').disabled=b;}
function recoverConnection(error,callback){
 if(!(error instanceof TypeError)||!/fetch|network/i.test(error.message))return false;
 disable(true);reconnectAttempts++;$('state').textContent='正在恢复连接';$('logs').textContent='部署工具连接暂时中断，正在恢复任务状态。现有服务器继续由 MCSManager 管理。';
 clearTimeout(reconnectTimer);reconnectTimer=setTimeout(callback,Math.min(1000*2**Math.min(reconnectAttempts,4),15000));return true;
}
function connected(){reconnectAttempts=0;clearTimeout(reconnectTimer);}
function resultSummary(result){
 if(!result)return '';
 if(result.stopped)return '\n'+(result.alreadyStopped?'服务器原本已经关闭。':'服务器已关闭。')+'\n游戏 TCP 端口已释放。'+(result.saveVerified?'\n本次已核对世界保存完成。':'');
 if(result.ready&&result.instanceUuid)return '\n服务器已就绪。'+(result.address?'\n连接地址：'+result.address:'')+(result.networkError?'\n域名／DDNS 提醒：'+result.networkError:'\n当前 IPv6 与域名解析已核验。')+'\n关闭部署页面后，服务器仍由 MCSManager 运行。';
 if(result.imported)return '\n现有服务器已复制并接入 MCSManager，原目录保留。\n端口：'+result.config.port+'\n点击“一键启动服务器”即可开服。'+(result.networkError?'\n'+result.networkError:'');
 const cfg=result.config||result;
 if(cfg.selectedCore)return `\n服务端方案：${cfg.selectedCore}\nMinecraft：${cfg.mc}\n加载器版本：${cfg.loaderVersion}\n端口：${cfg.port}\n内存：${cfg.memory} GB\n${result.managed?'实例已在 MCSManager 中运行。':'文件已准备，是否启动通过请查看试启动结果。'}${result.networkError?'\n'+result.networkError:''}`;
 if(result.status==='startup-test-passed')return '\n启动检查通过。外网连接和多人负载尚待验证。';
 if(result.domain)return `\n域名：${result.domain}\n游戏端口：${result.port}`;
 if(result.instanceUuid)return result.status===3?'\n实例已由 MCSManager 接管并运行。世界初始化进度可在实例控制台查看。':'\n实例已导入 MCSManager。';
 if(result.url)return '\nMCSManager 已响应，请打开管理面板。';
 return '';
}
async function openPanelWindow(win){try{const info=await api('panel-access',{});$('panelDirect').href=info.url;$('panelNotice').textContent=info.authenticated?'MCSManager 已登录，正在打开管理页面。':info.message||'请在 MCSManager 完成首次登录。';if(win)win.location.href=info.url;else $('panelNotice').textContent+=' 浏览器未允许自动打开，请点击“直接打开管理面板”。';}catch(e){$('panelNotice').textContent=e.message+' 请点击“直接打开管理面板”重试。';if(win)win.location.href='http://127.0.0.1:23333/';}}
async function action(name){const wantsPanel=['start-managed','panel','all'].includes(name),win=wantsPanel?window.open('/panel-opening','greenloong-mcsm'):null;disable(true);$('state').textContent=name==='stop-managed'?'正在关闭服务器':'正在处理';$('logs').textContent='正在开始当前步骤…';try{await api(name,{...values(),...(name==='start-managed'?{confirmedStart:true}:{}),...(name==='stop-managed'?{confirmedStop:true}:{})});if(wantsPanel)void openPanelWindow(win);await poll(name);}catch(e){if(win)win.close();if(recoverConnection(e,()=>poll(name)))return;error(e);disable(false);}}
async function poll(name){try{const r=await fetch('/api/status',{headers:{'X-GreenLoong-Token':token}});const j=await r.json();if(!r.ok)throw Error(j.error);connected();const historical=!name&&!j.busy&&j.logs.length>0;$('logs').textContent=(historical?'上次操作记录（以页面上方当前服务器状态为准，不会自动重新执行）：\n':'')+j.logs.slice(-20).join('\n')+resultSummary(j.result);$('state').textContent=j.busy?(j.downloads?.paused?'下载已停止，等待处理':'正在处理…'):historical?'上次操作记录':j.error?'步骤未完成':j.cancelled?'任务已取消':j.result?.stopped?'服务器已关闭':j.result?.networkError?'服务端已部署，网络配置待完成':j.logs.length?'步骤完成':'等待开始';if(j.error&&!j.logs.some(l=>l.includes(j.error)))$('logs').textContent+='\n'+j.error;if(j.busy){disable(true);renderDownloads(j);if(j.kind==='start-managed'&&!j.stopQueued)$('stopServer').disabled=false;setTimeout(()=>poll(name),1200);}else{disable(false);renderDownloads(j);void refreshGameState();if(['network','all'].includes(name)&&!j.result?.networkError&&!j.error){$('accessSecret').value='';$('cloudflareToken').value='';}if(name==='import')$('apiKey').value='';}}catch(e){if(recoverConnection(e,()=>poll(name)))return;error(e);disable(false);}}
function showAnalysis(j){
 hasUpload=true;
 const types={client:'客户端包，需要下载并转换',server:'服务端包，优先保留已有核心',mixed:'同时包含客户端和服务端，需要核对',unknown:'类型未确定，需核对内容'};
 $('analysis').textContent=`${j.name}\n包类型：${types[j.packType]}\n判断依据：${j.typeEvidence.join('；')||'证据不足'}\nMinecraft：${j.mc||'未确定'}\n加载器：${Object.entries(j.loaders).filter(x=>x[1]).map(x=>x.join(' ')).join(', ')||'未确定'}\n已有核心：${j.existingCore?.kind||'没有识别到'}\n模组数量：${j.modCount}\n${j.warnings.join('\n')}\n清单中明确排除的客户端文件：${(j.excluded||[]).length}`;
 $('corePlan').textContent=j.resolution?.reason||'等待选择服务端方案';$('manual').open=!j.mc||!j.core.loader;
}
async function refreshPlan(){if(!hasUpload||busy)return;try{const plan=await api('plan',values());$('corePlan').textContent=plan.reason;}catch(e){$('corePlan').textContent=e.message;}}
$('coreMode').onchange=refreshPlan;
for(const name of ['mc','loader','loaderVersion','serverPack'])$(name).onchange=refreshPlan;
$('check').onclick=async()=>{disable(true);try{const j=await api('check',values());if(j.authority)showAuthority(j.authority);$('networkResult').textContent=`内存：${j.memoryGB} GB\n公网 IPv6 候选：${j.addresses.length}\n`+j.addresses.map(a=>`${a.name}：${a.address}${a.temporary?'（临时地址，不用于 DDNS）':''}`).join('\n')+`\n端口占用：${j.conflicts.length?j.conflicts.map(c=>`${c.protocol} ${c.port}`).join('；'):'未发现'}\n域名 AAAA：${j.dns.length?j.dns.join(', '):j.providerDns?.length?'实际 DNS 服务商已配置记录（公网 DNS 缓存更新中）：'+j.providerDns.join(', '):j.providerError||j.dnsError||'尚无 AAAA 解析记录'}\n${j.externalReachability}`;$('nic').replaceChildren();for(const a of j.addresses.filter(a=>!a.temporary)){const o=document.createElement('option');o.value=a.guid;o.textContent=a.name+' · '+a.address;$('nic').append(o);}if(!$('nic').options.length){const o=document.createElement('option');o.value='';o.textContent='没有找到可用的稳定公网 IPv6';$('nic').append(o);}}catch(e){if(recoverConnection(e,()=>poll()))return;error(e);}finally{if(!reconnectAttempts)disable(false);}};
$('analyze').onclick=async()=>{const f=$('pack').files[0];if(!f)return error(Error('请先选择整合包'));disable(true);hasUpload=false;$('analysis').textContent='正在检查包类型、已有核心和加载器版本…';try{showAnalysis(await api('upload',f,true));$('logs').textContent='分析完成，处理方案已显示在左侧。';$('state').textContent='分析完成';}catch(e){error(e);$('analysis').textContent=e.message;}finally{disable(false);await refreshPlan();}};
for(const name of ['deploy','panel','network','import','all','smoke'])$(name).onclick=()=>action(name);
$('startServer').onclick=()=>action('start-managed');
function showControlPort(info){$('controlPortInfo').textContent='本机控制页面端口：'+(info?.selectedPort||location.port||18640)+(info?.message?'。检测结果：'+info.message:'');}
async function refreshControlPort(){try{const r=await fetch('/api/control-port',{headers:{'X-GreenLoong-Token':token}});if(r.ok)showControlPort(await r.json());}catch{}}
$('checkControlPort').onclick=async()=>{try{showControlPort(await api('control-port-detect',{}));}catch(e){$('controlPortInfo').textContent=e.message;}};
$('stopServer').onclick=()=>action('stop-managed');
$('previewNetwork').onclick=async()=>{disable(true);networkTicket='';$('takeOverDdns').checked=false;$('takeOverDomain').checked=false;try{const r=await api('network-preview',values());networkTicket=r.ticket;const names={owned:'本目录的服务，可复用',foreign:'另一份安装的服务',absent:'尚未安装',unknown:'服务存在，但路径未能核实'};$('networkConflictReport').textContent=`当前公网 IPv6：${r.currentIPv6}\n域名：${r.domain}\n已有 AAAA：${r.addresses.join(', ')||'没有'}\n域名检查：${r.conflicting.length?'存在未识别地址，先核对或明确迁移':'没有发现其他主机地址冲突'}\nDDNS：${names[r.service.ownership]}\n程序：${r.service.exe||'—'}\n配置：${r.service.config||'—'}\n旧服务中配置的域名：${r.service.domains.join(', ')||'—'}`+(r.service.ownership==='foreign'&&!r.service.canTakeover?'\n旧服务含其他域名或配置无法安全读取，请先在原平台处理。':'')+(r.otherRecordTypes?'\n域名已有 A/CNAME 记录，请改用专用游戏子域名或先在 DNS 控制台核对。':'');$('ddnsTakeoverOption').hidden=!(r.service.ownership==='foreign'&&r.service.canTakeover);$('domainTakeoverOption').hidden=!r.conflicting.length;}catch(e){$('networkConflictReport').textContent=e.message;}finally{disable(false);}};
for(const id of ['takeOverDdns','takeOverDomain'])$(id).onchange=()=>{if(!networkTicket){$(id).checked=false;$('networkConflictReport').textContent='请先检查并查看要迁移的服务和域名记录。';}};
for(const [id,route] of [['downloadStop','download-stop'],['downloadRetry','download-retry'],['downloadCancel','download-cancel']])$(id).onclick=async()=>{try{await api(route,{downloadIdleSeconds:$('downloadIdleSeconds').value,downloadTotalMinutes:$('downloadTotalMinutes').value,takeOverDdns:$('takeOverDdns').checked,takeOverDomain:$('takeOverDomain').checked,networkTicket});await poll('download-control');}catch(e){error(e);}};
$('openPanel').onclick=()=>openPanelWindow(window.open('/panel-opening','greenloong-mcsm'));
async function refreshGameState(){try{const r=await fetch('/api/game-state',{headers:{'X-GreenLoong-Token':token}});if(!r.ok)throw Error();const j=await r.json();$('gameState').textContent='当前服务器：'+j.message+(j.port?' · 端口 '+j.port:'');}catch{$('gameState').textContent='当前服务器状态暂时无法查询，请查看 MCSManager。';}}
async function refreshPanelLogin(){try{const r=await fetch('/api/panel-login-state',{headers:{'X-GreenLoong-Token':token}}),j=await r.json();if(!r.ok)throw Error();$('panelUsername').value=j.username||'';$('panelLoginState').textContent=j.saved?'已加密记住登录；点击一键启动后会尝试自动登录。':'尚未记住登录；已登录的浏览器可沿用当前会话。';}catch{$('panelLoginState').textContent='暂时无法读取本机登录设置。';}}
$('savePanelLogin').onclick=async()=>{disable(true);try{const j=await api('panel-save-login',{username:$('panelUsername').value,password:$('panelPassword').value,code:$('panelCode').value});$('panelPassword').value='';$('panelCode').value='';$('panelNotice').textContent=j.message;await refreshPanelLogin();}catch(e){$('panelNotice').textContent=e.message;}finally{disable(false);}};
$('forgetPanelLogin').onclick=async()=>{try{await api('panel-forget-login',{});$('panelPassword').value='';$('panelCode').value='';await refreshPanelLogin();$('panelNotice').textContent='已删除本机记住的登录信息。当前浏览器会话仍由 MCSManager 管理。';}catch(e){$('panelNotice').textContent=e.message;}};
function showExisting(plan){
 existingPlanId=plan.id;const r=plan.report;$('existingOptions').hidden=false;$('existingDirectory').value=plan.source==='zip'?'':r.directory;
 $('existingReport').textContent=`名称：${r.name}\n游戏端口：${r.port}\n存档目录：${r.world}\n文件：${r.fileCount} 个 · ${(r.bytes/1024**3).toFixed(2)} GB\n启动入口：${r.candidates.length} 个\n${r.warnings.join('\n')}`;
 $('existingCore').replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent='请选择启动入口';$('existingCore').append(blank);
 for(const c of r.candidates){const o=document.createElement('option');o.value=c.key;o.textContent=c.kind+' · '+c.key;$('existingCore').append(o);}
 $('existingCore').value=r.selectedKey;$('existingMC').value=r.mc;$('existingJava').value=r.java||'';$('existingPort').value=r.port;$('existingMemory').value=r.memory;
}
$('chooseExisting').onclick=async()=>{disable(true);try{const r=await api('existing-folder',{});if(r.directory){$('existingDirectory').value=r.directory;showExisting(await api('existing-analyze',{directory:r.directory}));}}catch(e){error(e);}finally{disable(false);}};
$('existingDirectory').oninput=()=>{existingPlanId='';$('existingOptions').hidden=true;};
$('existingCore').onchange=()=>{const o=$('existingCore').value;if(!o)return;const match=/^libraries\/net\/minecraftforge\/forge\/(1\.\d+(?:\.\d+)?)-/.exec(o);if(match)$('existingMC').value=match[1];};
$('analyzeExisting').onclick=async()=>{disable(true);try{showExisting(await api('existing-analyze',{directory:$('existingDirectory').value.trim()}));}catch(e){error(e);}finally{disable(false);}};
$('analyzeExistingZIP').onclick=async()=>{const f=$('existingZIP').files[0];if(!f)return error(Error('请先选择完整服务端 ZIP'));disable(true);try{showExisting(await api('existing-upload',f,true));}catch(e){error(e);}finally{disable(false);}};
$('importExisting').onclick=async()=>{if(!existingPlanId)return error(Error('请先分析现有服务端'));disable(true);try{await api('existing-import',{apiKey:$('apiKey').value,existingPlanId,existingCore:$('existingCore').value,existingMC:$('existingMC').value,existingJava:$('existingJava').value,existingPort:$('existingPort').value,existingMemory:$('existingMemory').value,existingStart:$('existingStart').checked});$('port').value=$('existingPort').value;await poll('existing-import');}catch(e){if(recoverConnection(e,()=>poll('existing-import')))return;error(e);disable(false);}};
async function restoreExisting(){try{const r=await fetch('/api/existing',{headers:{'X-GreenLoong-Token':token}});const j=await r.json();if(r.ok&&j?.report)showExisting(j);}catch{}}
async function restore(){try{if(!$('domain').value){const savedResponse=await fetch('/api/network-settings',{headers:{'X-GreenLoong-Token':token}});if(savedResponse.ok){const saved=await savedResponse.json();if(saved?.domain){$('domain').value=saved.domain;$('port').value=saved.port;}}}const r=await fetch('/api/upload',{headers:{'X-GreenLoong-Token':token}});const j=await r.json();if(!r.ok)throw Error(j.error);connected();if(j)showAnalysis(j);await refreshAuthority();await poll();}catch(e){if(recoverConnection(e,restore))return;error(e);}}
if(!token)error(Error('会话已失效，请重新双击 Launch.cmd 打开工具。'));else {restore();restoreExisting();refreshGameState();refreshPanelLogin();refreshControlPort();setInterval(refreshGameState,5000);if(panelAutoOpen)api('panel-access',{}).then(info=>{location.href=info.url;}).catch(e=>{$('panelNotice').textContent=e.message;});}


let detectedProvider;
function showAuthority(info){detectedProvider=info.provider;$('dnsAuthority').textContent='实际解析服务商：'+(info.provider==='cloudflare'?'Cloudflare':info.provider==='alidns'?'阿里云':'暂未支持')+'；DNS 服务器：'+info.nameservers.join(', ')+'。应使用这家服务商的密钥。';updateProviderFields();}
function updateProviderFields(){const selected=$('dnsProvider').value,p=selected==='auto'?detectedProvider:selected;$('aliyunFields').hidden=p==='cloudflare';$('cloudflareFields').hidden=p==='alidns';}
async function refreshAuthority(){if(!$('domain').value.trim()){$('dnsAuthority').textContent='填写游戏域名后自动识别 DNS 服务商。';return;}try{const r=await fetch('/api/authority?domain='+encodeURIComponent($('domain').value),{headers:{'X-GreenLoong-Token':token}});const j=await r.json();if(!r.ok)throw Error(j.error);showAuthority(j);}catch(e){$('dnsAuthority').textContent=e.message;}}
$('dnsProvider').onchange=updateProviderFields;$('domain').onchange=refreshAuthority;
