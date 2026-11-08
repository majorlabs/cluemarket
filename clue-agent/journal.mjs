// Server side of the memory loop: live market lookups and the journal built from a user's saved forecasts.
import { store } from './auth.mjs';
import { assess, summarize, validMarketId } from './memory.mjs';

const GAMMA = (process.env.CLUE_GAMMA_BASE || 'https://gamma-api.polymarket.com').replace(/\/+$/, '');
const TTL_MS = Number.isFinite(Number(process.env.CLUE_LIVE_TTL_MS)) && process.env.CLUE_LIVE_TTL_MS !== undefined ? Number(process.env.CLUE_LIVE_TTL_MS) : 60_000;
const cache = new Map();

const parseList = v => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };

// The market as Polymarket shows it now. Cached for a minute so a busy journal does not hammer Polymarket.
export async function liveMarket(id, now = Date.now()) {
  if (!validMarketId(id)) return null;
  const hit = cache.get(id);
  if (hit && now - hit.at < TTL_MS) return hit.data;
  let data = null;
  try {
    const response = await fetch(`${GAMMA}/markets/${id}`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } });
    if (response.ok) {
      const m = await response.json();
      data = { closed: Boolean(m.closed), outcomePrices: parseList(m.outcomePrices), outcomes: parseList(m.outcomes), endDate: m.endDate || null, question: m.question || null, rules: typeof m.description === 'string' ? m.description : null, eventSlug: m.events?.[0]?.slug || null };
    }
  } catch { /* leave null: the page says the market could not be reached */ }
  if (data) { if (cache.size > 500) cache.clear(); cache.set(id, { at: now, data }); }
  return data;
}

// The market a piece of research or a forecast is about, exactly as Polymarket describes it. The browser only names the market (its numeric id);
// the question, rules and outcomes are read from Polymarket here, so nothing typed or altered in the browser can pose as market text.
export async function marketRecord(id) {
  if (!validMarketId(String(id))) throw Object.assign(new Error('That is not a valid market.'), { status: 400 });
  const m = await liveMarket(String(id));
  if (!m || !m.question) throw Object.assign(new Error('Could not load that market from Polymarket. Try again in a moment.'), { status: 502 });
  const outcomes = m.outcomes.length ? m.outcomes.map(String) : ['Yes', 'No'];
  return { id: String(id), question: String(m.question).slice(0, 1000), rules: m.rules ? m.rules.slice(0, 8000) : null, outcomes, endDate: m.endDate, eventSlug: m.eventSlug, sourceUrl: m.eventSlug ? `https://polymarket.com/event/${encodeURIComponent(m.eventSlug)}` : null };
}

// Facts about the market a forecast is about, taken from what the server stored with the research, never from the browser.
export async function marketFacts(snapshotJson, outcomeIndex) {
  let snap = null;
  try { snap = snapshotJson ? JSON.parse(snapshotJson) : null; } catch { /* ignore */ }
  if (!snap || !validMarketId(String(snap.id))) return { id: null, question: null, label: null, price: null, index: 0 };
  const outcomes = Array.isArray(snap.outcomes) && snap.outcomes.length ? snap.outcomes : ['Yes', 'No'];
  const index = Number.isInteger(outcomeIndex) && outcomeIndex >= 0 && outcomeIndex < outcomes.length ? outcomeIndex : 0;
  const live = await liveMarket(String(snap.id));
  const price = live ? Number(live.outcomePrices[index]) : NaN;
  return { id: String(snap.id), question: String(snap.question || '').slice(0, 500) || null, label: String(outcomes[index]).slice(0, 80), price: Number.isFinite(price) ? price : null, index };
}

// Older forecasts only kept the market snapshot; recover what we can from it.
export function forecastMarket(f) {
  if (f.market_id) return { id: f.market_id, question: f.market_question, label: f.outcome_label };
  try {
    const s = f.market_snapshot ? JSON.parse(f.market_snapshot) : null;
    if (s && validMarketId(String(s.id))) return { id: String(s.id), question: s.question || null, label: (s.outcomes || [])[0] || 'Yes' };
  } catch { /* ignore */ }
  return null;
}

export async function watchFor(forecast) {
  const market = forecastMarket(forecast);
  if (!market) return null;
  const live = await liveMarket(market.id);
  return { market, reachable: Boolean(live), ...(assess(forecast, live) || {}) };
}

async function pool(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}

export async function journalFor(owner) {
  const threads = await store.all('SELECT id, question, created_at, updated_at, lesson FROM research_threads WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100', owner);
  const rows = await store.all('SELECT f.id, f.thread_id, f.probability, f.reasoning, f.change_condition, f.created_at, f.market_snapshot, f.market_id, f.outcome_index, f.market_price, f.market_question, f.outcome_label FROM forecast_revisions f JOIN research_threads t ON t.id = f.thread_id WHERE t.user_id = ? ORDER BY f.created_at DESC', owner);
  const latest = new Map(), counts = new Map();
  for (const f of rows) { counts.set(f.thread_id, (counts.get(f.thread_id) || 0) + 1); if (!latest.has(f.thread_id)) latest.set(f.thread_id, f); }
  const items = threads.map(t => ({ t, f: latest.get(t.id) })).filter(x => x.f);
  const entries = await pool(items, 5, async ({ t, f }) => {
    const watch = await watchFor(f);
    return { thread: { id: t.id, question: t.question, updated_at: t.updated_at, lesson: t.lesson || '' }, forecast: { id: f.id, probability: f.probability, reasoning: f.reasoning, change_condition: f.change_condition, created_at: f.created_at, revisions: counts.get(t.id) }, watch };
  });
  const without = threads.filter(t => !latest.has(t.id)).map(t => ({ id: t.id, question: t.question, updated_at: t.updated_at }));
  return { entries, withoutForecast: without, summary: summarize(entries.map(e => e.watch)) };
}
