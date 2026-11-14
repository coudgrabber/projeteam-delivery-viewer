// Offline, browser-level smoke tests. No private repository, Cloudflare credentials or live origin needed.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const files = {
  '/': ['text/html', readFileSync(new URL('../public/index.html', import.meta.url))],
  '/index.html': ['text/html', readFileSync(new URL('../public/index.html', import.meta.url))],
  '/app.js': ['text/javascript', readFileSync(new URL('../public/app.js', import.meta.url))],
  '/style.css': ['text/css', readFileSync(new URL('../public/style.css', import.meta.url))]
};
const commit='a'.repeat(40);
const note = '<!doctype html><html><body><article id="note-article">'+
  '<h3>Heading</h3><p><strong>Bold</strong> and <a href="https://example.org/link">Link</a></p>'+
  '<blockquote><p>Quote</p></blockquote></article></body></html>';
const wix = '<!doctype html><html><body><article id="wix-article">'+
  '<h1>Wix title</h1><p><em>Wix body</em></p></article></body></html>';
const dangerous = '<!doctype html><html><body><article id="note-article">'+
  '<h3>Safe heading</h3><p><strong onclick="window.evil=1">Safe bold</strong>'+
  '<a href="javascript:alert(1)" onclick="window.evil=1">Bad link</a>'+
  '<a href="https://example.org/ok">Good link</a>'+
  '<script>window.evil=1</script><iframe srcdoc="<script>parent.evil=2</script>"></iframe>'+
  '<svg onload="window.evil=3"><circle r="4"/></svg>'+
  '<button>Fake control</button><img src="data:image/png;base64,AAAA" onerror="window.evil=4"></p>'+
  '</article></body></html>';
const doubled = note.replace('</body>', '<article id="note-article"><p>duplicate</p></article></body>');
const digest = data => createHash('sha256').update(data).digest('hex');
let mode='note';
let browser, context, page, server, address;
before(async()=>{
  server=createServer((req,res)=>{
    const url=new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control','no-store');
    const send=(status,data,type='application/json')=>{
      res.writeHead(status,{'Content-Type':type});
      res.end(typeof data==='string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
    };
    if(url.pathname==='/api/releases') return send(200,{releases:[{slug:'test-article',commit}]});
    if(url.pathname==='/api/article'){
      const format=url.searchParams.get('format');
      const html=mode==='dangerous'?dangerous:mode==='duplicate'?doubled:format==='wix'?wix:note;
      const hash=mode==='hash-mismatch'?'0'.repeat(64):digest(html);
      return send(200,{slug:'test-article',commit,format,sha256:hash,html});
    }
    if(files[url.pathname]){
      const [type,bytes]=files[url.pathname];
      return send(200,bytes,type);
    }
    return send(404,'Not Found','text/plain');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  address='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true});
  context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  page=await context.newPage();
});
after(async()=>{
  await context?.close();
  await browser?.close();
  await new Promise(resolve=>server?.close(resolve));
});
async function openAndLoad(format='note'){
  await page.goto(address+'/');
  await page.locator('#release').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('#release').disabled);
  await page.locator('#format').selectOption(format);
  await page.locator('#load').click();
  await page.waitForFunction(()=>document.querySelector('#load').disabled===false &&
    (document.querySelector('#status').textContent.includes('検証成功')||
     document.querySelector('#status').textContent.includes('一致しません')||
     document.querySelector('#status').textContent.includes('特定に失敗')));
}
test('real Chromium renders all four note formats and transfers rich HTML to clipboard',async()=>{
  mode='note';
  await openAndLoad();
  assert.equal(await page.locator('#preview h3').innerText(),'Heading');
  assert.equal(await page.locator('#preview strong').innerText(),'Bold');
  assert.equal(await page.locator('#preview blockquote').innerText(),'Quote');
  assert.equal(await page.locator('#preview a').getAttribute('href'),'https://example.org/link');
  await page.locator('#copy').click();
  await page.waitForFunction(() => document.querySelector('#copy-status').textContent.trim().length > 0);
  assert.match(await page.locator('#copy-status').innerText(),/コピーAPIに渡しました/);
  const clipboard=await page.evaluate(async()=>{
    const contents=await navigator.clipboard.read();
    const item=contents[0];
    return {
      types:item.types,
      html:await (await item.getType('text/html')).text(),
      plain:await (await item.getType('text/plain')).text()
    };
  });
  assert.ok(clipboard.types.includes('text/html'));
  assert.ok(clipboard.types.includes('text/plain'));
  assert.match(clipboard.html,/<h3>Heading<\/h3>/);
  assert.match(clipboard.html,/<strong>Bold<\/strong>/);
  assert.match(clipboard.html,/<blockquote>/);
  assert.match(clipboard.html,/https:\/\/example\.org\/link/);
  assert.match(clipboard.plain,/Bold/);
  await page.locator('#paste-check').focus();
  await page.keyboard.press('ControlOrMeta+V');
  await page.waitForFunction(()=>document.querySelector('#paste-report').textContent.includes('HTML形式を検出'));
});
test('Wix article is extracted without note-specific fields',async()=>{
  mode='note';
  await openAndLoad('wix');
  assert.equal(await page.locator('#preview h1').innerText(),'Wix title');
  assert.equal(await page.locator('#preview em').innerText(),'Wix body');
  assert.equal(await page.locator('#copy').isEnabled(),true);
});
test('untrusted active HTML and event attributes are removed from preview and copied text',async()=>{
  mode='dangerous';
  await openAndLoad();
  const safe=await page.locator('#preview').innerHTML();
  assert.ok(!/<(script|iframe|svg|button|img)\b/i.test(safe));
  assert.ok(!/\bonclick\b|\bonerror\b|javascript:/i.test(safe));
  assert.equal(await page.locator('#preview a').count(),2);
  assert.equal(await page.locator('#preview a').first().getAttribute('href'),null);
  assert.equal(await page.locator('#preview a').last().getAttribute('href'),'https://example.org/ok');
  assert.equal(await page.evaluate(()=>window.evil),undefined);
});
test('hash mismatch leaves all copy controls disabled',async()=>{
  mode='hash-mismatch';
  await openAndLoad();
  assert.equal(await page.locator('#copy').isEnabled(),false);
  assert.equal(await page.locator('#fallback').isEnabled(),false);
  assert.equal(await page.locator('#preview').innerText(),'');
});
test('duplicate article roots fail closed',async()=>{
  mode='duplicate';
  await openAndLoad();
  assert.equal(await page.locator('#copy').isEnabled(),false);
  assert.equal(await page.locator('#preview').innerText(),'');
});
