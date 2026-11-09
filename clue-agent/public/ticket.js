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
      if (o.tickSize && Math.abs(lim / o.tickSize - Math.round(lim / o.tickSize)) > 1e-6) warn("warn", `Price must be a multiple of ${o.tickSize}. The market would reject this one.`);
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
    if (o.minSize && total > 0 && total < o.minSize - 1e-9) warn("block", `The minimum order is ${o.minSize} shares. This is ${fmt(total)}.`);
    if (o.accepting === false) warn("block", "This market isn't accepting orders right now.");
    out.ok = !out.warnings.some((w) => w.level === "block") && total > 0;
    return out;
  }

  /**
   * Decide whether a market buy may be sent, and the worst price Clue will accept for it.
   * Everything is re-checked against the live book at the moment of ordering, not when the page was drawn.
   * `preview` is previewBuy({mode:"market"}) run on a fresh book. `balance` is dollars in the user's trading account, or null if unknown.
   * The order is all-or-nothing: it only goes through if it fills completely at no worse than `maxPrice`.
   */
  function orderPlan(o) {
    const no = (reason) => ({ ok: false, reason });
    const r = o.preview;
    if (!o.signedIn) return no("Sign in to trade.");
    if (!o.geo || o.geo.state !== "ok") return no(o.geo && o.geo.state === "blocked" ? "Trading isn't available where you are." : "Your location couldn't be checked, so trading stays off.");
    if (!o.setUp) return no("Set up trading first.");
    if (o.accepting === false) return no("This market isn't accepting orders right now.");
    if (!r || !r.sharesFilled) return no("Nobody is selling this outcome right now.");
    if (r.restingShares > 0 || r.unfilledBudget > 0.005) return no("There aren't enough sellers for this amount. Try a smaller amount.");
    const minSize = o.minSize || 5;
    if (r.sharesFilled < minSize - 1e-9) return no(`The minimum order is ${minSize} shares. This is ${fmt(r.sharesFilled)}.`);
    const need = r.cost + r.platformFee + (r.builderFee || 0);
    if (o.balance == null) return no("Your balance couldn't be read.");
    if (o.balance + 1e-9 < need) return no(`You need ${money(need)} in your account and have ${money(o.balance)}. Use Add money.`);
    const worst = r.fills[r.fills.length - 1].price;
    const tick = o.tickSize || 0.01, tol = o.tolerance == null ? 0.01 : o.tolerance;
    const steps = Math.ceil((worst * (1 + tol)) / tick - 1e-9);
    const top = Math.round((1 - tick) * 1e6) / 1e6;          // the highest price the market can take: one step below $1
    const maxPrice = Math.min(top, Math.round(steps * tick * 1e6) / 1e6);
    if (maxPrice < worst - 1e-9) return no("The price is too close to $1 to order safely.");
    return { ok: true, spend: Math.round(r.cost * 100) / 100, shares: r.sharesFilled, maxPrice, expectedCost: need, worstFill: worst };
  }

  /** Only addresses of the right shape are ever shown for deposits: EVM (0x + 40 hex) or Solana (32-44 base58 characters). */
  function validDepositAddress(kind, value) {
    const v = String(value || "");
    if (kind === "evm") return /^0x[0-9a-fA-F]{40}$/.test(v);
    if (kind === "svm") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
    return false;
  }

  /** Where a position stands: still open; or the market ended and it won, paid out only part (a tie, for example), or lost. */
  function positionState(p) {
    if (!p || !p.redeemable) return "open";
    if (Number(p.current_price) >= 0.99) return "won";
    return Number(p.current_value) > 0 ? "partial" : "lost";
  }
  /** A position's market id, if it is one that can be claimed. */
  function claimId(p) { return p && /^0x[0-9a-fA-F]{64}$/.test(String(p.condition_id || "")) ? p.condition_id : null; }
  /** Profit or loss on a position the way Polymarket counts it (value now minus what was paid, fees apart), and as a share of what was paid. */
  function positionNumbers(p) {
    const cost = Number(p.entry_cost_usdc) || 0, pnl = Number(p.unrealized_pnl) || 0;
    return { value: Number(p.current_value) || 0, pnl, pct: cost > 0 ? pnl / cost : 0, shares: Number(p.current_size) || 0, avg: Number(p.avg_price) || 0, now: Number(p.current_price) || 0, paid: Number(p.total_cost_usdc) || cost };
  }
  /** The totals at the top of the portfolio. */
  function portfolioTotals(list) {
    let value = 0, openPnl = 0, toClaim = 0, open = 0;
    for (const p of list || []) {
      const s = positionState(p), n = positionNumbers(p);
      if (s === "open") { value += n.value; openPnl += n.pnl; open++; } else if (s === "won" || s === "partial") toClaim += n.value;
    }
    return { value, openPnl, toClaim, open };
  }

  /** The request that reads a trading account's cash: pUSD (Polymarket's dollar, 6 decimals) held at that address. null if the address is malformed. */
  function cashCall(wallet) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(wallet || ""))) return null;
    return { to: "0xc011a7e12a19f7b1f670d46f03b03f3342e82dfb", data: "0x70a08231" + wallet.slice(2).toLowerCase().padStart(64, "0") };
  }
  /** Dollars from the chain's answer, or null if the answer is not a number. */
  function cashParse(result) {
    if (typeof result !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(result)) return null;
    const n = Number(BigInt(result)) / 1e6;
    return Number.isFinite(n) ? n : null;
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

  root.ClueTicket = { previewBuy, checkGeoblock, orderPlan, validDepositAddress, cashCall, cashParse, positionState, positionNumbers, portfolioTotals, claimId };
})(typeof window !== "undefined" ? window : globalThis);
