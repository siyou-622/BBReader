// Directory discovery has no known total. Percentages apply only to fixed phases.
export function scanProgress(job){
  if(!job)return {value:100,label:'检查完成'};
  if(job.phase==='files')return {value:35+45*(job.fileDone||0)/Math.max(1,job.fileTotal||0),label:`核对课件 ${job.fileDone||0}/${job.fileTotal||0}`};
  if(job.phase==='grades')return {value:80+15*(job.gradeDone||0)/Math.max(1,job.gradeTotal||0),label:`核对作业状态 ${job.gradeDone||0}/${job.gradeTotal||0}`};
  if(job.phase==='calendar')return {value:98,label:'补充日历并保存检查结果'};
  return {value:10,label:`读取课程目录 · 已读取 ${job.pages||0} 页，正在发现内容`};
}
