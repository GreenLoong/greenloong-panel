import path from 'node:path';
function appendedConsole(before,after){if(typeof before!=='string'||typeof after!=='string')return '';const tail=before.slice(-1500);if(!tail)return after;const at=after.lastIndexOf(tail);return at<0?'':after.slice(at+tail.length);}
export async function stopManagedInstance({cfg,root,api,portFree,log=()=>{},timeout=600000,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(!cfg?.panelInstance||!cfg?.panelDaemon||!cfg.directory)throw Error('当前服务器还未接入 MCSManager，无法执行一键关闭。');
 const query=`daemonId=${encodeURIComponent(cfg.panelDaemon)}&uuid=${encodeURIComponent(cfg.panelInstance)}`,route='/api/instance?'+query;let detail=await api(route);
 if(!detail.config?.cwd||path.resolve(detail.config.cwd).toLowerCase()!==path.resolve(root,cfg.directory).toLowerCase())throw Error('管理实例目录与当前服务器不一致，已停止操作，请检查实例选择。');
 if(detail.status===0){if(!await portFree(cfg.port))throw Error('管理实例已停止，但游戏 TCP 端口仍被占用，请在 MCSManager 检查旧进程。');log('服务器已经关闭，游戏端口已释放。');return {stopped:true,alreadyStopped:true,portReleased:true,port:cfg.port};}
 const outputRoute='/api/protected_instance/outputlog?'+query+'&size=64kb',before=await api(outputRoute).catch(()=>null);
 if(detail.status!==1){
  // Prevent MCSManager from forcibly killing a server that is slow to save.
  await api(route,'PUT',{stopCommand:'stop',stopTimeout:0});
  log('已发送正常停服请求，正在等待玩家数据和世界保存…');await api('/api/protected_instance/stop?'+query);
 }else if(Number(detail.config.stopTimeout)>0)throw Error('实例已在停止中，原来的超时强制结束计时可能已启动；请在 MCSManager 核对状态。');
 const started=now();let nextLog=started+30000;
 while(now()-started<timeout){
  detail=await api(route);
  if(detail.status===0){
   if(!await portFree(cfg.port))throw Error('管理实例已停止，但游戏 TCP 端口尚未释放，请检查是否有遗留进程。');
   let saveVerified=false;
   for(let i=0;i<4;i++){const after=await api(outputRoute).catch(()=>null),fresh=appendedConsole(before,after);saveVerified=/All dimensions are saved|所有维度.*保存/i.test(fresh);if(saveVerified)break;await sleep(250);}
   log(saveVerified?'已核对世界保存完成，服务器已关闭，游戏端口已释放。':'服务器进程已停止，游戏端口已释放；本次未识别到世界保存完成标记，可在 MCSManager 查看停止日志。');
   return {stopped:true,alreadyStopped:false,portReleased:true,saveVerified,port:cfg.port};
  }
  if(now()>=nextLog){log('仍在等待正常停服和存档保存，请稍候…');nextLog=now()+30000;}
  await sleep(1000);
 }
 throw Error('等待正常停服超过 10 分钟，尚不能确认已关闭。请在 MCSManager 查看保存进度和报错。');
}
