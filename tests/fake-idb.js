// Minimal in-memory IndexedDB for the vault tests (Node has no IndexedDB).
export function installFakeIndexedDB(){
  const databases=new Map();
  const request=fn=>{const r={};queueMicrotask(()=>{try{r.result=fn();r.onsuccess?.();}catch(e){r.error=e;r.onerror?.();}});return r;};
  globalThis.indexedDB={open(name){
    const r={};
    queueMicrotask(()=>{
      let db=databases.get(name);const fresh=!db;
      if(fresh){db={stores:new Map(),createObjectStore(n){this.stores.set(n,new Map());},close(){},
        transaction(n){const m=this.stores.get(n);return {objectStore:()=>({get:k=>request(()=>m.get(k)),put:(v,k)=>request(()=>{m.set(k,v);return k;}),delete:k=>request(()=>{m.delete(k);})})};}};databases.set(name,db);}
      r.result=db;if(fresh)r.onupgradeneeded?.();r.onsuccess?.();
    });
    return r;
  }};
  return databases;
}
