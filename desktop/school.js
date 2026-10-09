export function schoolTab(window,load){
  if(load?.error)throw Error(load.error);
  const url=window.webContents.getURL()||load?.url;
  return {id:window.webContents.id,url,status:load?.pending||window.webContents.isLoading()||!window.webContents.getURL()?'loading':'complete'};
}
export function schoolFailure(code){
  if(code===-3)return null; // Superseded navigation is normal during school redirects.
  if([-130,-131,-111].includes(code))return '无法连接当前代理，请检查代理软件后重试学校登录';
  if([-105,-106,-109,-118].includes(code))return '学校页面无法连接，请检查校园网络、VPN或网络连接后重试';
  if(code<=-200&&code>=-299)return '学校页面的安全证书验证失败，请检查电脑时间或联系学校支持';
  return `学校页面加载失败（${code}），请重试或在浏览器中检查学校网站`;
}
