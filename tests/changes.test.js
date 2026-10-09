import test from 'node:test';
import assert from 'node:assert/strict';
import {fileVersion,compareVersions,discoverFile,observeFile,unverifiedFile,completeChanges} from '../extension/changes.js';

const state=files=>({files:structuredClone(files),warnings:[],job:{started:200},lastRun:100,lastSync:100});
test('first collection, legacy indexes, and files found in an interrupted check have distinct discovery semantics',()=>{
  const fresh=state({});fresh.lastRun=null;fresh.lastSync=null;
  fresh.files.a={firstSeen:discoverFile(fresh,'a')};observeFile(fresh,'a',{etag:'v1'});completeChanges(fresh,201);
  assert.equal(fresh.fileChanges.initial,true);assert.deepEqual(fresh.fileChanges.added,['a']);assert.deepEqual(fresh.fileChanges.updated,[]);
  const legacy=state({a:{seen:100,browserDownload:{headers:{etag:'v1',modified:null,size:'42'}}}});
  discoverFile(legacy,'a');observeFile(legacy,'a',{etag:'v1',size:'42'});completeChanges(legacy,201);
  assert.equal(legacy.fileChanges.initial,false);assert.deepEqual(legacy.fileChanges.added,[]);assert.deepEqual(legacy.fileChanges.updated,[]);
  const interrupted=state({a:{firstSeen:150,seen:150}});discoverFile(interrupted,'a');discoverFile(interrupted,'a');completeChanges(interrupted,201);
  assert.deepEqual(interrupted.fileChanges.added,['a']);
});
test('version comparisons use shared evidence and never mistake a newly supplied header for an update',()=>{
  assert.deepEqual(compareVersions({etag:'v1'},{etag:'v2'}),{updated:true,verified:true});
  assert.deepEqual(compareVersions({etag:'v1',modified:'2026-10-08'},{etag:'v1',modified:'2026-10-09'}),{updated:false,verified:true});
  assert.equal(compareVersions({modified:'Thu, 08 Oct 2026 06:30:00 GMT',size:'42'},{modified:'2026-10-08T06:30:00Z',size:42}).updated,false);
  assert.equal(compareVersions({modified:'2026-10-08',size:42},{modified:'2026-10-09',size:42}).updated,true);
  assert.deepEqual(compareVersions({size:42},{size:43}),{updated:true,verified:true});
  assert.deepEqual(compareVersions({},{etag:'newly-exposed',size:42}),{updated:false,verified:false});
  assert.deepEqual(compareVersions({size:42},{size:42}),{updated:false,verified:false});
  assert.deepEqual(fileVersion({size:null,modified:'invalid'}),{etag:null,modified:null,size:null});
});
test('only completed checks publish version baselines and deduplicated reports; downloaded versions remain intact',()=>{
  const s=state({a:{seen:100,browserDownload:{headers:{etag:'v1',size:'42'},path:'/saved/a.pdf'}}});
  discoverFile(s,'a');observeFile(s,'a',{etag:'v2',size:42});observeFile(s,'a',{etag:'v2',size:42});
  assert.equal(s.files.a.observedHeaders.etag,'v1');assert.equal(s.fileChanges,undefined);
  const restored=JSON.parse(JSON.stringify(s));restored.warnings.push('a page failed');unverifiedFile(restored,'missing');completeChanges(restored,201);
  assert.deepEqual(restored.fileChanges.updated,['a']);assert.equal(restored.fileChanges.partial,true);
  assert.deepEqual(restored.fileChanges.unverified,['missing']);assert.equal(restored.files.a.observedHeaders.etag,'v2');
  assert.equal(restored.files.a.browserDownload.headers.etag,'v1');assert.equal(restored.files.a.browserDownload.path,'/saved/a.pdf');
  restored.lastRun=200;restored.lastSync=201;restored.job={started:300};restored.warnings=[];
  discoverFile(restored,'a');observeFile(restored,'a',{etag:'v2',size:42});completeChanges(restored,301);
  assert.deepEqual(restored.fileChanges.updated,[]);assert.deepEqual(restored.fileChanges.added,[]);
});
test('new files cannot be counted as updates and unavailable metadata does not erase the previous baseline',()=>{
  const s=state({a:{seen:100,observedHeaders:{etag:'v1'}}});discoverFile(s,'a');unverifiedFile(s,'a');
  s.files.b={firstSeen:discoverFile(s,'b')};observeFile(s,'b',{etag:'v1'});observeFile(s,'b',{etag:'v2'});completeChanges(s,201);
  assert.deepEqual(s.fileChanges.added,['b']);assert.deepEqual(s.fileChanges.updated,[]);assert.deepEqual(s.fileChanges.unverified,['a']);assert.equal(s.files.a.observedHeaders.etag,'v1');
  s.lastRun=200;s.lastSync=201;s.job={started:300};
  discoverFile(s,'a');observeFile(s,'a',{});completeChanges(s,301);
  assert.equal(s.files.a.observedHeaders.etag,'v1');assert.deepEqual(s.fileChanges.unverified,['a']);
  s.lastRun=300;s.job={started:400};discoverFile(s,'a');observeFile(s,'a',{etag:'v2'});completeChanges(s,401);
  assert.deepEqual(s.fileChanges.updated,['a']);
});
