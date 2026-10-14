import test from 'node:test';
import assert from 'node:assert/strict';
import {scanProgress} from '../extension/scan-progress.js';
test('discovered pages cannot move progress backwards and fixed phases advance monotonically',()=>{
  const steps=[{phase:'pages',done:1,pages:1,queue:[1]},{phase:'pages',done:2,pages:2,queue:Array(100).fill(1)},...Array.from({length:5},(_,fileDone)=>({phase:'files',fileTotal:4,fileDone})),...Array.from({length:3},(_,gradeDone)=>({phase:'grades',gradeTotal:2,gradeDone})),{phase:'calendar'},null];
  const values=steps.map(s=>scanProgress(s).value);assert.deepEqual(values,[10,10,35,46.25,57.5,68.75,80,80,87.5,95,98,100]);
  for(let i=1;i<values.length;i++)assert.ok(values[i]>=values[i-1]);
  assert.match(scanProgress(steps[1]).label,/已读取 2 页/);assert.match(scanProgress(steps[3]).label,/1\/4/);
});
