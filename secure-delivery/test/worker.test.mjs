import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign, createVerify } from 'node:crypto';
import { handleRequest } from '../worker.mjs';

const ORIGIN='https://delivery.example.org';
const now=Math.floor(Date.now()/1000);
const cf=generateKeyPairSync('rsa',{modulusLength:2048});
const app=generateKeyPairSync('rsa',{modulusLength:2048});
const key=cf.publicKey.export({format:'jwk'});
key.kid='local-test-key';
const html='<!doctype html><html><body><article id="note-article"><h3>題</h3><p><strong>内容</strong></p></article></body></html>';
const enc=new TextEncoder();
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
function jwt(payload) {
  const h=b64({alg:'RS256',kid:key.kid,typ:'JWT'});
  const p=b64(payload);
  const sig=createSign('RSA-SHA256').update(h+'.'+p).end().sign(cf.privateKey).toString('base64url');
  return h+'.'+p+'.'+sig;
}
const token=jwt({iss:'https://team.cloudflareaccess.com',aud:['audience-test'],email:'user@example.org',exp:now+600,iat:now-5});
const vars={
  DELIVERY_ORIGIN:ORIGIN,CF_ACCESS_TEAM_DOMAIN:'team.cloudflareaccess.com',CF_ACCESS_AUD:'audience-test',
  ALLOWED_EMAILS:'user@example.org',SOURCE_REPO:'owner/private-blog',
  GITHUB_APP_ID:'123',GITHUB_INSTALLATION_ID:'456',
  GITHUB_APP_PRIVATE_KEY_PKCS8:app.privateKey.export({type:'pkcs8',format:'pem'}),
  DELIVERY_RELEASES_JSON:JSON.stringify({'test-article':['a'.repeat(40)]}),
  ASSETS:{fetch:async()=>new Response('<!doctype html><html></html>',{headers:{'Content-Type':'text/html'}})}
};
function req(path,authenticated=true) {
  return new Request(ORIGIN+path,{headers:authenticated?{'Cf-Access-Jwt-Assertion':token}:{}});
}
function mockGitHub(expected,overrideHash=false) {
  return async (url,opt={})=>{
    if (url === 'https://team.cloudflareaccess.com/cdn-cgi/access/certs') {
      return Response.json({keys:[key]});
    }
    if (url.endsWith('/access_tokens')) {
      assert.equal(opt.method,'POST');
      assert.match(opt.headers.Authorization,/^Bearer /);
      const [head,payload,signature]=opt.headers.Authorization.slice(7).split('.');
      assert.equal(JSON.parse(Buffer.from(head,'base64url')).alg,'RS256');
      const claims=JSON.parse(Buffer.from(payload,'base64url'));
      assert.equal(claims.iss,'123');
      assert.ok(claims.exp-claims.iat<=600);
      assert.equal(createVerify('RSA-SHA256').update(head+'.'+payload).end().verify(app.publicKey,Buffer.from(signature,'base64url')),true);
      assert.deepEqual(JSON.parse(opt.body),{permissions:{contents:'read'},repositories:['private-blog']});
      return Response.json({token:'temporary-test-token'});
    }
    assert.match(url,/^https:\/\/api\.github\.com\/repos\/owner\/private-blog\/contents\//);
    assert.equal(opt.headers.Authorization,'Bearer temporary-test-token');
    const isHash=url.includes('deliverable-hashes.json');
    const data=isHash?JSON.stringify({'test-article_dialogue_note-copy.html':overrideHash?'0'.repeat(64):expected}):html;
    return Response.json({type:'file',path:isHash?'docs/test-article/deliverable-hashes.json':'docs/test-article/test-article_dialogue_note-copy.html',encoding:'base64',size:Buffer.byteLength(data),content:Buffer.from(data).toString('base64')});
  };
}
test('no Access assertion => 401; no private upstream request',async()=>{
  const res=await handleRequest(req('/api/releases',false),vars,async()=>{throw new Error('unexpected fetch')});
  assert.equal(res.status,401);
  assert.equal(res.headers.get('Cache-Control'),'private, no-store, max-age=0');
});
test('forged JWT or unapproved email => 401',async()=>{
  const bad=new Request(ORIGIN+'/api/releases',{headers:{'Cf-Access-Jwt-Assertion':token.slice(0,-5)+'xxxxx'}});
  assert.equal((await handleRequest(bad,vars,mockGitHub(''))).status,401);
  const other=jwt({iss:'https://team.cloudflareaccess.com',aud:['audience-test'],email:'stranger@example.org',exp:now+600,iat:now-5});
  assert.equal((await handleRequest(new Request(ORIGIN+'/api/releases',{headers:{'Cf-Access-Jwt-Assertion':other}}),vars,mockGitHub(''))).status,401);
});
test('valid Access user sees approved releases only',async()=>{
  const r=await handleRequest(req('/api/releases'),vars,mockGitHub(''));
  assert.equal(r.status,200);
  assert.deepEqual((await r.json()).releases,[{slug:'test-article',commit:'a'.repeat(40)}]);
});
test('unapproved release cannot reach GitHub',async()=>{
  let requestedPrivate=false;
  const r=await handleRequest(req('/api/article?slug=other&commit='+('a'.repeat(40))+'&format=note'),vars,async(url,opt)=>{
    if(url.includes('api.github.com')) requestedPrivate=true;
    return mockGitHub('')(url,opt);
  });
  assert.equal(r.status,404);
  assert.equal(requestedPrivate,false);
});
test('approved artifact is hash checked',async()=>{
  const expected=await sha(html);
  const url='/api/article?slug=test-article&commit='+('a'.repeat(40))+'&format=note';
  const result=await handleRequest(req(url),vars,mockGitHub(expected));
  assert.equal(result.status,200);
  const body=await result.json();
  assert.equal(body.sha256,expected);
  assert.equal(body.html,html);
  const bad=await handleRequest(req(url),vars,mockGitHub(expected,true));
  assert.equal(bad.status,503);
  assert.equal((await bad.json()).error,'納品サービスを利用できません');
});
test('different origin and non-GET rejected',async()=>{
  assert.equal((await handleRequest(new Request('https://evil.example/api/releases'),vars,mockGitHub(''))).status,403);
  assert.equal((await handleRequest(new Request(ORIGIN+'/api/releases',{method:'POST'}),vars,mockGitHub(''))).status,405);
});

test('bootstrap state with no Access or GitHub secrets refuses every request',async()=>{
  let calls=0;
  const noSecrets={DELIVERY_ORIGIN:ORIGIN,ASSETS:vars.ASSETS};
  for(const path of ['/', '/app.js', '/api/releases',
    '/api/article?slug=test-article&commit='+('a'.repeat(40))+'&format=note']) {
    const res=await handleRequest(req(path),noSecrets,async()=>{
      calls++;
      throw new Error('Upstream must not be contacted before configuration');
    });
    assert.equal(res.status,503);
    assert.equal(res.headers.get('Cache-Control'),'private, no-store, max-age=0');
    assert.deepEqual(await res.json(),{error:'納品サービスを利用できません'});
  }
  assert.equal(calls,0);
});

test('authenticated health probe needs no release list or GitHub credentials',async()=>{
  const safeEnv={
    DELIVERY_ORIGIN:ORIGIN,
    CF_ACCESS_TEAM_DOMAIN:vars.CF_ACCESS_TEAM_DOMAIN,
    CF_ACCESS_AUD:vars.CF_ACCESS_AUD,
    ALLOWED_EMAILS:vars.ALLOWED_EMAILS
  };
  let external=0;
  const certsOnly=async (url)=>{
    external++;
    assert.equal(url,'https://team.cloudflareaccess.com/cdn-cgi/access/certs');
    return Response.json({keys:[key]});
  };
  const ok=await handleRequest(req('/api/health'),safeEnv,certsOnly);
  assert.equal(ok.status,200);
  assert.deepEqual(await ok.json(),{status:'ok',access:'verified'});
  assert.equal(external,1);
  const unauthorized=await handleRequest(req('/api/health',false),safeEnv,async()=>{throw Error('unexpected network')});
  assert.equal(unauthorized.status,401);
  const wrongEmailToken=jwt({iss:'https://team.cloudflareaccess.com',aud:['audience-test'],email:'different@example.org',exp:now+600,iat:now-5});
  const wrong=await handleRequest(new Request(ORIGIN+'/api/health',{headers:{'Cf-Access-Jwt-Assertion':wrongEmailToken}}),safeEnv,certsOnly);
  assert.equal(wrong.status,401);
});

const ledgerEnv={...vars, DELIVERY_LEDGER_REF:'refs/heads/delivery-approved',DELIVERY_LEDGER_PATH:'delivery/approved-releases.json'};
async function ledgerMock({mutate=x=>x, fail=false, hashMismatch=false}={}) {
  const expected=await sha(html);
  const ledger=mutate({version:1,releases:[{slug:'test-article',commit:'a'.repeat(40),approved:true,hashes:{note:expected,wix:expected}}]});
  const calls=[];
  const fetcher=async(url,opts)=>{
    calls.push(url);
    if(url.includes('/contents/delivery/approved-releases.json')) {
      assert.match(url,/ref=refs%2Fheads%2Fdelivery-approved$/);
      if(fail) return new Response('private upstream error',{status:403});
      const body=JSON.stringify(ledger);
      return Response.json({type:'file',path:'delivery/approved-releases.json',size:Buffer.byteLength(body),encoding:'base64',content:Buffer.from(body).toString('base64')});
    }
    return mockGitHub(expected,hashMismatch)(url,opts);
  };
  return {fetcher,calls};
}
test('ledger uses scoped App token, anchors artifact hash, and reuses token within request',async()=>{
  const {fetcher,calls}=await ledgerMock();
  const res=await handleRequest(req('/api/article?slug=test-article&commit='+('a'.repeat(40))+'&format=note'),ledgerEnv,fetcher);
  assert.equal(res.status,200);
  assert.equal(calls.filter(u=>u.endsWith('/access_tokens')).length,1);
  assert.ok(calls.filter(u=>u.includes('docs/')).every(u=>u.endsWith('?ref='+'a'.repeat(40))));
});
test('ledger excludes unapproved commits before any artifact read',async()=>{
  const {fetcher,calls}=await ledgerMock();
  const res=await handleRequest(req('/api/article?slug=test-article&commit='+('b'.repeat(40))+'&format=note'),ledgerEnv,fetcher);
  assert.equal(res.status,404);
  assert.equal(calls.some(u=>u.includes('/contents/docs/')),false);
});
test('ledger is fetched afresh, so revocation is immediate without stale fallback',async()=>{
  const first=await ledgerMock();
  assert.equal((await (await handleRequest(req('/api/releases'),ledgerEnv,first.fetcher)).json()).releases.length,1);
  const removed=await ledgerMock({mutate:x=>({...x,releases:[]})});
  assert.deepEqual(await (await handleRequest(req('/api/releases'),ledgerEnv,removed.fetcher)).json(),{releases:[]});
});
test('malformed, unapproved, duplicate, unavailable ledger fails closed despite legacy approvals',async()=>{
  for(const options of [
    {fail:true}, {mutate:x=>({...x,version:2})},
    {mutate:x=>{x.releases[0].approved=false;return x;}},
    {mutate:x=>{x.releases[0].commit='main';return x;}},
    {mutate:x=>{x.releases[0].hashes.note='invalid';return x;}},
    {mutate:x=>{x.releases.push(x.releases[0]);return x;}}
  ]) {
    const {fetcher,calls}=await ledgerMock(options);
    const res=await handleRequest(req('/api/releases'),ledgerEnv,fetcher);
    assert.equal(res.status,503);
    assert.deepEqual(await res.json(),{error:'納品サービスを利用できません'});
    assert.equal(calls.some(u=>u.includes('/contents/docs/')),false);
  }
});
test('ledger hash and repository manifest must agree',async()=>{
  const {fetcher,calls}=await ledgerMock({hashMismatch:true});
  const res=await handleRequest(req('/api/article?slug=test-article&commit='+('a'.repeat(40))+'&format=note'),ledgerEnv,fetcher);
  assert.equal(res.status,503);
  assert.equal(calls.some(u=>u.includes('_note-copy.html')),false);
});
test('authenticated diagnostics discloses no token, repo, article or email',async()=>{
  const {fetcher}=await ledgerMock();
  const res=await handleRequest(req('/api/diagnostics'),ledgerEnv,fetcher);
  assert.deepEqual(await res.json(),{status:'ok',github:'verified',ledger:'validated',approvals:1});
  let calls=0;
  assert.equal((await handleRequest(req('/api/diagnostics',false),ledgerEnv,async()=>{calls++;})).status,401);
  assert.equal(calls,0);
});
test('JWT issuer, audience, lifetime, algorithm and key mismatch rejected',async()=>{
  const claims={iss:'https://team.cloudflareaccess.com',aud:['audience-test'],email:'user@example.org',exp:now+600,iat:now-5};
  for(const changes of [{iss:'https://attacker.example'},{aud:['other']},{exp:now-1},{iat:now+120},{nbf:now+120},{iat:now+600},{email:null}]) {
    const assertion=jwt({...claims,...changes});
    const res=await handleRequest(new Request(ORIGIN+'/api/health',{headers:{'Cf-Access-Jwt-Assertion':assertion}}),vars,mockGitHub(''));
    assert.equal(res.status,401);
  }
  for(const assertion of ['eyJhbGciOiJub25lIn0.e30.x','malformed', 'x'.repeat(12001)])
    assert.equal((await handleRequest(new Request(ORIGIN+'/',{headers:{'Cf-Access-Jwt-Assertion':assertion}}),vars,mockGitHub(''))).status,401);
  assert.equal((await handleRequest(req('/api/health'),vars,async()=>Response.json({keys:[]}))).status,401);
});
test('GitHub failures and oversized responses never expose upstream body',async()=>{
  for(const upstream of [new Response('SECRET-TOKEN',{status:403}), new Response('x'.repeat(100001))]) {
    const res=await handleRequest(req('/api/releases'),ledgerEnv,async(url,opts)=>url.endsWith('/access_tokens')?upstream:mockGitHub('')(url,opts));
    assert.equal(res.status,503);
    assert.equal((await res.text()).includes('SECRET'),false);
  }
});

test('deployment requires exact manual revision and non-bypassable independent approval',async()=>{
  const {checkDeployGate}=await import('../scripts/check-deploy-gate.mjs');
  const context={APPROVED_SHA:'a'.repeat(40),GITHUB_SHA:'a'.repeat(40),GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/feature/authenticated-delivery-worker',GITHUB_REPOSITORY:'coudgrabber/projeteam-delivery-viewer',GH_TOKEN:'test'};
  const gate={can_admins_bypass:false,protection_rules:[{type:'required_reviewers',prevent_self_review:true,reviewers:[{type:'User',reviewer:{id:1}}]}]};
  await checkDeployGate(context,async()=>Response.json(gate));
  for(const patch of [{APPROVED_SHA:'b'.repeat(40)},{GITHUB_EVENT_NAME:'push'},{GITHUB_REF:'refs/pull/1/merge'},{GITHUB_REPOSITORY:'attacker/repo'}])
    await assert.rejects(()=>checkDeployGate({...context,...patch},async()=>Response.json(gate)));
  for(const settings of [{}, {...gate,can_admins_bypass:true}, {...gate,protection_rules:[]}, {...gate,protection_rules:[{type:'required_reviewers',prevent_self_review:false,reviewers:[{}]}]}])
    await assert.rejects(()=>checkDeployGate(context,async()=>Response.json(settings)));
  await assert.rejects(()=>checkDeployGate(context,async()=>new Response('',{status:403})));
});

test('all assets and diagnostics require Access, and authenticated assets carry security headers',async()=>{
  for(const path of ['/', '/index.html','/app.js','/style.css','/api/health','/api/diagnostics','/api/releases','/api/article']) {
    assert.equal((await handleRequest(req(path,false),vars,async()=>{throw Error('unexpected');})).status,401);
  }
  const asset=await handleRequest(req('/app.js'),vars,mockGitHub(''));
  assert.equal(asset.status,200);
  assert.equal(asset.headers.get('X-Frame-Options'),'DENY');
  assert.match(asset.headers.get('Content-Security-Policy'),/default-src 'none'/);
  assert.match(asset.headers.get('Cache-Control'),/no-store/);
});
test('incorrect file path, size, encoding, and invalid UTF-8 are rejected',async()=>{
  for(const patch of [{path:'docs/other/file'}, {size:600001}, {size:1}, {encoding:'none'}, {content:'/w==',size:1}]) {
    const {fetcher}=await ledgerMock();
    const res=await handleRequest(req('/api/releases'),ledgerEnv,async(url,opts)=>{
      const response=await fetcher(url,opts);
      return url.includes('approved-releases.json') ? Response.json({...await response.json(),...patch}) : response;
    });
    assert.equal(res.status,503);
  }
});
