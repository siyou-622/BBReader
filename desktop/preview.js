import path from 'node:path';

export const previewableFile=filename=>/\.(?:pdf|png|jpe?g|gif|webp|txt|docx?|pptx?|xlsx?|odt|odp|ods|rtf|csv|epub)$/i.test(filename);
export function applicationCommand(application,filename,platform){
  const paths=platform==='win32'?path.win32:path.posix;
  if(typeof application!=='string'||typeof filename!=='string'||!paths.isAbsolute(application)||!paths.isAbsolute(filename))throw Error('软件或课件位置无效');
  if(!previewableFile(filename))throw Error('此类型暂不支持预览，请打开所在文件夹查看');
  if(platform==='win32'&&!/\.exe$/i.test(application))throw Error('请选择 Windows 应用程序（.exe）');
  if(platform==='darwin'){
    if(!/\.app$/i.test(application))throw Error('请选择 macOS 应用程序（.app）');
    return {command:'/usr/bin/open',args:['-a',application,filename]};
  }
  return {command:application,args:[filename]};
}
