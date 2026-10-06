import path from 'node:path';
export function reuseDeployment(cfg,file,input){
 if(!cfg||cfg.sourceUpload!==path.basename(file))return null;
 if(cfg.port!==Number(input.port)||cfg.memory!==Number(input.memory))throw Error('同一整合包已有实例，端口或内存设置与现有实例不同；请在 MCSManager 中调整现有实例，或为新实例选择其他端口。');
 if(cfg.status!=='startup-test-passed'||!cfg.panelInstance)return null;
 return cfg;
}
