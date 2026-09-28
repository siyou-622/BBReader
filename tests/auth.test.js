import test from 'node:test';
import assert from 'node:assert/strict';
import {casForm,SSO,renewLogin} from '../extension/auth.js';

test('credentials only enter the exact CAS POST form for Blackboard',()=>{
  let submitted=0;const fields={username:{dispatchEvent(){},value:''},password:{dispatchEvent(){},value:''}};
  const form={method:'post',getAttribute:()=> 'login',querySelector:q=>q.includes('username')?fields.username:fields.password,requestSubmit(){submitted++;}};
  globalThis.document={querySelector:q=>q==='form#fm1'?form:null};
  globalThis.location={href:'https://cas.sustech.edu.cn/cas/login?service='+encodeURIComponent(SSO)};
  assert.equal(casForm(null),'ready');assert.equal(submitted,0);
  assert.equal(casForm({username:'fixture',password:'fake-test-password'}),'submitted');assert.equal(submitted,1);
  assert.equal(fields.username.value,'fixture');assert.equal(fields.password.value,'fake-test-password');
  form.getAttribute=()=> 'https://example.com/steal';assert.equal(casForm({}),'manual');
  location.href='https://cas.sustech.edu.cn/cas/login?service=https://example.com';assert.equal(casForm({}),'wrong-page');
  location.href='https://example.com/cas/login';assert.equal(casForm({}),'wrong-page');assert.equal(submitted,1);
  location.href='https://cas.sustech.edu.cn/cas/login?service='+encodeURIComponent(SSO);
  document.body={innerText:'Invalid credentials.'};assert.equal(casForm({}),'rejected');assert.equal(submitted,1);
});

test('missing CAS permission never reads credentials and closes only its own background tab',async()=>{
  let state={credentialLogin:true},reads=0,removed=[];
  globalThis.chrome={permissions:{contains:async()=>false},tabs:{create:async()=>({id:42}),get:async()=>({status:'complete'}),remove:async id=>removed.push(id)}};
  await assert.rejects(renewLogin({get:async()=>state,put:async s=>state=s,native:async()=>{reads++;}}),/需要在学校/);
  assert.equal(reads,0);assert.deepEqual(removed,[42]);assert.match(state.authStatus,/需要在学校/);
});

test('daily password limit and failure pause do not retrieve a password',async()=>{
  const {campusDay}=await import('../extension/core.js');
  for(const policy of [{lastCredentialDay:campusDay()},{authBlocked:true}]) {
    let state={credentialLogin:true,...policy},reads=0;
    globalThis.chrome={permissions:{contains:async()=>true},tabs:{create:async()=>({id:42}),get:async()=>({status:'complete',url:'https://cas.sustech.edu.cn/cas/login'}),remove:async()=>{}}};
    await assert.rejects(renewLogin({get:async()=>state,put:async s=>state=s,native:async()=>{reads++;}}));
    assert.equal(reads,0);
  }
});

test('a working SSO browser session succeeds without retrieving credentials',async()=>{
  let state={},reads=0,closed=false;
  globalThis.chrome={permissions:{contains:async()=>false},tabs:{create:async()=>({id:42}),get:async()=>({status:'complete',url:'https://bb.sustech.edu.cn/webapps/portal/execute/tabs/tabAction'}),remove:async()=>{closed=true;}},scripting:{executeScript:async()=>[{result:true}]}};
  await renewLogin({get:async()=>state,put:async s=>state=s,native:async()=>{reads++;}});
  assert.equal(reads,0);assert.equal(closed,true);assert.equal(state.authStatus,'统一认证连接正常');
});

test('explicit credential check renews authentication once and clears the pause only after successful password login',async()=>{
  let state={credentialLogin:true,authBlocked:true},createdURL,reads=0,scripts=0,polls=0;
  globalThis.chrome={permissions:{contains:async()=>true},tabs:{create:async o=>{createdURL=o.url;return{id:42};},get:async()=>({status:'complete',url:polls++===0?'https://cas.sustech.edu.cn/cas/login':'https://bb.sustech.edu.cn/webapps/portal/execute/tabs/tabAction'}),remove:async()=>{}},scripting:{executeScript:async()=>[{result:['ready','submitted',true][scripts++]}]}};
  await renewLogin({manual:true,get:async()=>state,put:async s=>state=s,native:async()=>{reads++;return{configured:true,username:'fixture',password:'not-a-real-password'};}});
  assert.equal(new URL(createdURL).searchParams.get('renew'),'true');assert.equal(reads,1);assert.equal(state.authBlocked,false);assert.match(state.authStatus,/已使用保存的凭据/);
});

test('browser mode never reads legacy saved credentials',async()=>{
  let state={integrationMode:'browser',credentialLogin:true},reads=0;
  globalThis.chrome={permissions:{contains:async()=>true},tabs:{create:async()=>({id:42}),get:async()=>({status:'complete',url:'https://cas.sustech.edu.cn/cas/login'}),remove:async()=>{}}};
  await assert.rejects(renewLogin({manual:true,get:async()=>state,put:async s=>state=s,native:async()=>{reads++;}}),/需要在学校/);
  assert.equal(reads,0);
});

test('browser mode fills CAS from the encrypted browser vault, not the macOS helper',async()=>{
  let state={integrationMode:'browser',browserCredentialLogin:true},nativeReads=0,vaultReads=0,scripts=0,polls=0,filled;
  globalThis.chrome={permissions:{contains:async()=>true},tabs:{create:async()=>({id:42}),get:async()=>({status:'complete',url:polls++===0?'https://cas.sustech.edu.cn/cas/login':'https://bb.sustech.edu.cn/webapps/portal/execute/tabs/tabAction'}),remove:async()=>{}},
    scripting:{executeScript:async({args})=>{if(args?.[0])filled={...args[0]};return [{result:['ready','submitted',true][scripts++]}];}}};
  await renewLogin({manual:true,get:async()=>state,put:async s=>state=s,native:async()=>{nativeReads++;},readCredentials:async()=>{vaultReads++;return {configured:true,username:'fixture',password:'vault-password'};}});
  assert.equal(nativeReads,0);assert.equal(vaultReads,1);assert.deepEqual(filled,{username:'fixture',password:'vault-password'});assert.match(state.authStatus,/已使用保存的凭据/);
});
