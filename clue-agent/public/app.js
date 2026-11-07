/* Clue front end. Plain JS, no build step. All text from the network is inserted with textContent. */
"use strict";

const $ = (id) => document.getElementById(id);
const app = $("app");
const IMG_HOST = "polymarket-upload.s3.us-east-2.amazonaws.com";
const CATEGORIES = [
  ["Trending", ""], ["Politics", "politics"], ["Sports", "sports"], ["Crypto", "crypto"],
  ["Economy", "economy"], ["Finance", "finance"], ["Tech", "tech"], ["Culture", "culture"], ["World", "world"],
];
const EXAMPLES = [
  "Will the Fed cut rates at its next meeting?",
  "Who is likely to win the next UK general election?",
  "Will Bitcoin reach a new all-time high this year?",
  "How close is AGI, according to credible sources?",
];

let user = null;
let navToken = 0;

/* ---------- helpers ---------- */
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
}
const pct = (p, d = 0) => (p == null || !Number.isFinite(Number(p)) ? "—" : `${(Number(p) * 100).toFixed(Number(p) > 0 && Number(p) < 0.01 ? 1 : d)}%`);
const money = (n) => (!n ? "$0" : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "unavailable");
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "no end date");
const ended = (iso) => iso && new Date(iso).getTime() < Date.now();
function safeImg(url) { try { const u = new URL(url); return u.protocol === "https:" && u.hostname === IMG_HOST ? u.href : null; } catch { return null; } }
function safeLink(url, fallback = "https://polymarket.com/") { try { const u = new URL(url); return u.protocol === "https:" ? u.href : fallback; } catch { return fallback; } }
async function api(path, opts) {
  const r = await fetch(path, opts);
  let d = {};
  try { d = await r.json(); } catch { /* non-JSON error body */ }
  if (!r.ok) throw new Error(d.message || d.error || `Request failed (${r.status})`);
  return d;
}
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
function thumb(m, cls = "") {
  const src = safeImg(m.image);
  if (src) { const i = el("img", { class: `thumb ${cls}`, src, alt: "", loading: "lazy", width: 44, height: 44 }); i.onerror = () => i.replaceWith(el("div", { class: `thumb ph ${cls}`, text: (m.title || m.question || "?")[0] })); return i; }
  return el("div", { class: `thumb ph ${cls}`, text: (m.title || m.question || "?")[0] });
}
function linkify(target, text) {
  target.replaceChildren();
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>)\]"']+/g)) {
    target.append(text.slice(last, m.index));
    let v = m[0], tail = "";
    while (/[.,;:]$/.test(v)) { tail = v.slice(-1) + tail; v = v.slice(0, -1); }
    try { const u = new URL(v); target.append(el("a", { href: u.href, target: "_blank", rel: "noopener noreferrer", text: v })); } catch { target.append(v); }
    target.append(tail);
    last = m.index + m[0].length;
  }
  target.append(text.slice(last));
}
function sourceChips(urls) {
  const box = el("div", { class: "sources", "aria-label": "Sources" });
  for (const url of [...new Set(urls)].slice(0, 8)) {
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) continue; box.append(el("a", { href: u.href, target: "_blank", rel: "noopener noreferrer", text: u.hostname.replace(/^www\./, "") })); } catch { /* skip */ }
  }
  return box;
}
const errBox = (title, detail, retry) => el("div", { class: "err-box", role: "alert" }, el("strong", { text: title }), el("p", { text: detail }), retry && el("button", { class: "btn small", style: "margin-top:10px", onclick: retry, text: "Try again" }));

/* ---------- shell ---------- */
function buildCategories(active) {
  const nav = $("categories");
  nav.replaceChildren(...CATEGORIES.map(([label, tag]) => el("a", { href: tag ? `#/?tag=${tag}` : "#/", "aria-current": String(active === tag) }, label)));
}
function setNav(name) {
  document.querySelectorAll("[data-nav]").forEach((a) => (a.dataset.nav === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  $("categories").hidden = name !== "board";
}
$("top-search").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("top-q").value.trim();
  if (q.length >= 2) location.hash = `#/?q=${encodeURIComponent(q)}`;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) { e.preventDefault(); $("top-q").focus(); }
});

/* ---------- account ---------- */
const dialog = $("account-dialog");
function openAccountDialog(message) {
  dialog.replaceChildren(
    el("h2", { text: "Sign in to Clue" }),
    el("p", { text: message || "Signing in keeps your research and forecasts private to you. Clue never holds your keys and never places trades." }),
    el("p", { id: "account-status", class: "status err", role: "status" }),
    el("div", { class: "actions", style: "flex-direction:column;align-items:stretch" },
      el("button", { class: "btn primary", id: "wallet-connect", type: "button", text: "Continue with NEAR wallet", onclick: connectWallet }),
      el("button", { class: "btn", id: "privy-connect", type: "button", text: "Continue with email or wallet (Privy)", onclick: connectPrivy }),
      el("button", { class: "btn ghost", type: "button", text: "Not now", onclick: () => dialog.close() })),
  );
  if (!dialog.open) dialog.showModal();
}
async function connectWallet() {
  dialog.close();
  $("account-open").disabled = true;
  try { await window.clueConnect(); await refreshAccount(); }
  catch (e) { openAccountDialog(); $("account-status").textContent = e.message || "Connection cancelled. Try again."; }
  finally { $("account-open").disabled = false; }
}
let privyLoading = null;
function loadPrivy() {
  // The Privy bundle is large, so it loads only when someone chooses Privy.
  privyLoading ||= (async () => {
    const cfg = await api("/api/privy/config");
    if (!cfg.enabled) throw new Error("Privy sign-in is not available right now.");
    await new Promise((resolve, reject) => {
      const s = el("script", { src: "/privy.js" });
      s.onload = resolve; s.onerror = () => reject(new Error("Could not load Privy. Check your connection and try again."));
      document.head.append(s);
    });
    await window.cluePrivy.init(cfg.appId);
  })().catch((e) => { privyLoading = null; throw e; });
  return privyLoading;
}
async function connectPrivy() {
  const status = $("account-status"), btn = $("privy-connect");
  btn.disabled = true; status.className = "status"; status.textContent = "Opening Privy…";
  try {
    await loadPrivy();
    dialog.close(); // Privy shows its own sign-in window
    const accessToken = await window.cluePrivy.login();
    await post("/api/privy/login", { accessToken });
    await refreshAccount();
  } catch (e) {
    openAccountDialog();
    $("account-status").className = "status err";
    $("account-status").textContent = e.message || "Sign-in was cancelled. Try again.";
  }
}
async function refreshAccount() {
  try { user = (await api("/api/wallet/session"))?.user || null; } catch { user = null; }
  const b = $("account-open");
  b.textContent = user ? shortName(user.name || user.email) : "Sign in";
  b.title = user ? "Click to disconnect" : "";
  document.dispatchEvent(new CustomEvent("clue:account"));
}
const shortName = (s = "") => (s.length > 18 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);
$("account-open").addEventListener("click", async () => {
  if (!user) return openAccountDialog();
  if (!confirm("Disconnect this wallet from Clue?")) return;
  try { await post("/api/wallet/disconnect", {}); } catch { /* session may already be gone */ }
  try { await window.cluePrivy?.logout(); } catch { /* not signed in with Privy */ }
  await refreshAccount();
  if (location.hash.startsWith("#/saved")) route();
});
window.installClueTheme?.();

/* ---------- router ---------- */
function parse() {
  const raw = location.hash.slice(1) || "/";
  const [path, query = ""] = raw.split("?");
  return { parts: path.split("/").filter(Boolean), qs: new URLSearchParams(query) };
}
async function route() {
  const token = ++navToken;
  const { parts, qs } = parse();
  window.scrollTo(0, 0);
  app.focus({ preventScroll: true });
  const stale = () => token !== navToken;
  if (parts[0] === "event" && parts[1]) { setNav("event"); return eventView(parts[1], qs.get("m"), stale); }
  if (parts[0] === "ask") { setNav("ask"); return askView(qs, stale); }
  if (parts[0] === "saved") { setNav("saved"); return savedView(parts[1], stale); }
  setNav("board");
  buildCategories(qs.get("q") ? null : qs.get("tag") || "");
  return boardView(qs.get("tag") || "", qs.get("q") || "", stale, qs.get("sort") || "trending");
}
window.addEventListener("hashchange", route);

/* ---------- board ---------- */
function marketCard(ev) {
  const ms = ev.markets;
  const multi = ev.marketCount > 1 && ms.length > 1;
  const body = el("div", { class: "rows" });
  if (multi) {
    for (const m of [...ms].sort((a, b) => (b.outcomePrices[0] || 0) - (a.outcomePrices[0] || 0)).slice(0, 3)) {
      body.append(el("div", { class: "orow3" },
        el("span", { class: "name", text: m.groupItemTitle || m.question }),
        el("span", { class: "val", text: pct(m.outcomePrices[0]) }),
        el("span", { class: "pills", "aria-hidden": "true" }, el("span", { class: "pillb y", text: "Yes" }), el("span", { class: "pillb n", text: "No" }))));
    }
  } else {
    const m = ms[0];
    const [a = "Yes", b = "No"] = m.outcomes;
    body.append(
      el("div", { class: "bigp" }, el("b", { text: pct(m.outcomePrices[0]) }), el("span", { text: `chance · ${a}` })),
      el("div", { class: "ybtns", "aria-hidden": "true" }, el("span", { class: "y", text: `${a} ${pct(m.outcomePrices[0])}` }), el("span", { class: "n", text: `${b} ${pct(m.outcomePrices[1])}` })));
  }
  return el("a", { class: "mcard", href: `#/event/${encodeURIComponent(ev.slug)}` },
    el("div", { class: "mcard-head" }, thumb(ev), el("h3", { text: ev.title })),
    body,
    el("div", { class: "mfoot" },
      el("span", { class: "num", text: `${money(ev.volume24hr)} today` }),
      ended(ev.endDate) ? el("span", { class: "tag ended", text: "Ended · awaiting result" }) : el("span", { text: `Ends ${day(ev.endDate)}` })));
}

function askHero() {
  const input = el("input", { type: "text", id: "hero-q", placeholder: "Ask anything: “Will inflation fall below 3%?”", "aria-label": "Your question", maxlength: 2000 });
  const form = el("form", { onsubmit: (e) => { e.preventDefault(); const q = input.value.trim(); if (q.length >= 5) location.hash = `#/ask?q=${encodeURIComponent(q)}`; else input.focus(); } },
    input, el("button", { class: "btn primary", type: "submit", text: "Research it" }));
  return el("section", { class: "ask-hero" },
    el("h1", { text: "A clearer view of what comes next." }),
    el("p", { text: "Ask any question. Clue finds sources for and against, shows where real markets stand, and keeps your own forecast so you can learn from what happens." }),
    form,
    el("div", { class: "chips" }, EXAMPLES.map((q) => el("a", { class: "chip", href: `#/ask?q=${encodeURIComponent(q)}`, text: q }))));
}

const SORTS = [["Trending", "trending"], ["Volume", "volume"], ["New", "new"], ["Ending soon", "ending"]];
async function boardView(tag, q, stale, sort = "trending") {
  const head = el("div", { class: "section-head" }, el("h2", { text: q ? `Results for “${q}”` : tag ? CATEGORIES.find((c) => c[1] === tag)?.[0] || "Markets" : "Trending markets" }), el("span", { class: "live", id: "board-meta" }));
  const sortbar = q ? null : el("nav", { class: "sortbar", "aria-label": "Sort markets" }, SORTS.map(([label, v]) => el("a", { class: "chipb", href: `#/?${tag ? "tag=" + tag + "&" : ""}sort=${v}`, "aria-current": String(v === sort), text: label })));
  const grid = el("div", { class: "grid-board", "aria-busy": "true" }, Array.from({ length: 8 }, () => el("div", { class: "skeleton" })));
  const rail = el("aside", { class: "card rail" }, el("h2", { text: "Most traded today" }), el("ol", { id: "rail-list" }));
  const top = !q && !tag ? el("div", { class: "hero" }, askHero(), rail) : null;
  app.replaceChildren(...[top, head, sortbar, grid].filter(Boolean));
  try {
    const d = await api(`/api/events?${q ? "q=" + encodeURIComponent(q) : "tag=" + encodeURIComponent(tag) + "&sort=" + sort}`);
    if (stale()) return;
    grid.removeAttribute("aria-busy");
    $("board-meta").textContent = `Live from Polymarket · ${new Date(d.retrievedAt).toLocaleTimeString()}`;
    if (!d.events.length) { grid.replaceWith(el("div", { class: "card empty" }, el("h2", { text: "No open markets found" }), el("p", { class: "muted", text: "Try a broader word, another category, or ask Clue to research it directly." }), el("a", { class: "btn primary", style: "margin-top:16px", href: `#/ask${q ? "?q=" + encodeURIComponent(q) : ""}`, text: "Ask Clue instead" }))); return; }
    const live = d.events.filter((e) => !ended(e.endDate)), over = d.events.filter((e) => ended(e.endDate));
    grid.replaceChildren(...[...live, ...over].map(marketCard));
    const list = $("rail-list");
    if (list) for (const ev of [...d.events].filter((e) => !ended(e.endDate)).sort((a, b) => b.volume24hr - a.volume24hr).slice(0, 5)) {
      const m = [...ev.markets].sort((a, b) => b.volume - a.volume)[0];
      list.append(el("li", null, el("a", { href: `#/event/${encodeURIComponent(ev.slug)}` }, el("span", { text: ev.title }), el("span", { class: "pct", text: pct(m.outcomePrices[0]) }))));
    }
  } catch (e) {
    if (!stale()) grid.replaceWith(errBox("Couldn’t load markets", `${e.message}. Nothing is shown instead of made-up data.`, route));
  }
}

/* ---------- event page ---------- */
async function eventView(slug, marketId, stale) {
  app.replaceChildren(el("p", { class: "loading", role: "status", text: "Loading market…" }));
  let d;
  try { d = await api(`/api/events/${encodeURIComponent(slug)}`); }
  catch (e) { if (!stale()) app.replaceChildren(el("a", { class: "crumb", href: "#/", text: "← Markets" }), errBox("Couldn’t load this market", e.message, route)); return; }
  if (stale()) return;
  const ev = d.event;
  document.title = `${ev.title} — Clue`;
  const open = [...ev.markets].sort((x, y) => (Number(y.outcomePrices[0]) || 0) - (Number(x.outcomePrices[0]) || 0));
  if (!open.length) { app.replaceChildren(el("a", { class: "crumb", href: "#/", text: "← Markets" }), errBox("No open question in this event", "Every market here has closed. Check the venue for the result.")); return; }
  let sel = open.find((m) => m.id === marketId) || open[0];
  let outcomeIdx = 0;
  let interval = "1w";

  const optsBox = el("div", { class: "card opts", role: "group", "aria-label": "Questions in this event" });
  const stage = el("div", { id: "stage" });
  const workspaceBox = el("aside", { class: "card panel" });
  const left = el("div", null, stage);

  const header = el("div", { class: "ev-head" }, thumb(ev),
    el("div", null,
      el("h1", { text: ev.title }),
      el("div", { class: "meta" },
        ended(ev.endDate) ? el("span", { class: "tag ended", text: "Ended · awaiting result" }) : el("span", { class: "tag live", text: "Open" }),
        el("span", { text: `${money(ev.volume)} volume` }),
        el("span", { text: `${money(ev.volume24hr)} in 24h` }),
        el("span", { text: `Closes ${day(ev.endDate)}` }),
        el("a", { href: safeLink(ev.sourceUrl), target: "_blank", rel: "noopener noreferrer", text: "View on Polymarket ↗" }))));
  app.replaceChildren(el("a", { class: "crumb", href: "#/", text: "← Markets" }), header, el("div", { class: "layout" }, left, workspaceBox));

  function renderOptions() {
    if (open.length < 2) { optsBox.remove(); return; }
    optsBox.replaceChildren(...open.slice(0, 40).map((m) => {
      const p = Number(m.outcomePrices[0]);
      return el("button", { class: "opt", type: "button", "aria-pressed": String(m.id === sel.id), onclick: () => { sel = m; outcomeIdx = 0; history.replaceState(null, "", `#/event/${encodeURIComponent(slug)}?m=${m.id}`); renderAll(); } },
        el("span", { class: "name", text: m.groupItemTitle || m.question }),
        el("span", { class: "val", text: pct(p) }),
        el("small", { text: `${money(m.volume)} volume` }),
        el("div", { class: "bar", "aria-hidden": "true" }, el("i", { style: `width:${Math.max(1, Math.min(100, p * 100))}%` })));
    }));
  }

  function renderStage() {
    const outcomes = sel.outcomes.length ? sel.outcomes : ["Yes", "No"];
    const token = sel.tokenIds[outcomeIdx];
    const price = Number(sel.outcomePrices[outcomeIdx]);
    const chartBox = el("div", { class: "chart" }, el("div", { class: "chart-empty", text: "Loading price history…" }));
    const seg = el("div", { class: "seg", role: "group", "aria-label": "Chart range" }, [["1d", "1D"], ["1w", "1W"], ["1m", "1M"], ["max", "All"]].map(([v, l]) =>
      el("button", { type: "button", "aria-pressed": String(v === interval), text: l, onclick: () => { interval = v; renderStage(); } })));
    const outcomeSeg = outcomes.length > 1 ? el("div", { class: "seg", role: "group", "aria-label": "Outcome" }, outcomes.slice(0, 4).map((o, i) =>
      el("button", { type: "button", "aria-pressed": String(i === outcomeIdx), text: `${o} ${pct(sel.outcomePrices[i])}`, onclick: () => { outcomeIdx = i; renderStage(); } }))) : null;

    const tabs = ["Rules", "Order book"];
    let tab = "Rules";
    const panel = el("div", { class: "tabpanel", role: "tabpanel" });
    const tabBar = el("div", { class: "tabs", role: "tablist" });
    const drawTabs = () => {
      tabBar.replaceChildren(...tabs.map((t) => el("button", { role: "tab", type: "button", "aria-selected": String(t === tab), text: t, onclick: () => { tab = t; drawTabs(); } })));
      panel.replaceChildren();
      if (tab === "Rules") drawRules(panel); else drawBook(panel, token, outcomes[outcomeIdx]);
    };

    stage.replaceChildren(
      optsBox,
      el("section", { class: "card chart-card" },
        el("div", { class: "chart-top" },
          el("div", null,
            el("p", { class: "muted small", text: sel.question }),
            el("div", { class: "big", text: pct(price) }),
            el("p", { class: "muted small", text: `${outcomes[outcomeIdx]} · market price, not a forecast by Clue` })),
          el("div", { style: "display:grid;gap:8px;justify-items:end" }, outcomeSeg, seg)),
        chartBox),
      el("div", { class: "stats" },
        stat("Best bid", pct(sel.bestBid, 1)), stat("Best ask", pct(sel.bestAsk, 1)),
        stat("Last trade", pct(sel.lastTradePrice, 1)), stat("Liquidity", money(sel.liquidity))),
      el("section", { class: "card" }, tabBar, panel));
    renderOptions();
    drawTabs();
    drawChart(chartBox, token, interval);
  }
  const stat = (k, v) => el("div", { class: "stat" }, el("small", { text: k }), el("b", { text: v }));

  function drawRules(box) {
    const rules = sel.rules || ev.description;
    const text = el("div", { class: "rules" });
    linkify(text, rules || "Polymarket published no resolution text for this market.");
    box.append(
      el("p", { class: "muted small", style: "margin-bottom:10px", text: "This is the venue’s own wording. It decides how the market settles. Nothing on Clue overrides it." }),
      text,
      rules && rules.length > 700 ? el("button", { class: "btn small ghost", type: "button", text: "Show all", onclick: (e) => { text.classList.toggle("open"); e.target.textContent = text.classList.contains("open") ? "Show less" : "Show all"; } }) : null,
      el("dl", { class: "facts" },
        fact("Resolution source", sel.resolutionSource || ev.resolutionSource || "Not stated"),
        fact("Resolution status", sel.resolutionStatus || "Not resolved yet"),
        fact("Market closes", when(sel.endDate)),
        fact("Market ID", sel.conditionId || "unavailable")));
  }
  const fact = (k, v) => el("div", null, el("dt", { text: k }), el("dd", { text: v }));

  async function drawBook(box, token, name) {
    if (!token) { box.append(el("p", { class: "muted", text: "No order book is available for this outcome." })); return; }
    box.append(el("p", { class: "muted", role: "status", text: "Loading live order book…" }));
    try {
      const b = await api(`/api/book?token=${encodeURIComponent(token)}`);
      if (!box.isConnected) return;
      const max = Math.max(1, ...b.bids.map((x) => x.size), ...b.asks.map((x) => x.size));
      const col = (title, rows, cls) => el("div", null, el("h3", { text: title }), rows.length ? rows.slice(0, 6).map((l) =>
        el("div", { class: `lvl ${cls}` }, el("i", { style: `width:${(l.size / max) * 100}%` }), el("span", { text: pct(l.price, 1) }), el("span", { text: `${Math.round(l.size).toLocaleString()} shares` }))) : el("p", { class: "muted small", text: "No orders" }));
      const spread = b.bids[0] && b.asks[0] ? b.asks[0].price - b.bids[0].price : null;
      box.replaceChildren(
        el("div", { class: "book" }, col(`Buyers · ${name}`, b.bids, "b"), col(`Sellers · ${name}`, b.asks, "a")),
        el("p", { class: "muted small", style: "margin-top:12px", text: `Spread ${spread == null ? "unavailable" : (spread * 100).toFixed(1) + " pts"}. This is the resting order book, not trading volume. Book time ${when(b.bookTime)}.` }));
    } catch (e) { box.replaceChildren(errBox("Order book unavailable", e.message)); }
  }

  async function drawChart(box, token, iv) {
    if (!token) { box.replaceChildren(el("div", { class: "chart-empty", text: "No price history for this outcome." })); return; }
    try {
      const h = await api(`/api/history?token=${encodeURIComponent(token)}&interval=${iv}`);
      if (!box.isConnected) return;
      if (h.points.length < 2) { box.replaceChildren(el("div", { class: "chart-empty", text: "Not enough trading history to chart yet." })); return; }
      lineChart(box, h.points);
    } catch (e) { box.replaceChildren(el("div", { class: "chart-empty", text: `Chart unavailable: ${e.message}` })); }
  }

  function renderAll() { renderStage(); mountWorkspace(workspaceBox, { market: sel, event: ev, outcome: () => (sel.outcomes[outcomeIdx] || "Yes"), outcomeIdx: () => outcomeIdx }); }
  renderAll();
}

/* SVG line chart with hover read-out */
function lineChart(box, pts) {
  const W = 760, H = 240, padL = 8, padR = 44, padT = 10, padB = 22;
  const ps = pts.map((x) => x.p);
  const lo = Math.max(0, Math.floor((Math.min(...ps) - 0.03) * 20) / 20), hi = Math.min(1, Math.ceil((Math.max(...ps) + 0.03) * 20) / 20);
  const t0 = pts[0].t, t1 = pts.at(-1).t;
  const X = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const Y = (p) => padT + (1 - (p - lo) / (hi - lo || 1)) * (H - padT - padB);
  const ns = "http://www.w3.org/2000/svg";
  const s = (tag, a) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Price history from ${pct(pts[0].p)} to ${pct(pts.at(-1).p)}` });
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3, y = Y(v);
    svg.append(s("line", { x1: padL, x2: W - padR, y1: y, y2: y, stroke: "var(--line)", "stroke-width": 1 }));
    const t = s("text", { x: W - padR + 6, y: y + 4, fill: "var(--faint)", "font-size": 12 }); t.textContent = pct(v); svg.append(t);
  }
  const d = pts.map((x, i) => `${i ? "L" : "M"}${X(x.t).toFixed(1)},${Y(x.p).toFixed(1)}`).join("");
  svg.append(s("path", { d: `${d}L${X(t1)},${H - padB}L${X(t0)},${H - padB}Z`, fill: "var(--brand)", opacity: 0.08 }));
  svg.append(s("path", { d, fill: "none", stroke: "var(--brand)", "stroke-width": 2.2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  const dot = s("circle", { r: 5, fill: "var(--brand)", stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" });
  svg.append(dot);
  const tip = el("div", { class: "tip", hidden: true });
  box.replaceChildren(svg, tip);
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const t = t0 + (((e.clientX - r.left) / r.width) * W - padL) / (W - padL - padR) * (t1 - t0);
    let best = pts[0]; for (const x of pts) if (Math.abs(x.t - t) < Math.abs(best.t - t)) best = x;
    dot.setAttribute("cx", X(best.t)); dot.setAttribute("cy", Y(best.p)); dot.setAttribute("visibility", "visible");
    tip.hidden = false; tip.textContent = `${pct(best.p, 1)} · ${new Date(best.t * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`;
    tip.style.left = `${Math.min(Math.max((X(best.t) / W) * 100, 12), 88)}%`;
  });
  svg.addEventListener("pointerleave", () => { dot.setAttribute("visibility", "hidden"); tip.hidden = true; });
}

/* ---------- workspace: research + forecast (used on event page and Ask page) ---------- */
function mountWorkspace(container, ctx) {
  // ctx: { market?: normalizedMarket, event?, outcome?: ()=>string, question?: string, threadId?: string, revision?, forecasts? }
  const state = { threadId: ctx.threadId || null, report: ctx.report || null };
  const market = ctx.market || null;
  const marketRef = market ? { question: market.question, rules: (market.rules || "").slice(0, 8000), id: market.id, outcomes: market.outcomes, bestBid: market.bestBid, bestAsk: market.bestAsk, lastTradePrice: market.lastTradePrice, observedAt: market.observedAt, sourceUrl: market.sourceUrl, eventSlug: market.eventSlug } : ctx.savedMarket || null;
  const defaultQ = ctx.question || (market ? market.question : "");

  const q = el("textarea", { id: "ws-q", rows: 2, maxlength: 2000, placeholder: market ? "Ask something specific, or research this market’s question" : "What do you want to understand?" }); q.value = defaultQ;
  const rStatus = el("p", { class: "status", role: "status", "aria-live": "polite" });
  const reportBox = el("div", { class: "report", hidden: true });
  const researchBtn = el("button", { class: "btn dark", type: "button", text: "Research with sources", onclick: runResearch });

  const prior = ctx.forecasts?.[0];
  const startP = Math.min(99, Math.max(1, Math.round(prior ? prior.probability : market ? (Number(market.outcomePrices[0]) || 0.5) * 100 : 50)));
  const range = el("input", { type: "range", min: 1, max: 99, value: startP, "aria-label": "Your probability" });
  const out = el("output", { text: `${startP}%` });
  range.addEventListener("input", () => (out.textContent = `${range.value}%`));
  const ta = (id, ph, rows = 3) => el("textarea", { id, rows, maxlength: 5000, placeholder: ph });
  const why = ta("f-why", "The base rate is… The key driver is…");
  const pro = ta("f-pro", "Strongest evidence for. Paste links if you have them.", 2);
  const con = ta("f-con", "Strongest evidence against.", 2);
  const flip = ta("f-flip", "If the next report shows…, I would move to…", 2);
  const fStatus = el("p", { class: "status", role: "status", "aria-live": "polite" });
  const histBox = el("div", { class: "hist" });
  const field = (label, hint, input) => el("label", { class: "field" }, el("span", { text: label }), hint && el("small", { text: hint }), input);

  const refLine = market ? el("p", { class: "ref" }, `Market last traded at ${pct(market.lastTradePrice, 0)}. That is a price, not the truth.`) : null;

  const step1 = el("section", { class: "step active" },
    el("div", { class: "step-title" }, el("span", { class: "step-n", text: "1" }), "Research it"),
    el("p", { class: "muted small", text: market ? "Clue searches the web for evidence for and against. The market’s own rules still decide how it resolves." : "Clue searches the web for evidence for and against, and says when evidence is thin." }),
    el("label", { class: "field" }, el("span", { text: "Your question" }), q),
    el("div", { class: "actions" }, researchBtn), rStatus, reportBox);

  const step2 = el("section", { class: "step" },
    el("div", { class: "step-title" }, el("span", { class: "step-n", text: "2" }), "What do you think?"),
    el("p", { class: "muted small", text: "Private to you. This is a forecast, not a trade." }),
    el("div", { class: "field" }, el("span", { text: `Chance that ${market ? `“${(ctx.outcome ? ctx.outcome() : "Yes")}”` : "it"} happens` }), el("div", { class: "prob" }, range, out), refLine),
    field("Why do you think so?", null, why),
    field("Evidence for", null, pro),
    field("Evidence against", null, con),
    field("What would change your mind?", "A concrete event, number or report. This makes your forecast testable.", flip),
    el("div", { class: "actions" }, el("button", { class: "btn primary", type: "button", text: "Save forecast", onclick: saveForecast })),
    fStatus, histBox);

  container.replaceChildren(el("div", { class: "panel-head" }, el("h2", { text: "Your read" })), el("div", { class: "steps" }, step1, step2));
  if (state.report) showReport(state.report);
  if (ctx.forecasts?.length) renderForecasts(ctx.forecasts);
  const markDone = () => { step1.classList.add("done"); step1.classList.remove("active"); step2.classList.add("active"); };
  if (state.report) markDone();

  function showReport(r) {
    const text = el("div", { class: "report-text clamp" });
    linkify(text, r.content);
    const more = el("button", { class: "btn small ghost", type: "button", text: "Read full research", onclick: () => { const c = text.classList.toggle("clamp"); more.textContent = c ? "Read full research" : "Show less"; } });
    reportBox.replaceChildren(
      el("span", { class: "label" }, "AI-generated · check the sources"),
      sourceChips(r.sources || []), text, more,
      el("p", { class: "muted small", style: "margin-top:8px", text: `${r.model} · ${when(r.retrievedAt)}. AI can be wrong or out of date. It is not a source of truth about outcomes.` }));
    reportBox.hidden = false;
  }

  async function runResearch() {
    const question = q.value.trim();
    if (question.length < 5) { rStatus.className = "status err"; rStatus.textContent = "Write a question of at least 5 characters."; q.focus(); return; }
    if (!user) { openAccountDialog("Sign in to run research. It keeps your work private to you."); return; }
    researchBtn.disabled = true; rStatus.className = "status"; rStatus.textContent = "Searching sources. This can take up to a minute…";
    try {
      const d = await post("/api/research", { question, market: marketRef && marketRef.question ? { question: marketRef.question, rules: marketRef.rules || null } : null });
      state.report = { question, market: marketRef, content: d.content, sources: d.sources, model: d.model, retrievedAt: d.retrievedAt };
      showReport(state.report); markDone();
      rStatus.className = "status ok"; rStatus.textContent = "Research complete. Save it with your forecast below.";
      if (state.threadId) { try { await ensureThread(true); } catch { /* user can save manually */ } }
    } catch (e) { rStatus.className = "status err"; rStatus.textContent = e.message; }
    finally { researchBtn.disabled = false; }
  }

  async function ensureThread(newRevision = false) {
    const r = state.report;
    const body = {
      threadId: state.threadId || undefined,
      question: (r?.question || q.value.trim() || defaultQ).slice(0, 2000),
      content: r?.content || "Started from a forecast. No research has been run yet.",
      sources: r?.sources || [], model: r?.model || "none", retrievedAt: r?.retrievedAt || new Date().toISOString(),
      market: marketRef || null,
    };
    if (body.question.length < 5) throw new Error("Write your question first (at least 5 characters).");
    if (state.threadId && !newRevision) return state.threadId;
    const d = await post("/api/threads", body);
    state.threadId = d.id;
    return d.id;
  }

  async function saveForecast() {
    if (!user) { openAccountDialog("Sign in so your forecast is saved privately to you."); return; }
    if (!why.value.trim()) { fStatus.className = "status err"; fStatus.textContent = "Write a line on why you think so."; why.focus(); return; }
    if (!flip.value.trim()) { fStatus.className = "status err"; fStatus.textContent = "Say what would change your mind. It is what makes this forecast testable."; flip.focus(); return; }
    fStatus.className = "status"; fStatus.textContent = "Saving…";
    try {
      const id = await ensureThread();
      await post(`/api/threads/${encodeURIComponent(id)}/forecasts`, { probability: Number(range.value), reasoning: why.value, supportingEvidence: pro.value, opposingEvidence: con.value, changeCondition: flip.value });
      const d = await api(`/api/threads/${encodeURIComponent(id)}`);
      renderForecasts(d.forecasts);
      why.value = ""; pro.value = ""; con.value = "";
      fStatus.className = "status ok"; fStatus.textContent = "Saved privately. Each save adds a dated revision; older ones are kept.";
    } catch (e) { fStatus.className = "status err"; fStatus.textContent = e.message; }
  }

  function renderForecasts(rows) {
    histBox.replaceChildren();
    if (!rows?.length) return;
    histBox.append(el("h3", { style: "font-size:14px", text: `Forecast history (${rows.length})` }));
    for (const f of rows) histBox.append(el("div", { class: "hist-item" },
      el("b", { text: `${f.probability}%` }), " ", el("span", { class: "muted small", text: when(f.created_at) }),
      el("p", { text: f.reasoning || "No reasoning recorded" }),
      f.change_condition && el("p", { class: "muted small", text: `Would change my mind: ${f.change_condition}` })));
  }
  container.__state = state;
  return state;
}

/* ---------- ask page ---------- */
async function askView(qs, stale) {
  const presetQ = qs.get("q") || "";
  const holder = el("aside", { class: "card" });
  let linked = null;
  const linkedBox = el("div");
  const pickBox = el("div", { class: "pick" });
  const searchIn = el("input", { type: "text", placeholder: "Search for a market to connect (optional)", "aria-label": "Search for a market", style: "width:100%;height:42px;border:1px solid var(--line-strong);border-radius:10px;padding:0 12px;background:var(--surface)" });
  searchIn.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const v = searchIn.value.trim(); if (v.length < 2) return;
    pickBox.replaceChildren(el("p", { class: "muted small", text: "Searching Polymarket…" }));
    try {
      const d = await api(`/api/events?q=${encodeURIComponent(v)}`);
      pickBox.replaceChildren(d.events.length ? el("div", { class: "pick-list" }, d.events.slice(0, 6).map((ev) => el("button", { type: "button", onclick: () => connect(ev.markets[0]) }, el("span", { text: ev.markets[0].question }), el("b", { class: "num", text: pct(ev.markets[0].outcomePrices[0]) })))) : el("p", { class: "muted small", text: "No open markets found. You can still research the question on its own." }));
    } catch (er) { pickBox.replaceChildren(errBox("Search failed", er.message)); }
  });
  function connect(m) {
    linked = m; pickBox.replaceChildren();
    linkedBox.replaceChildren(el("div", { class: "linked" }, el("span", null, el("strong", { text: "Connected market: " }), m.question), el("button", { class: "btn small", type: "button", text: "Remove", onclick: () => { linked = null; linkedBox.replaceChildren(); remount(); } })));
    remount();
  }
  function remount() { mountWorkspace(holder, { market: linked, question: linked ? linked.question : presetQ }); }
  app.replaceChildren(el("div", { class: "ask-page" },
    el("h1", { text: "What do you want to understand?" }),
    el("p", { text: "Ask about anything. Clue looks for sources on both sides, tells you where the evidence is thin, and lets you record your own forecast to revisit later. A market is optional context." }),
    el("section", { class: "card ask-box" },
      el("strong", { text: "Optional: connect a real market" }),
      el("p", { class: "muted small", style: "margin:2px 0 10px", text: "Pulls in the exact question, rules and current price from Polymarket. Press Enter to search." }),
      searchIn, pickBox, linkedBox),
    holder));
  remount();
}

/* ---------- saved ---------- */
async function savedView(id, stale) {
  if (!user) {
    app.replaceChildren(el("div", { class: "card empty" }, el("h2", { text: "Your research is private to you" }), el("p", { class: "muted", text: "Sign in to see saved research and forecasts." }), el("button", { class: "btn primary", style: "margin-top:16px", type: "button", text: "Sign in", onclick: () => openAccountDialog() })));
    document.addEventListener("clue:account", () => { if (location.hash.startsWith("#/saved")) route(); }, { once: true });
    return;
  }
  if (id) return savedThread(id, stale);
  app.replaceChildren(el("p", { class: "loading", role: "status", text: "Loading your research…" }));
  try {
    const d = await api("/api/threads");
    if (stale()) return;
    app.replaceChildren(
      el("div", { class: "section-head" }, el("h1", { style: "font-size:28px;letter-spacing:-.03em", text: "My research" }), el("a", { class: "btn primary", href: "#/ask", text: "New research" })),
      d.threads.length ? el("div", { class: "saved-list" }, d.threads.map((t) => el("a", { class: "card saved-row", href: `#/saved/${t.id}` }, el("strong", { text: t.question }), el("span", { class: "muted small", text: `Updated ${when(t.updated_at)}` }))))
        : el("div", { class: "card empty" }, el("h2", { text: "Nothing saved yet" }), el("p", { class: "muted", text: "Research a question or forecast a market and it will appear here, with every revision." }), el("a", { class: "btn primary", style: "margin-top:16px", href: "#/", text: "Browse markets" })));
  } catch (e) { if (!stale()) app.replaceChildren(errBox("Couldn’t load your research", e.message, route)); }
}

async function savedThread(id, stale) {
  app.replaceChildren(el("p", { class: "loading", role: "status", text: "Opening…" }));
  try {
    const d = await api(`/api/threads/${encodeURIComponent(id)}`);
    if (stale()) return;
    const rev = d.revisions[0];
    const market = rev?.market || null;
    const holder = el("aside", { class: "card" });
    const state = mountWorkspace(holder, {
      threadId: id, question: rev?.question || d.thread.question, savedMarket: market, forecasts: d.forecasts,
      report: rev && rev.model !== "none" ? { question: rev.question, market, content: rev.content, sources: rev.sources, model: rev.model, retrievedAt: rev.retrieved_at } : null,
    });
    const msg = el("p", { class: "status", role: "status" });
    const shares = el("div");
    const drawShares = (items) => shares.replaceChildren(...(items || []).map((p) => el("p", { class: "small" }, el("a", { href: `/?share=${encodeURIComponent(p.id)}`, target: "_blank", rel: "noopener", text: `Shared snapshot · ${day(p.created_at)}` }), " · ", el("button", { class: "btn small ghost", type: "button", text: "Remove", onclick: async () => { if (!confirm("Remove this shared snapshot?")) return; try { await api(`/api/threads/${encodeURIComponent(id)}/publications/${encodeURIComponent(p.id)}`, { method: "DELETE" }); drawShares((await api(`/api/threads/${encodeURIComponent(id)}`)).publications); } catch (e) { msg.className = "status err"; msg.textContent = e.message; } } }))));
    drawShares(d.publications);
    const actions = el("div", { class: "actions" },
      el("button", { class: "btn", type: "button", text: "Export", onclick: async () => { const full = await api(`/api/threads/${encodeURIComponent(id)}`); const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(full, null, 2)], { type: "application/json" })), download: "clue-research.json" }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); } }),
      el("button", { class: "btn", type: "button", text: "Share snapshot", onclick: async () => { if (!confirm("Publish the latest saved question, answer, sources and connected market? Your private forecast and notes are NOT included.")) return; try { await post(`/api/threads/${encodeURIComponent(id)}/publish`, {}); drawShares((await api(`/api/threads/${encodeURIComponent(id)}`)).publications); msg.className = "status ok"; msg.textContent = "Shared. This is a snapshot, not a full track record."; } catch (e) { msg.className = "status err"; msg.textContent = e.message; } } }),
      el("button", { class: "btn", type: "button", style: "color:var(--no)", text: "Delete", onclick: async () => { if (!confirm("Delete this research and all its revisions?")) return; try { await api(`/api/threads/${encodeURIComponent(id)}`, { method: "DELETE" }); location.hash = "#/saved"; } catch (e) { msg.className = "status err"; msg.textContent = e.message; } } }));
    const older = d.revisions.slice(1).map((r) => el("details", { class: "card pad", style: "margin-top:10px" }, el("summary", { text: `Earlier research · ${when(r.created_at)}` }), el("p", { class: "report-text", text: r.content })));
    app.replaceChildren(
      el("a", { class: "crumb", href: "#/saved", text: "← My research" }),
      el("h1", { style: "font-size:26px;letter-spacing:-.03em;margin-bottom:6px", text: d.thread.question }),
      market && el("p", { class: "muted", text: `Connected market: ${market.question}` }),
      actions, msg, shares, el("div", { style: "margin-top:20px", class: "ask-page" }, holder), older);
  } catch (e) { if (!stale()) app.replaceChildren(el("a", { class: "crumb", href: "#/saved", text: "← My research" }), errBox("Couldn’t open this research", e.message, route)); }
}

/* ---------- public shared snapshot ---------- */
async function sharedView(shareId) {
  setNav("ask");
  try {
    const d = await api(`/api/public/${encodeURIComponent(shareId)}`);
    const text = el("div", { class: "report-text" }); linkify(text, d.snapshot.content);
    app.replaceChildren(el("div", { class: "ask-page" },
      el("p", { class: "muted small", text: `Shared research snapshot · ${when(d.publishedAt)}` }),
      el("h1", { text: d.snapshot.question }),
      el("div", { class: "card pad", style: "margin-top:20px" }, el("span", { class: "label", style: "color:var(--brand-text);font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase", text: "AI-generated · check the sources" }), sourceChips(d.snapshot.sources || []), text),
      el("p", { class: "note", text: "This is a one-time snapshot chosen by its author. It is not a complete record, and the author’s private forecasts are not included." })));
  } catch (e) { app.replaceChildren(errBox("Shared research unavailable", e.message)); }
}

/* ---------- boot ---------- */
(async () => {
  const share = new URLSearchParams(location.search).get("share");
  await refreshAccount();
  if (share) return sharedView(share);
  route();
})();
