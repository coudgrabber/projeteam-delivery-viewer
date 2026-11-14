import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
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
