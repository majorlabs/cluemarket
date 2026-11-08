import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

// A stand-in for Polymarket's market endpoint, so the test can move prices and resolve markets.
const markets = { 777: { closed: false, outcomePrices: '["0.40","0.60"]', outcomes: '["Yes","No"]', endDate: '2027-06-01T00:00:00Z', question: 'Will it happen?' } };
const fake = http.createServer((req, res) => {
  const m = req.url.match(/^\/markets\/(\d+)$/);
  if (m && markets[m[1]]) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(markets[m[1]])); }
  res.writeHead(404); res.end('{}');
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
const gamma = `http://127.0.0.1:${fake.address().port}`;

const dir = await mkdtemp(join(tmpdir(), 'clue-journal-'));
const port = 31000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir, CLUE_GAMMA_BASE: gamma, CLUE_LIVE_TTL_MS: '0' };
for (const k of ['DATABASE_URL', 'NEAR_AI_API_KEY', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: process.env.DEBUG_SERVER ? 'inherit' : 'ignore' });
after(async () => { server.kill(); await new Promise(r => server.once('exit', r)); fake.close(); await rm(dir, { recursive: true, force: true }); });

async function ready() { for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); } throw new Error('server failed to start'); }
async function request(path, { cookie, body, method } = {}) {
  const res = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'), headers: { Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const signup = name => {
  const db = new Database(join(dir, 'clue.sqlite')); const token = randomBytes(32).toString('hex'); const now = new Date().toISOString();
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(name, name + '.near', name + '@test.invalid', 0, now, now);
  db.prepare('INSERT INTO wallet_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), name, name + '.near', Date.now() + 600000); db.close();
  return { cookie: 'clue_wallet=' + token };
};
const seed = (user, market) => {
  const db = new Database(join(dir, 'clue.sqlite')); const id = randomUUID();
  db.prepare('INSERT INTO research_results (id,user_id,created_at,question,content,sources,market,model,retrieved_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id, user, new Date().toISOString(), 'Will it happen?', 'A report.', '[]', market ? JSON.stringify(market) : null, 'test', '2026-11-05T00:00:00Z'); db.close(); return id;
};
const marketRef = { id: '777', question: 'Will it happen?', outcomes: ['Yes', 'No'] };

test('the memory loop: remember, watch, then score', async () => {
  await ready();
  const alice = signup('alice'), bob = signup('bob');
  assert.equal((await request('/api/journal')).status, 401);

  const t = await request('/api/threads', { cookie: alice.cookie, body: { researchId: seed('alice', marketRef) } });
  assert.equal(t.status, 201); const id = t.body.id;
  const forecast = { probability: 70, reasoning: 'Base rate is high', changeCondition: 'A court ruling against', outcomeIndex: 0 };
  assert.equal((await request(`/api/threads/${id}/forecasts`, { cookie: alice.cookie, body: forecast })).status, 201);

  // The price the market had when saved is recorded by the server, not taken from the browser.
  let thread = (await request(`/api/threads/${id}`, { cookie: alice.cookie })).body;
  assert.equal(thread.forecasts[0].market_price, 0.4);
  assert.equal(thread.forecasts[0].outcome_label, 'Yes');
  assert.equal(thread.watch.state, 'open');
  assert.deepEqual(thread.watch.flags.sort(), ['gap']);           // 70% vs 40%: a 30 point gap, no move yet

  // The market moves: the journal says so, with the price from when the forecast was saved.
  markets[777].outcomePrices = '["0.55","0.45"]';
  let journal = (await request('/api/journal', { cookie: alice.cookie })).body;
  assert.equal(journal.entries.length, 1);
  let watch = journal.entries[0].watch;
  assert.equal(watch.marketAtForecast, 0.4);
  assert.equal(watch.marketNow, 0.55);
  assert.equal(watch.movePoints, 15);
  assert.ok(watch.flags.includes('moved'));
  assert.equal(journal.summary.resolved, 0);
  assert.equal(journal.summary.verdict, 'none');

  // The market resolves Yes: the forecast is scored against the market's price at the time.
  markets[777].closed = true; markets[777].outcomePrices = '["1","0"]';
  journal = (await request('/api/journal', { cookie: alice.cookie })).body;
  watch = journal.entries[0].watch;
  assert.equal(watch.state, 'resolved');
  assert.equal(watch.happened, true);
  assert.ok(watch.score.beatMarket);                       // 70% beat the 40% market on an event that happened
  assert.equal(journal.summary.resolved, 1);
  assert.equal(journal.summary.verdict, 'too-few');        // one result is not a track record

  // Someone else's journal is empty and cannot touch Alice's notes.
  assert.equal((await request('/api/journal', { cookie: bob.cookie })).body.entries.length, 0);
  assert.equal((await request(`/api/threads/${id}/lesson`, { cookie: bob.cookie, method: 'PUT', body: { lesson: 'mine now' } })).status, 404);

  // Notes: validated, saved, returned.
  assert.equal((await request(`/api/threads/${id}/lesson`, { cookie: alice.cookie, method: 'PUT', body: { lesson: 5 } })).status, 400);
  assert.equal((await request(`/api/threads/${id}/lesson`, { cookie: alice.cookie, method: 'PUT', body: { lesson: 'x'.repeat(2001) } })).status, 400);
  assert.equal((await request(`/api/threads/${id}/lesson`, { cookie: alice.cookie, method: 'PUT', body: { lesson: 'I ignored the court calendar.' } })).status, 200);
  assert.equal((await request(`/api/threads/${id}`, { cookie: alice.cookie })).body.thread.lesson, 'I ignored the court calendar.');
});

test('a forecast without a market, and a bad outcome index, are handled safely', async () => {
  const carol = signup('carol');
  const t = await request('/api/threads', { cookie: carol.cookie, body: { researchId: seed('carol', null) } });
  const id = t.body.id;
  const r = await request(`/api/threads/${id}/forecasts`, { cookie: carol.cookie, body: { probability: 30, reasoning: 'x', changeCondition: 'y', outcomeIndex: 99 } });
  assert.equal(r.status, 201);
  const thread = (await request(`/api/threads/${id}`, { cookie: carol.cookie })).body;
  assert.equal(thread.watch, null);                        // no market, nothing to watch
  assert.equal(thread.forecasts[0].market_price, null);
  const journal = (await request('/api/journal', { cookie: carol.cookie })).body;
  assert.equal(journal.entries.length, 1);
  assert.equal(journal.entries[0].watch, null);

  const t2 = await request('/api/threads', { cookie: carol.cookie, body: { researchId: seed('carol', { ...marketRef, id: '777' }) } });
  await request(`/api/threads/${t2.body.id}/forecasts`, { cookie: carol.cookie, body: { probability: 30, reasoning: 'x', changeCondition: 'y', outcomeIndex: 99 } });
  const saved = (await request(`/api/threads/${t2.body.id}`, { cookie: carol.cookie })).body;
  assert.equal(saved.forecasts[0].outcome_index, 0);       // out-of-range index falls back to the first outcome
});

test('a market id that is not a plain number is never looked up', async () => {
  const dave = signup('dave');
  const t = await request('/api/threads', { cookie: dave.cookie, body: { researchId: seed('dave', { ...marketRef, id: '../../etc/passwd' }) } });
  await request(`/api/threads/${t.body.id}/forecasts`, { cookie: dave.cookie, body: { probability: 30, reasoning: 'x', changeCondition: 'y' } });
  const thread = (await request(`/api/threads/${t.body.id}`, { cookie: dave.cookie })).body;
  assert.equal(thread.forecasts[0].market_id, null);
  assert.equal(thread.watch, null);
});

test('an unreachable market is reported as unreachable, not as a result', async () => {
  const erin = signup('erin');
  const t = await request('/api/threads', { cookie: erin.cookie, body: { researchId: seed('erin', { ...marketRef, id: '999' }) } });   // the stand-in has no market 999
  await request(`/api/threads/${t.body.id}/forecasts`, { cookie: erin.cookie, body: { probability: 60, reasoning: 'x', changeCondition: 'y' } });
  const thread = (await request(`/api/threads/${t.body.id}`, { cookie: erin.cookie })).body;
  assert.equal(thread.watch.reachable, false);
  assert.equal(thread.watch.state, 'unknown');
});
