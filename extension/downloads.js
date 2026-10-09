import {readURL} from './core.js';

// Use stable index keys, never renderer-supplied URLs or paths.
export function createDownloadBatch(state,{courseId,keys,all=false}) {
  const course=state.courses.find(c=>c.id===courseId&&c.enabled);
  if(!course)throw new Error('请选择已启用的课程');
  const available=Object.values(state.files).filter(f=>f.courseId===courseId);
  if(!all&&(!Array.isArray(keys)||!keys.length))throw new Error('请先勾选课件');
  const chosen=all?available.map(f=>f.key):[...new Set(keys)];
  if(!chosen.length)throw new Error('该课程暂无可下载课件');
  for(const key of chosen){const f=state.files[key];if(!f||f.courseId!==courseId)throw new Error('课件不属于当前课程');readURL(f.url);}
  return {id:crypto.randomUUID(),courseId,courseName:course.name,keys:chosen,results:{},status:'running',started:Date.now()};
}
export function finishBatchFile(state,key,status,error=null) {
  const batch=state.downloadBatch;
  if(batch?.status==='running'&&batch.keys.includes(key))batch.results[key]={status,error,finished:Date.now()};
}
export function fileMetadata(file) {
  const name=file.archiveName||file.name||'';
  const ext=name.match(/\.([a-z0-9]{1,12})$/i)?.[1]?.toUpperCase();
  const mime=file.metadata?.type?.split(';')[0];
  const size=file.metadata?.size;
  return {type:ext||mime||'类型未知',size:size!==null&&size!==undefined&&size!==''&&Number.isFinite(Number(size))&&Number(size)>=0?Number(size):null};
}
export function formatSize(size) {
  if(size===null)return '大小未知';
  if(size<1024)return `${size} B`;
  return size<1024*1024?`${(size/1024).toFixed(1)} KB`:`${(size/1024/1024).toFixed(1)} MB`;
}
