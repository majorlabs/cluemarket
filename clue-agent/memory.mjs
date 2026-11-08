// The memory loop: what a market looks like now compared with when the user made a forecast,
// and, once it resolves, how the forecast did. Pure functions; the server supplies live data.

export const MOVE_POINTS = 5;        // price change (percentage points) worth telling the user about
export const GAP_POINTS = 10;        // user's forecast vs market price, worth pointing out
export const CLOSING_DAYS = 7;
export const MIN_FOR_VERDICT = 5;    // below this many resolved forecasts, say there is too little to judge

const num = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const clamp01 = n => Math.min(1, Math.max(0, n));

// Polymarket marks a resolved market closed with prices of exactly 1 and 0. Anything between is not resolved.
export function liveState(live, outcomeIndex) {
  if (!live || typeof live !== 'object') return { state: 'unknown' };
  const prices = (Array.isArray(live.outcomePrices) ? live.outcomePrices : []).map(num);
  const price = prices[outcomeIndex] ?? null;
  const base = { price, endDate: live.endDate || null };
  if (!live.closed) return { ...base, state: 'open' };
  const winner = prices.findIndex(p => p !== null && p >= 0.99);
  if (winner === -1 || price === null || prices.some(p => p === null)) return { ...base, state: 'closed' };
  return { ...base, state: 'resolved', won: winner === outcomeIndex };
}

export const brier = (probability, happened) => (clamp01(probability / 100) - (happened ? 1 : 0)) ** 2;

// One forecast revision (the latest for a thread) against live data.
export function assess(forecast, live, now = Date.now()) {
  if (!forecast) return null;
  const idx = Number.isInteger(forecast.outcome_index) ? forecast.outcome_index : 0;
  const atSave = num(forecast.market_price);          // 0..1, fetched by the server when saved
  const s = liveState(live, idx);
  const out = { state: s.state, outcomeIndex: idx, forecast: forecast.probability, marketAtForecast: atSave, marketNow: s.price, flags: [] };
  if (s.state === 'unknown') return out;
  if (s.state === 'resolved') {
    const happened = s.won;
    out.happened = happened;
    out.score = {
      you: brier(forecast.probability, happened),
      market: atSave === null ? null : brier(atSave * 100, happened),
      pointsToward: happened ? forecast.probability : 100 - forecast.probability, // how much of your 100 points were on the right side
    };
    out.score.beatMarket = out.score.market === null ? null : out.score.you < out.score.market;
    out.flags.push('resolved');
    return out;
  }
  if (s.state === 'closed') { out.flags.push('awaiting-resolution'); return out; }
  if (s.price !== null && atSave !== null) {
    const move = (s.price - atSave) * 100;
    out.movePoints = Math.round(move * 10) / 10;
    if (Math.abs(move) >= MOVE_POINTS) out.flags.push('moved');
  }
  if (s.price !== null) {
    const gap = forecast.probability - s.price * 100;
    out.gapPoints = Math.round(gap * 10) / 10;
    if (Math.abs(gap) >= GAP_POINTS) out.flags.push('gap');
  }
  const end = s.endDate ? Date.parse(s.endDate) : NaN;
  if (Number.isFinite(end)) {
    const days = (end - now) / 86400000;
    out.daysToClose = Math.round(days * 10) / 10;
    if (days >= 0 && days <= CLOSING_DAYS) out.flags.push('closing-soon');
  }
  return out;
}

// Track record over resolved forecasts only. Never claims skill from a handful of results.
export function summarize(assessments) {
  const resolved = assessments.filter(a => a?.state === 'resolved');
  const open = assessments.filter(a => a?.state === 'open' || a?.state === 'closed').length;
  const withMarket = resolved.filter(a => a.score.market !== null);
  const mean = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
  const right = resolved.filter(a => (a.forecast >= 50) === a.happened).length;
  const summary = {
    resolved: resolved.length,
    open,
    rightSide: right,                                   // forecast was on the correct side of 50%
    brier: mean(resolved.map(a => a.score.you)),         // lower is better; always guessing 50% scores 0.25
    marketBrier: mean(withMarket.map(a => a.score.market)),
    comparedWithMarket: withMarket.length,
    beatMarket: withMarket.filter(a => a.score.beatMarket).length,
  };
  summary.verdict = resolved.length === 0 ? 'none'
    : resolved.length < MIN_FOR_VERDICT ? 'too-few'
    : summary.marketBrier === null ? 'no-market'
    : summary.brier < summary.marketBrier ? 'better' : summary.brier > summary.marketBrier ? 'worse' : 'same';
  return summary;
}

// What the server will accept as a market-price lookup: a Polymarket numeric market id.
export const validMarketId = id => typeof id === 'string' && /^\d{1,20}$/.test(id);
