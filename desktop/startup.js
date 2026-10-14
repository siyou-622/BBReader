import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export const STARTUP_NAME='cn.sustech.bbreader.desktop';
const args=['--bbreader-autostart'];

export function startupExecutable(platform,execPath,env={}){
  const value=platform==='win32'?env.PORTABLE_EXECUTABLE_FILE||execPath:platform==='linux'?env.APPIMAGE||execPath:execPath;
  if(typeof value!=='string'||/[\x00-\x1f]/.test(value)||!(platform==='win32'?path.win32:path.posix).isAbsolute(value))throw Error('自启动需要固定的程序路径');
  return value;
}
export function nativeStartup(app,{platform,executable,name=STARTUP_NAME}){
  const query=platform==='win32'?{path:executable,args}:{};
  return {
    read:async()=>{
      const settings=app.getLoginItemSettings(query),item=settings.launchItems?.find(item=>item.name===name);
      const pending=platform==='darwin'&&settings.status==='requires-approval';
      const configured=!!(settings.openAtLogin||item||pending);
      const enabled=!!settings.openAtLogin&&!pending&&(platform!=='win32'||(item?item.enabled:settings.executableWillLaunchAtLogin!==false));
      return {configured,enabled,pending};
    },
    write:async enabled=>app.setLoginItemSettings({openAtLogin:enabled,...(platform==='win32'?{path:executable,args,name,enabled}:{})})
  };
}
// Desktop Entry has two escape layers (string values, then quoted Exec arguments).
export function desktopExec(executable){
  if(!path.posix.isAbsolute(executable)||/[=\x00-\x1f]/.test(executable))throw Error('Linux 自启动程序路径无效');
  const quoted=executable.replace(/["`$\\]/g,char=>'\\'+char).replaceAll('%','%%').replaceAll('\\','\\\\');
  return `"${quoted}" --bbreader-autostart`;
}
export function linuxStartup({configHome,executable,io=fs}){
  const filename=path.join(configHome,'autostart',STARTUP_NAME+'.desktop');
  const read=async()=>{
    const exec=desktopExec(executable);
    let text;
    try{if((await io.lstat(filename)).isSymbolicLink())throw Error('自启动配置是符号链接，请在系统设置中处理');text=await io.readFile(filename,'utf8');}
    catch(error){if(error.code==='ENOENT')return {configured:false,enabled:false,pending:false};throw error;}
    if(!/^X-BBReader-Managed=true$/m.test(text))throw Error('已存在其他来源的自启动配置，请在系统设置中处理');
    return {configured:true,enabled:!/^Hidden=true$/mi.test(text)&&!/^X-GNOME-Autostart-enabled=false$/mi.test(text)&&text.split(/\r?\n/).includes('Exec='+exec),pending:false};
  };
  return {read,write:async enabled=>{
    await read();await io.mkdir(path.dirname(filename),{recursive:true,mode:0o700});
    const content=`[Desktop Entry]\nType=Application\nName=BBReader\nComment=Start BBReader after login\nExec=${desktopExec(executable)}\nTerminal=false\nHidden=${!enabled}\nX-GNOME-Autostart-enabled=${enabled}\nX-BBReader-Managed=true\n`;
    const temporary=filename+'.'+randomUUID()+'.tmp';
    try{await io.writeFile(temporary,content,{mode:0o600,flag:'wx'});await io.rename(temporary,filename);}
    finally{await io.unlink(temporary).catch(()=>{});}
  }};
}

export function createStartup({adapter,supported=true,reason='',load=()=>null,save=async()=>{}}){
  let queue=Promise.resolve(),lastError=null;
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  const status=async()=>{
    const base={supported,enabled:false,configured:false,pending:false,systemDisabled:false,reason,error:lastError};
    if(!supported)return base;
    try{const current=await adapter.read();return {...base,...current,systemDisabled:current.configured&&!current.enabled&&!current.pending&&load()?.enabled===true};}
    catch(error){return {...base,error:`无法读取自启动设置：${error.message}`};}
  };
  const apply=async enabled=>{
    await adapter.write(enabled);const current=await adapter.read();
    if(enabled?!current.enabled&&!current.pending:current.enabled)throw Error('系统没有应用自启动设置，请检查系统启动应用权限');
    await save({initialized:true,enabled});lastError=null;
  };
  return {
    initialize:()=>serial(async()=>{
      if(supported&&!load()?.initialized){
        try{const existing=await adapter.read();if(existing.configured)await save({initialized:true,enabled:existing.enabled||existing.pending});else await apply(true);}
        catch(error){lastError=`未能默认开启自启动：${error.message}`;await save({initialized:true,enabled:false}).catch(()=>{});}
      }
      return status();
    }),
    status:()=>serial(status),
    set:enabled=>serial(async()=>{if(!supported)throw Error(reason||'此运行方式不修改系统自启动');if(typeof enabled!=='boolean')throw Error('自启动设置无效');await apply(enabled);return status();})
  };
}
