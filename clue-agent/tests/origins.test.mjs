import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigins, checkOrigin } from '../origins.mjs';

test('accepts the configured site and clue-markets.vercel.app by default', () => {
  const list = allowedOrigins('https://clue-research-preview.vercel.app/some/path', undefined);
  assert.deepEqual(list, ['https://clue-research-preview.vercel.app', 'https://clue-markets.vercel.app']);
  assert.equal(checkOrigin('https://clue-markets.vercel.app', list), 'https://clue-markets.vercel.app');
  assert.equal(checkOrigin('https://clue-research-preview.vercel.app', list), 'https://clue-research-preview.vercel.app');
});

test('rejects lookalikes, http, missing and partial origins', () => {
  const list = allowedOrigins('https://clue-research-preview.vercel.app', undefined);
  for (const bad of ['https://clue-markets.vercel.app.evil.com', 'https://evil-clue-markets.vercel.app', 'http://clue-markets.vercel.app',
    'https://clue-markets.vercel.app/', 'null', '', undefined, 'https://evil.example']) {
    assert.equal(checkOrigin(bad, list), null, String(bad));
  }
});

test('CLUE_PUBLIC_ORIGINS can replace the extra list; non-https entries are ignored', () => {
  const list = allowedOrigins('https://a.example', 'https://b.example, http://c.example, not a url');
  assert.deepEqual(list, ['https://a.example', 'https://b.example']);
});
