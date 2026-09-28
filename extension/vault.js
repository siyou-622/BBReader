// Browser-mode credential store: a compensation for platforms without the macOS Keychain helper.
// The campus SID/password are AES-GCM encrypted; the ciphertext lives in chrome.storage.local and the
// AES key is a non-extractable CryptoKey kept in this extension's IndexedDB. Scripts cannot export the
// key, and the password is never written in plain text. This is weaker than the system Keychain: someone
// with access to this Chrome profile's files could still recover it. Removing the extension deletes both.
const DB='bbreader-vault',STORE='keys',KEY_ID='credential-key',RECORD='vault';
function database(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
async function keyStore(mode,change){
  const db=await database();
  try{
    return await new Promise((resolve,reject)=>{
      const store=db.transaction(STORE,mode).objectStore(STORE);
      const request=change===undefined?store.get(KEY_ID):change===null?store.delete(KEY_ID):store.put(change,KEY_ID);
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
  }finally{db.close();}
}
async function vaultKey(create){
  let key=await keyStore('readonly');
  if(!key&&create){key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await keyStore('readwrite',key);}
  return key;
}
const toBase64=bytes=>btoa(String.fromCharCode(...bytes));
const fromBase64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
export function validCredentials(username,password){
  return typeof username==='string'&&typeof password==='string'&&username.trim()&&password&&username.length<=128&&password.length<=1024&&!/[\r\n]/.test(username);
}
export async function saveVault({username,password}){
  if(!validCredentials(username,password))throw new Error('账号或密码格式不正确');
  const key=await vaultKey(true),iv=crypto.getRandomValues(new Uint8Array(12));
  const data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify({username:username.trim(),password}))));
  await chrome.storage.local.set({[RECORD]:{version:1,iv:toBase64(iv),data:toBase64(data),savedAt:Date.now()}});
}
export async function readVault(){
  const record=(await chrome.storage.local.get(RECORD))[RECORD];
  if(!record)return {configured:false};
  const key=await vaultKey(false);
  if(!key)throw new Error('本机加密密钥已丢失，请在设置中重新保存账号');
  let plain;
  try{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(record.iv)},key,fromBase64(record.data));}
  catch{throw new Error('无法解密保存的账号，请在设置中重新保存');}
  const {username,password}=JSON.parse(new TextDecoder().decode(plain));
  return {configured:true,username,password};
}
export async function deleteVault(){
  await chrome.storage.local.remove(RECORD);
  await keyStore('readwrite',null).catch(()=>{});
}
