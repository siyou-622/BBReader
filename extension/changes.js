// Version observations are independent of download headers and saved paths.
export function fileVersion(headers={}){
  const size=headers?.size;
  const modified=Date.parse(headers?.modified||'');
  return {etag:typeof headers?.etag==='string'&&headers.etag.trim()||null,
    modified:Number.isFinite(modified)?new Date(modified).toISOString():null,
    size:size!==null&&size!==undefined&&size!==''&&Number.isFinite(Number(size))&&Number(size)>=0?Number(size):null};
}
export function compareVersions(previous,next){
  const before=fileVersion(previous),after=fileVersion(next);
  if(before.etag&&after.etag)return {updated:before.etag!==after.etag,verified:true};
  if(before.modified&&after.modified){
    return {updated:before.modified!==after.modified||(before.size!==null&&after.size!==null&&before.size!==after.size),verified:true};
  }
  const changedSize=before.size!==null&&after.size!==null&&before.size!==after.size;
  return {updated:changedSize,verified:changedSize};
}
const add=(list,key)=>{if(!list.includes(key))list.push(key);};
export function scanChanges(state){
  return state.job.changes||= {initial:!state.lastSync&&!state.lastRun,added:[],updated:[],unverified:[],observed:{}};
}
export function discoverFile(state,key){
  const old=state.files[key],scan=scanChanges(state);
  if(old){
    old.observedHeaders||=fileVersion(old.browserDownload?.headers||old.headers||old.metadata);
    old.firstSeen??=old.seen||state.lastRun||0;
  }
  if(!old||old.firstSeen>(state.lastRun||0))add(scan.added,key);
  return old?.firstSeen??state.job.started;
}
export function observeFile(state,key,headers){
  const scan=scanChanges(state),next=fileVersion(headers),before=state.files[key].observedHeaders;
  scan.observed[key]=next;
  const result=compareVersions(before,next);
  if(!scan.added.includes(key)&&result.updated)add(scan.updated,key);
  if(!result.verified&&!(scan.added.includes(key)&&(next.etag||next.modified)))add(scan.unverified,key);
}
export function unverifiedFile(state,key){add(scanChanges(state).unverified,key);}
export function completeChanges(state,checkedAt){
  const scan=scanChanges(state);
  for(const [key,version] of Object.entries(scan.observed))if(state.files[key]){
    // An intermittently missing header must not discard the last known version.
    state.files[key].observedHeaders={...state.files[key].observedHeaders,...Object.fromEntries(Object.entries(version).filter(([,value])=>value!==null))};
  }
  state.fileChanges={run:state.job.started,checkedAt,initial:scan.initial,added:scan.added,updated:scan.updated,unverified:scan.unverified,partial:state.warnings.length>0};
}
