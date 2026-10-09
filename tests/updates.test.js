import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createUpdates,updateSource,releasePage} from '../desktop/updates.js';
const source={provider:'github',owner:'example',repo:'BBReader'};
function fixture(options={}){
  const updater=new EventEmitter(),events=[];let checks=0,downloads=0,installs=0;
  updater.checkForUpdates=async()=>{checks++;updater.emit('update-available',{version:'0.4.0',releaseNotes:'<script>unsafe</script>说明'});return {};};
  updater.downloadUpdate=async()=>{downloads++;updater.emit('download-progress',{percent:150,transferred:10,total:10});updater.emit('update-downloaded',{version:'0.4.0'});};
  updater.quitAndInstall=(silent,restart)=>{assert.equal(silent,false);assert.equal(restart,true);installs++;};
  const service=createUpdates({version:'0.3.2',source,packaged:true,automatic:true,updaterFactory:()=>updater,onChange:s=>events.push(s),schedule:fn=>fn(),...options});
  return {service,updater,events,counts:()=>({checks,downloads,installs})};
}
test('update sources allow explicit GitHub and HTTPS publishers without credentials',()=>{
  assert.equal(updateSource({provider:null}),null);assert.deepEqual(updateSource(source),source);
  assert.equal(releasePage(source),'https://github.com/example/BBReader/releases/latest');
  assert.equal(updateSource({provider:'generic',url:'https://updates.example/app'}).url,'https://updates.example/app/');
  for(const value of [{provider:'github',owner:'../other',repo:'x'},{provider:'generic',url:'http://updates.example/'},{provider:'generic',url:'https://user:password@updates.example/'},{provider:'generic',url:'https://updates.example/?token=x'},{provider:'generic',url:'https://updates.example/',releasePage:'javascript:alert(1)'}])assert.throws(()=>updateSource(value));
});
test('updates require explicit download and install and never install on ordinary exit',async()=>{
  const {service,updater,events,counts}=fixture();
  await service.check();assert.equal(service.status().phase,'available');assert.deepEqual(counts(),{checks:1,downloads:0,installs:0});
  assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false);assert.equal(updater.allowDowngrade,false);
  await service.download();assert.equal(service.status().phase,'downloaded');assert.ok(events.some(s=>s.phase==='downloading'&&s.percent===100));
  service.install();assert.deepEqual(counts(),{checks:1,downloads:1,installs:1});
});
test('unconfigured, development and manual packages cannot silently install',async()=>{
  await assert.rejects(fixture({source:null}).service.check(),/尚未配置/);
  await assert.rejects(fixture({packaged:false}).service.check(),/开发模式/);
  let opened;
  const {service}=fixture({automatic:false,openExternal:url=>{opened=url;}});
  await service.check();await assert.rejects(service.download(),/下载页/);assert.throws(()=>service.install(),/完成更新下载/);
  await service.openRelease();assert.equal(opened,'https://github.com/example/BBReader/releases/latest');
});
test('failed downloads can retry, and installing while coursework is active is rejected',async()=>{
  let busy=true;const {service,updater,counts}=fixture({busy:()=>busy});
  await service.check();updater.downloadUpdate=async()=>{updater.emit('error',Error('network'));throw Error('network');};
  await service.download();assert.equal(service.status().phase,'error');assert.equal(service.status().newVersion,'0.4.0');
  updater.downloadUpdate=async()=>updater.emit('update-downloaded',{version:'0.4.0'});await service.download();
  assert.throws(()=>service.install(),/等待课程/);assert.equal(counts().installs,0);busy=false;service.install();assert.equal(counts().installs,1);
});
test('simultaneous checks coalesce and closing a dialog cannot start another download',async()=>{
  const {service,updater,counts}=fixture();let finish;
  updater.checkForUpdates=()=>new Promise(resolve=>{finish=()=>{updater.emit('update-not-available');resolve({});};});
  const checking=service.check();await Promise.resolve();await service.check();assert.equal(service.status().phase,'checking');finish();await checking;
  assert.equal(service.status().phase,'current');await assert.rejects(service.download(),/先检查/);assert.equal(counts().downloads,0);
});
