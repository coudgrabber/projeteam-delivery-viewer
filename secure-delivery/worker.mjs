// Private article delivery. All requests require a verified Cloudflare Access JWT.
// GitHub App credentials, approved release list, and allowed emails are server-side only.
const SECURITY = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:"
};
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_FILE = 600_000;
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

function response(body, status = 200, extra = {}) {
  return new Response(body, { status, headers: { ...SECURITY, ...extra } });
}
function json(data, status = 200) {
  return response(JSON.stringify(data), status, { 'Content-Type': 'application/json; charset=utf-8' });
}
function error(status, message) { return json({ error: message }, status); }
function need(env, key) {
  if (!env[key] || typeof env[key] !== 'string') throw new Error('Missing server configuration: ' + key);
  return env[key].trim();
}
function base64UrlBytes(str) {
  if (!/^[A-Za-z0-9_-]+$/.test(str)) throw new Error('Malformed base64url');
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s.padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(bin, ch => ch.charCodeAt(0));
}
function base64Bytes(s) {
  const bin = atob(s.replace(/\s/g, ''));
  return Uint8Array.from(bin, ch => ch.charCodeAt(0));
}
function base64Url(obj) {
  const b = encoder.encode(JSON.stringify(obj));
  let s = '';
  for (const v of b) s += String.fromCharCode(v);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('');
}
function releaseList(env) {
  const data = JSON.parse(need(env, 'DELIVERY_RELEASES_JSON'));
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Invalid release configuration');
  const result = {};
  for (const [slug, shas] of Object.entries(data)) {
    if (!SLUG.test(slug) || !Array.isArray(shas) || shas.length === 0 || !shas.every(v => typeof v === 'string' && SHA.test(v))) {
      throw new Error('Invalid release entry');
    }
    result[slug] = [...new Set(shas)];
  }
  if (!Object.keys(result).length) throw new Error('No releases');
  return result;
}

async function verifyAccess(request, env, fetcher) {
  const domain = need(env, 'CF_ACCESS_TEAM_DOMAIN');
  const aud = need(env, 'CF_ACCESS_AUD');
  const allowed = need(env, 'ALLOWED_EMAILS').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !allowed.length) throw new Error('Invalid Access configuration');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 12000) return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const header = JSON.parse(decoder.decode(base64UrlBytes(parts[0])));
    const claims = JSON.parse(decoder.decode(base64UrlBytes(parts[1])));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 200) return false;
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== 'https://' + domain || !audiences.includes(aud)) return false;
    if (typeof claims.exp !== 'number' || claims.exp <= now || typeof claims.iat !== 'number' || claims.iat > now + 60) return false;
    if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now + 60)) return false;
    if (typeof claims.email !== 'string' || !allowed.includes(claims.email.toLowerCase())) return false;
    const r = await fetcher('https://' + domain + '/cdn-cgi/access/certs', {
      method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store'
    });
    if (!r.ok) return false;
    const jwks = await r.json();
    const key = Array.isArray(jwks.keys) && jwks.keys.find(k => k.kid === header.kid && k.kty === 'RSA');
    if (!key) return false;
    const pub = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', pub, base64UrlBytes(parts[2]), encoder.encode(parts[0] + '.' + parts[1])
    );
  } catch { return false; }
}

function gitRepo(env) {
  const repo = need(env, 'SOURCE_REPO');
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) throw new Error('Invalid SOURCE_REPO');
  return repo;
}
function pkcs8Key(env) {
  const pem = need(env, 'GITHUB_APP_PRIVATE_KEY_PKCS8');
  if (!pem.includes('-----BEGIN PRIVATE KEY-----') || !pem.includes('-----END PRIVATE KEY-----')) throw new Error('Expected PKCS8 PEM');
  return base64Bytes(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g, ''));
}
async function appJwt(env) {
  const id = need(env, 'GITHUB_APP_ID');
  if (!/^\d+$/.test(id)) throw new Error('Invalid app ID');
  const key = await crypto.subtle.importKey('pkcs8', pkcs8Key(env), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const head = base64Url({ alg: 'RS256', typ: 'JWT' });
  const payload = base64Url({ iat: now - 60, exp: now + 540, iss: id });
  const input = head + '.' + payload;
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(input)));
  let str = '';
  for (const b of sig) str += String.fromCharCode(b);
  return input + '.' + btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
async function githubToken(env, fetcher) {
  const installation = need(env, 'GITHUB_INSTALLATION_ID');
  if (!/^\d+$/.test(installation)) throw new Error('Invalid installation ID');
  const resp = await fetcher('https://api.github.com/app/installations/' + installation + '/access_tokens', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + await appJwt(env),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'projeteam-private-delivery',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ permissions: { contents: 'read' }, repositories: [gitRepo(env).split('/')[1]] }),
    credentials: 'omit', redirect: 'error', cache: 'no-store'
  });
  if (!resp.ok) throw new Error('GitHub installation authentication failed');
  const data = await resp.json();
  if (typeof data.token !== 'string' || !data.token) throw new Error('No installation token');
  return data.token;
}
async function githubFile(env, token, path, sha, fetcher) {
  const url = 'https://api.github.com/repos/' + gitRepo(env) + '/contents/' +
    path.split('/').map(encodeURIComponent).join('/') + '?ref=' + sha;
  const res = await fetcher(url, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'projeteam-private-delivery' },
    credentials: 'omit', redirect: 'error', cache: 'no-store'
  });
  if (!res.ok) throw new Error('GitHub read failed');
  const data = await res.json();
  if (data.type !== 'file' || data.path !== path || data.encoding !== 'base64' ||
      !Number.isInteger(data.size) || data.size < 1 || data.size > MAX_FILE ||
      typeof data.content !== 'string') throw new Error('Invalid GitHub file');
  const bytes = base64Bytes(data.content);
  if (bytes.length !== data.size) throw new Error('GitHub size mismatch');
  return bytes;
}
async function article(env, slug, sha, format, fetcher) {
  const releases = releaseList(env);
  if (!Object.hasOwn(releases, slug) || !releases[slug].includes(sha) || !['note', 'wix'].includes(format)) {
    return error(404, '承認済みの記事が見つかりません');
  }
  const token = await githubToken(env, fetcher);
  const directory = 'docs/' + slug + '/';
  const name = slug + (format === 'note' ? '_dialogue_note-copy.html' : '_essay_wix-copy.html');
  const hashBytes = await githubFile(env, token, directory + 'deliverable-hashes.json', sha, fetcher);
  const hashes = JSON.parse(decoder.decode(hashBytes));
  const expected = hashes && hashes[name];
  if (typeof expected !== 'string' || !HASH.test(expected)) throw new Error('Missing approved artifact hash');
  const bytes = await githubFile(env, token, directory + name, sha, fetcher);
  const actual = await sha256(bytes);
  if (actual !== expected) throw new Error('Artifact integrity mismatch');
  return json({ slug, commit: sha, format, sha256: actual, html: decoder.decode(bytes) });
}
export async function handleRequest(request, env, fetcher = globalThis.fetch) {
  try {
    const url = new URL(request.url);
    if (url.origin !== need(env, 'DELIVERY_ORIGIN')) return error(403, '許可されていない接続元');
    if (request.method !== 'GET') return error(405, '許可されていない操作');
    if (!await verifyAccess(request, env, fetcher)) return error(401, '認証が必要です');
    if (url.pathname === '/api/releases') {
      const releases = releaseList(env);
      return json({ releases: Object.entries(releases).flatMap(([slug, commits]) =>
        commits.map(commit => ({ slug, commit }))) });
    }
    if (url.pathname === '/api/article') {
      const slug = url.searchParams.get('slug') || '';
      const sha = url.searchParams.get('commit') || '';
      const format = url.searchParams.get('format') || '';
      if (!SLUG.test(slug) || !SHA.test(sha) || !['note', 'wix'].includes(format)) return error(400, '指定が不正です');
      return await article(env, slug, sha, format, fetcher);
    }
    if (url.pathname !== '/' && url.pathname !== '/index.html' &&
        url.pathname !== '/app.js' && url.pathname !== '/style.css') return error(404, '見つかりません');
    if (!env.ASSETS || !env.ASSETS.fetch) throw new Error('Missing static asset binding');
    const asset = await env.ASSETS.fetch(request);
    if (!asset.ok) return error(404, '見つかりません');
    const headers = new Headers(asset.headers);
    for (const [k, v] of Object.entries(SECURITY)) headers.set(k, v);
    return new Response(asset.body, { status: asset.status, headers });
  } catch {
    // Never disclose repository existence, token, hash, private text, or configuration in errors.
    return error(503, '納品サービスを利用できません');
  }
}
export default { fetch: (request, env) => handleRequest(request, env) };
