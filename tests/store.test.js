import test from 'node:test';
import assert from 'node:assert/strict';
import {writeState} from '../desktop/store.js';
test('temporary Windows locks retry atomic index replacement without deleting the previous index',async()=>{
  let attempts=0,writes=0,pauses=0;const renames=[];
  const io={mkdir:async()=>{},writeFile:async(_file,value)=>{writes++;assert.equal(value,'valid index');},rename:async(...args)=>{renames.push(args);if(++attempts<3)throw Object.assign(Error('locked'),{code:'EPERM'});}};
  await writeState('/profile/state.json','valid index',{io,pause:async()=>{pauses++;}});
  assert.equal(writes,1);assert.equal(attempts,3);assert.equal(pauses,2);assert.deepEqual(renames[2],['/profile/state.json.tmp','/profile/state.json']);
});
test('permanent storage failures remain visible rather than discarding the old index',async()=>{
  let attempts=0;const io={mkdir:async()=>{},writeFile:async()=>{},rename:async()=>{attempts++;throw Object.assign(Error('locked'),{code:'EACCES'});}};
  await assert.rejects(writeState('/profile/state.json','index',{io,pause:async()=>{}}),/locked/);assert.equal(attempts,10);
  attempts=0;io.rename=async()=>{attempts++;throw Object.assign(Error('disk failure'),{code:'EIO'});};
  await assert.rejects(writeState('/profile/state.json','index',{io,pause:async()=>{}}),/disk failure/);assert.equal(attempts,1);
});
