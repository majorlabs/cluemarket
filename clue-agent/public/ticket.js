/* Trade ticket maths and location check. Preview only: nothing here places an order.
   Fee formula (Polymarket docs, "Builder Fees"): platform_fee = shares x feeRate x p x (1 - p), taker side only.
   Exposed as window.ClueTicket. Also loadable in tests with new Function('window', source)(sandbox). */
(function (root) {
  "use strict";

  /**
   * Preview a BUY against the sell side of the book.
   * mode "market": spend a budget (pUSD) walking the asks from the best price up.
   * mode "limit":  buy `shares` at no more than `limitPrice`; whatever can't fill now rests on the book.
   * asks: [{price, size}] sorted ascending by price. Prices are 0..1 per share; a winning share pays 1.
   */
  function previewBuy(o) {
    const asks = (o.asks || []).filter((l) => l.price > 0 && l.size > 0).sort((a, b) => a.price - b.price);
    const feeOn = !!o.feesEnabled && o.feeRate > 0;
    const out = {
      mode: o.mode, fills: [], sharesFilled: 0, cost: 0, avgPrice: null, platformFee: 0, builderFee: 0,
      restingShares: 0, restingPrice: null, unfilledBudget: 0, maxPayout: 0, profitIfWin: null,
      bestAsk: asks[0] ? asks[0].price : null, slippagePts: null, warnings: [], ok: false,
    };
    const warn = (level, text) => out.warnings.push({ level, text });

    if (!asks.length && o.mode === "market") { warn("block", "Nobody is selling this outcome right now, so a market buy can't fill."); return out; }

    if (o.mode === "market") {
      let budget = Number(o.spend) || 0;
      if (budget <= 0) { warn("info", "Enter an amount to preview."); return out; }
      for (const l of asks) {
        if (budget <= 1e-9) break;
        const take = Math.min(budget, l.price * l.size);
        const sh = take / l.price;
        out.fills.push({ price: l.price, shares: sh });
        out.sharesFilled += sh; out.cost += take; budget -= take;
        if (feeOn) out.platformFee += sh * o.feeRate * l.price * (1 - l.price);
      }
      out.unfilledBudget = Math.max(0, budget);
      if (out.unfilledBudget > 0.005) warn("warn", `Only ${money(out.cost)} of your ${money(Number(o.spend))} could fill. There aren't enough sellers.`);
    } else {
      const want = Number(o.shares) || 0, lim = Number(o.limitPrice) || 0;
      if (want <= 0 || lim <= 0 || lim >= 1) { warn("info", "Enter a price between 0 and 1 and a number of shares."); return out; }
      let left = want;
      for (const l of asks) {
        if (l.price > lim + 1e-12 || left <= 1e-9) break;
        const sh = Math.min(left, l.size);
        out.fills.push({ price: l.price, shares: sh });
        out.sharesFilled += sh; out.cost += sh * l.price; left -= sh;
        if (feeOn) out.platformFee += sh * o.feeRate * l.price * (1 - l.price);
      }
      out.restingShares = Math.max(0, left);
      out.restingPrice = out.restingShares > 0 ? lim : null;
      if (o.tickSize && Math.abs(lim / o.tickSize - Math.round(lim / o.tickSize)) > 1e-6) warn("warn", `Price must be a multiple of ${o.tickSize}. Polymarket will reject this one.`);
      if (out.restingShares > 0) warn("info", `${fmt(out.restingShares)} shares wouldn't fill now. They'd wait for a seller at ${pct(lim)} and might never fill.`);
    }

    out.avgPrice = out.sharesFilled > 0 ? out.cost / out.sharesFilled : null;
    out.builderFee = (o.builderFeeBps || 0) > 0 ? (out.cost * o.builderFeeBps) / 10000 : 0;
    out.maxPayout = out.sharesFilled + out.restingShares;
    out.profitIfWin = out.sharesFilled > 0 ? out.sharesFilled - out.cost - out.platformFee - out.builderFee : null;
    if (out.avgPrice != null && out.bestAsk != null) {
      out.slippagePts = (out.avgPrice - out.bestAsk) * 100;
      if (out.slippagePts >= 2) warn("warn", `You'd pay ${out.slippagePts.toFixed(1)} points above the best price because your order uses up the cheapest sellers first.`);
    }
    if (o.bestBid != null && out.bestAsk != null && out.bestAsk - o.bestBid >= 0.1) warn("warn", `Thin market: buyers and sellers are ${((out.bestAsk - o.bestBid) * 100).toFixed(0)} points apart. Selling back later could cost a lot.`);
    const total = out.sharesFilled + out.restingShares;
    if (o.minSize && total > 0 && total < o.minSize - 1e-9) warn("block", `Polymarket's minimum order is ${o.minSize} shares. This is ${fmt(total)}.`);
    if (o.accepting === false) warn("block", "This market isn't accepting orders right now.");
    out.ok = !out.warnings.some((w) => w.level === "block") && total > 0;
    return out;
  }

  /** Ask Polymarket whether the visitor's location may place orders. Runs in the visitor's browser so it sees their real location. */
  async function checkGeoblock(fetchImpl) {
    const f = fetchImpl || (root.fetch && root.fetch.bind(root));
    try {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const t = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
      const r = await f("https://polymarket.com/api/geoblock", ctl ? { signal: ctl.signal } : undefined);
      if (t) clearTimeout(t);
      if (!r.ok) return { state: "unknown" };
      const d = await r.json();
      return { state: d.blocked ? "blocked" : "ok", country: d.country || null, region: d.region || null };
    } catch { return { state: "unknown" }; }
  }

  const money = (n) => "$" + (Number.isFinite(n) ? n.toFixed(2) : "0.00");
  const fmt = (n) => (Number.isFinite(n) ? (Math.round(n * 100) / 100).toString() : "0");
  const pct = (p) => (p * 100).toFixed(p < 0.1 ? 1 : 0) + "¢";

  root.ClueTicket = { previewBuy, checkGeoblock };
})(typeof window !== "undefined" ? window : globalThis);
