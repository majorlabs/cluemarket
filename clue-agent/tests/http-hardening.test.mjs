// Findings #5 and #6: every state-changing request needs an approved Origin; internal errors are not shown to users.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const dir = await mkdtemp(join(tmpdir(), 'clue-http-'));
const port = 42000 + Math.floor(Math.random() * 9000), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, PORT: String(port), CLUE_DATA_DIR: dir };
for (const k of ['DATABASE_URL', 'NEAR_AI_API_KEY', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'CLUE_HOSTED']) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { env, stdio: 'ignore', cwd: new URL('..', import.meta.url) });
after(async () => { server.kill(); await new Promise((r) => server.once('exit', r)); await rm(dir, { recursive: true, force: true }); });

test('cross-site deletes are refused; broken requests get a plain error', async () => {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const db = new Database(join(dir, 'clue.sqlite')); const token = randomBytes(32).toString('hex'); const now = new Date().toISOString();
  db.prepare('INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').run('alice', 'alice', 'a@test.invalid', 0, now, now);
  db.prepare('INSERT INTO wallet_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(token).digest('hex'), 'alice', 'alice', Date.now() + 3600000); db.close();
  const cookie = `clue_wallet=${token}`;
  const made = await fetch(base + '/api/threads', { method: 'POST', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Will it rain tomorrow?', content: 'Started from a forecast. No research has been run yet.', sources: [], model: 'none' }) });
  const id = (await made.json()).id;
  // a page on another site tries to delete Alice's research with her cookie
  assert.equal((await fetch(`${base}/api/threads/${id}`, { method: 'DELETE', headers: { Origin: 'https://evil.example', Cookie: cookie } })).status, 403);
  assert.equal((await fetch(`${base}/api/threads/${id}`, { method: 'DELETE', headers: { Cookie: cookie } })).status, 403, 'no Origin header at all');
  assert.equal((await fetch(`${base}/api/threads/${id}`, { headers: { Cookie: cookie } })).status, 200, 'still there');
  assert.equal((await fetch(`${base}/api/threads/${id}`, { method: 'DELETE', headers: { Origin: base, Cookie: cookie } })).status, 200, 'same-site delete works');
  // broken JSON: a plain 400, no parser internals
  const bad = await fetch(base + '/api/threads', { method: 'POST', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"question": oops' });
  const body = await bad.json();
  assert.equal(bad.status, 400); assert.equal(body.error, 'Request body must be valid JSON.');
  assert.equal(/Unexpected token|SyntaxError|at JSON/.test(JSON.stringify(body)), false);
  void randomUUID;
});
