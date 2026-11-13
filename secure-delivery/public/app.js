// The browser never receives a GitHub token, app private key, or Cloudflare secret.
// HTML is parsed as inert data and rebuilt with a strict tag/attribute allowlist.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ALLOWED = new Set(['p','h1','h2','h3','h4','h5','h6','strong','b','em','i','u','a',
    'blockquote','br','hr','ul','ol','li','pre','code','table','thead','tbody','tr','th','td','sup','sub','span','div']);
  const DROP = new Set(['script','style','iframe','object','embed','svg','math','template','form',
    'input','textarea','button','select','link','meta','base','noscript','img','audio','video']);
  let article = null;
  let busy = false;
  const enc = new TextEncoder();
  const status = msg => { $('status').textContent = msg; };
  const hex = bytes => [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
  async function digest(input) {
    return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(input))));
  }
  function safeUrl(input) {
    try {
      const uri = new URL(input);
      if (uri.protocol === 'https:' || uri.protocol === 'http:') return uri.href;
    } catch {}
    return null;
  }
  function cloneSafe(node, parent) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.nodeValue));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const name = node.localName.toLowerCase();
    if (DROP.has(name)) return;
    if (!ALLOWED.has(name)) {
      for (const child of node.childNodes) cloneSafe(child, parent);
      return;
    }
    const el = document.createElement(name);
    if (name === 'a') {
      const href = safeUrl(node.getAttribute('href') || '');
      if (href) {
        el.setAttribute('href', href);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    }
    if (name === 'td' || name === 'th') {
      for (const attr of ['colspan','rowspan']) {
        const n = Number(node.getAttribute(attr));
        if (Number.isInteger(n) && n >= 1 && n <= 20) el.setAttribute(attr, String(n));
      }
    }
    for (const child of node.childNodes) cloneSafe(child, el);
    parent.appendChild(el);
  }
  function htmlBody(html, format) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const expectedId = format === 'note' ? 'note-article' : 'wix-article';
    const roots = parsed.querySelectorAll('article#' + expectedId);
    if (roots.length !== 1 || !roots[0].textContent.trim()) throw new Error('本文の特定に失敗しました');
    const holder = document.createElement('article');
    for (const child of roots[0].childNodes) cloneSafe(child, holder);
    if (!holder.textContent.trim()) throw new Error('本文が空です');
    return holder;
  }
  async function request(url) {
    const r = await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error'});
    if (r.status === 401 || r.status === 403) throw new Error('認証または閲覧権限を確認してください');
    if (!r.ok) throw new Error('取得に失敗しました（HTTP ' + r.status + '）');
    return r.json();
  }
  function lock() {
    article = null;
    $('copy').disabled = $('fallback').disabled = true;
    $('preview').replaceChildren();
    $('copy-status').textContent = '';
  }
  function selectOption({slug,commit}) {
    const option = document.createElement('option');
    option.value = JSON.stringify([slug,commit]);
    option.textContent = slug + ' / ' + commit.slice(0,12);
    return option;
  }
  async function listReleases() {
    status('公開承認済みの確定版を確認しています。');
    try {
      const data = await request('/api/releases');
      if (!Array.isArray(data.releases) || !data.releases.length) throw new Error('記事が登録されていません');
      $('release').replaceChildren(...data.releases.map(selectOption));
      $('release').disabled = $('load').disabled = false;
      status('選択可能な確定版：' + data.releases.length + '件');
    } catch(e) {
      status(e.message);
    }
  }
  async function load() {
    if (busy) return;
    busy=true;
    $('load').disabled = true;
    lock();
    status('確定版の取得と完全性確認を実施しています。');
    try {
      const [slug,commit] = JSON.parse($('release').value);
      const format = $('format').value;
      const data = await request('/api/article?slug='+encodeURIComponent(slug)+
        '&commit='+encodeURIComponent(commit)+'&format='+encodeURIComponent(format));
      if (data.slug !== slug || data.commit !== commit || data.format !== format ||
          typeof data.html !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256)) {
        throw new Error('レスポンスの識別情報が一致しません');
      }
      const actual = await digest(data.html);
      if (actual !== data.sha256) throw new Error('取得HTMLのSHA-256が一致しません');
      const parsed = htmlBody(data.html,format);
      $('preview').replaceChildren(parsed);
      article = parsed;
      $('copy').disabled = $('fallback').disabled = false;
      status('検証成功：'+slug+' / '+format+' / '+commit.slice(0,12)+' / SHA-256 '+actual);
    } catch(e) { lock(); status(e.message); }
    finally { busy=false; $('load').disabled=false; }
  }
  function richHtml() {
    if (!article) throw new Error('記事未取得');
    return '<article>'+article.innerHTML+'</article>';
  }
  function plainText() { return article ? article.innerText : ''; }
  async function copy() {
    if (!article) return;
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('HTMLコピーAPIが利用できません');
      await navigator.clipboard.write([new ClipboardItem({
        'text/html':new Blob([richHtml()],{type:'text/html'}),
        'text/plain':new Blob([plainText()],{type:'text/plain'})
      })]);
      $('copy-status').textContent='HTMLとテキストをコピーAPIに渡しました。貼付先で書式を確認してください。';
    } catch(e) { $('copy-status').textContent='HTMLコピーAPIが使用できません。代替コピーを試してください。'; }
  }
  function fallback() {
    if (!article) return;
    let success=false;
    const handler = e => {
      if (!e.clipboardData) return;
      e.clipboardData.setData('text/html',richHtml());
      e.clipboardData.setData('text/plain',plainText());
      e.preventDefault();
      success=true;
    };
    document.addEventListener('copy',handler,true);
    let ok=false;
    try { ok=document.execCommand('copy'); } catch {}
    document.removeEventListener('copy',handler,true);
    $('copy-status').textContent=ok&&success ?
      '代替方式でHTML形式を渡しました。貼付先で確認してください。':
      '代替方式は成立しませんでした。ブラウザの手動選択コピーをお試しください。';
  }
  function pasteReport(e) {
    const types=e.clipboardData ? [...e.clipboardData.types] : [];
    $('paste-report').textContent=types.includes('text/html') ?
      'HTML形式を検出しました。noteまたはWix上での書式確認が必要です。':
      'HTML形式を検出できませんでした（'+types.join(', ')+ '）。';
  }
  $('load').addEventListener('click',load);
  $('release').addEventListener('change',lock);
  $('format').addEventListener('change',lock);
  $('copy').addEventListener('click',copy);
  $('fallback').addEventListener('click',fallback);
  $('paste-check').addEventListener('paste',pasteReport);
  listReleases();
})();
