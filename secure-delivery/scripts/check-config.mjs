import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
assert.match(config, /^name = "projeteam-secure-delivery"$/m);
assert.match(config, /^keep_vars = true$/m);
assert.match(config, /^run_worker_first = true$/m);
assert.match(config, /^preview_urls = false$/m);
assert.doesNotMatch(config, /^\[vars\]|^routes?\s*=|PRIVATE KEY|^\s*(ALLOWED_EMAILS|GITHUB_APP_PRIVATE_KEY_PKCS8)\s*=/m);
console.log('Worker configuration safety checks passed');
