import test from 'node:test';
import assert from 'node:assert/strict';
import {courseSettingsURL,selectCurrentCourses} from '../extension/courses.js';
const terms=[
  {id:'fall',name:'2026秋（Fall 2026）',duration:'从 2026年7月10日 至 2027年3月1日'},
  {id:'spring',name:'2026春（Spring 2026）',duration:'从 2026年1月7日 至 2026年7月15日'},
  {id:'na',name:'无规定学期（N/A）',duration:'连续'}];
const courses=[
  {id:'hidden',code:'CS100-2026FA',name:'Hidden course',shown:false},
  {id:'old',code:'CS100-2026SP',name:'Old course',shown:true},
  {id:'group',code:'CS-202605',name:'Example 2026 Fall Group Project'},
  {id:'chinese',code:'nonstandard',name:'课程（2026秋）'},
  {id:'site',code:'CS-2020',name:'示例院系常设站点'},
  {id:'future',code:'CS100-2027SP',name:'Future course'}];
test('current semester uses school dates, includes hidden memberships, excludes old and undated sites',()=>{
  const found=selectCurrentCourses({terms,courses},Date.parse('2026-09-26T09:00:00+08:00'));
  assert.equal(found.term.id,'fall');assert.deepEqual(found.courses.map(c=>c.id),['hidden','group','chinese']);
  assert.ok(found.courses.every(c=>c.term==='2026秋（Fall 2026）'));
});
test('overlapping terms select newest start, campus date handles boundary and gaps fail safely',()=>{
  assert.equal(selectCurrentCourses({terms,courses},Date.parse('2026-07-09T15:59:59Z')).term.id,'spring');
  assert.equal(selectCurrentCourses({terms,courses},Date.parse('2026-07-09T16:00:00Z')).term.id,'fall');
  assert.throws(()=>selectCurrentCourses({terms,courses},Date.parse('2028-09-01')),/保留上次/);
  assert.throws(()=>selectCurrentCourses({terms:[],courses},Date.now()),/保留上次/);
});
test('enrollment entry is read-only and restricted to the observed module editor',()=>{
  const url='https://bb.sustech.edu.cn/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=_1_1&forwardUrl=edit_module%2F_3_1%2Fbbcourseorg%3Fcmd%3Dedit';
  assert.equal(courseSettingsURL(url),url);
  for(const invalid of [url.replace('cmd%3Dedit','cmd%3Dsave'),url+'&action=delete',url.replace('bb.sustech.edu.cn','evil.test')])assert.throws(()=>courseSettingsURL(invalid));
});
