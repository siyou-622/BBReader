import path from 'node:path';
import {createHash} from 'node:crypto';
import {readURL} from '../extension/core.js';
import {courseSettingsURL} from '../extension/courses.js';
export const APP_ORIGIN='bbreader://app';
export const SCHOOL_ORIGINS=new Set(['https://bb.sustech.edu.cn','https://cas.sustech.edu.cn']);
export function schoolURL(value){const url=new URL(value);if(!SCHOOL_ORIGINS.has(url.origin)||url.username||url.password)throw Error('仅允许学校 HTTPS 页面');return url.href;}
export function appPage(value){try{const u=new URL(value);return u.origin===APP_ORIGIN||u.protocol==='bbreader:'&&u.host==='app';}catch{return false;}}
export function downloadPath(root,filename){
  if(typeof filename!=='string'||!/^BBReader(?:-staging)?\//.test(filename)||filename.includes('\\')||filename.split('/').some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\x00-\x1f]/.test(p)))throw Error('下载路径无效');
  const target=path.resolve(root,...filename.split('/'));
  if(!target.startsWith(path.resolve(root)+path.sep))throw Error('下载路径越界');return target;
}
export function extensionOrigin(key){const hex=createHash('sha256').update(Buffer.from(key,'base64')).digest('hex').slice(0,32);return `chrome-extension://${[...hex].map(c=>String.fromCharCode(97+parseInt(c,16))).join('')}/`;}
export function attachmentURL(value){const url=readURL(value);if(!new URL(url).pathname.startsWith('/bbcswebdav/'))throw Error('仅允许课件附件下载');return url;}
export function requestURL(value){try{return readURL(value);}catch(error){try{return courseSettingsURL(value);}catch{throw error;}}}
