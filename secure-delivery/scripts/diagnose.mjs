// Read-only diagnostics. Supply secrets through a local ignored env file, never CLI values.
import { diagnoseGitHub } from '../worker.mjs';
const mode = process.argv[2];
if (mode === 'github') {
  const result = await diagnoseGitHub(process.env);
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'ok' ? 0 : 1;
} else if (mode === 'access') {
  try {
    const origin = new URL(process.env.DELIVERY_ORIGIN);
    if (origin.protocol !== 'https:' || origin.origin !== process.env.DELIVERY_ORIGIN) throw Error();
    const assertion = process.env.CF_ACCESS_JWT;
    const paths = ['/', '/app.js', '/style.css', '/api/health', '/api/releases', '/api/diagnostics'];
    let failed = false;
    for (const path of paths) {
      const headers = assertion ? { 'Cf-Access-Jwt-Assertion': assertion, Cookie: 'CF_Authorization=' + assertion } : {};
      const res = await fetch(origin.origin + path, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      // Never print response bodies, redirect locations, JWTs or cookies.
      const denied = [401, 403].includes(res.status) ||
        ([302, 303].includes(res.status) && new URL(res.headers.get('location'), origin).hostname.endsWith('.cloudflareaccess.com'));
      const ok = assertion ? res.status === 200 && /no-store/.test(res.headers.get('cache-control') || '') : denied;
      console.log(JSON.stringify({ path, status: res.status, expected: assertion ? 'authenticated' : 'denied', ok }));
      failed ||= !ok;
      await res.body?.cancel();
    }
    process.exitCode = failed ? 1 : 0;
  } catch { console.log(JSON.stringify({ status: 'unavailable', reason: 'access_probe_failed' })); process.exitCode = 1; }
} else {
  console.error('Usage: node [--env-file=<ignored-local-file>] scripts/diagnose.mjs github|access');
  process.exitCode = 1;
}
