// Loaded only by the desktop protocol; Chrome extension files keep their native APIs.
(() => {
  const bridge=globalThis.bbDesktop;if(!bridge)return;
  const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},emit(...args){this.listeners.forEach(fn=>fn(...args));}});
  const call=(op,payload)=>bridge.invoke(op,payload);
  const onMessage=event(),onStartup=event(),onAlarm=event(),onChanged=event(),downloadChanged=event();
  function deliver(msg,sender,reply){let handled=false;for(const fn of onMessage.listeners)if(fn(msg,sender,reply)===true)handled=true;return handled;}
  globalThis.chrome={
    runtime:{id:'bbreader-desktop',getURL:p=>`bbreader://app/${p}`,getManifest:()=>({version:bridge.version}),getPlatformInfo:()=>call('platform'),getContexts:async()=>[{}],
      onMessage,onStartup,onInstalled:event(),sendNativeMessage:(host,message)=>call('native',{host,message}),
      sendMessage:msg=>msg.target==='parser'?new Promise(resolve=>deliver(msg,{id:'bbreader-desktop'},resolve)):call('message',msg)},
    storage:{local:{get:key=>call('storage.get',key),set:data=>call('storage.set',data),remove:key=>call('storage.remove',key)},onChanged},
    tabs:{create:data=>call('tabs.create',data),get:id=>call('tabs.get',id),remove:id=>call('tabs.remove',id)},
    scripting:{executeScript:({target,func,args=[]})=>call('script',{id:target.tabId,source:func.toString(),args})},
    permissions:{contains:data=>call('permission.contains',data),request:data=>call('permission.request',data)},
    alarms:{get:name=>call('alarm.get',name),create:(name,options)=>call('alarm.create',{name,options}),onAlarm},
    downloads:{download:options=>call('download',options),search:query=>call('download.search',query),onChanged:downloadChanged},
    offscreen:{createDocument:async()=>{}},action:{onClicked:event()}
  };
  bridge.onEvent(data=>{
    if(data.type==='message')deliver(data.message,{id:chrome.runtime.id,url:chrome.runtime.getURL('index.html')},result=>bridge.reply(data.id,result));
    if(data.type==='storage')onChanged.emit(data.changes,'local');
    if(data.type==='download')downloadChanged.emit(data.delta);
    if(data.type==='alarm')onAlarm.emit({name:data.name});
    if(data.type==='startup')onStartup.emit();
  });
  if(location.pathname==='/desktop/background.html'){
    globalThis.fetch=async(url,options={})=>{
      const result=await call('fetch',{url:String(url),method:options.method||'GET'});
      const response=new Response(result.body,{status:result.status,headers:result.headers});
      Object.defineProperty(response,'url',{value:result.url});return response;
    };
  }
})();
