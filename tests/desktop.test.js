import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {appPage,schoolURL,downloadPath,extensionOrigin,attachmentURL,requestURL} from '../desktop/security.js';
import {applicationCommand,previewableFile} from '../desktop/preview.js';
import {schoolTab,schoolFailure} from '../desktop/school.js';
test('desktop bridge and school navigation enforce local and school origins',()=>{
  assert.ok(appPage('bbreader://app/index.html'));assert.ok(!appPage('https://bb.sustech.edu.cn'));
  assert.ok(!appPage('bbreader://evil/index.html'));
  assert.equal(schoolURL('https://cas.sustech.edu.cn/cas/login'),'https://cas.sustech.edu.cn/cas/login');
  for(const url of ['http://bb.sustech.edu.cn','https://bb.sustech.edu.cn.evil/','file:///tmp/x','https://user@bb.sustech.edu.cn'])assert.throws(()=>schoolURL(url));
  assert.throws(()=>attachmentURL('https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment'));
  assert.equal(attachmentURL('https://bb.sustech.edu.cn/bbcswebdav/xid-1'),'https://bb.sustech.edu.cn/bbcswebdav/xid-1');
  const settings='https://bb.sustech.edu.cn/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=_1_1&forwardUrl=edit_module%2F_3_1%2Fbbcourseorg%3Fcmd%3Dedit';
  assert.equal(requestURL(settings),settings);assert.throws(()=>requestURL(settings+'&action=delete'));
});
test('desktop download paths preserve archive layout while rejecting traversal and alternate roots',()=>{
  const root=path.resolve('verification/downloads');
  assert.equal(downloadPath(root,'BBReader/学期/课程/讲义.pdf'),path.join(root,'BBReader','学期','课程','讲义.pdf'));
  assert.equal(downloadPath(root,'BBReader-staging/token/a.pdf'),path.join(root,'BBReader-staging','token','a.pdf'));
  for(const filename of ['../evil','BBReader/../evil','BBReader//evil','BBReader/./evil','BBReader/a\\evil','other/a.pdf','C:/evil','BBReader/a:b'])assert.throws(()=>downloadPath(root,filename));
});
test('desktop uses the same fixed extension origin as the optional Swift host',()=>{
  const {key}=JSON.parse(readFileSync(new URL('../extension/manifest.json',import.meta.url)));
  assert.match(extensionOrigin(key),/^chrome-extension:\/\/[a-p]{32}\/$/);
});
test('a school window cannot report a blank initial URL as a completed page',()=>{
  let url='',loading=false;
  const window={webContents:{id:1,getURL:()=>url,isLoading:()=>loading}};
  const load={url:'https://bb.sustech.edu.cn/webapps/login/',pending:true};
  assert.equal(schoolTab(window,load).status,'loading');assert.equal(schoolTab(window,load).url,load.url);
  url=load.url;loading=true;load.pending=false;assert.equal(schoolTab(window,load).status,'loading');
  loading=false;assert.equal(schoolTab(window,load).status,'complete');
  load.error='无法连接代理';assert.throws(()=>schoolTab(window,load),/无法连接代理/);
  assert.equal(schoolFailure(-3),null);assert.match(schoolFailure(-130),/代理/);assert.match(schoolFailure(-105),/校园网络/);assert.match(schoolFailure(-202),/证书/);
});

test('external preview commands use separately passed local filenames on all three platforms',()=>{
  const windows=applicationCommand('C:\\Program Files\\Reader\\reader.exe','C:\\Downloads\\讲义 & $name.pdf','win32');
  assert.deepEqual(windows,{command:'C:\\Program Files\\Reader\\reader.exe',args:['C:\\Downloads\\讲义 & $name.pdf']});
  assert.deepEqual(applicationCommand('/Applications/Reader.app','/Users/student/Lecture.pdf','darwin'),{command:'/usr/bin/open',args:['-a','/Applications/Reader.app','/Users/student/Lecture.pdf']});
  assert.deepEqual(applicationCommand('/usr/bin/reader','/home/student/Lecture.pdf','linux'),{command:'/usr/bin/reader',args:['/home/student/Lecture.pdf']});
  assert.throws(()=>applicationCommand('reader.exe','C:\\Downloads\\Lecture.pdf','win32'));
  assert.throws(()=>applicationCommand('C:\\reader.cmd','C:\\Downloads\\Lecture.pdf','win32'));
  assert.throws(()=>applicationCommand('/Applications/Reader.app','https://school/Lecture.pdf','darwin'));
  assert.equal(previewableFile('/downloads/setup.exe'),false);assert.equal(previewableFile('/downloads/page.html'),false);
  assert.throws(()=>applicationCommand('/usr/bin/reader','/downloads/setup.exe','linux'));
});
