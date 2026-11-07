// Sliding one-hour budgets for paid work (NEAR AI research). In memory: resets when the server restarts.
export class HourlyBudget {
  constructor(limit, now = () => Date.now()) { this.limit = limit; this.now = now; this.hits = new Map(); }
  take(key = 'all') {
    const t = this.now();
    const recent = (this.hits.get(key) || []).filter((x) => x > t - 3600000);
    if (recent.length >= this.limit) { this.hits.set(key, recent); return false; }
    recent.push(t); this.hits.set(key, recent); return true;
  }
}
