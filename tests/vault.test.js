import test from 'node:test';
import assert from 'node:assert/strict';
import {installFakeIndexedDB} from './fake-idb.js';
const databases=installFakeIndexedDB(),store={};
globalThis.chrome={storage:{local:{async get(k){return {[k]:structuredClone(store[k])};},async set(d){Object.assign(store,structuredClone(d));},async remove(k){delete store[k];}}}};
const {saveVault,readVault,deleteVault}=await import('../extension/vault.js');

test('browser vault encrypts credentials with a non-extractable key and round-trips them',async()=>{
  assert.deepEqual(await readVault(),{configured:false});
  await saveVault({username:' 12345678 ',password:'fixture-password-不是真的'});
  const raw=JSON.stringify(store.vault);
  assert.doesNotMatch(raw,/fixture-password|12345678/,'no plain text in extension storage');
  const key=databases.get('bbreader-vault').stores.get('keys').get('credential-key');
  assert.equal(key.extractable,false);assert.deepEqual(key.usages.sort(),['decrypt','encrypt']);
  await assert.rejects(crypto.subtle.exportKey('raw',key));
  assert.deepEqual(await readVault(),{configured:true,username:'12345678',password:'fixture-password-不是真的'});
  const first=store.vault.iv;await saveVault({username:'12345678',password:'fixture-password-不是真的'});
  assert.notEqual(store.vault.iv,first,'fresh IV per save');
});

test('tampered or orphaned vault data fails closed and deletion removes key and ciphertext',async()=>{
  await saveVault({username:'sid',password:'pw'});
  const good=structuredClone(store.vault),bytes=Uint8Array.from(atob(good.data),c=>c.charCodeAt(0));bytes[0]^=1;
  store.vault={...good,data:btoa(String.fromCharCode(...bytes))};
  await assert.rejects(readVault(),/无法解密/);
  store.vault=good;await deleteVault();
  assert.equal(store.vault,undefined);assert.equal(databases.get('bbreader-vault').stores.get('keys').size,0);
  store.vault=good;await assert.rejects(readVault(),/密钥已丢失/);delete store.vault;
  await assert.rejects(saveVault({username:'a\nb',password:'x'}),/格式不正确/);
  await assert.rejects(saveVault({username:'sid',password:''}),/格式不正确/);
});
