import { betterAuth } from 'better-auth';
import Database from 'better-sqlite3';
import pg from 'pg';
import { randomBytes, createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const port = Number(process.env.PORT || 3000);
const isPostgres = Boolean(process.env.DATABASE_URL);
const hosted = process.env.CLUE_HOSTED === '1';
if(hosted && !isPostgres) throw new Error('Hosted preview requires Postgres.');
const directory = resolve(process.env.CLUE_DATA_DIR || '.clue-data');
let secret = process.env.BETTER_AUTH_SECRET;
let database;
if (isPostgres) {
  if (!secret || secret.length < 32 || !process.env.BETTER_AUTH_URL) throw new Error('Hosted Postgres requires BETTER_AUTH_SECRET and BETTER_AUTH_URL.');
  database = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
} else {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const secretPath = join(directory, 'auth-secret');
  if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  chmodSync(secretPath, 0o600);
  secret ||= readFileSync(secretPath, 'utf8').trim();
  database = new Database(join(directory, 'clue.sqlite'));
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
}
// Seals the assistant-wallet keys people connect (agent-wallet.mjs). Derived from the server secret, never stored.
export const sealingKey = createHash('sha256').update('clue-agent-wallet:' + (process.env.CLUE_SEAL_SECRET || secret)).digest();
export const auth = betterAuth({ secret, baseURL: process.env.BETTER_AUTH_URL || `http://127.0.0.1:${port}`, database, emailAndPassword: { enabled: false, minPasswordLength: 10 } });
await (await auth.$context).runMigrations();
const schema = `CREATE TABLE IF NOT EXISTS research_threads (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, question TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE CASCADE
); CREATE TABLE IF NOT EXISTS research_revisions (
 id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, created_at TEXT NOT NULL,
 question TEXT NOT NULL, content TEXT NOT NULL, sources TEXT NOT NULL,
 market TEXT, model TEXT NOT NULL, retrieved_at TEXT NOT NULL,
 FOREIGN KEY(thread_id) REFERENCES research_threads(id) ON DELETE CASCADE
); CREATE TABLE IF NOT EXISTS forecast_revisions (
 id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, probability REAL NOT NULL,
 reasoning TEXT NOT NULL, change_condition TEXT NOT NULL, created_at TEXT NOT NULL,
 FOREIGN KEY(thread_id) REFERENCES research_threads(id) ON DELETE CASCADE
); CREATE TABLE IF NOT EXISTS public_reports (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, user_id TEXT NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(thread_id) REFERENCES research_threads(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS public_reports_owner ON public_reports(user_id, thread_id); CREATE INDEX IF NOT EXISTS forecast_thread ON forecast_revisions(thread_id, created_at); CREATE INDEX IF NOT EXISTS research_threads_owner ON research_threads(user_id, updated_at); CREATE INDEX IF NOT EXISTS research_revisions_thread ON research_revisions(thread_id, created_at);;
CREATE TABLE IF NOT EXISTS ai_usage (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, day TEXT NOT NULL, created_at TEXT NOT NULL,
 status TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL NOT NULL, estimated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ai_usage_day ON ai_usage(day, user_id);
CREATE TABLE IF NOT EXISTS trading_accounts (
 user_id TEXT PRIMARY KEY, wallet TEXT NOT NULL, signer TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS fund_deposits (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, deposit_address TEXT NOT NULL, deposit_memo TEXT,
 send_symbol TEXT NOT NULL, send_chain TEXT NOT NULL, send_amount TEXT NOT NULL, send_usd REAL,
 receive_amount TEXT, refund_to TEXT, deadline TEXT, state TEXT NOT NULL DEFAULT 'waiting', delivered_amount TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(user_id, deposit_address),
 FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS fund_deposits_user ON fund_deposits(user_id, created_at);
CREATE TABLE IF NOT EXISTS agent_keys (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
 created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT,
 FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_keys_user ON agent_keys(user_id);
CREATE TABLE IF NOT EXISTS agent_wallets (
 user_id TEXT PRIMARY KEY, provider TEXT NOT NULL, key_sealed TEXT NOT NULL, address TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0, max_order REAL NOT NULL, max_day REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS agent_orders (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, side TEXT,
 token_id TEXT, usd REAL NOT NULL DEFAULT 0, price REAL, status TEXT NOT NULL, reason TEXT,
 FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_orders_day ON agent_orders(user_id, day);
CREATE TABLE IF NOT EXISTS research_results (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL,
 question TEXT NOT NULL, content TEXT NOT NULL, sources TEXT NOT NULL,
 market TEXT, model TEXT NOT NULL, retrieved_at TEXT NOT NULL,
 FOREIGN KEY(user_id) REFERENCES "user"(id) ON DELETE CASCADE
)`;
if (isPostgres) await database.query(schema); else database.exec(schema);
// An assistant key can trade only if the person ticked that when making it. Keys made before this can only read.
if (isPostgres) await database.query('ALTER TABLE agent_keys ADD COLUMN IF NOT EXISTS can_trade INTEGER NOT NULL DEFAULT 0'); else if (!database.prepare('PRAGMA table_info(agent_keys)').all().some(x => x.name === 'can_trade')) database.exec('ALTER TABLE agent_keys ADD COLUMN can_trade INTEGER NOT NULL DEFAULT 0');
if (isPostgres) await database.query('ALTER TABLE forecast_revisions ADD COLUMN IF NOT EXISTS market_snapshot TEXT'); else if (!database.prepare('PRAGMA table_info(forecast_revisions)').all().some(x => x.name === 'market_snapshot')) database.exec('ALTER TABLE forecast_revisions ADD COLUMN market_snapshot TEXT');
for (const column of ['supporting_evidence','opposing_evidence']) { if (isPostgres) await database.query(`ALTER TABLE forecast_revisions ADD COLUMN IF NOT EXISTS ${column} TEXT NOT NULL DEFAULT ''`); else if (!database.prepare('PRAGMA table_info(forecast_revisions)').all().some(x => x.name === column)) database.exec(`ALTER TABLE forecast_revisions ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`); }
const memoryColumns = [['forecast_revisions','market_id','TEXT'],['forecast_revisions','outcome_index','INTEGER NOT NULL DEFAULT 0'],['forecast_revisions','market_price','REAL'],['forecast_revisions','market_question','TEXT'],['forecast_revisions','outcome_label','TEXT'],['research_threads','lesson',"TEXT NOT NULL DEFAULT ''"]];
for (const [table,column,type] of memoryColumns) { if (isPostgres) await database.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`); else if (!database.prepare(`PRAGMA table_info(${table})`).all().some(x => x.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`); }
const params = sql => { let index=0; return sql.replace(/\?/g,()=>`$${++index}`); };
let queue = Promise.resolve();
async function sqliteExclusive(fn) { const previous=queue; let release; queue=new Promise(resolve=>{release=resolve}); await previous; try{return await fn()}finally{release()} }
export const store = {
 async all(sql,...values) { return isPostgres ? (await database.query(params(sql),values)).rows : await sqliteExclusive(()=>database.prepare(sql).all(...values)); },
 async get(sql,...values) { return isPostgres ? (await database.query(params(sql),values)).rows[0] : await sqliteExclusive(()=>database.prepare(sql).get(...values)); },
 async run(sql,...values) { if(isPostgres){const result=await database.query(params(sql),values); return {changes:result.rowCount};} return sqliteExclusive(()=>database.prepare(sql).run(...values)); },
 async transaction(fn) {
  if(isPostgres){const client=await database.connect();try{await client.query('BEGIN');const query=async(sql,...values)=>client.query(params(sql),values);const tx={get:async(sql,...values)=>(await query(sql,...values)).rows[0],run:async(sql,...values)=>query(sql,...values)};const result=await fn(tx);await client.query('COMMIT');return result;}catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}}
  return sqliteExclusive(async()=>{database.exec('BEGIN IMMEDIATE');try{const tx={get:async(sql,...values)=>database.prepare(sql).get(...values),run:async(sql,...values)=>database.prepare(sql).run(...values)};const result=await fn(tx);database.exec('COMMIT');return result;}catch(err){database.exec('ROLLBACK');throw err;}});
 }
};
