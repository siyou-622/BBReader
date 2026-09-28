import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('credential form validates input, locks concurrent actions, clears passwords, and recovers after errors',async()=>{
  const elements=Object.fromEntries(['authForm','casUsername','casPassword','saveCredentials','testLogin','openLogin','deleteCredentials'].map(id=>[id,{value:'',textContent:id,disabled:false,attributes:{},addEventListener(type,fn){this[type]=fn;},setAttribute(k,v){this.attributes[k]=v;},reportValidity(){return true;}}]));
  let finish,calls=0,message='';
  const context=vm.createContext({authBusy:false,demo:false,state:{authStatus:'Connected'},CAS_PERMISSION:'https://cas.sustech.edu.cn/*',$:id=>elements[id],chrome:{permissions:{request:async()=>true}},api:async()=>{calls++;await new Promise(resolve=>finish=resolve);},refresh:async()=>{},note:text=>message=text,run:async fn=>{try{await fn();}catch(e){message=e.message;}}});
  const source=readFileSync(new URL('../extension/ui.js',import.meta.url),'utf8');
  vm.runInContext(source.slice(source.indexOf('function updateAuthControls()'),source.indexOf("$('feed').onclick")),context);
  assert.equal(elements.saveCredentials.disabled,true);
  elements.casUsername.value='test-sid';elements.casUsername.input();
  assert.equal(elements.saveCredentials.disabled,true);
  elements.casPassword.value='test-only';elements.casPassword.input();
  assert.equal(elements.saveCredentials.disabled,false);
  const pending=elements.authForm.onsubmit({preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.authForm.attributes['aria-busy'],'true');
  for(const id of ['casUsername','casPassword','saveCredentials','testLogin','openLogin','deleteCredentials'])assert.equal(elements[id].disabled,true,id);
  await elements.testLogin.onclick();assert.equal(calls,1);
  finish();await pending;
  assert.equal(elements.casPassword.value,'');assert.equal(elements.saveCredentials.disabled,true);
  assert.equal(elements.testLogin.disabled,false);assert.equal(elements.authForm.attributes['aria-busy'],'false');
  context.api=async()=>{throw Error('Connection failed');};
  elements.casPassword.value='test-only';elements.casPassword.input();
  await elements.authForm.onsubmit({preventDefault(){}});
  assert.equal(message,'Connection failed');assert.equal(elements.casPassword.value,'');assert.equal(elements.casUsername.disabled,false);
});
