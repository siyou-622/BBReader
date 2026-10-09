const {contextBridge,ipcRenderer}=require('electron');
// No generic ipcRenderer, filesystem, shell or Node access in either page world.
contextBridge.exposeInMainWorld('bbDesktop',{
  version:process.argv.find(arg=>arg.startsWith('--bbreader-version='))?.slice('--bbreader-version='.length)||'',
  invoke:(op,payload)=>ipcRenderer.invoke('bbreader',op,payload),
  onEvent:callback=>ipcRenderer.on('bbreader-event',(_event,data)=>callback(data)),
  reply:(id,result)=>ipcRenderer.send('bbreader-reply',id,result),
  ready:()=>ipcRenderer.send('bbreader-ready')
});
