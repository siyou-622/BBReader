import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

export async function nativeMessage({host,message},home,origin){
  if(process.platform!=='darwin')throw Error('系统集成仅支持 macOS');
  const bundle=host==='cn.sustech.bbreader'?'BBReader Helper.app':host==='cn.sustech.bbreader.picker'?'BBReader Folder Picker.app':null;
  if(!bundle)throw Error('未知本地助手');
  const directory=path.join(home,'Library/Application Support/BBReader',bundle,'Contents/MacOS');
  const savedOrigin=(await readFile(path.join(directory,'extension-origin.txt'),'utf8').catch(()=>{throw Error('请先安装原 macOS 本地助手');})).trim();
  if(savedOrigin!==origin)throw Error('本地助手标识不匹配，请重新安装本仓库助手');
  const binary=path.join(directory,host.endsWith('.picker')?'bbreader-picker':'bbreader-host');
  const body=Buffer.from(JSON.stringify(message));if(body.length>1024*1024)throw Error('消息过大');
  const header=Buffer.alloc(4);header.writeUInt32LE(body.length);
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,[origin],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let output=Buffer.alloc(0),finished=false;
    const timer=setTimeout(()=>done(Error('本地助手响应超时')),120000);
    function done(error,value){if(finished)return;finished=true;clearTimeout(timer);child.kill();error?reject(error):resolve(value);}
    child.on('error',e=>done(e));child.on('exit',()=>{if(!finished)done(Error('本地助手未返回完整消息'));});
    child.stdin.on('error',e=>done(e));child.stderr.resume();
    child.stdout.on('data',chunk=>{
      output=Buffer.concat([output,chunk]);if(output.length<4)return;
      const length=output.readUInt32LE(0);if(length>1024*1024)return done(Error('本地助手响应过大'));
      if(output.length>=length+4){try{done(null,JSON.parse(output.subarray(4,length+4).toString()));}catch(e){done(e);}}
    });
    child.stdin.end(Buffer.concat([header,body]));
  });
}
