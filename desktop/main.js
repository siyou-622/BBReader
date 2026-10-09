import {app,BrowserWindow,session,protocol,ipcMain,dialog,shell,net,Menu,clipboard,powerMonitor} from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {APP_ORIGIN,appPage,schoolURL,downloadPath,extensionOrigin,attachmentURL,requestURL,SCHOOL_ORIGINS} from './security.js';
import {readURL} from '../extension/core.js';
import {cleanName} from '../extension/core.js';
import {nativeMessage} from './native.js';
import childProcess from 'node:child_process';
import {previewableFile,applicationCommand} from './preview.js';
import updaterPackage from 'electron-updater';
import {createUpdates} from './updates.js';
import {smokeUpdater} from './update-smoke.js';
import {schoolTab,schoolFailure} from './school.js';
import {writeState} from './store.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fsSync.readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
const profileArgument=process.argv.find(value=>value.startsWith('--bbreader-profile='));
if(profileArgument){const directory=path.resolve(profileArgument.slice('--bbreader-profile='.length));fsSync.mkdirSync(directory,{recursive:true});app.setPath('userData',directory);}
const origin=extensionOrigin(manifest.key);
const smoke=process.argv.includes('--bbreader-smoke');
// Chromium's bundled PDF viewer is an extension and must be allowed on this scheme.
protocol.registerSchemesAsPrivileged([{scheme:'bbreader',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,allowExtensions:true}}]);
if(!app.requestSingleInstanceLock())app.quit();
else launch().catch(error=>{console.error(error);if(!smoke)dialog.showErrorBox('BBReader 启动失败',error.message);app.quit();});

async function launch(){
  await app.whenReady();
  const profile=session.fromPartition('persist:bbreader');
  const downloadsArgument=process.argv.find(value=>value.startsWith('--bbreader-downloads='));
  if(downloadsArgument){const directory=path.resolve(downloadsArgument.slice('--bbreader-downloads='.length));await fs.mkdir(directory,{recursive:true});app.setPath('downloads',directory);}
  const storePath=path.join(app.getPath('userData'),'desktop-state.json');
  let data;
  try{data=JSON.parse(await fs.readFile(storePath,'utf8'));}
  catch(e){if(e.code!=='ENOENT')throw Error('本地索引无法读取，请先备份 desktop-state.json 后修复');data={storage:{},downloads:[],alarms:{},permissions:[]};}
  if(data.downloadRoot&&!downloadsArgument){await fs.mkdir(data.downloadRoot,{recursive:true});app.setPath('downloads',data.downloadRoot);}
  let writes=Promise.resolve();
  const save=()=>{const json=JSON.stringify(data);writes=writes.catch(()=>{}).then(()=>writeState(storePath,json));return writes;};
  const windows=new Map(),schoolLoads=new Map(),requests=new Map(),timers=new Map();
  let worker,main,sequence=0,shuttingDown=false,workerReady=false;
  const send=(window,event)=>{if(window&&!window.isDestroyed())window.webContents.send('bbreader-event',event);};
  const emit=event=>{send(worker,event);send(main,event);};
  const updateFixture=smoke&&process.argv.includes('--bbreader-smoke-updates');
  const source=JSON.parse(await fs.readFile(path.join(root,'desktop/update-source.json'),'utf8'));
  const updates=createUpdates({version:app.getVersion(),source:updateFixture?{provider:'github',owner:'fixture',repo:'BBReader'}:source,packaged:app.isPackaged||updateFixture,
    automatic:updateFixture||app.isPackaged&&(process.platform==='win32'?!process.env.PORTABLE_EXECUTABLE_FILE:process.platform==='darwin'||!!process.env.APPIMAGE),
    updaterFactory:updateFixture?smokeUpdater:()=>updaterPackage.autoUpdater,onChange:state=>emit({type:'update',state}),openExternal:url=>shell.openExternal(url),
    busy:()=>!!(data.storage.state?.job||data.storage.state?.transfer||data.storage.state?.downloadBatch?.status==='running'||Object.keys(data.storage.pending||{}).length||data.downloads.some(item=>item.state==='in_progress'))});
  const appOptions={contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(root,'desktop/preload.cjs'),session:profile,additionalArguments:[`--bbreader-version=${manifest.version}`]};
  profile.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  profile.setPermissionCheckHandler(()=>false);
  // The school can redirect only within Blackboard/CAS; local pages have a narrow IPC bridge.
  function secureWindow(window,local){
    const allowed=url=>local?appPage(url):(()=>{try{schoolURL(url);return true;}catch{return false;}})();
    window.webContents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});
    window.webContents.on('will-redirect',(event,url)=>{if(!allowed(url))event.preventDefault();});
    window.webContents.setWindowOpenHandler(({url})=>{
      let remoteOrigin;try{remoteOrigin=new URL(url).origin;}catch{return {action:'deny'};}
      if(SCHOOL_ORIGINS.has(remoteOrigin))createSchool({url,active:true});
      else if(local&&/^https:\/\//.test(url))shell.openExternal(url).catch(()=>{});
      return {action:'deny'};
    });
    window.webContents.on('will-attach-webview',event=>event.preventDefault());
  }
  profile.protocol.handle('bbreader',async request=>{
    const url=new URL(request.url);if(url.host!=='app')return new Response('Forbidden',{status:403});
    if(url.pathname.startsWith('/preview/')){
      // Preview URLs contain an index key, never a renderer-selected filesystem path.
      const key=decodeURIComponent(url.pathname.slice('/preview/'.length)),state=data.storage.state||{};
      const file=Object.hasOwn(state.files||{},key)?state.files[key]:null;
      const filename=file&&(state.integrationMode==='macos'?file.savedPath:file.browserDownload?.path);
      if(!file)return new Response('未找到课件',{status:404});
      const local=filename&&path.isAbsolute(filename)&&await fs.stat(filename).then(s=>s.isFile()).catch(()=>false);
      try{
        const response=local?await net.fetch(pathToFileURL(filename).href):await profile.fetch(attachmentURL(file.url),{credentials:'include',signal:AbortSignal.timeout(60000)});
        const type=local?{'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.txt':'text/plain; charset=utf-8'}[path.extname(filename).toLowerCase()]:response.headers.get('content-type');
        if(!response.ok)return new Response(`学校原文件暂时无法读取（${response.status}），请检查网络和学校登录状态`,{status:response.status,headers:{'content-type':'text/plain; charset=utf-8'}});
        if(!/^(?:application\/pdf|image\/(?:png|jpeg|gif|webp)|text\/plain)(?:;|$)/i.test(type||'')){
          await response.body?.cancel();return new Response(/text\/html/i.test(type||'')?'学校返回了登录页，请先连接学校再预览。':'此类型暂不支持应用内预览，请下载后使用系统应用打开。',{headers:{'content-type':'text/plain; charset=utf-8'}});
        }
        if(!local)readURL(response.url||file.url);
        response.headers.set('content-type',type);response.headers.set('content-disposition','inline');
        // Chromium generates the PDF viewer's HTML and security policy itself.
        // A document-level "default-src none" also blocks that internal viewer.
        if(/^application\/pdf(?:;|$)/i.test(type))response.headers.delete('content-security-policy');
        else response.headers.set('content-security-policy',"default-src 'none'; style-src 'unsafe-inline'");return response;
      }catch{return new Response('预览失败，请检查网络或重新下载课件',{status:502,headers:{'content-type':'text/plain; charset=utf-8'}});}
    }
    const relative=decodeURIComponent(url.pathname).replace(/^\//,'');
    const directory=relative.startsWith('desktop/')?root:path.join(root,'extension');
    const filename=path.resolve(directory,relative);
    if(!filename.startsWith(directory+path.sep)||!/^([\w/-]+\.(?:html|js|css|png))$/.test(relative))return new Response('Forbidden',{status:403});
    try{
      if(relative==='index.html'){
        let html=await fs.readFile(filename,'utf8');
        html=html.replace('<script src="theme.js">','<script src="desktop/shim.js"></script><script src="theme.js">');
        // Keep original DOM IDs and flows while accurately describing the desktop profile.
        html=html.replaceAll('当前浏览器','本机应用').replaceAll('本机浏览器','本机应用').replaceAll('浏览器下载目录','系统下载目录').replaceAll('关闭浏览器','退出应用');
        return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'"}});
      }
      const response=await net.fetch(pathToFileURL(filename).href);
      if(relative.endsWith('.html'))response.headers.set('content-security-policy',"default-src 'self'; script-src 'self'; object-src 'none'");
      return response;
    }catch{return new Response('Not found',{status:404});}
  });
  async function createSchool({url,active=true}){
    url=schoolURL(url);
    const window=new BrowserWindow({width:1100,height:800,show:active&&!smoke,title:'Blackboard · BBReader',webPreferences:{session:profile,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    const id=window.webContents.id;windows.set(id,window);secureWindow(window,false);
    const load={url,pending:true,error:null};schoolLoads.set(id,load);
    let loadDeadline;
    window.on('closed',()=>{clearTimeout(loadDeadline);windows.delete(id);schoolLoads.delete(id);});
    window.webContents.on('did-start-navigation',(_event,target,_inPlace,isMain)=>{if(isMain&&/^https:\/\//.test(target)){load.url=target;load.pending=true;load.error=null;}});
    window.webContents.on('did-finish-load',()=>{load.pending=false;clearTimeout(loadDeadline);});
    const failed=async code=>{
      const message=schoolFailure(code);if(!message||window.isDestroyed()||load.error)return;
      load.error=message;load.pending=false;emit({type:'school-error',message});
      clearTimeout(loadDeadline);
      if(active)await window.loadURL(`${APP_ORIGIN}/desktop/school-error.html?message=${encodeURIComponent(message)}&retry=${encodeURIComponent(url)}`).catch(()=>{});
    };
    window.webContents.on('did-fail-load',(_event,code,_description,_validatedURL,isMain)=>{if(isMain)failed(code).catch(()=>{});});
    const deadline=()=>{clearTimeout(loadDeadline);loadDeadline=setTimeout(()=>{if(load.pending||!window.webContents.getURL())failed(-118).catch(()=>{});},30000);};
    window.webContents.on('did-start-navigation',(_event,_target,_inPlace,isMain)=>{if(isMain)deadline();});deadline();
    window.loadURL(url).then(()=>{load.pending=false;}).catch(error=>failed(error.errno||-2));return {id};
  }
  function arm(name){
    clearTimeout(timers.get(name));const alarm=data.alarms[name];if(!alarm||!workerReady)return;
    timers.set(name,setTimeout(()=>{delete data.alarms[name];save().catch(()=>{});send(worker,{type:'alarm',name});},Math.max(0,alarm.scheduledTime-Date.now())));
  }
  for(const item of data.downloads)if(item.state==='in_progress'){item.state='interrupted';item.error='应用已退出，下载中断，请重试';}
  await save();
  // Reserve a free filename and refuse symlink directories before writing a download.
  async function reserve(target){
    const base=app.getPath('downloads'),relative=path.relative(base,path.dirname(target));
    if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('下载目录越界');
    let current=base;
    if((await fs.lstat(base)).isSymbolicLink())throw Error('下载根目录不能是符号链接');
    for(const part of relative.split(path.sep).filter(Boolean)){
      current=path.join(current,part);await fs.mkdir(current,{recursive:true});if((await fs.lstat(current)).isSymbolicLink())throw Error('下载目录不能是符号链接');
    }
    const extension=path.extname(target),stem=target.slice(0,target.length-extension.length);
    for(let i=0;i<10000;i++){
      const filename=i?`${stem} (${i})${extension}`:target;
      try{const handle=await fs.open(filename,'wx');await handle.close();return filename;}catch(e){if(e.code!=='EEXIST')throw e;}
    }throw Error('同名文件过多');
  }
  profile.on('will-download',(event,item,contents)=>{
    const isExport=contents?.id===main?.webContents.id&&item.getURL().startsWith(`blob:${APP_ORIGIN}/`);
    const isManual=windows.has(contents?.id)&&item.getURLChain().every(url=>{try{attachmentURL(url);return true;}catch{return false;}});
    if(!isExport&&!isManual){event.preventDefault();return;}
    (async()=>{
      // setSavePath must run synchronously inside will-download to suppress Chromium's save dialog.
      let filename;
      if(!filename){const base=path.join(app.getPath('downloads'),cleanName(item.getFilename())),ext=path.extname(base);for(let i=0;i<10000;i++){const candidate=i?`${base.slice(0,base.length-ext.length)} (${i})${ext}`:base;try{fsSync.closeSync(fsSync.openSync(candidate,'wx'));filename=candidate;break;}catch(e){if(e.code!=='EEXIST')throw e;}}if(!filename)throw Error('同名文件过多');}
      item.setSavePath(filename);
      const id=data.downloads.reduce((n,d)=>Math.max(n,d.id+1),0);
      const record={id,url:item.getURL(),finalUrl:item.getURL(),filename,state:'in_progress',danger:'safe',mime:item.getMimeType(),bytesReceived:0,totalBytes:item.getTotalBytes(),fileSize:-1,byExtensionId:'bbreader-desktop',startTime:new Date().toISOString()};
      data.downloads.push(record);
      item.on('updated',()=>{record.bytesReceived=item.getReceivedBytes();record.totalBytes=item.getTotalBytes();});
      item.once('done',async(_event,state)=>{
        Object.assign(record,{state:state==='completed'?'complete':'interrupted',fileSize:item.getReceivedBytes(),bytesReceived:item.getReceivedBytes(),finalUrl:item.getURL(),error:state==='completed'?undefined:`网络中断或下载取消（${state}），可重试`});
        if(state!=='completed')await fs.unlink(filename).catch(()=>{});
        await save();emit({type:'download',delta:{id,state:{current:record.state}}});
      });
      await save();
    })().catch(e=>{item.cancel();console.error('导出失败：',e.message);});
  });
  ipcMain.handle('bbreader',async(event,op,payload)=>{
    const sender=event.sender,frame=event.senderFrame;
    if(!frame||frame!==sender.mainFrame||!appPage(frame.url)||![worker?.webContents.id,main?.webContents.id].includes(sender.id))throw Error('不允许的调用来源');
    const isWorker=sender.id===worker.webContents.id;
    const shared=['message','platform','storage.get','permission.contains','permission.request','clipboard.write','file.status','file.reveal','file.preview','preview.settings','updates.status','updates.check','updates.download','updates.install','updates.release'];
    if(!isWorker&&!shared.includes(op))throw Error('仅后台可执行此操作');
    if(op==='platform')return {os:process.platform==='darwin'?'mac':process.platform==='win32'?'win':'linux',downloads:app.getPath('downloads')};
    if(op.startsWith('updates.')){
      if(payload!==undefined&&payload!==null)throw Error('更新操作不接受自定义地址或路径');
      const action=({'updates.status':updates.status,'updates.check':updates.check,'updates.download':updates.download,'updates.install':updates.install,'updates.release':updates.openRelease})[op];
      if(!action)throw Error('未知更新操作');return action();
    }
    if(op==='preview.settings'){
      const settings=()=>({mode:data.preview?.mode||'internal',applicationName:data.preview?.application?path.basename(data.preview.application):null});
      if(payload===undefined||payload===null)return settings();
      if(typeof payload!=='object'||Object.keys(payload).some(key=>!['mode','choose'].includes(key)))throw Error('预览设置无效');
      if(payload.mode!==undefined&&!['internal','system','custom'].includes(payload.mode))throw Error('预览方式无效');
      if(payload.choose!==undefined&&payload.choose!==true)throw Error('请选择软件');
      if(payload.choose||payload.mode==='custom'&&!data.preview?.application){
        const result=await dialog.showOpenDialog(main,{title:'选择课件阅读软件',properties:['openFile'],...(process.platform==='win32'?{filters:[{name:'应用程序',extensions:['exe']}]}:process.platform==='darwin'?{filters:[{name:'应用程序',extensions:['app']}]}:{})});
        if(result.canceled)return {...settings(),cancelled:true};
        const application=path.resolve(result.filePaths[0]);
        const details=await fs.stat(application);
        if(process.platform==='darwin'?!details.isDirectory()||!/\.app$/i.test(application):!details.isFile()||process.platform==='win32'&&!/\.exe$/i.test(application))throw Error('请选择可用的阅读软件');
        await fs.access(application,process.platform==='win32'?fsSync.constants.F_OK:fsSync.constants.X_OK);
        data.preview={mode:'custom',application};
      }else if(payload.mode)data.preview={...data.preview,mode:payload.mode};
      await save();return settings();
    }
    if(op==='file.status'||op==='file.reveal'||op==='file.preview'){
      const state=data.storage.state||{},files=state.files||{};
      const savedPath=file=>state.integrationMode==='macos'?file.savedPath:file.browserDownload?.path;
      if(op==='file.status')return Object.fromEntries(await Promise.all(Object.values(files).filter(savedPath).map(async file=>[file.key,await fs.stat(savedPath(file)).then(s=>s.isFile()).catch(()=>false)])));
      const file=typeof payload?.key==='string'&&Object.hasOwn(files,payload.key)?files[payload.key]:null;
      const filename=file&&savedPath(file);
      if(op==='file.preview'){
        if(!file)throw Error('未找到课件');
        const exists=filename&&path.isAbsolute(filename)&&await fs.stat(filename).then(s=>s.isFile()).catch(()=>false);
        if(data.preview?.mode==='system'||data.preview?.mode==='custom'){
          if(!exists)throw Error('请先下载课件，再使用外部软件预览');
          if(!previewableFile(filename))throw Error('此类型暂不支持预览，请打开所在文件夹查看');
          if(data.preview.mode==='system'){
            const error=await shell.openPath(filename);if(error)throw Error('系统没有可打开此课件的软件，请选择指定软件');
          }else{
            const application=data.preview.application;
            if(!application)throw Error('请先在设置中选择阅读软件');
            await fs.access(application,process.platform==='win32'?fsSync.constants.F_OK:fsSync.constants.X_OK).catch(()=>{throw Error('指定软件已移动或删除，请重新选择软件');});
            const {command,args}=applicationCommand(application,filename,process.platform);
            await new Promise((resolve,reject)=>{const child=childProcess.spawn(command,args,{shell:false,detached:true,stdio:'ignore'});child.once('error',()=>reject(Error('无法启动指定软件，请重新选择')));child.once('spawn',()=>{child.unref();resolve();});});
          }
          return {local:true,external:true};
        }
        if(exists&&!/\.(?:pdf|png|jpe?g|gif|webp|txt)$/i.test(filename)){
          if(!/\.(?:docx?|pptx?|xlsx?|odt|odp|ods|rtf|csv|epub)$/i.test(filename))throw Error('此类型暂不支持预览，请打开所在文件夹查看');
          const error=await shell.openPath(filename);if(error)throw Error('系统没有可预览此文件的应用，请打开所在文件夹选择应用');return {local:true,external:true};
        }
        const window=new BrowserWindow({width:1100,height:850,show:!smoke,title:`${file.name} · BBReader 预览`,icon:path.join(root,'desktop/icons/icon.png'),webPreferences:{session:profile,contextIsolation:true,nodeIntegration:false,sandbox:true,plugins:true}});
        secureWindow(window,true);await window.loadURL(`${APP_ORIGIN}/preview/${encodeURIComponent(file.key)}`);return {local:!!exists};
      }
      if(!filename||!path.isAbsolute(filename))throw Error('课件尚未下载');
      if(!await fs.stat(filename).then(s=>s.isFile()).catch(()=>false))throw Error('文件已移动或删除，请重新下载');
      shell.showItemInFolder(filename);return {ok:true};
    }
    if(op==='clipboard.write'){if(typeof payload!=='string'||payload.length>10000)throw Error('剪贴板内容无效');clipboard.writeText(payload);return;}
    if(op==='storage.get')return {[payload]:structuredClone(data.storage[payload])};
    if(op==='storage.set'||op==='storage.remove'){
      const changes={};const update=op==='storage.set'?payload:{[payload]:undefined};
      for(const [key,value] of Object.entries(update)){changes[key]={oldValue:data.storage[key],newValue:value};if(value===undefined)delete data.storage[key];else data.storage[key]=value;}
      await save();emit({type:'storage',changes});return;
    }
    if(op==='message'){
      if(isWorker)throw Error('后台消息须本地分派');
      return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{requests.delete(id);reject(Error('后台响应超时'));},180000);requests.set(id,{resolve,timer});send(worker,{type:'message',id,message:payload});});
    }
    if(op==='permission.contains'||op==='permission.request'){
      const permissions=[...(payload.origins||[]),...(payload.permissions||[])];
      if(permissions.some(p=>!['https://cas.sustech.edu.cn/*','nativeMessaging'].includes(p)))throw Error('未知权限');
      if(permissions.every(p=>data.permissions.includes(p)))return true;
      if(op==='permission.contains')return false;
      const result=await dialog.showMessageBox(main,{type:'question',buttons:['允许','取消'],defaultId:1,cancelId:1,title:'BBReader 权限',message:permissions.includes('nativeMessaging')?'允许调用已安装的 BBReader macOS 本地助手？':'允许访问学校 CAS 认证页面并在保存账号后自动登录？'});
      if(result.response!==0)return false;data.permissions=[...new Set([...data.permissions,...permissions])];await save();return true;
    }
    if(op==='native'){if(!data.permissions.includes('nativeMessaging'))throw Error('尚未允许本地助手通信');return nativeMessage(payload,app.getPath('home'),origin);}
    if(op==='tabs.create')return createSchool(payload);
    if(op==='tabs.get'){const window=windows.get(payload);if(!window)throw Error('学校窗口已关闭');return schoolTab(window,schoolLoads.get(payload));}
    if(op==='tabs.remove'){windows.get(payload)?.destroy();return;}
    if(op==='script'){
      const window=windows.get(payload.id);if(!window)throw Error('学校窗口已关闭');
      const tab=schoolTab(window,schoolLoads.get(payload.id));if(tab.status!=='complete')throw Error('学校页面正在加载，请稍后重试');
      const url=schoolURL(window.webContents.getURL());if(new URL(url).origin==='https://cas.sustech.edu.cn'&&!data.permissions.includes('https://cas.sustech.edu.cn/*'))throw Error('未授权 CAS');
      return [{result:await window.webContents.executeJavaScript(`(${payload.source})(...${JSON.stringify(payload.args)})`)}];
    }
    if(op==='fetch'){
      const url=requestURL(payload.url);if(!['GET','HEAD'].includes(payload.method))throw Error('仅允许读取学校数据');
      const response=await profile.fetch(url,{method:payload.method,credentials:'include',cache:'no-cache',signal:AbortSignal.timeout(20000)});
      return {url:response.url||url,status:response.status,headers:Object.fromEntries(response.headers),body:payload.method==='HEAD'?null:await response.text()};
    }
    if(op==='alarm.get')return data.alarms[payload];
    if(op==='alarm.create'){const {name,options}=payload;data.alarms[name]={name,scheduledTime:options.when};await save();arm(name);return;}
    if(op==='download.search'){
      const query=payload||{},found=data.downloads.filter(d=>(query.id===undefined||d.id===query.id)&&(!query.url||d.url===query.url)&&(!query.startedAfter||d.startTime>=query.startedAfter)&&(!query.filenameRegex||new RegExp(query.filenameRegex).test(d.filename.replaceAll('\\','/'))));
      return Promise.all(found.map(async d=>({...d,exists:await fs.stat(d.filename).then(s=>s.isFile()).catch(()=>false)})));
    }
    if(op==='download'){
      const url=attachmentURL(payload.url),target=downloadPath(app.getPath('downloads'),payload.filename);
      const filename=await reserve(target);
      const id=data.downloads.reduce((n,d)=>Math.max(n,d.id+1),0);
      const record={id,url,finalUrl:url,filename,state:'in_progress',danger:'safe',mime:'',bytesReceived:0,totalBytes:-1,fileSize:-1,byExtensionId:'bbreader-desktop',startTime:new Date().toISOString()};
      data.downloads.push(record);await save();
      // Stream through the SAME authenticated session as HTML/HEAD requests. This also avoids
      // relying on unsupported Chrome downloads extension APIs in Electron.
      (async()=>{
        const controller=new AbortController();let timer=setTimeout(()=>controller.abort(),20000),handle;
        try{
          const response=await profile.fetch(url,{credentials:'include',cache:'no-cache',signal:controller.signal});
          clearTimeout(timer);record.finalUrl=readURL(response.url||url);
          if(!response.ok)throw Error(`Blackboard 返回 ${response.status}`);
          record.mime=response.headers.get('content-type')||'';
          if(/text\/html/.test(record.mime))throw Error('附件是 HTML 登录页，未保存');
          record.totalBytes=Number(response.headers.get('content-length'))||-1;
          handle=await fs.open(filename,'r+');const reader=response.body.getReader();
          while(true){timer=setTimeout(()=>controller.abort(),60000);const {done,value}=await reader.read();clearTimeout(timer);if(done)break;let written=0;while(written<value.length){const result=await handle.write(value,written,value.length-written,record.bytesReceived+written);if(!result.bytesWritten)throw Error('无法写入下载文件');written+=result.bytesWritten;}record.bytesReceived+=written;}
          if(!record.bytesReceived)throw Error('下载文件为空');
          await handle.sync();await handle.close();handle=null;record.fileSize=record.bytesReceived;record.state='complete';
        }catch(e){record.state='interrupted';record.error=`${e.message}；可重试下载`;await handle?.close().catch(()=>{});await fs.unlink(filename).catch(()=>{});}
        finally{clearTimeout(timer);controller.abort();await save();emit({type:'download',delta:{id,state:{current:record.state}}});}
      })().catch(e=>console.error('下载状态保存失败：',e.message));
      return id;
    }
    throw Error('未知桌面操作');
  });
  ipcMain.on('bbreader-reply',(event,id,result)=>{if(event.sender.id!==worker?.webContents.id||!appPage(event.senderFrame?.url))return;const pending=requests.get(id);if(pending){clearTimeout(pending.timer);requests.delete(id);pending.resolve(result);}});
  const ready=new Promise(resolve=>ipcMain.on('bbreader-ready',event=>{if(event.sender.id===worker?.webContents.id){workerReady=true;resolve();}}));
  worker=new BrowserWindow({show:false,webPreferences:{...appOptions,backgroundThrottling:false}});secureWindow(worker,true);
  worker.webContents.on('render-process-gone',()=>{if(!shuttingDown){dialog.showErrorBox('BBReader','后台已停止，请重启应用；已有索引和文件保留。');app.quit();}});
  await worker.loadURL(`${APP_ORIGIN}/desktop/background.html`);
  let readyTimeout;try{await Promise.race([ready,new Promise((_resolve,reject)=>{readyTimeout=setTimeout(()=>reject(Error('后台初始化超时')),30000);})]);}finally{clearTimeout(readyTimeout);}
  function showMain(){
    if(main&&!main.isDestroyed()){main.show();main.focus();return;}
    main=new BrowserWindow({width:1280,height:900,show:!smoke,minWidth:480,minHeight:600,title:'BBReader',icon:path.join(root,'desktop/icons/icon.png'),webPreferences:appOptions});secureWindow(main,true);
    main.on('closed',()=>{main=null;if(process.platform!=='darwin')app.quit();});
    main.loadURL(`${APP_ORIGIN}/index.html`);
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{role:'appMenu'}]:[]),{label:'应用',submenu:[{label:'打开 BBReader',click:showMain},{label:'打开下载目录',click:()=>shell.openPath(app.getPath('downloads'))},{label:'选择下载目录…',click:async()=>{const pending=Object.keys(data.storage.pending||{}).length;if(pending||data.storage.state?.job||data.storage.state?.downloadBatch?.status==='running'){await dialog.showMessageBox(main,{message:'请等待当前检查和下载结束'});return;}const result=await dialog.showOpenDialog(main,{properties:['openDirectory','createDirectory'],defaultPath:app.getPath('downloads')});if(!result.canceled){data.downloadRoot=result.filePaths[0];app.setPath('downloads',data.downloadRoot);await save();}}},{type:'separator'},{role:'quit'}]},
    {label:'帮助',submenu:[{label:'检查更新…',click:()=>{showMain();send(main,{type:'update-open'});}}]},
    {role:'editMenu'},{role:'viewMenu'},{role:'windowMenu'}
  ]));
  app.on('second-instance',showMain);app.on('activate',showMain);app.on('before-quit',()=>{shuttingDown=true;});
  powerMonitor.on('resume',()=>{for(const name of Object.keys(data.alarms))arm(name);send(worker,{type:'startup'});});
  for(const name of Object.keys(data.alarms))arm(name);
  showMain();send(worker,{type:'startup'});
}
