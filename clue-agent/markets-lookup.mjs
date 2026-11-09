// Names for markets, looked up by the market id Polymarket gives an order. An order only carries the id, and people need to see "Will Gen.G win
// Worlds 2026?". Polymarket's market list does not allow browsers to ask it directly, so the server asks and passes on only what the page shows.

const GAMMA = () => process.env.CLUE_GAMMA_BASE || 'https://gamma-api.polymarket.com';
const ID = /^0x[0-9a-fA-F]{64}$/;
export const MAX_IDS = 20;

/** The well-formed, distinct ids out of a comma-separated list. At most MAX_IDS. */
export function parseIds(text) {
  const seen = new Set();
  for (const raw of String(text || '').split(',')) { const id = raw.trim().toLowerCase(); if (ID.test(id)) seen.add(id); if (seen.size >= MAX_IDS) break; }
  return [...seen];
}

export async function marketsByCondition(ids, { fetchImpl = fetch } = {}) {
  if (!ids.length) return {};
  const url = new URL(`${GAMMA()}/markets`);
  for (const id of ids) url.searchParams.append('condition_ids', id);
  url.searchParams.set('limit', String(MAX_IDS));
  let r;
  try { r = await fetchImpl(url, { signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } }); }
  catch { throw Object.assign(new Error('Market names are unavailable right now.'), { status: 502 }); }
  if (!r.ok) throw Object.assign(new Error('Market names are unavailable right now.'), { status: 502 });
  const list = await r.json().catch(() => []);
  const out = {};
  for (const m of Array.isArray(list) ? list : []) {
    const id = String(m && m.conditionId || '').toLowerCase();
    if (!ids.includes(id)) continue;                                       // only what was asked for
    const ev = Array.isArray(m.events) && m.events[0] ? m.events[0] : {};
    out[id] = { question: String(m.question || '').slice(0, 200), group: String(m.groupItemTitle || '').slice(0, 80), eventSlug: String(ev.slug || '').slice(0, 200) };
  }
  return out;
}
