// Actual Electron integration test with isolated local data and school-shaped fixtures.
const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),output=path.join(root,'verification');
const smokeUpdates=!!process.env.BBREADER_SMOKE_UPDATES||!!require('../desktop/update-source.json').provider;
const profile=path.join(output,`desktop-smoke-${Date.now()}`),downloads=path.join(profile,'downloads');
const ORIGIN='https://bb.sustech.edu.cn';
// A valid PDF verifies the actual Chromium preview, rather than only MIME routing.
const pdf=(()=>{
  const stream='BT /F1 18 Tf 40 160 Td (BBReader preview) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let value='%PDF-1.4\n',offsets=[0];for(const [i,object] of objects.entries()){offsets.push(value.length);value+=`${i+1} 0 obj\n${object}\nendobj\n`;}
  const xref=value.length;return value+`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
})();
async function waitPDF(page){
  const isViewer=frame=>frame.url().startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/');
  const viewer=page.frames().find(isViewer)||await page.waitForEvent('framenavigated',{predicate:isViewer,timeout:15000});
  assert.ok(viewer,'native PDF viewer frame must exist');
  await viewer.locator('pdf-viewer').waitFor({state:'attached'});
  await viewer.waitForFunction(()=>document.querySelector('pdf-viewer')?.loadState_==='success');
  assert.equal(await viewer.evaluate(()=>typeof bbDesktop),'undefined');
  assert.equal(await viewer.evaluate(()=>typeof require),'undefined');
}
(async()=>{
  await fs.mkdir(downloads,{recursive:true});
  const files=Object.fromEntries(['a','b','other'].map((key,i)=>[key,{key,id:key,courseId:i===2?'c2':'c1',name:i===0?'Lecture.pdf':'Exercises.pdf',url:ORIGIN+'/bbcswebdav/xid-'+key,relative:['Term','Course',i===0?'Lecture.pdf':'Exercises.pdf'],seen:1}]));
  files.a.uploadedTime='2026年10月8日 14:30';
  const fileChanges={run:1,checkedAt:1,initial:false,added:['other'],updated:['a'],unverified:[],partial:false};
  await fs.writeFile(path.join(profile,'desktop-state.json'),JSON.stringify({storage:{state:{account:'smoke',accountLabel:'Fixture',integrationMode:'browser',enabled:false,autoDownload:false,status:'课程和作业检查完成',courses:[{id:'c1',name:'示例课程',enabled:true},{id:'c2',name:'其他课程',enabled:true}],fileChanges,assignments:[{id:'a1',courseId:'c1',courseName:'示例课程',title:'Homework',due:'2026-12-01T15:59:00Z',status:'unknown',url:ORIGIN,checked:1}],files,notes:{p:{courseId:'c1',path:[],items:[{title:'Notes',body:'Example content',links:[]}]}},warnings:[],lastRun:1,lastSync:1}},downloads:[],alarms:{},permissions:[]}));
  let app;
  const waitExport=async extension=>{
    for(let i=0;i<300;i++){
      const data=JSON.parse(await fs.readFile(path.join(profile,'desktop-state.json'),'utf8'));
      const record=data.downloads.find(item=>item.filename.endsWith(extension)&&item.state==='complete');
      if(record&&await fs.stat(record.filename).then(s=>s.size>0).catch(()=>false))return record.filename;
      const failed=data.downloads.find(item=>item.filename.endsWith(extension)&&item.state==='interrupted');
      if(failed)throw Error(`Export failed: ${failed.error}`);
      await new Promise(r=>setTimeout(r,100));
    }
    throw Error(`Export ${extension} did not complete`);
  };
  const waitState=async(page,predicate)=>{for(let i=0;i<300;i++){const result=await page.evaluate(()=>chrome.runtime.sendMessage({op:'state'}));if(predicate(result.state))return result;await new Promise(r=>setTimeout(r,100));}throw Error('Desktop state did not settle');};
  const launch=async()=>{
    const launched=await electron.launch({executablePath:process.env.BBREADER_EXECUTABLE||require('electron'),args:[...(process.env.BBREADER_EXECUTABLE?[]:[root]),'--bbreader-smoke',...(smokeUpdates?['--bbreader-smoke-updates']:[]),`--bbreader-profile=${profile}`,`--bbreader-downloads=${downloads}`],timeout:60000});
    launched.on('console',msg=>{if(msg.type()==='error'&&!msg.text().includes('仅后台可执行此操作'))console.error('Electron:',msg.text());});
    await launched.evaluate(({session},pdf)=>{
      session.fromPartition('persist:bbreader').protocol.handle('https',request=>{
        if(new URL(request.url).hostname!=='bb.sustech.edu.cn')return new Response('Forbidden',{status:403});
        if(!new URL(request.url).pathname.startsWith('/bbcswebdav/'))return new Response('<html><body>Fixture school login</body></html>',{headers:{'content-type':'text/html'}});
        const body=pdf;
        if(request.method!=='HEAD'&&request.url.endsWith('xid-b')&&globalThis.bbSmokeFail)return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('%PDF-'));setTimeout(()=>controller.error(Error('fixture network interruption')),150);}}),{headers:{'content-type':'application/pdf'}});
        return new Response(request.method==='HEAD'?null:body,{headers:{'content-type':'application/pdf','content-disposition':'attachment; filename="Shared.pdf"',etag:'v1','last-modified':'Thu, 08 Oct 2026 06:30:00 GMT','content-length':String(new TextEncoder().encode(body).length)}});
      });
    },pdf);
    return launched;
  };
  try{
    app=await launch();const pages=await app.windows();let page=pages.find(p=>p.url().includes('index.html'));
    if(!page)page=await app.waitForEvent('window',{predicate:p=>p.url().includes('index.html')});
    await page.waitForFunction(()=>document.getElementById('account')?.textContent.includes('Fixture'));
    assert.equal(await page.locator('#version').textContent(),'v'+require('../extension/manifest.json').version);
    assert.equal(await page.evaluate(()=>typeof require),'undefined');
    assert.equal(await page.locator('#preview').isVisible(),false);
    await page.locator('[data-view="settings"]').click();await page.locator('#openUpdates').click();
    await page.locator('#updateDialog').waitFor({state:'visible'});
    if(smokeUpdates){
      await page.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('发现新版本'));
      assert.match(await page.locator('#updateVersions').textContent(),/99\.0\.0/);assert.match(await page.locator('#updateNotes').textContent(),/保留课程/);
      await app.evaluate(()=>{globalThis.bbSmokeUpdateFailure=true;});await page.locator('#updateAction').click();
      await page.waitForFunction(()=>document.querySelector('#updateAction').textContent==='重试下载'&&!document.querySelector('#updateAction').disabled);
      await app.evaluate(()=>{globalThis.bbSmokeUpdateFailure=false;});await page.locator('#updateAction').click();
      await page.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('更新已下载')&&!document.querySelector('#updateAction').disabled);
      await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/index.html')).showInactive();});
      await page.screenshot({path:path.join(output,'desktop-update.png'),fullPage:true});
      assert.equal(await app.evaluate(()=>globalThis.bbSmokeInstalled),undefined,'download must never install automatically');
      await page.locator('#updateLater').click();await page.locator('#openUpdates').click();
      await page.locator('#updateAction').click();
      for(let i=0;i<100&&!(await app.evaluate(()=>globalThis.bbSmokeInstalled));i++)await new Promise(resolve=>setTimeout(resolve,50));
      assert.deepEqual(await app.evaluate(()=>globalThis.bbSmokeInstalled),{silent:false,restart:true});
    }else{
      assert.match(await page.locator('#updateStatus').textContent(),/尚未连接更新服务/);assert.equal(await page.locator('#updateAction').isDisabled(),true);
      assert.match(await page.evaluate(()=>bbDesktop.invoke('updates.check').then(()=>'',e=>e.message)),/尚未配置/);
    }
    assert.match(await page.evaluate(()=>bbDesktop.invoke('updates.check',{url:'https://evil.example'}).then(()=>'',e=>e.message)),/不接受/);
    await page.locator('#closeUpdates').click();
    await page.locator('[data-view="courses"]').click();
    for(let i=0;i<2;i++){
      await page.waitForFunction(()=>!document.querySelector('#saveCourses').disabled);
      await page.locator('#saveCourses').click();
      await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('课程选择已保存'));
    }
    assert.deepEqual((await page.evaluate(()=>chrome.runtime.sendMessage({op:'state'}))).state.courses.map(c=>c.enabled),[true,true]);
    await page.locator('[data-view="files"]').click();
    assert.equal(await page.locator('.file input[type=checkbox]').count(),3);
    await page.locator('#viewAddedFiles').click();
    assert.equal(await page.locator('.file').count(),1);assert.match(await page.locator('.file').textContent(),/Exercises/);
    assert.match(await page.locator('.file-group summary').textContent(),/其他课程/);
    await page.locator('#viewUpdatedFiles').click();
    assert.equal(await page.locator('.file').count(),1);assert.match(await page.locator('.file').textContent(),/Lecture/);
    await page.locator('#showAllFiles').click();assert.equal(await page.locator('.file').count(),3);
    assert.match(await page.locator('.file').first().textContent(),/未下载/);
    const remotePromise=app.waitForEvent('window');
    await page.getByRole('button',{name:'预览',exact:true}).first().click();
    const remote=await remotePromise;await remote.waitForURL('bbreader://app/preview/b');
    assert.equal(await remote.evaluate(()=>typeof bbDesktop),'undefined');assert.equal(await remote.evaluate(()=>typeof require),'undefined');
    const previewResponse=await page.evaluate(async()=>{const r=await fetch('bbreader://app/preview/b');return {type:r.headers.get('content-type'),disposition:r.headers.get('content-disposition'),body:await r.text()};});
    assert.equal(previewResponse.type,'application/pdf');assert.equal(previewResponse.disposition,'inline');assert.match(previewResponse.body,/^%PDF/);
    await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='bbreader://app/preview/b').showInactive();});
    await waitPDF(remote);
    await remote.screenshot({path:path.join(output,'desktop-preview-remote.png')});
    assert.deepEqual(await fs.readdir(downloads),[],'preview must not persist a download');await remote.close();
    await page.getByRole('button',{name:'读取类型与大小',exact:true}).first().click();
    await waitState(page,state=>state.files.a.metadata?.size===String(pdf.length)&&state.files.b.metadata?.size===String(pdf.length));
    await page.waitForFunction(()=>!document.querySelector('.file input[type=checkbox]').disabled);
    await app.evaluate(()=>{globalThis.bbSmokeFail=true;});
    await page.locator('.file input[type=checkbox]').first().check();
    await page.getByRole('button',{name:'下载已勾选（1）',exact:true}).click();
    await waitState(page,state=>state.downloadBatch?.status==='complete');
    const failure=await page.evaluate(()=>chrome.runtime.sendMessage({op:'state'}));assert.equal(failure.state.downloadBatch.results.b.status,'failed');assert.equal(failure.state.files.b.browserDownload,undefined);
    assert.deepEqual(await fs.readdir(path.join(downloads,'BBReader/Term/Course')),[],'interrupted partial file must be cleaned');
    await app.evaluate(()=>{globalThis.bbSmokeFail=false;});await page.locator('#retrySelected').click();
    await waitState(page,state=>state.downloadBatch?.status==='complete'&&state.downloadBatch.results.b?.status==='saved');
    let result=await page.evaluate(()=>chrome.runtime.sendMessage({op:'state'}));
    assert.deepEqual(Object.keys(result.state.downloadBatch.results),['b']); // Chinese name sort: Exercises first.
    assert.equal(result.state.downloadBatch.results.b.status,'saved');
    await page.waitForFunction(()=>document.querySelector('.file').textContent.includes('已下载'));
    assert.match(await page.locator('.file').first().textContent(),/文件更新时间/);
    assert.doesNotMatch(await page.locator('#fileList').textContent(),/[A-Z]:\\|原文件 ↗/);
    const localPromise=app.waitForEvent('window');await page.getByRole('button',{name:'预览',exact:true}).first().click();
    const local=await localPromise;await local.waitForURL('bbreader://app/preview/b');
    assert.equal(await local.evaluate(()=>typeof bbDesktop),'undefined');
    await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='bbreader://app/preview/b').showInactive();});
    await waitPDF(local);
    await local.screenshot({path:path.join(output,'desktop-preview.png')});
    await local.close();
    // Verify external preview without launching another real desktop application.
    await app.evaluate(({shell,dialog})=>{
      globalThis.bbOriginalOpen=shell.openPath;shell.openPath=async filename=>{globalThis.bbOpened=filename;return '';};
      globalThis.bbOriginalDialog=dialog.showOpenDialog;const paths=process.getBuiltinModule('path');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[process.platform==='darwin'?paths.dirname(paths.dirname(paths.dirname(process.execPath))):process.execPath]});
      const cp=process.getBuiltinModule('child_process'),{EventEmitter}=process.getBuiltinModule('events');globalThis.bbOriginalSpawn=cp.spawn;
      cp.spawn=(command,args,options)=>{globalThis.bbSpawned={command,args,options};const child=new EventEmitter();child.unref=()=>{};setImmediate(()=>child.emit('spawn'));return child;};
    });
    await page.locator('[data-view="settings"]').click();await page.locator('#previewMode').selectOption('system');
    await page.waitForFunction(async()=>(await bbDesktop.invoke('preview.settings')).mode==='system');
    assert.deepEqual(await page.evaluate(()=>bbDesktop.invoke('file.preview',{key:'b'})),{local:true,external:true});
    assert.equal(await app.evaluate(()=>globalThis.bbOpened),result.state.files.b.browserDownload.path);
    assert.match(await page.evaluate(()=>bbDesktop.invoke('file.preview',{key:'a'}).then(()=>'',e=>e.message)),/请先下载/);
    await page.locator('#previewMode').selectOption('custom');
    await page.waitForFunction(async()=>(await bbDesktop.invoke('preview.settings')).mode==='custom');
    assert.ok(await page.locator('#previewApplicationName').textContent());
    await page.screenshot({path:path.join(output,'desktop-preview-settings.png'),fullPage:true});
    assert.deepEqual(await page.evaluate(()=>bbDesktop.invoke('file.preview',{key:'b'})),{local:true,external:true});
    const spawned=await app.evaluate(()=>globalThis.bbSpawned);
    assert.equal(spawned.args.at(-1),result.state.files.b.browserDownload.path);assert.equal(spawned.options.shell,false);
    assert.match(await page.evaluate(()=>bbDesktop.invoke('preview.settings',{mode:'custom',application:'bad.exe'}).then(()=>'',e=>e.message)),/无效/);
    await page.locator('#previewMode').selectOption('system');
    await page.waitForFunction(async()=>(await bbDesktop.invoke('preview.settings')).mode==='system');
    await app.evaluate(({shell,dialog})=>{shell.openPath=globalThis.bbOriginalOpen;dialog.showOpenDialog=globalThis.bbOriginalDialog;process.getBuiltinModule('child_process').spawn=globalThis.bbOriginalSpawn;});
    await page.locator('[data-view="files"]').click();
    await app.evaluate(({shell})=>{globalThis.bbOriginalReveal=shell.showItemInFolder;shell.showItemInFolder=filename=>{globalThis.bbRevealed=filename;};});
    await page.getByRole('button',{name:'打开所在文件夹',exact:true}).first().click();
    assert.equal(await app.evaluate(()=>globalThis.bbRevealed),result.state.files.b.browserDownload.path);
    await app.evaluate(({shell})=>{shell.showItemInFolder=globalThis.bbOriginalReveal;});
    assert.match(await page.evaluate(()=>bbDesktop.invoke('file.reveal',{key:'missing',path:'C:\\Windows'}).then(()=>'',e=>e.message)),/尚未下载/);
    await fs.unlink(result.state.files.b.browserDownload.path);
    assert.match(await page.evaluate(()=>bbDesktop.invoke('file.reveal',{key:'b'}).then(()=>'',e=>e.message)),/移动或删除/);
    await page.reload();await page.locator('[data-view="files"]').click();
    await page.waitForFunction(()=>document.querySelector('.file').textContent.includes('文件已移动或删除'));
    assert.equal(await page.getByRole('button',{name:'打开所在文件夹',exact:true}).count(),0);
    assert.ok((await page.evaluate(()=>chrome.runtime.sendMessage({op:'state'}))).state.files.b.browserDownload.path,'missing-file status must not delete history');
    await page.locator('.file').first().getByRole('button',{name:'下载',exact:true}).click();
    await waitState(page,state=>state.downloadBatch?.status==='complete'&&state.downloadBatch.results.b?.status==='saved');
    await page.locator('#fileSearch').fill('Lecture');
    await page.getByRole('button',{name:'下载该课程全部课件',exact:true}).click();
    await waitState(page,state=>state.downloadBatch?.status==='complete'&&state.downloadBatch.keys.length===2);
    result=await page.evaluate(()=>chrome.runtime.sendMessage({op:'state'}));
    assert.equal(result.state.downloadBatch.results.b.status,'skipped');assert.equal(result.state.downloadBatch.results.a.status,'saved');
    assert.equal(result.state.files.other.browserDownload,undefined);
    assert.doesNotMatch(await page.locator('#fileList').textContent(),/上传时间/);
    assert.equal(await page.locator('.file-buttons').first().evaluate(el=>getComputedStyle(el).flexDirection),'row');
    const filenames=(await fs.readdir(path.join(downloads,'BBReader/Term/Course'))).sort();
    assert.deepEqual(filenames,['Shared (1).pdf','Shared.pdf']);
    for(const filename of filenames)assert.match(await fs.readFile(path.join(downloads,'BBReader/Term/Course',filename),'utf8'),/^%PDF/);
    await page.locator('#exportNotes').click();
    const notes=await waitExport('.txt');assert.match(await fs.readFile(notes,'utf8'),/Example content/);
    await page.screenshot({path:path.join(output,'desktop-files.png'),fullPage:true});
    await page.locator('[data-view="agenda"]').click();
    await page.locator('#export').click();
    const ics=await waitExport('.ics');assert.match(await fs.readFile(ics,'utf8'),/BEGIN:VCALENDAR/);
    await page.locator('[data-view="settings"]').click();await page.locator('[data-palette-option="teal"]').click();
    assert.match(await page.evaluate(()=>bbDesktop.invoke('storage.set',{malicious:true}).then(()=>'',e=>e.message)),/仅后台/);
    const schoolPromise=app.waitForEvent('window');
    await page.evaluate(()=>chrome.runtime.sendMessage({op:'openLogin'}));
    const school=await schoolPromise;await school.waitForURL(ORIGIN+'/**');await school.waitForLoadState();
    assert.equal(await school.evaluate(()=>typeof bbDesktop),'undefined');assert.equal(await school.evaluate(()=>typeof require),'undefined');
    await app.evaluate(({BrowserWindow})=>{const school=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('https://bb.sustech.edu.cn'));school.webContents.emit('did-fail-load',{},-130,'ERR_PROXY_CONNECTION_FAILED',school.webContents.getURL(),true);});
    await school.waitForURL('bbreader://app/desktop/school-error.html*');
    assert.match(await school.locator('#schoolError').textContent(),/代理/);
    assert.equal(await school.evaluate(()=>typeof bbDesktop),'undefined');
    await school.locator('#retrySchool').click();await school.waitForURL(ORIGIN+'/**');await school.waitForLoadState();
    await page.setViewportSize({width:520,height:780});await page.locator('[data-view="files"]').click();
    await page.screenshot({path:path.join(output,'desktop-files-narrow.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'narrow layout must not overflow');
    await app.close();app=null;
    app=await launch();page=(await app.windows()).find(p=>p.url().includes('index.html'))||await app.waitForEvent('window',{predicate:p=>p.url().includes('index.html')});
    await page.waitForFunction(()=>document.documentElement.dataset.palette==='teal');
    assert.equal((await page.evaluate(()=>bbDesktop.invoke('preview.settings'))).mode,'system');
    result=await page.evaluate(()=>chrome.runtime.sendMessage({op:'state'}));assert.equal(result.state.downloadBatch.status,'complete');assert.ok(result.state.files.a.browserDownload.path);
    // Exercise the entire original scraper with real DOM parsing and real school-window scripting.
    await page.evaluate(()=>chrome.runtime.sendMessage({op:'reset'}));
    await page.evaluate(()=>chrome.runtime.sendMessage({op:'downloadSettings',autoDownload:false}));
    await app.evaluate(({session})=>{
      const profile=session.fromPartition('persist:bbreader');profile.protocol.unhandle('https');
      const year=new Date().getFullYear();
      profile.protocol.handle('https',request=>{
        const url=new URL(request.url);let body='',type='text/html';
        if(url.pathname==='/webapps/portal/execute/tabs/tabAction')body=url.searchParams.has('forwardUrl')?
          `<table id="termDisplay_table_jsListTermDisplay"><tbody><tr id="term:_58_1"><th>${year}秋（Fall ${year}）</th><td id="miniListElement-termduration:row_0">从 ${year}年1月1日 至 ${year}年12月31日</td></tr></tbody></table><table id="blockAttributes_table_jsListFULL_Student_123_1"><tbody><tr id="course:_1_1"><th>CS100-${year}FA: Hidden current course</th><td><input type="checkbox"></td></tr></tbody></table>`:
          '<html><title>Welcome, Fixture - Blackboard Learn</title><div id="global-nav-link">Fixture</div><a href="/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=_1_1&amp;forwardUrl=edit_module%2F_3_1%2Fbbcourseorg%3Fcmd%3Dedit">Courses</a></html>';
        else if(url.pathname.endsWith('/personalInfo'))body='<a href="/webapps/blackboard/execute/launcher?type=PersonalInfo&amp;id=_42_1&amp;url=">Profile</a>';
        else if(url.pathname.endsWith('/launcher'))body='<div id="courseMenuPalette_contents"><a href="/webapps/blackboard/content/listContent.jsp?course_id=_1_1&amp;content_id=_2_1">Lectures</a></div>';
        else if(url.pathname.endsWith('/listContent.jsp'))body='<div id="content"><ul id="content_listContainer"><li id="contentListItem:_3_1"><h3><a href="/webapps/assignment/uploadAssignment?course_id=_1_1&amp;content_id=_3_1&amp;mode=view">Homework</a></h3><a href="/bbcswebdav/xid-99_1">Scan.pdf</a><div class="vtbegenerated">Scan notes</div></li>'+((globalThis.bbSmokeCatalog||0)>0?'<li id="contentListItem:_4_1"><h3>Extra</h3><a href="/bbcswebdav/xid-100_1">ScanExtra.pdf</a></li>':'')+'</ul></div>';
        else if(url.pathname.endsWith('/uploadAssignment'))body=`<div id="content">Due Date December 1, ${year} 11:59 PM Points Possible 100</div>`;
        else if(url.pathname.endsWith('/myGrades'))body='<div id="grades_wrapper"><div class="submitted_item_row"><div class="gradable"><span id="_3_1">Homework</span></div><div class="activity">Submitted</div></div></div>';
        else if(url.pathname.includes('/calendarData/')){body='[]';type='application/json';}
        else if(url.pathname.startsWith('/bbcswebdav/')){body='%PDF-1.4\nScan fixture\n%%EOF';type='application/pdf';}
        else return new Response('Unknown fixture',{status:404});
        const headers={'content-type':type};if(type==='application/pdf'){headers.etag=globalThis.bbSmokeCatalog?'scan-v2':'scan-v1';headers['content-disposition']='attachment; filename="Scan.pdf"';}
        const response=new Response(request.method==='HEAD'?null:body,{headers,status:globalThis.bbSmokeCatalog>=3&&request.method==='HEAD'&&url.pathname.endsWith('xid-100_1')?(globalThis.bbSmokeCatalog===4?403:405):200});
        // Blackboard's launcher resolves to courseMain with course_id; synthetic Responses
        // otherwise have an empty url, so model the observed final address explicitly.
        Object.defineProperty(response,'url',{value:url.pathname.endsWith('/launcher')?'https://bb.sustech.edu.cn/webapps/blackboard/execute/courseMain?course_id=_1_1':request.url});
        return response;
      });
    });
    await page.evaluate(()=>chrome.runtime.sendMessage({op:'sync'}));
    await waitState(page,state=>state.job?.gradesQueued||state.lastError);
    await app.evaluate(({BrowserWindow})=>{const service=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/desktop/background.html'));service.webContents.send('bbreader-event',{type:'alarm',name:'resume-job'});});
    result=await waitState(page,state=>!state.job&&(state.lastSync||state.lastError));
    assert.equal(result.state.lastError,null,result.state.lastError);assert.equal(result.state.courses.length,1);assert.equal(result.state.courses[0].name,'Hidden current course');
    assert.equal(result.state.assignments[0].status,'submitted');assert.match(result.state.assignments[0].due,/12-01T15:59:00/);
    assert.ok(result.state.files['_1_1:99_1']);assert.equal(result.state.files['_1_1:99_1'].browserDownload,undefined,'scan-only must retain the catalog without downloading');
    assert.equal(result.state.fileChanges.initial,true);assert.deepEqual(result.state.fileChanges.added,['_1_1:99_1']);assert.deepEqual(result.state.fileChanges.updated,[]);
    await page.evaluate(()=>chrome.runtime.sendMessage({op:'files'}));
    result=await waitState(page,state=>state.files['_1_1:99_1'].browserDownload&&state.downloadStatus==='文件检查完成');
    assert.match(await fs.readFile(result.state.files['_1_1:99_1'].browserDownload.path,'utf8'),/^%PDF/);
    const runCheck=async phase=>{
      const previous=(await page.evaluate(()=>chrome.runtime.sendMessage({op:'state'}))).state.fileChanges.run;
      await app.evaluate(({},phase)=>{globalThis.bbSmokeCatalog=phase;},phase);
      await page.evaluate(()=>chrome.runtime.sendMessage({op:'sync'}));
      await waitState(page,state=>state.job?.gradesQueued||state.lastError);
      await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/desktop/background.html')).webContents.send('bbreader-event',{type:'alarm',name:'resume-job'});});
      const result=await waitState(page,state=>!state.job&&(state.fileChanges?.run!==previous||state.lastError));
      assert.equal(result.state.lastError,null);return result.state;
    };
    const changed=await runCheck(1);
    assert.deepEqual(changed.fileChanges.added,['_1_1:100_1']);assert.deepEqual(changed.fileChanges.updated,['_1_1:99_1']);assert.equal(changed.fileChanges.initial,false);
    await page.locator('#viewAddedFiles').click();assert.equal(await page.locator('.file').count(),1);assert.match(await page.locator('.file').textContent(),/ScanExtra/);
    await page.locator('.file input[type=checkbox]').check();
    await page.locator('#viewUpdatedFiles').click();assert.equal(await page.locator('.file').count(),1);assert.match(await page.locator('.file').textContent(),/Scan\.pdf/);
    await page.screenshot({path:path.join(output,'desktop-changes.png'),fullPage:true});
    await page.locator('#showAllFiles').click();assert.equal(await page.locator('.file').count(),2);assert.equal(await page.locator('.file input:checked').count(),1);
    const unchanged=await runCheck(2);assert.deepEqual(unchanged.fileChanges.added,[]);assert.deepEqual(unchanged.fileChanges.updated,[]);
    await page.waitForFunction(()=>document.querySelector('#viewAddedFiles').disabled&&document.querySelector('#viewUpdatedFiles').disabled);
    const partial=await runCheck(3);assert.deepEqual(partial.fileChanges.unverified,['_1_1:100_1']);assert.equal(partial.fileChanges.partial,true);assert.deepEqual(partial.fileChanges.updated,[]);
    await page.waitForFunction(()=>document.querySelector('#fileChangeNote').textContent.includes('未能核对'));
    const forbiddenHEAD=await runCheck(4);assert.deepEqual(forbiddenHEAD.fileChanges.unverified,['_1_1:100_1']);assert.equal(forbiddenHEAD.fileChanges.partial,true);assert.equal(forbiddenHEAD.lastError,null);
    await app.close();app=null;app=await launch();
    page=(await app.windows()).find(p=>p.url().includes('index.html'))||await app.waitForEvent('window',{predicate:p=>p.url().includes('index.html')});
    await page.waitForFunction(()=>document.querySelector('#fileChangeNote').textContent.includes('未能核对'));
    assert.equal((await page.evaluate(()=>chrome.runtime.sendMessage({op:'state'}))).state.fileChanges.run,forbiddenHEAD.fileChanges.run);
    assert.equal((await page.evaluate(()=>bbDesktop.invoke('preview.settings'))).mode,'system');
    const parserWindow=app.waitForEvent('window');
    await app.evaluate(({BrowserWindow},filename)=>{new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}}).loadFile(filename);},path.join(root,'tests/parser.html'));
    const parserPage=await parserWindow;await parserPage.waitForFunction(()=>/^(PASS|FAIL)/.test(document.getElementById('result')?.textContent||''));assert.match(await parserPage.locator('#result').textContent(),/^PASS/);
    console.log('PASS: unchanged course saves, local/remote inline PDF preview, preview isolation, file reveal/missing-file recovery, hidden upload time, horizontal actions, change summaries and external preview settings, packaged-compatible Electron UI, partial-stream failure cleanup and retry, metadata HEAD, selection/course-all scope, same-name files, ETag skip, ICS/TXT export, school/IPC isolation, restart persistence, narrow layout, hidden-enrollment scan, parser fixtures, deadlines, grades, legacy download entry.');
  }finally{if(app)await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
