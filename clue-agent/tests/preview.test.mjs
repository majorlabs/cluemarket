// The page must tell link-preview robots the real address and a picture that exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const meta = (name) => (html.match(new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)"`)) || [])[1];

test('the preview points at the real site, not an old address', () => {
  for (const k of ['og:url', 'og:image', 'twitter:image']) assert.match(meta(k), /^https:\/\/www\.oncluemarket\.xyz\//, k);
  assert.doesNotMatch(html, /clue-markets\.vercel\.app/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.oncluemarket\.xyz\/">/);
});

test('the preview image exists, is a large card, and has a description', () => {
  assert.equal(meta('twitter:card'), 'summary_large_image');
  const file = new URL(`../public${new URL(meta('og:image')).pathname}`, import.meta.url);
  assert.ok(existsSync(file), 'og image file is missing');
  const png = readFileSync(file);
  assert.equal(png.readUInt32BE(16), Number(meta('og:image:width')));
  assert.equal(png.readUInt32BE(20), Number(meta('og:image:height')));
  assert.ok(meta('og:image:alt').length > 20);
});
