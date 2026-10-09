import fs from 'node:fs/promises';
import path from 'node:path';
export async function writeState(filename,json,{io=fs,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  await io.mkdir(path.dirname(filename),{recursive:true});
  await io.writeFile(filename+'.tmp',json,{mode:0o600});
  // Windows readers or antivirus may briefly lock the destination. Keep the old
  // valid index intact and retry the atomic replacement instead of deleting it.
  for(let attempt=0;;attempt++){
    try{await io.rename(filename+'.tmp',filename);return;}
    catch(error){if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=9)throw error;await pause(100);}
  }
}
