// Names for the markets behind a person's open orders: only well-formed ids are asked about, only what was asked for comes back, and
// the page gets only what it shows.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseIds, marketsByCondition, MAX_IDS } from '../markets-lookup.mjs';

const A = '0x' + 'ab'.repeat(32), B = '0x' + 'cd'.repeat(32), C = '0x' + 'ef'.repeat(32);

test('only well-formed, distinct ids are used, in lower case, and no more than the limit', () => {
  assert.deepEqual(parseIds(`${A},${B.toUpperCase().replace('0X', '0x')},${A}`), [A, B]);
  assert.deepEqual(parseIds('0x123,nope,,<script>,' + A), [A]);
  assert.deepEqual(parseIds(''), []); assert.deepEqual(parseIds(null), []);
  const many = Array.from({ length: 50 }, (_, i) => '0x' + i.toString(16).padStart(64, '0')).join(',');
  assert.equal(parseIds(many).length, MAX_IDS);
});

test('the answer holds only the asked-for markets, with the question, the group name and the event, trimmed', async () => {
  let asked;
  const fetchImpl = async (url) => { asked = new URL(url); return { ok: true, json: async () => [
    { conditionId: A, question: 'Will Gen.G win Worlds 2026?', groupItemTitle: 'Gen.G', events: [{ slug: 'worlds-2026-winner', description: 'long text that must not travel' }], liquidity: 99 },
    { conditionId: C, question: 'Not asked for', events: [] }] }; };
  const out = await marketsByCondition([A, B], { fetchImpl });
  assert.deepEqual(asked.searchParams.getAll('condition_ids'), [A, B]);
  assert.deepEqual(out, { [A]: { question: 'Will Gen.G win Worlds 2026?', group: 'Gen.G', eventSlug: 'worlds-2026-winner' } });   // C was not asked for; nothing else travels
  assert.deepEqual(await marketsByCondition([], { fetchImpl: () => { throw new Error('should not be called'); } }), {});
});

test('when the market list is down, the person gets a plain sentence', async () => {
  await assert.rejects(marketsByCondition([A], { fetchImpl: async () => ({ ok: false }) }), (e) => e.status === 502 && /unavailable/.test(e.message));
  await assert.rejects(marketsByCondition([A], { fetchImpl: async () => { throw new Error('boom'); } }), (e) => e.status === 502 && !/boom/.test(e.message));
});

// ---- through the real server, with a stand-in for the market list ----
let seen = null;
const fake = http.createServer((req, res) => { seen = new URL(req.url, 'http://x'); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([{ conditionId: A, question: 'Q one', groupItemTitle: 'One', events: [{ slug: 'one-event' }] }])); });
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const dir = await mkdtemp(join(tmpdir(), 'clue-lookup-'));
const port = 31000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir, CLUE_GAMMA_BASE: `http://127.0.0.1:${fake.address().port}` };
for (const k of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: process.env.DEBUG_SERVER ? 'inherit' : 'ignore' });
after(async () => { server.kill(); await new Promise((r) => server.once('exit', r)); fake.close(); await rm(dir, { recursive: true, force: true }); });
async function ready() { for (let i = 0; i < 300; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw new Error('server failed to start'); }

test('server: the lookup answers with names, ignores bad ids, and never calls the market list for none', async () => {
  await ready();
  const ok = await (await fetch(`${base}/api/markets/by-condition?ids=${A},junk`)).json();
  assert.deepEqual(ok, { markets: { [A]: { question: 'Q one', group: 'One', eventSlug: 'one-event' } } });
  assert.deepEqual(seen.searchParams.getAll('condition_ids'), [A]);
  seen = null;
  assert.deepEqual(await (await fetch(`${base}/api/markets/by-condition?ids=junk`)).json(), { markets: {} });
  assert.equal(seen, null);
});
