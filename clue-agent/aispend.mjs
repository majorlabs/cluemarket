// Spending guard for NEAR AI research. Two hard limits, both stored in the database so a restart cannot reset them:
//   1. each account gets a few free researches per UTC day (default 2);
//   2. all free research together may not cost more than a daily dollar cap (default $0.25).
// A run reserves its worst-case cost before it starts, so parallel requests cannot overshoot the cap.
import { randomUUID } from 'node:crypto';
import { store } from './auth.mjs';

const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
export const config = () => ({
  freePerDay: Math.max(0, Math.floor(num(process.env.CLUE_FREE_RESEARCH_PER_DAY, 2))),
  dailyUsd: Math.max(0, num(process.env.CLUE_AI_DAILY_USD, 0.25)),
  estimateUsd: Math.max(0, num(process.env.CLUE_AI_RUN_ESTIMATE_USD, 0.01)),   // charged when the provider reports no usage
  priceIn: num(process.env.NEAR_AI_PRICE_IN, 0.08),                           // USD per 1M input tokens (GLM 5.3 Flash)
  priceOut: num(process.env.NEAR_AI_PRICE_OUT, 0.5),                          // USD per 1M output tokens
});

export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export const costOf = (usage, cfg = config()) => (usage.input * cfg.priceIn + usage.output * cfg.priceOut) / 1e6;

// Takes the reservation, or says why not. 'user-limit': this account used its free runs. 'daily-cap': the shared cap is reached.
export async function reserve(userId, now = Date.now()) {
  const cfg = config(), day = utcDay(now), id = randomUUID();
  return store.transaction(async tx => {
    const mine = Number((await tx.get("SELECT COUNT(*) AS n FROM ai_usage WHERE user_id=? AND day=? AND status<>'failed'", userId, day))?.n || 0);
    if (mine >= cfg.freePerDay) return { ok: false, reason: 'user-limit' };
    const spent = Number((await tx.get("SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_usage WHERE day=? AND status<>'failed'", day))?.s || 0);
    if (spent + cfg.estimateUsd > cfg.dailyUsd + 1e-9) return { ok: false, reason: 'daily-cap' };
    await tx.run("INSERT INTO ai_usage (id,user_id,day,created_at,status,cost_usd,estimated) VALUES (?,?,?,?,'reserved',?,1)", id, userId, day, new Date(now).toISOString(), cfg.estimateUsd);
    return { ok: true, id };
  });
}

// Record what the run really cost. With no usage report, the reservation stays as the (conservative) cost.
export async function settle(id, usage) {
  const cfg = config();
  if (usage && Number.isFinite(usage.input) && Number.isFinite(usage.output)) {
    const cost = costOf(usage, cfg);
    await store.run("UPDATE ai_usage SET status='done', input_tokens=?, output_tokens=?, cost_usd=?, estimated=0 WHERE id=?", Math.round(usage.input), Math.round(usage.output), cost, id);
    return { cost, estimated: false };
  }
  await store.run("UPDATE ai_usage SET status='done' WHERE id=?", id);
  return { cost: cfg.estimateUsd, estimated: true };
}

// The provider refused or failed before doing work: the user keeps their free run and the cap is not charged.
export async function release(id) { await store.run("UPDATE ai_usage SET status='failed', cost_usd=0 WHERE id=?", id); }

export async function allowance(userId, now = Date.now()) {
  const cfg = config(), day = utcDay(now);
  const used = Number((await store.get("SELECT COUNT(*) AS n FROM ai_usage WHERE user_id=? AND day=? AND status<>'failed'", userId, day))?.n || 0);
  const spent = Number((await store.get("SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_usage WHERE day=? AND status<>'failed'", day))?.s || 0);
  return { freePerDay: cfg.freePerDay, usedToday: used, remaining: Math.max(0, cfg.freePerDay - used), paused: spent + cfg.estimateUsd > cfg.dailyUsd + 1e-9, resetsAt: new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString() };
}
