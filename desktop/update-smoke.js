// Enabled only by explicit smoke-test flags. Never downloads or installs a program.
import {EventEmitter} from 'node:events';
export function smokeUpdater(){
  const updater=new EventEmitter();
  updater.checkForUpdates=async()=>{updater.emit('checking-for-update');updater.emit('update-available',{version:'99.0.0',releaseNotes:'测试更新说明：保留课程和已下载文件。'});return {};};
  updater.downloadUpdate=async()=>{
    if(globalThis.bbSmokeUpdateFailure){updater.emit('error',Error('fixture network failure'));throw Error('fixture failure');}
    updater.emit('download-progress',{percent:50,transferred:512,total:1024});await new Promise(resolve=>setTimeout(resolve,150));updater.emit('update-downloaded',{version:'99.0.0'});return [];
  };
  updater.quitAndInstall=(silent,restart)=>{globalThis.bbSmokeInstalled={silent,restart};};
  return updater;
}
