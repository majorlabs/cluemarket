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
const kids = (...a) => a.flat().filter((x) => x != null && x !== false);
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
function linkify(target, text, allowed) {
  const ok = allowed ? new Set(allowed.map((u) => { try { const x = new URL(u); return (x.origin + x.pathname.replace(/\/+$/, '')).toLowerCase(); } catch { return ''; } })) : null;
  target.replaceChildren();
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>)\]"']+/g)) {
    target.append(text.slice(last, m.index));
    let v = m[0], tail = "";
    while (/[.,;:]$/.test(v)) { tail = v.slice(-1) + tail; v = v.slice(0, -1); }
    try { const u = new URL(v); const k = (u.origin + u.pathname.replace(/\/+$/, '')).toLowerCase(); if (ok && !ok.has(k)) target.append(v); else target.append(el("a", { href: u.href, target: "_blank", rel: "noopener noreferrer", text: v })); } catch { target.append(v); }
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
      el("button", { class: "btn", id: "privy-connect", type: "button", text: "Continue with email or wallet", onclick: connectPrivy }),
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
let tradingLoading = null, tradingSetup = null;   // tradingSetup: what the last setup found, for this page load
function loadTrading() {
  tradingLoading ||= (async () => {
    await loadPrivy();
    await new Promise((resolve, reject) => {
      const s = el("script", { src: "/trading.js" });
      s.onload = resolve; s.onerror = () => reject(new Error("Could not load trading. Check your connection and try again."));
      document.head.append(s);
    });
  })().catch((e) => { tradingLoading = null; throw e; });
  return tradingLoading;
}
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
  drawAccountButton();
  document.dispatchEvent(new CustomEvent("clue:account"));
  if (user && String(user.id).startsWith("privy:")) { try { const d = await api("/api/privy/wallet"); if (d.wallet) { myWallet = d.wallet; drawAccountButton(); } } catch { /* the button says Account until it is known */ } }
  if (!user) myWallet = null;
}
// What the header shows for a signed-in person: a small avatar and a short address. Never an email.
let myWallet = null;
const avatarColor = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return `linear-gradient(135deg, hsl(${h} 80% 60%), hsl(${(h + 50) % 360} 80% 45%))`; };
function accountLabel() {
  if (!user) return "Sign in";
  if (String(user.id).startsWith("privy:")) return myWallet ? shortName(myWallet.address) : "Account";
  return shortName(user.name || "Account");
}
// Signed out: a "Sign in" button. Signed in: just a round profile icon. The address and the sign-out are inside the menu behind it.
const PROFILE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
function drawAccountButton() {
  const b = $("account-open");
  if (!user) { b.classList.remove("profile-btn"); b.style.background = ""; b.replaceChildren("Sign in"); b.removeAttribute("aria-label"); b.title = ""; return; }
  b.classList.add("profile-btn");
  b.style.background = avatarColor(myWallet ? myWallet.address : user.id);
  const icon = el("span", { class: "profile-icon", "aria-hidden": "true" }); icon.innerHTML = PROFILE_ICON;
  b.replaceChildren(icon);
  b.setAttribute("aria-label", "Your account"); b.title = "Your account";
}
function openAccountMenu() {
  const addr = myWallet ? myWallet.address : (String(user.id).startsWith("near:") ? user.name : null);
  dialog.replaceChildren(
    el("h2", { text: "Your account" }),
    addr ? el("div", { class: "acct-addr" }, el("span", { class: "label", text: String(user.id).startsWith("near:") ? "NEAR account" : myWallet?.madeForYou ? "Your Clue wallet" : "Your wallet" }), el("code", { text: addr }),
      el("button", { class: "btn small", type: "button", text: "Copy", onclick: async (ev) => { try { await navigator.clipboard.writeText(addr); ev.currentTarget.textContent = "Copied"; } catch { ev.currentTarget.textContent = "Select and copy"; } } })) : null,
    el("div", { class: "actions", style: "flex-direction:column;align-items:stretch;margin-top:14px" },
      el("a", { class: "btn", href: "#/saved", text: "Journal", onclick: () => dialog.close() }),
      el("button", { class: "btn", type: "button", style: "color:var(--no)", text: "Disconnect", onclick: signOut }),
      el("button", { class: "btn ghost", type: "button", text: "Close", onclick: () => dialog.close() })));
  if (!dialog.open) dialog.showModal();
}
async function signOut() {
  dialog.close();
  try { await post("/api/wallet/disconnect", {}); } catch { /* session may already be gone */ }
  try { await window.cluePrivy?.logout(); } catch { /* not signed in with Privy */ }
  await refreshAccount();
  if (location.hash.startsWith("#/saved")) route();
}
const shortName = (s = "") => (s.length > 18 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);
$("account-open").addEventListener("click", async () => {
  if (!user) return openAccountDialog();
  openAccountMenu();
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
    $("board-meta").textContent = `Live prices · ${new Date(d.retrievedAt).toLocaleTimeString()}`;
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
  const workspaceBox = el("section", { class: "card" });
  const ticketBox = el("section", { class: "card ticket", "aria-label": "Trade ticket" });
  const fundBox = el("section", { class: "card pad fund", "aria-label": "Add money" });
  mountFunding(fundBox);
  const rightCol = el("aside", { class: "rightcol" }, ticketBox, fundBox, workspaceBox);
  const left = el("div", null, stage);

  const header = el("div", { class: "ev-head" }, thumb(ev),
    el("div", null,
      el("h1", { text: ev.title }),
      el("div", { class: "meta" },
        ended(ev.endDate) ? el("span", { class: "tag ended", text: "Ended · awaiting result" }) : el("span", { class: "tag live", text: "Open" }),
        el("span", { text: `${money(ev.volume)} volume` }),
        el("span", { text: `${money(ev.volume24hr)} in 24h` }),
        el("span", { text: `Closes ${day(ev.endDate)}` }),
        el("a", { href: safeLink(ev.sourceUrl), target: "_blank", rel: "noopener noreferrer", text: "View source ↗" }))));
  app.replaceChildren(el("a", { class: "crumb", href: "#/", text: "← Markets" }), header, el("div", { class: "layout" }, left, rightCol));

  let showAllOpts = false;
  function renderOptions() {
    if (open.length < 2) { optsBox.remove(); return; }
    const LIMIT = 8;
    let list = open.slice(0, 40);
    let hidden = 0;
    if (!showAllOpts && list.length > LIMIT) {
      const head = list.slice(0, LIMIT);
      if (!head.includes(sel)) head.push(sel); // the selected question always stays visible
      hidden = list.length - head.length;
      list = head;
    }
    optsBox.replaceChildren(...kids(list.map((m) => {
      const p = Number(m.outcomePrices[0]);
      return el("button", { class: "opt", type: "button", "aria-pressed": String(m.id === sel.id), onclick: () => { sel = m; outcomeIdx = 0; history.replaceState(null, "", `#/event/${encodeURIComponent(slug)}?m=${m.id}`); renderAll(); } },
        el("span", { class: "name", text: m.groupItemTitle || m.question }),
        el("span", { class: "val", text: pct(p) }),
        el("small", { text: `${money(m.volume)} volume` }),
        el("div", { class: "bar", "aria-hidden": "true" }, el("i", { style: `width:${Math.max(1, Math.min(100, p * 100))}%` })));
    }), hidden > 0 || showAllOpts ? el("button", { class: "opts-more", type: "button", text: showAllOpts ? "Show fewer" : `Show all ${Math.min(open.length, 40)} questions`, onclick: () => { showAllOpts = !showAllOpts; renderOptions(); } }) : null));
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

    const tabs = ["Rules", "Live orders"];
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
    linkify(text, rules || "No rules were published for this market.");
    box.append(...kids(
      el("p", { class: "muted small", style: "margin-bottom:10px", text: "These are the market’s own rules. They decide how this question is settled. Clue can’t change them." }),
      text,
      rules && rules.length > 700 ? el("button", { class: "btn small ghost", type: "button", text: "Show all", onclick: (e) => { text.classList.toggle("open"); e.target.textContent = text.classList.contains("open") ? "Show less" : "Show all"; } }) : null,
      el("dl", { class: "facts" },
        fact("Decided by", sel.resolutionSource || ev.resolutionSource || "Not stated"),
        fact("Status", sel.resolutionStatus || "Not decided yet"),
        fact("Closes", when(sel.endDate)))));
  }
  const fact = (k, v) => el("div", null, el("dt", { text: k }), el("dd", { text: v }));

  async function drawBook(box, token, name) {
    if (!token) { box.append(el("p", { class: "muted", text: "No live orders are available for this outcome." })); return; }
    box.append(el("p", { class: "muted", role: "status", text: "Loading live orders…" }));
    try {
      const b = await api(`/api/book?token=${encodeURIComponent(token)}`);
      if (!box.isConnected) return;
      if (b.available === false) { box.replaceChildren(el("p", { class: "muted", text: "Nobody is buying or selling this outcome right now." })); return; }
      const max = Math.max(1, ...b.bids.map((x) => x.size), ...b.asks.map((x) => x.size));
      const col = (title, rows, cls) => el("div", null, el("h3", { text: title }), rows.length ? rows.slice(0, 6).map((l) =>
        el("div", { class: `lvl ${cls}` }, el("i", { style: `width:${(l.size / max) * 100}%` }), el("span", { text: pct(l.price, 1) }), el("span", { text: `${Math.round(l.size).toLocaleString()} shares` }))) : el("p", { class: "muted small", text: "No orders" }));
      const spread = b.bids[0] && b.asks[0] ? b.asks[0].price - b.bids[0].price : null;
      box.replaceChildren(
        el("div", { class: "book" }, col(`Buyers · ${name}`, b.bids, "b"), col(`Sellers · ${name}`, b.asks, "a")),
        el("p", { class: "muted small", style: "margin-top:12px", text: `Spread ${spread == null ? "unavailable" : (spread * 100).toFixed(1) + " pts"}. This is the resting order book, not trading volume. Book time ${when(b.bookTime)}.` }));
    } catch (e) { box.replaceChildren(errBox("Live orders unavailable", e.message)); }
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

  function renderAll() { renderStage(); mountTicket(ticketBox, { market: sel, outcome: sel.outcomes[outcomeIdx] || "Yes", token: sel.tokenIds[outcomeIdx], eventTitle: ev.title }); mountWorkspace(workspaceBox, { market: sel, event: ev, outcome: () => (sel.outcomes[outcomeIdx] || "Yes"), outcomeIdx: () => outcomeIdx }); }
  renderAll();
}


/* ---------- trade ticket (preview only: nothing here can place an order) ---------- */
let geoPromise = null;
const geoOnce = () => (geoPromise ||= window.ClueTicket.checkGeoblock());
async function mountTicket(box, ctx) {
  const m = ctx.market, T = window.ClueTicket;
  let mode = "market", book = null, bookErr = "";
  const usd = (n) => `$${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
  const cents = (p) => (p == null ? "—" : `${(p * 100).toFixed(1)}¢`);
  const spend = el("input", { type: "number", min: "0", step: "1", value: "50", inputmode: "decimal", "aria-label": "Amount to spend in dollars" });
  const limitPrice = el("input", { type: "number", min: "0", max: "100", step: "0.1", inputmode: "decimal", "aria-label": "Limit price in cents" });
  const shares = el("input", { type: "number", min: "0", step: "1", value: "10", inputmode: "decimal", "aria-label": "Number of shares" });
  const geoBox = el("div", { class: "geo", role: "status" }, el("span", { class: "muted small", text: "Checking your location…" }));
  const preview = el("div", { class: "tk-preview", "aria-live": "polite" });
  const seg = el("div", { class: "seg", role: "group", "aria-label": "Order type" }, [["market", "Market"], ["limit", "Limit"]].map(([v, l]) =>
    el("button", { type: "button", "aria-pressed": String(v === mode), text: l, onclick: () => { mode = v; draw(); } })));
  const fields = el("div");

  function drawFields() {
    seg.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(["market", "limit"][i] === mode)));
    const f = (label, input, hint) => el("label", { class: "field" }, el("span", { text: label }), hint && el("small", { text: hint }), input);
    fields.replaceChildren(...(mode === "market"
      ? [f("Amount to spend ($)", spend, "Buys from the cheapest sellers first.")]
      : [f("Limit price (¢ per share)", limitPrice, `Most you'll pay. Steps of ${m.tickSize ? +(m.tickSize * 100).toFixed(2) : 1}¢.`), f("Shares", shares, `Minimum ${m.minOrderSize || 5} shares.`)]));
  }

  function drawPreview() {
    if (bookErr) { preview.replaceChildren(el("p", { class: "status err", text: bookErr })); return; }
    if (!book) { preview.replaceChildren(el("p", { class: "muted small", text: "Loading live orders…" })); return; }
    if (book.available === false) { preview.replaceChildren(el("p", { class: "tk-warn block", text: "Nobody is buying or selling this outcome right now, so it can’t be traded. Pick another question above." })); return; }
    const r = T.previewBuy({
      mode, asks: book.asks, bestBid: book.bids[0]?.price ?? null,
      spend: Number(spend.value), shares: Number(shares.value), limitPrice: Number(limitPrice.value) / 100,
      feesEnabled: m.feesEnabled, feeRate: m.feeRate, minSize: m.minOrderSize, tickSize: m.tickSize, accepting: m.acceptingOrders, builderFeeBps: 0,
    });
    const row = (k, v) => el("div", { class: "tk-row" }, el("span", { class: "muted", text: k }), el("b", { class: "num", text: v }));
    const total = r.sharesFilled + r.restingShares;
    preview.replaceChildren(...[
      ...(total > 0 ? [
        r.sharesFilled > 0 ? row("You'd get", `${r.sharesFilled.toFixed(2)} shares · ${cents(r.avgPrice)} each`) : null,
        r.restingShares > 0 ? row("Waiting for a seller", `${r.restingShares.toFixed(2)} shares at ${cents(r.restingPrice)}`) : null,
        row("You pay", usd(r.cost)),
        row("Trading fee (estimate)", m.feesEnabled ? usd(r.platformFee) : "none on this market"),
        row("Clue fee", "none"),
        el("div", { class: "tk-outcomes" },
          el("div", { class: "tk-win" }, el("small", { text: `If "${ctx.outcome}" happens` }), el("b", { class: "num", text: `+${usd(r.profitIfWin ?? 0)}` }), el("small", { text: `you receive ${usd(total)}` })),
          el("div", { class: "tk-lose" }, el("small", { text: "If it doesn't" }), el("b", { class: "num", text: `−${usd(r.cost + r.platformFee)}` }), el("small", { text: "you lose what you paid" }))),
      ] : []),
      ...r.warnings.map((w) => el("p", { class: `tk-warn ${w.level}`, text: w.text })),
      el("p", { class: "muted small", style: "margin-top:8px", text: `Based on live orders${book.bookTime ? ` at ${new Date(book.bookTime).toLocaleTimeString()}` : ""}. The real price can change if orders change, and the final fee is confirmed when the order is placed.` }),
    ].filter(Boolean));
  }

  function drawChecklist(geo) {
    const item = (state, title, note) => el("li", { class: `ck ${state}` }, el("span", { class: "ck-i", "aria-hidden": "true", text: state === "ok" ? "✓" : state === "bad" ? "✕" : "•" }), el("span", null, el("b", { text: title }), note ? ` ${note}` : ""));
    const loc = geo.state === "ok" ? item("ok", "Location", "can place orders")
      : geo.state === "blocked" ? item("bad", "Location", `Trading isn't available in ${[geo.region, geo.country].filter(Boolean).join(", ") || "your location"}`)
      : item("todo", "Location", "couldn't be checked, so trading stays off");
    const isPrivy = user && String(user.id || "").startsWith("privy:"), isNear = user && String(user.id || "").startsWith("near:");
    const t = tradingSetup, short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
    const rows = t
      ? [item("ok", "Your wallet", short(t.signer)), item("ok", "Ready to trade", "set up"),
         t.balance > 0 ? item("ok", "Money in your account", `$${t.balance.toFixed(2)}`) : item("todo", "Money in your account", "$0.00. Use Add money to put some in.")]
      : [item("todo", "Your wallet", isPrivy ? "ready to use" : "needs an email or Ethereum wallet sign-in"), item("todo", "Ready to trade", "set up in one step"), item("todo", "Money in your account", "after setup")];
    const status = el("p", { class: "status", role: "status", "aria-live": "polite" });
    let action = null;
    if (!user) action = el("button", { class: "btn small", type: "button", text: "Sign in to set up trading", onclick: () => openAccountDialog("Sign in to set up trading.") });
    else if (isNear) action = el("p", { class: "muted small", text: "Trading needs an email or Ethereum wallet sign-in for now. NEAR wallet accounts can research, forecast and preview." });
    else if (isPrivy && !t) {
      const go = el("button", { class: "btn primary small", type: "button", text: "Set up trading", disabled: geo.state !== "ok", title: geo.state !== "ok" ? "Trading is off where you are." : "", onclick: async () => {
        go.disabled = true; status.className = "status";
        const words = { wallet: "Setting up your trading account…", permissions: "Setting permission to trade…", balance: "Checking your balance…" };
        try { await loadTrading(); } catch (e) { status.className = "status err"; status.textContent = e.message; go.disabled = false; return; }
        const r = await window.clueTrading.setup((step) => { status.textContent = `${words[step]} Approve it in your wallet if it asks.`; });
        if (r.ok) { tradingSetup = r; drawChecklist(geo); } else { status.className = "status err"; status.textContent = r.error; go.disabled = false; }
      } });
      action = go;
    }
    geoBox.replaceChildren(...kids(
      el("ul", { class: "checklist" }, loc, ...rows),
      action, status,
      geo.state === "blocked" ? el("p", { class: "muted small", style: "margin-top:8px", text: "You can still research, forecast and preview. Clue doesn't help get around location limits." }) : null));
  }

  function draw() { drawFields(); drawPreview(); }
  box.replaceChildren(
    el("div", { class: "panel-head tk-head" }, el("h2", { text: "Trade" }), el("span", { class: "tag", text: "Preview" })),
    el("div", { class: "pad" },
      el("p", { class: "small" }, el("b", { text: `Buy "${ctx.outcome}"` }), el("span", { class: "muted", text: ` · ${m.groupItemTitle || m.question}` })),
      el("div", { style: "margin:10px 0" }, seg), fields, preview,
      el("button", { class: "btn dark tk-submit", type: "button", disabled: true, title: "Trading isn't switched on yet.", text: "Place order — not available yet" }),
      el("p", { class: "muted small", style: "margin-top:6px", text: "You will approve every order with your own wallet. Clue never holds your money." }),
      geoBox));
  [spend, limitPrice, shares].forEach((i) => i.addEventListener("input", drawPreview));
  draw();
  geoOnce().then(drawChecklist);
  if (!ctx.token) { bookErr = "No live orders for this outcome."; drawPreview(); return; }
  try {
    book = await api(`/api/book?token=${encodeURIComponent(ctx.token)}&depth=60`);
    if (!box.isConnected) return;
    if (!limitPrice.value && book.asks[0]) limitPrice.value = (book.asks[0].price * 100).toFixed(1);
    draw();
  } catch (e) { bookErr = `Couldn't load live orders: ${e.message}`; drawPreview(); }
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
  const allowLine = el("p", { class: "muted small", role: "status", "aria-live": "polite" });
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
    el("div", { class: "actions" }, researchBtn), allowLine, rStatus, reportBox);

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
  const showAllowance = (a) => { allowLine.textContent = !a ? "" : a.paused ? "Research is paused for today to keep costs under control." : `${a.remaining} of ${a.freePerDay} free researches left today. They reset at midnight UTC.`; };
  if (user) api("/api/research/allowance").then(showAllowance).catch(() => {});
  const markDone = () => { step1.classList.add("done"); step1.classList.remove("active"); step2.classList.add("active"); };
  if (state.report) markDone();

  function showReport(r) {
    const text = el("div", { class: "report-text clamp" });
    linkify(text, r.content, r.sources || []);
    const more = el("button", { class: "btn small ghost", type: "button", text: "Read full research", onclick: () => { const c = text.classList.toggle("clamp"); more.textContent = c ? "Read full research" : "Show less"; } });
    reportBox.replaceChildren(
      el("span", { class: "label" }, "AI-generated · check the sources"),
      sourceChips(r.sources || []), text, more,
      el("p", { class: "muted small", style: "margin-top:8px", title: `Written by ${r.model}`, text: `Written by AI · ${when(r.retrievedAt)}. It can be wrong or out of date, so check the sources. It does not decide how a market settles.` }));
    reportBox.hidden = false;
  }

  async function runResearch() {
    const question = q.value.trim();
    if (question.length < 5) { rStatus.className = "status err"; rStatus.textContent = "Write a question of at least 5 characters."; q.focus(); return; }
    if (!user) { openAccountDialog("Sign in to run research. It keeps your work private to you."); return; }
    researchBtn.disabled = true; rStatus.className = "status"; rStatus.textContent = "Searching sources. This can take up to a minute…";
    try {
      const start = await post("/api/research", { question, market: marketRef && marketRef.id ? { id: marketRef.id } : null });
      let d = null, hiccups = 0;
      for (let i = 0; i < 100 && !d; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const j = await api(`/api/research/${encodeURIComponent(start.researchId)}`);
          if (j.status === "done") d = j;
          else if (j.status === "failed") throw Object.assign(new Error(j.error || "Research failed. Please try again."), { final: true });
        } catch (e) { if (e.final || ++hiccups > 5) throw e; }
      }
      if (!d) throw new Error("This is taking longer than expected. Check your Journal in a minute.");
      state.report = { question, market: marketRef, content: d.content, sources: d.sources, model: d.model, retrievedAt: d.retrievedAt, researchId: d.researchId };
      showReport(state.report); markDone(); showAllowance(d.allowance);
      rStatus.className = "status ok"; rStatus.textContent = "Research complete. Save it with your forecast below.";
      if (state.threadId) { try { await ensureThread(true); } catch { /* user can save manually */ } }
    } catch (e) { rStatus.className = "status err"; rStatus.textContent = e.message; }
    finally { researchBtn.disabled = false; }
  }

  async function ensureThread(newRevision = false) {
    const r = state.report;
    const body = r?.researchId
      ? { threadId: state.threadId || undefined, researchId: r.researchId }
      : { threadId: state.threadId || undefined, question: (q.value.trim() || defaultQ).slice(0, 2000), content: "Started from a forecast. No research has been run yet.", sources: [], model: "none", market: marketRef || null };
    if (!body.researchId && body.question.length < 5) throw new Error("Write your question first (at least 5 characters).");
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
      await post(`/api/threads/${encodeURIComponent(id)}/forecasts`, { probability: Number(range.value), outcomeIndex: ctx.outcomeIdx ? ctx.outcomeIdx() : 0, reasoning: why.value, supportingEvidence: pro.value, opposingEvidence: con.value, changeCondition: flip.value });
      const d = await api(`/api/threads/${encodeURIComponent(id)}`);
      renderForecasts(d.forecasts);
      why.value = ""; pro.value = ""; con.value = "";
      fStatus.className = "status ok"; fStatus.textContent = market ? "Saved privately. Clue will compare it with the market in your Journal." : "Saved privately. Each save adds a dated revision; older ones are kept.";
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
  state.recheck = (text) => { q.value = text.slice(0, 2000); q.scrollIntoView({ behavior: "smooth", block: "center" }); return runResearch(); };
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
    pickBox.replaceChildren(el("p", { class: "muted small", text: "Searching markets…" }));
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
      el("p", { class: "muted small", style: "margin:2px 0 10px", text: "Pulls in the exact question, rules and current price. Press Enter to search." }),
      searchIn, pickBox, linkedBox),
    holder));
  remount();
}



/* ---------- add money: see what moving money into your Clue balance would cost (nothing is sent) ---------- */
const CHAIN_LOOK = { "ethereum-usdc": { name: "Ethereum", color: "#627eea" }, "base-usdc": { name: "Base", color: "#0052ff" }, "optimism-usdc": { name: "Optimism", color: "#ff0420" } };
async function mountFunding(box) {
  const title = el("div", { class: "fund-title" }, el("h2", { text: "Add money" }), el("span", { class: "fund-badge", text: "Price check" }));
  const intro = el("p", { class: "fund-intro", text: "Pick where your money is now and see what it would cost to bring it into Clue." });
  if (!user) { box.replaceChildren(title, intro, el("button", { class: "btn primary", type: "button", text: "Sign in to check a price", onclick: () => openAccountDialog("Sign in to check what adding money would cost.") })); return; }
  let options;
  try { options = await api("/api/fund/options"); } catch { box.replaceChildren(title, el("p", { class: "fund-intro", text: "Prices aren’t available right now. Try again in a minute." })); return; }

  let picked = options.sources[0].id;
  const chips = options.sources.map((o) => {
    const look = CHAIN_LOOK[o.id] || { name: o.label, color: "#93a4ad" };
    const b = el("button", { type: "button", class: "chain", "aria-pressed": String(o.id === picked), onclick: () => { picked = o.id; chips.forEach((c) => c.setAttribute("aria-pressed", String(c === b))); } },
      el("i", { style: `background:${look.color}` }), look.name);
    return b;
  });
  const amount = el("input", { id: "fund-amount", type: "text", inputmode: "decimal", autocomplete: "off", value: "25", "aria-label": "How much, in dollars" });
  const quick = [10, 25, 100].map((n) => el("button", { type: "button", class: "quick", text: `$${n}`, onclick: () => { amount.value = String(n); } }));
  const address = el("input", { id: "fund-address", type: "text", autocomplete: "off", spellcheck: "false", placeholder: "0x…", "aria-label": "Your wallet address" });
  try { address.value = localStorage.getItem("clue.fundAddress") || ""; } catch { /* storage may be blocked */ }
  const isPrivy = user.id && String(user.id).startsWith("privy:");
  const walletBox = el("div", { class: "mywallet", hidden: true });
  const emailNote = el("p", { class: "fund-hint", hidden: true, text: "We couldn’t set up a wallet for you just now. You can paste the address of a wallet you own instead." });
  const showWallet = (w) => {
    walletBox.hidden = false;
    walletBox.replaceChildren(
      el("span", { class: "label", text: w.madeForYou ? "Your Clue wallet" : "Your connected wallet" }),
      el("code", { class: "addr", text: w.address }),
      el("button", { type: "button", class: "btn small", text: "Copy", onclick: async (ev) => { try { await navigator.clipboard.writeText(w.address); ev.currentTarget.textContent = "Copied"; } catch { ev.currentTarget.textContent = "Select and copy"; } } }),
      el("small", { text: w.madeForYou ? "Made for you when you signed in. It belongs to you, and Clue never holds its keys." : "This is the wallet you signed in with." }));
    if (!address.value.trim()) address.value = w.address;
  };
  if (isPrivy) {
    walletBox.hidden = false; walletBox.replaceChildren(el("span", { class: "fund-wait", text: "Setting up your wallet…" }));
    (async () => {
      for (let i = 0; i < 10; i++) {
        try { const d = await api("/api/privy/wallet"); if (d.wallet) return showWallet(d.wallet); } catch { /* try again */ }
        await new Promise((r) => setTimeout(r, 3000));
      }
      walletBox.hidden = true; emailNote.hidden = false;
    })();
  }
  const out = el("div", { class: "fund-out", role: "status", "aria-live": "polite" });
  const go = el("button", { class: "btn primary fund-go", type: "button", text: "See what I’d get", onclick: async () => {
    go.disabled = true; out.replaceChildren(el("p", { class: "fund-wait", text: "Checking the best way to move your money…" }));
    try {
      try { localStorage.setItem("clue.fundAddress", address.value.trim()); } catch { /* ignore */ }
      const q = await api(`/api/fund/quote?${new URLSearchParams({ source: picked, amount: amount.value.trim(), address: address.value.trim() })}`);
      const dollars = (n) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
      const look = CHAIN_LOOK[q.source.id] || { name: q.source.label };
      out.replaceChildren(el("div", { class: "receipt" },
        el("div", { class: "rc-top" },
          el("div", null, el("span", { text: "You send" }), el("b", { class: "num", text: dollars(q.pay) }), el("small", { text: `on ${look.name}` })),
          el("div", { class: "rc-mid", "aria-hidden": "true" }),
          el("div", { class: "rc-get" }, el("span", { text: "You get about" }), el("b", { class: "num", text: dollars(q.receive) }), el("small", { text: "in your Clue balance" }))),
        el("dl", { class: "rc-list" },
          el("dt", { text: "Worst case you get" }), el("dd", { class: "num", text: dollars(q.minimumReceive) }),
          el("dt", { text: "Fee for moving it" }), el("dd", { class: "num", text: dollars(q.costUsd) }),
          q.networkFeeUsd != null ? el("dt", { text: "Blockchain fee" }) : null, q.networkFeeUsd != null ? el("dd", { class: "num", text: `about ${dollars(q.networkFeeUsd)}, paid in ${q.networkFeeToken}` }) : null,
          q.seconds != null ? el("dt", { text: "Takes" }) : null, q.seconds != null ? el("dd", { class: "num", text: `about ${q.seconds} seconds` }) : null),
        el("p", { class: "fund-foot", text: "This is a price check only. Nothing has been sent and your money hasn’t moved. Sending is the next thing we’re adding." })));
    } catch (e) { out.replaceChildren(el("p", { class: "status err", text: e.message })); }
    finally { go.disabled = false; }
  } });
  box.replaceChildren(...kids(title, intro,
    el("div", { class: "fund-step" }, el("span", { class: "fund-n", text: "1" }), el("b", { text: "Where is your money now?" })), el("div", { class: "chains", role: "group", "aria-label": "Where your money is" }, chips),
    el("div", { class: "fund-step" }, el("span", { class: "fund-n", text: "2" }), el("b", { text: "How much?" })),
    el("div", { class: "amt" }, el("span", { text: "$" }), amount), el("div", { class: "quicks" }, quick),
    el("div", { class: "fund-step" }, el("span", { class: "fund-n", text: "3" }), el("b", { text: "Your wallet address" })),
    walletBox, address, el("p", { class: "fund-hint", text: "It starts with 0x. This is where the money would arrive." }), emailNote,
    go, out));
}

/* ---------- journal: the memory loop ---------- */
const signed = (n, unit = "") => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}${unit}`;
const pts = (p) => (p == null ? "—" : `${Math.round(p * 100)}%`);
const FLAG_TEXT = {
  moved: (w) => `Market moved ${signed(w.movePoints, " pts")} since you forecast`,
  gap: (w) => `You are ${Math.abs(w.gapPoints)} pts ${w.gapPoints > 0 ? "above" : "below"} the market`,
  "closing-soon": (w) => `Closes in ${Math.max(0, Math.ceil(w.daysToClose))} day${Math.ceil(w.daysToClose) === 1 ? "" : "s"}`,
  "awaiting-resolution": () => "Closed, waiting for the result",
  resolved: (w) => (w.happened ? "Resolved: it happened" : "Resolved: it did not happen"),
};
function flagChips(w) {
  if (!w) return [];
  return (w.flags || []).filter((f) => FLAG_TEXT[f]).map((f) => el("span", { class: `jchip ${f}`, text: FLAG_TEXT[f](w) }));
}
function scoreLine(w) {
  if (w?.state !== "resolved") return null;
  const mine = (w.score.you).toFixed(2);
  if (w.score.market == null) return `Your score ${mine} (lower is better). No market price was recorded when you forecast.`;
  return `Your score ${mine} vs the market's ${w.score.market.toFixed(2)} (lower is better). ${w.score.beatMarket ? "You were closer than the market." : "The market was closer."}`;
}
function trackRecord(s) {
  const lines = {
    none: "Your track record starts when a market you forecast resolves.",
    "too-few": `${s.resolved} resolved so far. That is too few to say how good your forecasts are. Clue starts to compare you with the market at 5.`,
    "no-market": `${s.resolved} resolved. No market prices were recorded for them, so there is nothing to compare against.`,
    better: `Across ${s.resolved} resolved forecasts you were closer to what happened than the market's price at the time.`,
    worse: `Across ${s.resolved} resolved forecasts the market's price at the time was closer than you. That is useful to know.`,
    same: `Across ${s.resolved} resolved forecasts you and the market did about equally well.`,
  };
  const stat = (n, label) => el("div", { class: "jstat" }, el("b", { class: "num", text: n }), el("span", { text: label }));
  return el("section", { class: "card pad track", "aria-label": "Your track record" },
    el("div", { class: "jstats" },
      stat(String(s.resolved), "resolved"), stat(String(s.open), "still open"),
      stat(s.resolved ? `${s.rightSide}/${s.resolved}` : "—", "on the right side of 50%"),
      stat(s.brier == null ? "—" : s.brier.toFixed(2), "your score"),
      stat(s.marketBrier == null ? "—" : s.marketBrier.toFixed(2), "market's score")),
    el("p", { class: "muted", text: lines[s.verdict] }),
    el("p", { class: "muted small", text: "Score is the squared gap between a forecast and what happened, averaged. Lower is better; always saying 50% scores 0.25. The market's score uses its price when you saved the forecast." }));
}
function journalRow(e) {
  const w = e.watch, f = e.forecast;
  const now = w && w.marketNow != null ? `Market now ${pts(w.marketNow)}${w.marketAtForecast != null ? ` (was ${pts(w.marketAtForecast)})` : ""}` : w && !w.reachable ? "Market unavailable right now" : "No market connected";
  return el("a", { class: "card jrow", href: `#/saved/${e.thread.id}` },
    el("strong", { text: e.thread.question }),
    el("div", { class: "jmeta" },
      el("span", { class: "num", text: `You ${f.probability}%` }), el("span", { class: "muted", text: now }),
      el("span", { class: "muted small", text: `saved ${day(f.created_at)}${f.revisions > 1 ? ` · updated ${f.revisions - 1} time${f.revisions > 2 ? "s" : ""}` : ""}` })),
    el("div", { class: "jchips" }, flagChips(w)));
}
const needsAttention = (e) => e.watch && (e.watch.flags || []).some((f) => ["moved", "closing-soon", "awaiting-resolution"].includes(f) || (f === "resolved" && !e.thread.lesson));

async function journalView(stale) {
  app.replaceChildren(el("p", { class: "loading", role: "status", text: "Checking your markets…" }));
  try {
    const d = await api("/api/journal");
    if (stale()) return;
    const attention = d.entries.filter(needsAttention), rest = d.entries.filter((e) => !needsAttention(e));
    const head = el("div", { class: "section-head" }, el("h1", { style: "font-size:28px;letter-spacing:-.03em", text: "Your journal" }), el("a", { class: "btn primary", href: "#/ask", text: "New research" }));
    const empty = !d.entries.length && !d.withoutForecast.length;
    app.replaceChildren(...kids(head,
      el("p", { class: "muted", style: "margin-top:6px;max-width:62ch", text: "Private to you. Clue remembers why you made each forecast, compares it with the market every time you visit, and scores it when the market resolves." }),
      empty ? el("div", { class: "card empty" }, el("h2", { text: "Nothing here yet" }), el("p", { class: "muted", text: "Pick a market, research it, and save a forecast with what would change your mind." }), el("a", { class: "btn primary", style: "margin-top:16px", href: "#/", text: "Browse markets" })) : trackRecord(d.summary),
      attention.length ? el("h2", { class: "jhead", text: "Worth a look" }) : null, attention.length ? el("div", { class: "saved-list" }, attention.map(journalRow)) : null,
      rest.length ? el("h2", { class: "jhead", text: attention.length ? "Everything else" : "Your forecasts" }) : null, rest.length ? el("div", { class: "saved-list" }, rest.map(journalRow)) : null,
      d.withoutForecast.length ? el("h2", { class: "jhead", text: "Research without a forecast yet" }) : null,
      d.withoutForecast.length ? el("div", { class: "saved-list" }, d.withoutForecast.map((t) => el("a", { class: "card saved-row", href: `#/saved/${t.id}` }, el("strong", { text: t.question }), el("span", { class: "muted small", text: `Updated ${when(t.updated_at)}` })))) : null));
  } catch (e) { if (!stale()) app.replaceChildren(errBox("Couldn’t load your journal", e.message, route)); }
}

// Shown at the top of a saved thread: what has happened to the market since the forecast, and what to do about it.
function watchCard(d, state) {
  const f = d.forecasts[0], w = d.watch;
  if (!f) return null;
  const box = el("section", { class: "card pad watch", "aria-label": "Since you forecast" });
  box.append(el("h2", { text: w?.state === "resolved" ? "What happened" : "Since you forecast" }));
  box.append(el("p", {}, "You said ", el("b", { class: "num", text: `${f.probability}%` }), el("span", { class: "muted", text: ` on ${day(f.created_at)}${f.outcome_label ? ` for “${f.outcome_label}”` : ""}.` })));
  if (!w) { box.append(el("p", { class: "muted", text: "No market is connected to this forecast, so there is nothing to compare it with. Connect a market on the Ask page next time to have Clue watch it." })); }
  else if (!w.reachable) { box.append(el("p", { class: "muted", text: "Clue couldn’t reach the market just now. Your forecast is safe; open this page again in a minute." })); }
  else {
    box.append(el("p", { class: "muted", text: `Market then ${pts(w.marketAtForecast)}, now ${pts(w.marketNow)}${w.movePoints != null ? ` (${signed(w.movePoints, " pts")})` : ""}.${w.marketAtForecast == null ? " The market’s price wasn’t recorded when this was saved." : ""}` }));
    const chips = flagChips(w); if (chips.length) box.append(el("div", { class: "jchips" }, chips));
    const sl = scoreLine(w); if (sl) box.append(el("p", { text: sl }));
  }
  if (f.change_condition) box.append(el("p", { class: "mind" }, el("span", { class: "label", text: "You said this would change your mind" }), el("span", { text: f.change_condition })));
  if (w?.state !== "resolved") {
    box.append(el("div", { class: "actions" }, el("button", { class: "btn", type: "button", text: "Check what’s new", onclick: (ev) => {
      ev.currentTarget.disabled = true;
      state.recheck(`What has changed since ${day(f.created_at)} on this question: ${d.thread.question} In particular: ${f.change_condition}`).finally(() => { ev.currentTarget.disabled = false; });
    } })));
  } else {
    const note = el("textarea", { rows: 3, maxlength: 2000, placeholder: "What did you miss, or get right for the wrong reason? One honest line helps most.", "aria-label": "What you learned" }); note.value = d.thread.lesson || "";
    const st = el("p", { class: "status", role: "status", "aria-live": "polite" });
    box.append(el("label", { class: "field" }, el("span", { text: "What you learned" }), note),
      el("div", { class: "actions" }, el("button", { class: "btn primary", type: "button", text: "Save note", onclick: async () => {
        st.className = "status"; st.textContent = "Saving…";
        try { await api(`/api/threads/${encodeURIComponent(d.thread.id)}/lesson`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lesson: note.value }) }); st.className = "status ok"; st.textContent = "Saved."; }
        catch (e) { st.className = "status err"; st.textContent = e.message; }
      } })), st);
  }
  return box;
}

/* ---------- saved ---------- */
async function savedView(id, stale) {
  if (!user) {
    app.replaceChildren(el("div", { class: "card empty" }, el("h2", { text: "Your research is private to you" }), el("p", { class: "muted", text: "Sign in to see saved research and forecasts." }), el("button", { class: "btn primary", style: "margin-top:16px", type: "button", text: "Sign in", onclick: () => openAccountDialog() })));
    document.addEventListener("clue:account", () => { if (location.hash.startsWith("#/saved")) route(); }, { once: true });
    return;
  }
  if (id) return savedThread(id, stale);
  return journalView(stale);
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
    const drawShares = (items) => shares.replaceChildren(...(items || []).map((p) => el("p", { class: "small" }, el("a", { href: `/?share=${encodeURIComponent(p.id)}`, target: "_blank", rel: "noopener", text: `Shared research · ${day(p.created_at)}` }), " · ", el("button", { class: "btn small ghost", type: "button", text: "Remove", onclick: async () => { if (!confirm("Remove this shared snapshot?")) return; try { await api(`/api/threads/${encodeURIComponent(id)}/publications/${encodeURIComponent(p.id)}`, { method: "DELETE" }); drawShares((await api(`/api/threads/${encodeURIComponent(id)}`)).publications); } catch (e) { msg.className = "status err"; msg.textContent = e.message; } } }))));
    drawShares(d.publications);
    const actions = el("div", { class: "actions" },
      el("button", { class: "btn", type: "button", text: "Export", onclick: async () => { const full = await api(`/api/threads/${encodeURIComponent(id)}`); const a = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(full, null, 2)], { type: "application/json" })), download: "clue-research.json" }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); } }),
      el("button", { class: "btn", type: "button", text: "Share this research", onclick: async () => { if (!confirm("Publish the latest saved question, answer, sources and connected market? Your private forecast and notes are NOT included.")) return; try { await post(`/api/threads/${encodeURIComponent(id)}/publish`, {}); drawShares((await api(`/api/threads/${encodeURIComponent(id)}`)).publications); msg.className = "status ok"; msg.textContent = "Shared. This is a snapshot, not a full track record."; } catch (e) { msg.className = "status err"; msg.textContent = e.message; } } }),
      el("button", { class: "btn", type: "button", style: "color:var(--no)", text: "Delete", onclick: async () => { if (!confirm("Delete this research and everything saved with it?")) return; try { await api(`/api/threads/${encodeURIComponent(id)}`, { method: "DELETE" }); location.hash = "#/saved"; } catch (e) { msg.className = "status err"; msg.textContent = e.message; } } }));
    const older = d.revisions.slice(1).map((r) => el("details", { class: "card pad", style: "margin-top:10px" }, el("summary", { text: `Earlier research · ${when(r.created_at)}` }), el("p", { class: "report-text", text: r.content })));
    app.replaceChildren(
      el("a", { class: "crumb", href: "#/saved", text: "← Journal" }),
      el("h1", { style: "font-size:26px;letter-spacing:-.03em;margin-bottom:6px", text: d.thread.question }),
      ...(market ? [el("p", { class: "muted", text: `Connected market: ${market.question}` })] : []),
      actions, msg, shares, watchCard(d, state), el("div", { style: "margin-top:20px", class: "ask-page" }, holder), older);
  } catch (e) { if (!stale()) app.replaceChildren(el("a", { class: "crumb", href: "#/saved", text: "← Journal" }), errBox("Couldn’t open this research", e.message, route)); }
}

/* ---------- public shared snapshot ---------- */
async function sharedView(shareId) {
  setNav("ask");
  try {
    const d = await api(`/api/public/${encodeURIComponent(shareId)}`);
    const text = el("div", { class: "report-text" }); linkify(text, d.snapshot.content, d.snapshot.sources || []);
    app.replaceChildren(el("div", { class: "ask-page" },
      el("p", { class: "muted small", text: `Shared research · ${when(d.publishedAt)}` }),
      el("h1", { text: d.snapshot.question }),
      el("div", { class: "card pad", style: "margin-top:20px" }, el("span", { class: "label", style: "color:var(--brand-text);font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase", text: "AI-generated · check the sources" }), sourceChips(d.snapshot.sources || []), text),
      el("p", { class: "note", text: "This is a copy that its author chose to share. It is not the full story, and their private forecasts are not included." })));
  } catch (e) { app.replaceChildren(errBox("Shared research unavailable", e.message)); }
}

/* ---------- boot ---------- */
(async () => {
  const share = new URLSearchParams(location.search).get("share");
  await refreshAccount();
  if (share) return sharedView(share);
  route();
})();
