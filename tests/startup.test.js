import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createStartup,nativeStartup,linuxStartup,startupExecutable,desktopExec,STARTUP_NAME} from '../desktop/startup.js';
function fixture({supported=true,preferences=null,registered=false}={}){
  let config=preferences,current={configured:registered,enabled:registered,pending:false},writes=[];
  const adapter={read:async()=>({...current}),write:async enabled=>{writes.push(enabled);current={configured:enabled,enabled,pending:false};}};
  const service=()=>createStartup({supported,adapter,load:()=>config,save:async value=>{config=value;}});
  return {adapter,service,writes,config:()=>config,set:value=>{current=value;}};
}
test('first ordinary launch enables startup once, and updates preserve explicit disabled preferences',async()=>{
  const f=fixture();assert.equal((await f.service().initialize()).enabled,true);assert.deepEqual(f.writes,[true]);
  assert.equal((await f.service().set(false)).enabled,false);assert.equal(f.config().enabled,false);
  assert.equal((await f.service().initialize()).enabled,false);assert.deepEqual(f.writes,[true,false]);
  await f.service().set(true);await f.service().initialize();assert.deepEqual(f.writes,[true,false,true]);
});
test('system-disabled registration is never overwritten on launch, even before migration',async()=>{
  const f=fixture();f.set({configured:true,enabled:false,pending:false});await f.service().initialize();assert.deepEqual(f.writes,[]);
  const existing=fixture({registered:true,preferences:{initialized:true,enabled:true}});existing.set({configured:true,enabled:false,pending:false});
  const state=await existing.service().initialize();assert.equal(state.enabled,false);assert.equal(state.systemDisabled,true);assert.deepEqual(existing.writes,[]);
});
test('development and isolated tests do not read or write operating-system startup settings',async()=>{
  const f=fixture({supported:false});f.adapter.read=async()=>{throw Error('must not call');};assert.equal((await f.service().initialize()).supported,false);await assert.rejects(f.service().set(true));assert.deepEqual(f.writes,[]);
});
test('failed OS changes preserve prior preferences and do not keep retrying on every launch',async()=>{
  const f=fixture();f.adapter.write=async()=>{throw Error('permission denied');};
  assert.match((await f.service().initialize()).error,/permission denied/);assert.equal(f.config().initialized,true);
  await assert.rejects(f.service().set(true),/permission denied/);assert.equal(f.config().enabled,false);
  await assert.rejects(f.service().set('true'),/无效/);
});
test('macOS pending approval is reported honestly and not registered again at each start',async()=>{
  const f=fixture();f.adapter.write=async()=>f.set({configured:true,enabled:false,pending:true});
  const service=f.service();assert.equal((await service.initialize()).pending,true);assert.equal(f.config().enabled,true);await service.initialize();
  const adapter=nativeStartup({getLoginItemSettings:()=>({openAtLogin:true,status:'requires-approval'}),setLoginItemSettings:()=>{}},{platform:'darwin',executable:'/Applications/BBReader.app'});
  assert.deepEqual(await adapter.read(),{configured:true,enabled:false,pending:true});
});
test('Windows registers a stable launcher with fixed arguments and observes Task Manager approval',async()=>{
  let query,written,approved=false;const app={getLoginItemSettings:value=>{query=value;return {openAtLogin:false,executableWillLaunchAtLogin:approved,launchItems:[{name:STARTUP_NAME,path:'C:\\Apps\\BB Reader.exe',args:[],enabled:approved}]};},setLoginItemSettings:value=>{written=value;approved=value.enabled;}};
  const adapter=nativeStartup(app,{platform:'win32',executable:'C:\\Apps\\BB Reader.exe'});assert.equal((await adapter.read()).enabled,false);
  assert.deepEqual(query,{path:'C:\\Apps\\BB Reader.exe',args:['--bbreader-autostart']});await adapter.write(true);
  assert.deepEqual(written,{openAtLogin:true,path:query.path,args:query.args,name:STARTUP_NAME,enabled:true});
  assert.equal((await adapter.read()).enabled,true,'named approved startup item must work even when the default-name query says false');
  assert.equal(startupExecutable('win32','C:\\Temp\\unpacked.exe',{PORTABLE_EXECUTABLE_FILE:'C:\\Apps\\portable.exe'}),'C:\\Apps\\portable.exe');
  assert.equal(startupExecutable('linux','/tmp/mount/app',{APPIMAGE:'/home/user/BB Reader.AppImage'}),'/home/user/BB Reader.AppImage');
  assert.throws(()=>startupExecutable('linux','relative'));assert.throws(()=>desktopExec('/path/invalid\nname'));
});
test('Linux startup safely quotes executable paths and preserves external disable and unrelated files',async()=>{
  await fs.mkdir('verification',{recursive:true});const directory=await fs.mkdtemp(path.join(process.cwd(),'verification','startup-linux-'));
  const executable='/opt/BB Reader/$work%name\\version".AppImage',adapter=linuxStartup({configHome:directory,executable});
  assert.equal((await adapter.read()).enabled,false);await adapter.write(true);assert.equal((await adapter.read()).enabled,true);
  const file=path.join(directory,'autostart',STARTUP_NAME+'.desktop'),content=await fs.readFile(file,'utf8');
  assert.ok(content.includes('Exec='+desktopExec(executable)));assert.ok(desktopExec(executable).includes('%%'));assert.ok(desktopExec(executable).includes('\\\\$'));
  await fs.writeFile(file,content.replace('Hidden=false','Hidden=true'));assert.equal((await adapter.read()).enabled,false);
  await adapter.write(false);assert.match(await fs.readFile(file,'utf8'),/Hidden=true/);
  await fs.writeFile(file,'[Desktop Entry]\nName=Other\n');await assert.rejects(adapter.write(true),/其他来源/);assert.match(await fs.readFile(file,'utf8'),/Name=Other/);
});
