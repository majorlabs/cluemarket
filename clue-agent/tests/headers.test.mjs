// Finding #3: the production site (served by Vercel) must refuse to be framed by other sites.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('vercel.json forbids framing on every path', () => {
  const v = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const all = v.headers.find((h) => h.source === '/(.*)');
  const get = (k) => all.headers.find((h) => h.key.toLowerCase() === k)?.value;
  assert.equal(get('x-frame-options'), 'DENY');
  assert.match(get('content-security-policy'), /frame-ancestors 'none'/);
});
