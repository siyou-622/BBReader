import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {updateSource} from '../desktop/updates.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [kind,value,page]=process.argv.slice(2);
let source;
if(kind==='--github'){
  const parts=(value||'').replace(/^https:\/\/github.com\//,'').replace(/\/$/,'').split('/');
  if(parts.length!==2)throw Error('用法：node scripts/configure-updates.mjs --github owner/repo');
  source=updateSource({provider:'github',owner:parts[0],repo:parts[1]});
}else if(kind==='--url')source=updateSource({provider:'generic',url:value,releasePage:page});
else if(kind==='--disable')source=null;
else throw Error('用法：--github owner/repo，或 --url https://server/updates/ [HTTPS 下载页]，或 --disable');
const filename=path.join(root,'package.json'),pkg=JSON.parse(await fs.readFile(filename,'utf8'));
if(source){const {releasePage,...publish}=source;pkg.build.publish={...publish,...(source.provider==='github'?{releaseType:'release'}:{})};}
else pkg.build.publish=null;
await fs.writeFile(filename,JSON.stringify(pkg,null,2)+'\n');
await fs.writeFile(path.join(root,'desktop/update-source.json'),JSON.stringify(source||{provider:null},null,2)+'\n');
console.log('更新源已配置；重新打包后生效。此命令不会上传或发布任何文件。');
