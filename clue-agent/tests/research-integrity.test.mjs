// Finding #2: nobody can save or publish "AI research" that Clue did not produce.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const dir = await mkdtemp(join(tmpdir(), 'clue-integrity-'));
const port = 41000 + Math.floor(Math.random() * 9000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir };
for (const k of ['DATABASE_URL', 'NEAR_AI_API_KEY', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'CLUE_HOSTED']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: 'ignore', cwd: new URL('..', import.meta.url) });
after(async () => { server.kill(); await new Promise((r) => server.once('exit', r)); await rm(dir, { recursive: true, force: true }); });
async function ready() { for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/healthz')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); } throw new Error('server failed to start'); }
const db = () => new Database(join(dir, 'clue.sqlite'));
function signup(name) {
  const d = db(); const token = randomBytes(32).toString('hex'); const now = new Date().toISOString();
  d.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run(name, name, name + '@test.invalid', 0, now, now);
  d.prepare('INSERT INTO wallet_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), name, name, Date.now() + 3600000);
  d.close(); return `clue_wallet=${token}`;
}
function storeResearch(user, { content = 'Server-produced answer.', ageMs = 0 } = {}) {
  const d = db(); const id = randomUUID();
  d.prepare('INSERT INTO research_results (id,user_id,created_at,question,content,sources,market,model,retrieved_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, user, new Date(Date.now() - ageMs).toISOString(), 'Will it rain tomorrow?', content, JSON.stringify(['https://example.org/a']), null, 'test-model', new Date().toISOString());
  d.close(); return id;
}
const post = async (path, cookie, body) => { const r = await fetch(base + path, { method: 'POST', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const get = async (path, cookie) => { const r = await fetch(base + path, { headers: { Cookie: cookie } }); return { status: r.status, body: await r.json() }; };

test('made-up research cannot be saved or published; only research Clue produced can', async () => {
  await ready();
  const mallory = signup('mallory'), alice = signup('alice');
  const PLACEHOLDER = 'Started from a forecast. No research has been run yet.';

  // forged content, sources and model name are refused
  const forged = await post('/api/threads', mallory, { question: 'Will the Fed cut rates?', content: 'VERIFIED BY CLUE: claim at https://evil.example', sources: ['https://evil.example'], model: 'z-ai/glm-5.3-flash', retrievedAt: new Date().toISOString() });
  assert.equal(forged.status, 400);
  // the placeholder cannot carry sources or a model name
  assert.equal((await post('/api/threads', mallory, { question: 'Will the Fed cut rates?', content: PLACEHOLDER, sources: ['https://evil.example'] })).status, 400);
  assert.equal((await post('/api/threads', mallory, { question: 'Will the Fed cut rates?', content: PLACEHOLDER, model: 'z-ai/glm-5.3-flash' })).status, 400);
  // a forecast-only thread is fine, but there is nothing to publish
  const plain = await post('/api/threads', mallory, { question: 'Will the Fed cut rates?', content: PLACEHOLDER, sources: [], model: 'none' });
  assert.equal(plain.status, 201);
  assert.equal((await post(`/api/threads/${plain.body.id}/publish`, mallory, {})).status, 400);

  // someone else's research id, a made-up id and an expired id are refused
  assert.equal((await post('/api/threads', mallory, { researchId: storeResearch('alice') })).status, 400);
  assert.equal((await post('/api/threads', mallory, { researchId: randomUUID() })).status, 400);
  assert.equal((await post('/api/threads', mallory, { researchId: storeResearch('mallory', { ageMs: 2 * 86400000 }) })).status, 400);

  // real research: whatever else the browser sends is ignored; the stored text is what gets saved and published
  const ok = await post('/api/threads', mallory, { researchId: storeResearch('mallory'), content: 'tampered', sources: ['https://evil.example'], model: 'fake' });
  assert.equal(ok.status, 201);
  const thread = await get(`/api/threads/${ok.body.id}`, mallory);
  assert.equal(thread.body.revisions[0].content, 'Server-produced answer.');
  assert.deepEqual(thread.body.revisions[0].sources, ['https://example.org/a']);
  assert.equal(thread.body.revisions[0].model, 'test-model');
  const pub = await post(`/api/threads/${ok.body.id}/publish`, mallory, {});
  assert.equal(pub.status, 201);
  const page = await get(`/api/public/${pub.body.id}`, '');
  assert.equal(page.body.snapshot.content, 'Server-produced answer.');
  assert.equal(JSON.stringify(page.body).includes('evil.example'), false);
  void alice;
});
