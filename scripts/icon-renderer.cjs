const {app,BrowserWindow}=require('electron');
app.whenReady().then(()=>{
  const window=new BrowserWindow({width:1024,height:1024,useContentSize:true,show:false,transparent:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.loadURL('about:blank');
});
app.on('window-all-closed',()=>app.quit());
