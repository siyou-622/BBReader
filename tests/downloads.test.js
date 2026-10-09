import test from 'node:test';
import assert from 'node:assert/strict';
import {createDownloadBatch,finishBatchFile,fileMetadata,formatSize} from '../extension/downloads.js';
import {ORIGIN} from '../extension/core.js';
const state=()=>({courses:[{id:'c1',name:'Course',enabled:true},{id:'c2',enabled:false}],files:Object.fromEntries([['a','c1'],['b','c1'],['x','c2']].map(([key,courseId])=>[key,{key,courseId,name:key+'.pdf',url:ORIGIN+'/bbcswebdav/xid-'+key}]))});
test('selected keys are unique and the all button covers the entire course independently of UI search',()=>{
  const s=state();assert.deepEqual(createDownloadBatch(s,{courseId:'c1',keys:['b','b']}).keys,['b']);
  assert.deepEqual(createDownloadBatch(s,{courseId:'c1',keys:['b'],all:true}).keys,['a','b']);
  assert.throws(()=>createDownloadBatch(s,{courseId:'c1',keys:['x']}),/当前课程/);
  assert.throws(()=>createDownloadBatch(s,{courseId:'c2',all:true}),/启用/);
  assert.throws(()=>createDownloadBatch(s,{courseId:'c1',keys:[]}),/勾选/);
  assert.throws(()=>createDownloadBatch(s,{courseId:'c1',keys:['missing']}),/当前课程/);
  s.files.a.url='https://evil.example/file';assert.throws(()=>createDownloadBatch(s,{courseId:'c1',all:true}));
});
test('batch checkpoints preserve individual success, skips, and failures across serialization',()=>{
  const s=state();s.downloadBatch=createDownloadBatch(s,{courseId:'c1',all:true});
  finishBatchFile(s,'a','skipped');finishBatchFile(s,'x','saved');finishBatchFile(s,'b','failed','offline');
  const restored=JSON.parse(JSON.stringify(s));assert.deepEqual(Object.keys(restored.downloadBatch.results),['a','b']);
  assert.equal(restored.downloadBatch.results.b.error,'offline');
  finishBatchFile(restored,'b','saved');assert.equal(restored.downloadBatch.results.b.status,'saved');
});
test('metadata reports absent sizes honestly and preserves zero, extension, and MIME fallback',()=>{
  assert.deepEqual(fileMetadata({name:'Lecture',metadata:{type:'application/pdf',size:'1024'}}),{type:'application/pdf',size:1024});
  assert.deepEqual(fileMetadata({archiveName:'课程.pptx',metadata:{size:null}}),{type:'PPTX',size:null});
  assert.equal(fileMetadata({metadata:{size:'bad'}}).size,null);assert.equal(fileMetadata({metadata:{size:'0'}}).size,0);
  assert.equal(formatSize(null),'大小未知');assert.equal(formatSize(0),'0 B');assert.equal(formatSize(1024),'1.0 KB');
});
