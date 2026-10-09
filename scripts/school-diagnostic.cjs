const {_electron:electron}=require('playwright');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve(__dirname,'..');let app;
  try{
    app=await electron.launch({executablePath:process.env.BBREADER_EXECUTABLE||require('electron'),args:[...(process.env.BBREADER_EXECUTABLE?[]:[root]),'--bbreader-smoke',`--bbreader-profile=${path.join(root,'verification',`school-diagnostic-${Date.now()}`)}`],timeout:60000});
    await app.evaluate(({app})=>{
      globalThis.bbSchoolDiagnosis=[];
      app.on('web-contents-created',(_event,wc)=>{
        wc.on('did-fail-load',(_event,code,description,url,isMain)=>{if(isMain)globalThis.bbSchoolDiagnosis.push({code,description,url});});
        wc.on('will-redirect',(_event,url)=>globalThis.bbSchoolDiagnosis.push({redirect:url}));
      });
    });
    const page=(await app.windows()).find(page=>page.url().includes('index.html'))||await app.waitForEvent('window',{predicate:page=>page.url().includes('index.html')});
    await page.waitForFunction(()=>globalThis.chrome?.runtime?.id);
    const schoolPromise=app.waitForEvent('window');
    console.log('openLogin',await page.evaluate(()=>chrome.runtime.sendMessage({op:'openLogin'})));
    const school=await schoolPromise;
    await new Promise(resolve=>setTimeout(resolve,12000));
    console.log('proxy',await app.evaluate(async({session})=>session.fromPartition('persist:bbreader').resolveProxy('https://bb.sustech.edu.cn/')));
    console.log('diagnosis',await app.evaluate(()=>globalThis.bbSchoolDiagnosis));
    console.log('school',await school.evaluate(()=>({url:location.href,title:document.title,text:document.body?.innerText.slice(0,700),passwordField:!!document.querySelector('input[type=password]')})));
    assert.equal(await school.locator('input[type=password]').count(),1,'actual school CAS login must render');
  }finally{if(app)await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
