import {parseEnrollments} from './courses.js';
import { bbURL, parseDue, ORIGIN } from './core.js';
const text = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
const links = e => [...(e?.querySelectorAll('a[href]') || [])];
// Only explicitly labelled upload dates. A due date, generic <time>, or HTTP
// Last-Modified is not proof of when a teacher uploaded an attachment.
function uploadedTime(attachment,item){
  const valid=value=>value&&/20\d{2}/.test(value)?value.replace(/\s+/g,' ').trim().slice(0,150):null;
  const explicit=attachment.getAttribute('data-uploaded-at')||item?.getAttribute('data-uploaded-at');
  if(valid(explicit))return valid(explicit);
  for(const element of item?.querySelectorAll('.uploadDate,.uploadedDate,.upload-date,[data-uploaded-at],time,p,span,td,dd,.detailsLabel,.detailsValue')||[]){
    const attribute=element.getAttribute('data-uploaded-at');
    if(valid(attribute))return valid(attribute);
    const raw=text(element),label=element.getAttribute('aria-label')||element.getAttribute('data-label')||'';
    const match=raw.match(/(?:上传时间|上传日期|Uploaded(?:\s+(?:on|at|date))?|Upload Date)\s*[:：]?\s*(.{1,150})/i);
    const semantic=element.matches('.uploadDate,.uploadedDate,.upload-date')||/上传|\bupload(?:ed)?\b/i.test(label);
    const value=match?.[1]||(semantic?(element.getAttribute('datetime')||raw):null);
    if(valid(value))return valid(value);
  }
  return null;
}
export function parseHTML(html, url, kind) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!bbURL(url) || /\/webapps\/login|\/cas\/login/.test(url) || doc.querySelector('#loginForm,#fm1,input[type=password]')) throw new Error('需要重新登录 Blackboard');
  if(kind==='enrollments')return parseEnrollments(doc);
  if(kind==='identity'){
    const ids=[...new Set([...doc.querySelectorAll('a[href]')].flatMap(a=>{
      const u=bbURL(a.getAttribute('href'),url),id=u?.searchParams.get('id');
      return u?.pathname==='/webapps/blackboard/execute/launcher'&&u.searchParams.get('type')==='PersonalInfo'&&/^_\d+_\d+$/.test(id)?[id]:[];
    }))];
    if(ids.length!==1)throw new Error('无法确认 Blackboard 账户标识，已保留旧数据');
    return {userId:ids[0]};
  }
  doc.querySelectorAll('script,style,textarea,input').forEach(e => e.remove());
  const main = doc.querySelector('#content') || doc.body;
  const href = a => bbURL(a.getAttribute('href'), url)?.href;
  const context=bbURL(url);
  // Some launchers serve the menu directly instead of redirecting to courseMain.
  const courseId = context?.searchParams.get('course_id') || (kind==='course'&&context?.pathname==='/webapps/blackboard/execute/launcher'&&context.searchParams.get('type')==='Course'&&/^_\d+_\d+$/.test(context.searchParams.get('id')||'')?context.searchParams.get('id'):null);
  if (kind === 'detail') {
    const raw = text(main);
    const dueRaw = raw.match(/(?:Due Date|截止日期|到期日期|截止时间)\s*(.{0,130}?)(?=Points Possible|可能得分|满分|Assignment Submission|作业提交|$)/i)?.[1] || '';
    const due = parseDue(dueRaw);
    const submitted = /Submission Date|提交日期/.test(raw) && !/Draft|草稿/i.test(raw);
    const info = main.querySelector('#assignmentInfo') || main.querySelector('.field');
    return { due, dueRaw: dueRaw.slice(0,150), status: submitted ? 'submitted' : 'unknown', description: text(info).slice(0,2500) };
  }
  if (kind === 'grades') {
    return [...doc.querySelectorAll('#grades_wrapper > *, .gradeRow')].map(row => {
      const title = text(row.querySelector('.gradable > span[id],.gradable > a,.name,.itemName'));
      const activity = text(row.querySelector('.activity,.lastActivity'))+' '+[...row.querySelectorAll('.gradeStatus img[alt]')].map(e=>e.alt).join(' ');
      return { title, status: row.classList.contains('graded_item_row') || /Graded|已评分|已评阅/i.test(activity) ? 'graded' : row.classList.contains('submitted_item_row') || /Submitted|已提交|Needs Grading|需要评分/i.test(activity) ? 'submitted' : 'unknown' };
    }).filter(x => x.title);
  }
  const menu = doc.querySelector('#courseMenuPalette_contents');
  const currentContent = bbURL(url)?.searchParams.get('content_id');
  const pages = [...new Map(links(kind === 'course' ? (menu || main) : main).flatMap(a => {
    const u = bbURL(href(a));
    if (!u || !/\/listContent(?:Editable)?\.jsp$/.test(u.pathname) || u.searchParams.get('course_id') !== courseId) return [];
    const id=u.searchParams.get('content_id');
    if(!id || id===currentContent)return [];
    u.hash='';u.search=new URLSearchParams({course_id:courseId,content_id:id,mode:'reset'});
    return [[id,{ url: u.href, id, title: text(a) || text(a.closest('[id^="contentListItem:"]')?.querySelector('h3')) || '课程内容' }]];
  })).values()];
  let files = links(main).flatMap(a => {
    const u = bbURL(href(a)); if (!u?.pathname.startsWith('/bbcswebdav/')) return [];
    const item = a.closest('[id^="contentListItem:"]');
    const uploaded=uploadedTime(a,item);
    return [{ url: u.href, id: u.pathname.match(/(?:rid-|xid-)([\d_]+)/)?.[1] || u.pathname,
      name: text(a), item: text(item?.querySelector('h3')), contentId: item?.id.split(':')[1] || '',...(uploaded?{uploadedTime:uploaded}:{}) }];
  });
  files=[...new Map(files.map(f=>[`${f.contentId}:${f.id}`,f])).values()];
  const itemFiles=new Map();
  for(const f of files)if(f.contentId)itemFiles.set(f.contentId,(itemFiles.get(f.contentId)||0)+1);
  files=files.map(f=>({...f,itemFolder:f.contentId&&itemFiles.get(f.contentId)>1?(f.item||`内容 ${f.contentId}`):null}));
  const assignments = links(main).flatMap(a => {
    const u = bbURL(href(a)); if (u?.pathname !== '/webapps/assignment/uploadAssignment') return [];
    if (u.searchParams.get('course_id') !== courseId) return [];
    return [{ id: u.searchParams.get('content_id'), title: text(a), url: u.href, status: 'unknown', due: null }];
  });
  const notes = [...main.querySelectorAll('[id^="contentListItem:"]')].map(e => ({
    title: text(e.querySelector('h3')), body: text(e.querySelector('.vtbegenerated')), id: e.id.split(':')[1],
    links: links(e).map(a => ({ title: text(a), url: href(a) || (/^https?:/.test(a.getAttribute('href')) ? a.getAttribute('href') : null) })).filter(a => a.url)
  })).filter(x => x.body || x.links.length);
  const gradesLink = links(menu).map(href).find(x => x && /tool_id=_156_1/.test(x));
  return { pages, files, assignments, notes, gradesLink, courseId, valid: !!(menu || doc.querySelector('#content_listContainer')) };
}
