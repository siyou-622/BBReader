// Updating the application never reads or modifies the coursework index.
export function updateSource(value){
  if(!value||value.provider===null)return null;
  if(value.provider==='github'){
    if(!/^[\w-]+$/.test(value.owner||'')||!(/^[\w.-]+$/.test(value.repo||''))||value.repo==='.'||value.repo==='..')throw Error('GitHub 更新源无效');
    return {provider:'github',owner:value.owner,repo:value.repo};
  }
  if(value.provider==='generic'){
    const url=new URL(value.url);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('更新源必须是无账号参数的 HTTPS 地址');
    const releasePage=value.releasePage?new URL(value.releasePage):null;
    if(releasePage&&(releasePage.protocol!=='https:'||releasePage.username||releasePage.password))throw Error('下载页必须使用 HTTPS');
    return {provider:'generic',url:url.href.endsWith('/')?url.href:url.href+'/',...(releasePage?{releasePage:releasePage.href}:{})};
  }
  throw Error('不支持此更新源');
}
export const releasePage=source=>source?.provider==='github'?`https://github.com/${source.owner}/${source.repo}/releases/latest`:source?.releasePage||source?.url||null;
const notes=value=>typeof value==='string'?value.slice(0,20000):Array.isArray(value)?value.map(item=>`${item.version||''}\n${item.note||''}`).join('\n\n').slice(0,20000):'';

export function createUpdates({version,source,packaged,automatic,updaterFactory,onChange=()=>{},busy=()=>false,openExternal=()=>{},schedule=fn=>setTimeout(fn,250)}){
  source=updateSource(source);
  let updater,operation;
  let state={phase:source?(packaged?'idle':'development'):'unconfigured',currentVersion:version,newVersion:null,notes:'',percent:0,transferred:0,total:0,error:null,automatic:!!automatic,releasePage:releasePage(source)};
  const snapshot=()=>structuredClone(state);
  const change=patch=>{state={...state,...patch};onChange(snapshot());};
  const fail=()=>change({phase:'error',error:'更新失败，请检查网络或稍后重试。发布者需确认安装包、版本清单和签名配置完整。'});
  const load=()=>{
    if(updater)return updater;
    updater=updaterFactory();updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowPrerelease=false;updater.allowDowngrade=false;
    updater.on('checking-for-update',()=>change({phase:'checking',error:null}));
    updater.on('update-available',info=>change({phase:'available',newVersion:info.version,notes:notes(info.releaseNotes),error:null}));
    updater.on('update-not-available',()=>change({phase:'current',newVersion:null,notes:'',error:null}));
    updater.on('download-progress',progress=>change({phase:'downloading',percent:Math.min(100,Math.max(0,Number(progress.percent)||0)),transferred:Number(progress.transferred)||0,total:Number(progress.total)||0}));
    updater.on('update-downloaded',info=>change({phase:'downloaded',newVersion:info.version,percent:100,error:null}));
    updater.on('error',fail);
    return updater;
  };
  const ready=()=>{if(!source)throw Error('尚未配置更新源，需要发布者配置后重新打包');if(!packaged)throw Error('开发模式不执行在线更新，请使用安装版');};
  const run=async action=>{
    if(operation)return snapshot();
    operation=Promise.resolve().then(action).catch(()=>{fail();}).finally(()=>{operation=null;});
    await operation;return snapshot();
  };
  return {
    status:snapshot,
    check:async()=>{ready();if(['downloading','downloaded','installing'].includes(state.phase))return snapshot();return run(async()=>{change({phase:'checking',error:null});const result=await load().checkForUpdates();if(result===null)throw Error('updater inactive');});},
    download:async()=>{ready();if(operation||state.phase==='downloading')return snapshot();if(!automatic)throw Error('此包需前往下载页更新');if(!state.newVersion||!['available','error'].includes(state.phase))throw Error('请先检查是否有新版本');return run(async()=>{change({phase:'downloading',percent:0,transferred:0,total:0,error:null});await load().downloadUpdate();});},
    install:()=>{ready();if(!automatic||state.phase!=='downloaded')throw Error('请先完成更新下载');if(busy())throw Error('请等待课程检查、课件下载或导出完成后再安装更新');change({phase:'installing'});schedule(()=>{try{load().quitAndInstall(false,true);}catch{fail();}});return snapshot();},
    openRelease:async()=>{ready();await openExternal(state.releasePage);return snapshot();}
  };
}
