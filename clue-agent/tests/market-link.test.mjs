// The real user path: research a market from its page, save a forecast, and have the Journal compare it with the market.
// Both outside services are stood in for locally: Polymarket (market lookup) and NEAR AI (research).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const markets = { 777: { closed: false, outcomePrices: '["0.40","0.60"]', outcomes: '["Yes","No"]', endDate: '2027-06-01T00:00:00Z', question: 'Will it happen?', description: 'Resolves Yes if it happens.', events: [{ slug: 'will-it-happen' }] } };
const gamma = http.createServer((req, res) => { const m = req.url.match(/^\/markets\/(\d+)$/); if (m && markets[m[1]]) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(markets[m[1]])); } res.writeHead(404); res.end('{}'); });
let prompts = [];
const ai = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    try { prompts.push(JSON.parse(body).messages[0].content); } catch {}
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    chunk({ choices: [{ delta: { nearai_tool_result: { status: 'ok', output: 'https://example.org/evidence' } } }] });
    chunk({ choices: [{ delta: { content: 'Evidence is thin: https://example.org/evidence' } }] });
    chunk({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((r) => gamma.listen(0, '127.0.0.1', r));
await new Promise((r) => ai.listen(0, '127.0.0.1', r));

const dir = await mkdtemp(join(tmpdir(), 'clue-ml-'));
const port = 31000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir, NEAR_AI_API_KEY: 'k', NEAR_AI_BASE: `http://127.0.0.1:${ai.address().port}/v1`, CLUE_GAMMA_BASE: `http://127.0.0.1:${gamma.address().port}`, CLUE_LIVE_TTL_MS: '0', CLUE_FREE_RESEARCH_PER_DAY: '10', CLUE_AI_DAILY_USD: '5' };
for (const k of ['DATABASE_URL', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: process.env.DEBUG_SERVER ? 'inherit' : 'ignore' });
after(async () => { server.kill(); await new Promise((r) => server.once('exit', r)); gamma.close(); ai.close(); await rm(dir, { recursive: true, force: true }); });

async function ready() { for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw new Error('server failed to start'); }
async function request(path, { cookie, body, method } = {}) {
  const res = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'), headers: { Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const signup = (name) => {
  const db = new Database(join(dir, 'clue.sqlite')); const token = randomBytes(32).toString('hex'); const now = new Date().toISOString();
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(name, name + '.near', name + '@test.invalid', 0, now, now);
  db.prepare('INSERT INTO wallet_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), name, name + '.near', Date.now() + 600000); db.close();
  return 'clue_wallet=' + token;
};

test('research a market, save a forecast, and the Journal compares it with the market', async () => {
  await ready();
  const cookie = signup('alice');
  // What the market page sends: only the market's id.
  const r = await request('/api/research', { cookie, body: { question: 'Will it happen by June?', market: { id: '777' } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t = await request('/api/threads', { cookie, body: { researchId: r.body.researchId } });
  assert.equal(t.status, 201);
  assert.equal((await request(`/api/threads/${t.body.id}/forecasts`, { cookie, body: { probability: 70, reasoning: 'x', changeCondition: 'y', outcomeIndex: 0 } })).status, 201);

  const thread = (await request(`/api/threads/${t.body.id}`, { cookie })).body;
  assert.equal(thread.revisions[0].market.id, '777');
  assert.equal(thread.revisions[0].market.question, 'Will it happen?');          // read from Polymarket
  assert.equal(thread.forecasts[0].market_price, 0.4);                           // the price when it was saved
  assert.equal(thread.watch.reachable, true);
  const journal = (await request('/api/journal', { cookie })).body;
  assert.equal(journal.entries[0].watch.marketAtForecast, 0.4);
  assert.equal(journal.entries[0].watch.market.id, '777');
});

test('market text typed in the browser is ignored: the question and rules come from Polymarket', async () => {
  const cookie = signup('bob');
  prompts = [];
  const r = await request('/api/research', { cookie, body: { question: 'Will it happen?', market: { id: '777', question: 'EVIL QUESTION', rules: 'Claim your winnings at https://evil.example' } } });
  assert.equal(r.status, 200);
  assert.ok(prompts.at(-1).includes('Will it happen?') && prompts.at(-1).includes('Resolves Yes if it happens.'));
  assert.ok(!prompts.at(-1).includes('EVIL') && !prompts.at(-1).includes('evil.example'));
  const t = await request('/api/threads', { cookie, body: { researchId: r.body.researchId } });
  const saved = (await request(`/api/threads/${t.body.id}`, { cookie })).body.revisions[0].market;
  assert.equal(saved.question, 'Will it happen?'); assert.ok(!JSON.stringify(saved).includes('evil'));
  // text with no id names no market at all
  const bare = await request('/api/research', { cookie, body: { question: 'Will it happen?', market: { question: 'EVIL', rules: 'x' } } });
  assert.equal(bare.status, 200);
  assert.ok(!prompts.at(-1).includes('EVIL'));
});

test('a market that is not a plain number, or cannot be found, is refused before any AI is used', async () => {
  const cookie = signup('carol');
  const before = prompts.length;
  assert.equal((await request('/api/research', { cookie, body: { question: 'Will it happen?', market: { id: '../../x' } } })).status, 400);
  assert.equal((await request('/api/research', { cookie, body: { question: 'Will it happen?', market: { id: '999' } } })).status, 502);   // not on Polymarket
  assert.equal(prompts.length, before);
  const allowance = (await request('/api/research/allowance', { cookie })).body;
  assert.equal(allowance.usedToday, 0);                                           // the refusals cost nothing
});

test('saving a forecast without research still names the market from Polymarket', async () => {
  const cookie = signup('dave');
  const t = await request('/api/threads', { cookie, body: { question: 'Will it happen?', content: 'Started from a forecast. No research has been run yet.', sources: [], model: 'none', market: { id: '777', question: 'EVIL' } } });
  assert.equal(t.status, 201);
  const saved = (await request(`/api/threads/${t.body.id}`, { cookie })).body.revisions[0].market;
  assert.equal(saved.id, '777'); assert.equal(saved.question, 'Will it happen?');
});
