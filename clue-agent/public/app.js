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
// The AI's answer arrives with light formatting marks (## headings, **bold**, - lists). Show them as formatting.
// Everything is built from text nodes and a few fixed elements: nothing the AI writes can become HTML, and only links the search returned are clickable.
function renderAnswer(target, text, allowed) {
  target.replaceChildren();
  const inline = (parent, line) => {
    line = line.replace(/\(?\[[^\]]*\]\((https?:\/\/[^)\s]+)\)\)?/g, "$1");               // "[site](address)" becomes just the address, shown as the site name
    line.split(/\*\*([^*\n]+)\*\*/).forEach((part, i) => {
      if (!part) return;
      if (i % 2) { const b = el("strong"); appendLinked(b, part, allowed, true); parent.append(b); } else appendLinked(parent, part, allowed, true);
    });
  };
  let para = [], list = null;
  const flushPara = () => { if (para.length) { const p = el("p"); inline(p, para.join(" ")); target.append(p); para = []; } };
  const flushList = () => { if (list) { target.append(list.node); list = null; } };
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    const heading = /^#{1,6}\s+(.*)$/.exec(line), item = /^([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (!line) { flushPara(); flushList(); }
    else if (heading) { flushPara(); flushList(); const h = el("h4", { class: "ans-h" }); inline(h, heading[1].replace(/\*\*/g, "")); target.append(h); }
    else if (item) { flushPara(); const ordered = /\d/.test(item[1]); if (list && list.ordered !== ordered) flushList(); if (!list) list = { ordered, node: el(ordered ? "ol" : "ul", { class: "ans-list" }) }; const li = el("li"); inline(li, item[2]); list.node.append(li); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
}
function linkify(target, text, allowed) { target.replaceChildren(); appendLinked(target, text, allowed); }
function appendLinked(target, text, allowed, short = false) {
  const ok = allowed ? new Set(allowed.map((u) => { try { const x = new URL(u); return (x.origin + x.pathname.replace(/\/+$/, '')).toLowerCase(); } catch { return ''; } })) : null;
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s<>)\]"']+/g)) {
    target.append(text.slice(last, m.index));
    let v = m[0], tail = "";
    while (/[.,;:]$/.test(v)) { tail = v.slice(-1) + tail; v = v.slice(0, -1); }
    try { const u = new URL(v); const k = (u.origin + u.pathname.replace(/\/+$/, '')).toLowerCase(); if (ok && !ok.has(k)) target.append(v); else target.append(el("a", { href: u.href, target: "_blank", rel: "noopener noreferrer", text: short ? `${u.hostname.replace(/^www\./, "")} ↗` : v })); } catch { target.append(v); }
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
    el("img", { class: "dlg-mark", src: document.documentElement.dataset.theme === "light" ? "/assets/clue-mark.svg" : "/assets/clue-mark-on-dark.svg", alt: "" }),
    el("h2", { text: "Sign in to Clue" }),
    el("p", { text: message || "Sign in to research, keep a private forecast journal and trade, all in one place. Your keys stay yours." }),
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
let tradingLoading = null, tradingSetup = null;   // tradingSetup: the trading account for the signed-in user (balance null until read)
// Trading setup is remembered on this device so a refresh does not ask again. Only two public addresses are kept, never keys.
// Setting up again is harmless: the trading account's address comes from the user's wallet, so it is the same one, not a new one.
const setupKey = (id) => `clue-trading-setup:${id}`;
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || ""));
function savedSetup(id) {
  try {
    const d = JSON.parse(localStorage.getItem(setupKey(id)) || "null");
    return d && isAddr(d.wallet) ? { signer: isAddr(d.signer) ? d.signer : null, wallet: d.wallet, approved: true, balance: null } : null;
  } catch { return null; }
}
function rememberSetup(id, t) {
  try { localStorage.setItem(setupKey(id), JSON.stringify({ signer: t.signer, wallet: t.wallet })); } catch { /* private window: the server still knows */ }
  post("/api/trading/account", { wallet: t.wallet, signer: t.signer }).catch(() => {});   // so a new phone or a cleared browser does not ask again
}
let accountLookup = { id: null, state: null };
// A person's cash is the pUSD their trading account holds on Polygon. Anyone can read it from a public server: no sign-in step, so it shows at once.
const CHAIN_READERS = ["https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org"];
async function readCashRaw(wallet) {
  const call = window.ClueTicket.cashCall(wallet); if (!call) return null;
  for (const url of CHAIN_READERS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [call, "latest"] }) });
      const raw = (await r.json()).result;
      if (window.ClueTicket.cashParse(raw) !== null) return raw;
    } catch { /* try the next server */ }
  }
  return null;
}
const readCash = async (wallet) => window.ClueTicket.cashParse(await readCashRaw(wallet));
const readCashUnits = async (wallet) => window.ClueTicket.cashUnits(await readCashRaw(wallet));   // asking the server whether this person already set up trading
let tradingScript = null;
function loadTradingScript() {
  // Just the trading code, with no sign-in window. Enough for reading deposit addresses.
  tradingScript ||= new Promise((resolve, reject) => {
    const s = el("script", { src: "/trading.js" });
    s.onload = resolve; s.onerror = () => reject(new Error("Could not load trading. Check your connection and try again."));
    document.head.append(s);
  }).catch((e) => { tradingScript = null; throw e; });
  return tradingScript;
}
function loadTrading() {
  tradingLoading ||= (async () => { await loadPrivy(); await loadTradingScript(); })().catch((e) => { tradingLoading = null; throw e; });
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
      el("a", { class: "btn", href: "#/portfolio", text: "Portfolio", onclick: () => dialog.close() }),
      el("a", { class: "btn", href: "#/saved", text: "Journal", onclick: () => dialog.close() }),
      el("a", { class: "btn", href: "#/agents", text: "Agents", onclick: () => dialog.close() }),
      el("a", { class: "btn", href: "#/docs", text: "Docs and help", onclick: () => dialog.close() }),
      el("button", { class: "btn", type: "button", style: "color:var(--no)", text: "Disconnect", onclick: signOut }),
      el("button", { class: "btn ghost", type: "button", text: "Close", onclick: () => dialog.close() })));
  if (!dialog.open) dialog.showModal();
}
// Lets a person use Clue from Claude, Codex, Cursor and other assistants over MCP. A key reads markets, runs research within
// the free allowance and keeps the Journal. It cannot trade or move money. The key is shown once, when it is made.
const MCP_URL = `${location.origin}/api/mcp`;
const copyBtn = (text, label = "Copy") => el("button", { class: "btn small", type: "button", text: label, onclick: async (ev) => { try { await navigator.clipboard.writeText(text); ev.currentTarget.textContent = "Copied"; } catch { ev.currentTarget.textContent = "Select and copy"; } } });
const snippet = (title, text) => el("div", { class: "mcp-snip" }, el("div", { class: "mcp-snip-head" }, el("span", { class: "label", text: title }), copyBtn(text)), el("pre", {}, el("code", { text })));
// Where the agent panels draw: a section of the Agents page when it is open, or the dialog otherwise.
const agentHosts = { keys: null, wallet: null };
function agentShow(which, nodes) {
  const host = agentHosts[which];
  if (host && host.isConnected) { host.replaceChildren(...kids(nodes.filter((n) => !(n && n.classList && n.classList.contains("actions") && n.dataset.dialogOnly)))); return true; }
  dialog.replaceChildren(...kids(nodes)); if (!dialog.open) dialog.showModal(); return false;
}
async function openAssistants(fresh) {
  const list = el("div", { class: "mcp-keys" }, el("p", { class: "muted", text: "Loading…" }));
  const make = el("button", { class: "btn primary", type: "button", text: "Make a key" });
  const label = el("input", { type: "text", maxlength: "60", placeholder: "Name it, e.g. Claude", "aria-label": "Key name" });
  const trade = el("input", { type: "checkbox", "aria-label": "Can trade" });
  make.onclick = async () => {
    make.disabled = true;
    try { const k = await post("/api/agent-keys", { label: label.value.trim() || "My assistant", canTrade: trade.checked }); openAssistants(k); }
    catch (e) { make.disabled = false; list.prepend(el("p", { class: "err", text: e.message })); }
  };
  const key = fresh?.token || "YOUR_KEY";
  const shown = fresh?.token ? el("div", { class: "mcp-new" },
    el("strong", { text: "Your new key. Copy it now: it will not be shown again." }),
    el("div", { class: "acct-addr" }, el("code", { text: fresh.token }), copyBtn(fresh.token))) : null;
  agentShow("keys", [
    el("h2", { text: "Connect your AI" }),
    el("p", { class: "muted", text: "In Claude or ChatGPT, add a custom connector with this address. A Clue sign-in opens: approve it and you are connected. No key to copy." }),
    el("div", { class: "acct-addr" }, el("span", { class: "label", text: "Connector address" }), el("code", { text: MCP_URL }), copyBtn(MCP_URL)),
    snippet("Claude Code", `claude mcp add --transport http clue ${MCP_URL}`),
    el("details", { class: "mcp-adv", open: Boolean(fresh?.token) }, el("summary", { text: "Advanced: connect with a key" }),
    el("p", { class: "muted", text: "Use Clue from Claude, Codex, Cursor or any assistant that supports MCP. It can search markets, run research with your free daily allowance, save forecasts to your Journal and read your Portfolio. It cannot place trades or move money." }),
    shown,
    snippet("Claude Code plugin (research and trading)", `export CLUE_KEY=${key}\nclaude plugin marketplace add majorlabs/cluemarket\nclaude plugin install clue@clue`),
    snippet("Claude Code (research only)", `claude mcp add --transport http clue ${MCP_URL} --header "Authorization: Bearer ${key}"`),
    snippet("Codex (~/.codex/config.toml)", `[mcp_servers.clue]\nurl = "${MCP_URL}"\nhttp_headers = { "Authorization" = "Bearer ${key}" }`),
    snippet("Cursor and others (mcp.json)", JSON.stringify({ mcpServers: { clue: { url: MCP_URL, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)),
    ),
    el("h3", { text: "Connected AIs and keys" }), list,
    el("div", { class: "mcp-make" }, label, make),
    el("label", { class: "mcp-trade" }, trade, el("span", { text: "Can trade: lets this key ask for trades through Assistant trading, within your limits. Leave it off for research only." })),
    el("div", { class: "actions", "data-dialog-only": "1" }, el("button", { class: "btn ghost", type: "button", text: "Back", onclick: openAccountMenu }), el("button", { class: "btn ghost", type: "button", text: "Close", onclick: () => dialog.close() }))]);
  try {
    const { keys } = await api("/api/agent-keys");
    list.replaceChildren(...(keys.length ? keys.map((k) => el("div", { class: "mcp-key" },
      el("div", {}, el("strong", { text: k.label }), el("span", { class: `mcp-scope ${k.canTrade ? "trade" : ""}`, text: k.canTrade ? "Can trade" : "Read only" }), k.connected ? el("span", { class: "mcp-scope", text: "Connected" }) : null, el("div", { class: "muted small", text: `Made ${when(k.createdAt)}${k.lastUsedAt ? ` · last used ${when(k.lastUsedAt)}` : " · not used yet"}` })),
      el("button", { class: "btn small", type: "button", style: "color:var(--no)", text: k.connected ? "Disconnect" : "Remove", onclick: async (ev) => { ev.currentTarget.disabled = true; try { await api(`/api/agent-keys/${k.id}`, { method: "DELETE" }); } catch { /* already gone */ } openAssistants(); } })))
      : [el("p", { class: "muted", text: "Nothing connected yet." })]),
      keys.length ? el("button", { class: "btn small", type: "button", style: "color:var(--no)", text: "Disconnect all AIs", onclick: async (ev) => { if (!confirm("Disconnect every AI app and key from your account?")) return; ev.currentTarget.disabled = true; try { await api("/api/agent-keys", { method: "DELETE" }); } catch { /* try again */ } openAssistants(); } }) : null);
  } catch (e) { list.replaceChildren(el("p", { class: "err", text: e.message })); }
}
// Assistant trading: the person connects their own OutLayer agent wallet and sets their own limits. Their assistant trades
// through the Clue plugin from their own computer; Clue checks each order against these limits before the wallet signs it.
async function openAgentWallet() {
  const msg = el("p", { class: "err", role: "alert" });
  const body = el("div", {}, el("p", { class: "loading", role: "status", text: "Loading…" }));
  agentShow("wallet", [el("h2", { text: "Assistant trading" }),
    el("p", { class: "muted", text: "Let your AI assistant buy and sell on Polymarket with your own OutLayer agent wallet, within limits you set. Orders go from your own computer through the Clue plugin, and Clue checks every order against your limits before your wallet signs it." }),
    body, msg, el("div", { class: "actions", "data-dialog-only": "1" }, el("button", { class: "btn ghost", type: "button", text: "Back", onclick: openAccountMenu }), el("button", { class: "btn ghost", type: "button", text: "Close", onclick: () => dialog.close() }))]);
  const send = async (method, data) => { msg.textContent = ""; try { await api("/api/agent-wallet", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) }); openAgentWallet(); } catch (e) { msg.textContent = e.message; body.querySelectorAll("button").forEach((b) => { b.disabled = false; }); } };
  const limitInputs = (w) => {
    const per = el("input", { type: "number", min: "1", step: "1", inputmode: "decimal", value: w ? String(w.maxOrder) : "", placeholder: "e.g. 25", "aria-label": "Limit per order in dollars" });
    const day = el("input", { type: "number", min: "1", step: "1", inputmode: "decimal", value: w ? String(w.maxDay) : "", placeholder: "e.g. 100", "aria-label": "Limit per day in dollars" });
    return { per, day, node: el("div", { class: "aw-limits" }, el("label", { class: "field" }, el("span", { text: "Most per order ($)" }), per), el("label", { class: "field" }, el("span", { text: "Most per day ($)" }), day)) };
  };
  let w, log = [];
  try { ({ wallet: w, activity: log = [] } = await api("/api/agent-wallet")); } catch (e) { body.replaceChildren(el("p", { class: "err", text: e.message })); return; }
  if (!w) {
    const key = el("input", { type: "password", autocomplete: "off", placeholder: "wk_…", "aria-label": "OutLayer wallet key" });
    const L = limitInputs(null);
    body.replaceChildren(
      el("ol", { class: "aw-steps" },
        el("li", {}, "Create an agent wallet at ", el("a", { href: "https://app.outlayer.ai", target: "_blank", rel: "noopener", text: "app.outlayer.ai" }), " (Custody, Wallets). In its policy, allow evm_sign and save."),
        el("li", { text: "Paste the wallet key (it starts with wk_) and choose your limits." }),
        el("li", { text: "Make a key with Can trade ticked under Connect your AI, and install the Clue plugin." })),
      el("label", { class: "field" }, el("span", { text: "OutLayer wallet key" }), key), L.node,
      el("button", { class: "btn primary", type: "button", text: "Connect wallet", onclick: (ev) => { ev.currentTarget.disabled = true; send("POST", { key: key.value.trim(), maxOrder: Number(L.per.value), maxDay: Number(L.day.value) }); } }));
    return;
  }
  const L = limitInputs(w);
  body.replaceChildren(
    el("div", { class: "acct-addr" }, el("span", { class: "label", text: "Agent wallet (OutLayer)" }), el("code", { text: w.address }), copyBtn(w.address)),
    el("div", { class: `aw-state ${w.enabled ? "on" : ""}` }, el("b", { text: w.enabled ? "On: your assistant can trade" : "Off: your assistant cannot trade" }),
      el("span", { class: "muted small", text: `Used today: $${w.spentToday} of $${w.maxDay}` })),
    el("button", { class: `btn ${w.enabled ? "" : "primary"}`, type: "button", text: w.enabled ? "Switch off" : "Switch on", onclick: () => send("PATCH", { enabled: !w.enabled }) }),
    L.node,
    el("button", { class: "btn", type: "button", text: "Save limits", onclick: () => send("PATCH", { maxOrder: Number(L.per.value), maxDay: Number(L.day.value) }) }),
    el("p", { class: "muted small", text: "To fund it, ask your assistant for trading_status. It gives the trading account address to send pUSD to, or to use with Add money." }),
    el("button", { class: "btn small", type: "button", style: "color:var(--no)", text: "Disconnect wallet", onclick: () => send("DELETE") }),
    el("h3", { text: "What your assistant asked for" }),
    log.length ? el("div", { class: "aw-log" }, ...log.map((x) => el("div", { class: `aw-row ${x.status}` },
      el("span", { class: "num", text: new Date(x.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) }),
      el("span", { text: x.kind === "order" ? `${x.side === "SELL" ? "Sell" : "Buy"}${x.side === "BUY" ? ` $${Number(x.usd).toFixed(2)}` : ""}${x.price ? ` at ${Math.round(x.price * 100)}¢` : ""}` : x.kind === "signin" ? "Sign-in to Polymarket" : x.kind === "approval" ? "Trading permission" : `Request: ${x.kind}` }),
      el("b", { text: x.status === "signed" ? "Signed" : x.status === "refused" ? "Refused" : x.status === "pending" ? "Signing" : "Failed" }),
      x.reason ? el("small", { class: "muted", text: x.reason }) : null)))
      : el("p", { class: "muted small", text: "Nothing yet. Every request your assistant makes shows here, signed or refused." }));
}
async function signOut() {
  dialog.close();
  try { await post("/api/wallet/disconnect", {}); } catch { /* session may already be gone */ }
  try { await window.cluePrivy?.logout(); } catch { /* not signed in with Privy */ }
  tradingSetup = null;
  await refreshAccount();
  if (location.hash.startsWith("#/saved")) route();
}
const shortName = (s = "") => (s.length > 18 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);
$("account-open").addEventListener("click", async () => {
  if (!user) return openAccountDialog();
  openAccountMenu();
});
window.installClueTheme?.();
const topBar = document.querySelector(".top");
addEventListener("scroll", () => topBar.classList.toggle("scrolled", scrollY > 8), { passive: true });

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
  if (parts[0] === "agents") { setNav("agents"); return agentsView(); }
  if (parts[0] === "connect") { setNav(""); return connectView(parts[1] || ""); }
  if (parts[0] === "docs") { setNav(""); return docsView(parts[1]); }
  if (parts[0] === "portfolio") { setNav("portfolio"); return portfolioView(stale); }
  if (parts[0] === "card") { setNav(""); return cardView(parts[1] || ""); }
  setNav("board");
  buildCategories(qs.get("q") ? null : qs.get("tag") || "");
  return boardView(qs.get("tag") || "", qs.get("q") || "", stale, qs.get("sort") || "trending");
}
window.addEventListener("hashchange", route);

/* ---------- a share card made by an assistant: the link carries the call's numbers, the card is drawn here ---------- */
function cardFromLink(code) {
  let d; try { d = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(code.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))); } catch { return null; }
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined), t = (v, max) => (typeof v === "string" ? v.slice(0, max) : undefined);
  if (!d || !["won", "lost", "open", "placed"].includes(d.kind) || !t(d.question, 300) || !(n(d.entry) > 0 && n(d.entry) < 1)) return null;
  return { kind: d.kind, question: t(d.question, 300), side: t(d.side, 60) || "Yes", entry: n(d.entry), shares: n(d.shares) || 0, paid: n(d.paid), now: n(d.now), payout: n(d.payout), eventSlug: /^[a-z0-9-]{1,200}$/.test(d.eventSlug || "") ? d.eventSlug : undefined };
}
function cardView(code) {
  const data = cardFromLink(code);
  if (!data) { app.replaceChildren(el("div", { class: "card empty" }, el("h2", { text: "This card link does not work" }), el("p", { class: "muted", text: "Ask your assistant to make the card again." }), el("a", { class: "btn primary", href: "#/", text: "Go to Clue" }))); return; }
  const into = el("div", { class: "share-panel" });
  app.replaceChildren(el("div", { class: "card card-page" }, el("h2", { text: "Your card" }), el("p", { class: "muted", text: data.question }), into,
    data.eventSlug ? el("a", { class: "btn small", href: `#/event/${encodeURIComponent(data.eventSlug)}`, text: "Open the market" }) : null));
  openShare(data, into);
}

/* ---------- docs: everything about Clue, in one place ---------- */
// Each section: [id, title, blocks]. A block is a paragraph (string), a list (["ul", ...items]), steps (["ol", ...items]),
// a command (["code", text]) or a link row (["links", [label, href], ...]). Plain text only: nothing here becomes HTML.
const DOCS = [
  ["start", "Getting started", [
    "Clue is a place to research any question about the future, make your own call on it, and trade it. Research runs on NEAR AI Cloud, money comes in through NEAR Intents, and trades go to Polymarket's markets.",
    ["ol", "Open oncluemarket.xyz on your phone or computer.", "Tap Sign in and choose email, Google, an Ethereum wallet, or a NEAR wallet.", "With email or Google, Clue makes a wallet for you. There is nothing to install and no seed phrase to write down.", "Pick a market from Markets, or search for a topic."],
    "Prices on Clue are shown as chances. A Yes at 39¢ means traders put it at about 39%. If the call comes in, each share pays $1.",
  ]],
  ["research", "Research", [
    "Ask any question, with or without a market. Clue searches the web for the latest news and numbers and gives you a short answer you can take in at a glance.",
    ["ul", "The short answer", "The evidence for and against, each with a link to its source", "What to watch next", "How sure the answer is"],
    "Only links the search actually found are shown. Everyone gets 2 free researches a day, and they reset at midnight UTC. Open a market and tap Research, or go to Ask Clue.",
  ]],
  ["journal", "Your calls and the Journal", [
    "After research, save your own chance for the question, why you think so, and what would change your mind. Your Journal keeps every call next to the market price when you made it and the price now.",
    "When a market resolves, your call is scored against the market's price at the time, so you can see whether you are beating the crowd. You can add a note on what you learned. Everything in the Journal is private to you unless you choose to share it.",
  ]],
  ["trading", "Trading", [
    ["ol", "Open a market and choose a side.", "Set up trading the first time. It is gasless: you approve once in your wallet and Clue does the rest.", "Enter how much to spend. Clue shows the shares you get, the worst price it will accept, and what you get back if the call comes in.", "Place the order. It fills completely at your price or not at all, so you never end up with half an order you did not expect."],
    "Orders go from your own device straight to Polymarket. Orders still waiting on the market show in Portfolio, where you can cancel them.",
  ]],
  ["money", "Add money and withdraw", [
    "Open Portfolio and tap Add money. You can send from many chains through NEAR Intents, including USDC on NEAR, or send USDC straight from Solana or Polygon. Whatever you send arrives as pUSD, Polymarket's dollar.",
    ["ol", "Choose what you are sending and how much. Clue shows what will arrive.", "Tap Get my deposit address and send to it from your wallet or exchange.", "The deposit stays at the top of Add money, with live status, until it lands. It stays there after a refresh too.", "If a deposit cannot finish, it goes back to your refund address. Clue shows when and where."],
    "A deposit sent earlier can be added by pasting its address. To take money out, tap Withdraw in Portfolio and choose the chain and address. Withdrawals go through Polymarket's own bridge.",
  ]],
  ["portfolio", "Portfolio and share cards", [
    "Portfolio shows your cash, every position with its profit or loss, your history, and orders still waiting. When a market ends in your favour, tap Claim to move the winnings into your cash.",
    "Tap Share on any position to make a 16:9 card of your call: live, won or lost. It comes with a post ready for X and a code that opens the same market, so people who see it can make their own call. Save the card, copy the post, or post it on X.",
  ]],
  ["agents", "Agents: use Clue from your AI", [
    "Clue works inside Claude, Codex, Cursor and other AI assistants. You chat as you normally would, and your assistant uses Clue for you.",
    ["ul", "“How is my portfolio doing?”", "“Research the Fed's December decision and save my call at 70%.”", "“Make a PnL card for my biggest position.” (the card arrives as a picture in the chat)", "“What changed since my calls?” and “How good are my calls?”", "“Buy $5 of Yes on this market.” (with assistant trading switched on)"],
    ["ol", "In Claude or ChatGPT, open Settings, then Connectors, and add a custom connector with the address https://www.oncluemarket.xyz/api/mcp. In Claude Code, run: claude mcp add --transport http clue https://www.oncluemarket.xyz/api/mcp", "A Clue page opens. Sign in, choose whether it may also trade, and tap Approve.", "Ask away. It works as you: your Journal, your Portfolio, your limits. Disconnect it any time from Agents."],
    "There is no key to copy. Apps that cannot sign in this way can use a key instead: open Agents, then Advanced: connect with a key.",
    "For Claude Code, the Clue plugin adds everything in one install, with the commands /clue:research, /clue:portfolio, /clue:card, /clue:record, /clue:brief and /clue:trade:",
    ["code", "export CLUE_KEY=your_key\nclaude plugin marketplace add majorlabs/cluemarket\nclaude plugin install clue@clue"],
  ]],
  ["assistant-trading", "Assistant trading", [
    "Your assistant can trade for you with an agent wallet on OutLayer, NEAR's secure custody for AI agents. The wallet's keys stay in OutLayer's secure hardware, and you choose the limits.",
    ["ol", "At app.outlayer.ai, open Custody, then Wallets, and create a wallet. In its policy, allow evm_sign, leave the other capabilities off, and save.", "In Clue, open Agents, then Assistant trading. Paste the wallet key (it starts with wk_), set your most per order and most per day, and switch it on.", "Connect your AI with “Also let it trade” ticked, or make a key with Can trade ticked for the Clue plugin.", "Ask your assistant for trading_status, fund the trading account it shows (or use Add money), and run setup_trading once.", "Ask for a trade. Your assistant shows you the market, the amount and the worst price, and waits for your yes."],
    "Every order is checked by Clue before your wallet signs it: it must fit your limits and be close to the live market price, or it is refused. Clue signs only Polymarket sign-in, orders and Polymarket's trading permissions. It never signs transfers or withdrawals. Orders are sent to Polymarket from your own computer.",
    "Everything your assistant asks for shows under Assistant trading, signed or refused, with the reason. Switch it off there at any time, remove the key, or freeze the wallet on OutLayer.",
  ]],
  ["safety", "How your money and keys are kept safe", [
    ["ul", "Your trading wallet is yours. Clue never holds your money.", "Orders go from your own device or computer to Polymarket.", "Connecting an AI is a sign-in you approve. Nothing to copy, and you can disconnect any app from Agents, or all of them at once.", "A connected AI is read-only unless you tick Also let it trade.", "An OutLayer wallet key is stored sealed and is never shown again. Clue checks your limits and the live price on every order, and refuses anything else.", "Every request from your assistant is logged where you can see it."],
  ]],
  ["faq", "Questions people ask", [
    ["ul", "Do I need crypto to start? No. Sign in with email or Google and add money from any of the supported chains.", "What does 39¢ mean? Traders put the outcome at about 39%. Each share pays $1 if it comes in.", "Why did my research take a while? Clue searches for the latest news first. Most answers take under a minute.", "My deposit has not arrived. It stays at the top of Add money with its status. If it cannot finish, it goes back to your refund address automatically.", "Can my AI spend more than I allow? No. Your limits per order and per day are checked by Clue before anything is signed, and your wallet only holds what you put in it."],
  ]],
  ["help", "Get help", [
    "Stuck, found a bug, or have an idea? Open an issue on GitHub and we will get back to you.",
    ["links", ["Open an issue on GitHub", "https://github.com/majorlabs/cluemarket/issues"], ["Read the code", "https://github.com/majorlabs/cluemarket"]],
  ]],
];
function docsView(section) {
  const block = (b) => {
    if (typeof b === "string") return el("p", { text: b });
    const [kind, ...rest] = b;
    if (kind === "ul" || kind === "ol") return el(kind, {}, ...rest.map((t) => el("li", { text: t })));
    if (kind === "code") return el("div", { class: "mcp-snip" }, el("div", { class: "mcp-snip-head" }, el("span", { class: "label", text: "Command" }), copyBtn(rest[0])), el("pre", {}, el("code", { text: rest[0] })));
    if (kind === "links") return el("div", { class: "docs-links" }, ...rest.map(([label, href]) => el("a", { class: "btn small", href, target: "_blank", rel: "noopener", text: label })));
    return null;
  };
  const toc = el("nav", { class: "docs-toc card", "aria-label": "Docs contents" }, el("b", { text: "Contents" }), ...DOCS.map(([id, title]) => el("a", { href: `#/docs/${id}`, text: title })));
  const body = el("div", { class: "docs-body" },
    el("section", { class: "card docs-sec docs-intro" }, el("h1", { text: "Clue docs" }), el("p", { class: "muted", text: "Everything about Clue: research, your calls, trading, money in and out, and using Clue from your AI." })),
    ...DOCS.map(([id, title, blocks]) => el("section", { class: "card docs-sec", id: `docs-${id}` }, el("h2", { text: title }), ...blocks.map(block))));
  app.replaceChildren(el("div", { class: "docs-page" }, toc, body));
  if (section) { const t = document.getElementById(`docs-${section}`); if (t) requestAnimationFrame(() => t.scrollIntoView({ block: "start" })); }
}

/* ---------- connect: an AI app asks to use Clue for this person ---------- */
async function connectView(id) {
  app.replaceChildren(el("p", { class: "loading", role: "status", text: "Opening the request…" }));
  let r;
  try { r = await api(`/api/oauth/request/${encodeURIComponent(id)}`); }
  catch (e) { app.replaceChildren(el("div", { class: "card empty connect-card" }, el("h2", { text: "This request has expired" }), el("p", { class: "muted", text: "Go back to your AI app and connect Clue again." }))); return; }
  const card = el("section", { class: "card connect-card" });
  const head = [el("img", { src: "/assets/clue-mark.svg", alt: "", width: "48", height: "48" }), el("h1", { text: `Connect ${r.app} to Clue` }),
    el("p", { class: "muted", text: `${r.app} is asking to use your Clue account. It will send you back to ${r.returnsTo} when you are done.` })];
  if (!user) {
    card.replaceChildren(...head, el("button", { class: "btn primary", type: "button", text: "Sign in to continue", onclick: () => openAccountDialog(`Sign in to connect ${r.app}.`) }));
    app.replaceChildren(card);
    document.addEventListener("clue:account", () => { if (location.hash.startsWith("#/connect/")) route(); }, { once: true });
    return;
  }
  const trade = el("input", { type: "checkbox", "aria-label": "Also let it trade" });   // off unless the person ticks it, whatever the app asked for
  const msg = el("p", { class: "err", role: "alert" });
  const go = async (approve, ev) => {
    card.querySelectorAll("button").forEach((b) => { b.disabled = true; }); ev.currentTarget.textContent = approve ? "Connecting…" : "Going back…";
    try { const d = await post("/api/oauth/approve", { id, approve, canTrade: trade.checked }); location.href = d.redirect; }
    catch (e) { msg.textContent = e.message; card.querySelectorAll("button").forEach((b) => { b.disabled = false; }); }
  };
  card.replaceChildren(...head,
    el("div", { class: "connect-can" }, el("b", { text: `${r.app} will be able to` }),
      el("ul", {}, ...["Search markets and read their chances", "Run research with your free daily allowance", "Save calls to your Journal and read it", "Read your Portfolio and make PnL cards"].map((t) => el("li", { text: t })))),
    el("label", { class: "connect-trade" }, trade, el("span", {}, el("b", { text: "Also let it trade" }), el("small", { class: "muted", text: " Orders only within the limits you set under Agents, Assistant trading. It can never move money out." }))),
    el("div", { class: "connect-actions" }, el("button", { class: "btn primary", type: "button", text: "Approve", onclick: (ev) => go(true, ev) }), el("button", { class: "btn", type: "button", text: "Cancel", onclick: (ev) => go(false, ev) })),
    msg, el("p", { class: "muted small", text: "You can disconnect it at any time from Agents." }));
  app.replaceChildren(card);
}

/* ---------- agents: use Clue from an AI assistant, and let it trade within your limits ---------- */
function agentsView() {
  const intro = el("section", { class: "card agents-hero" },
    el("h1", { text: "Agents" }),
    el("p", { class: "muted", text: "Use Clue from Claude, Codex, Cursor or any AI assistant. Ask it to research a market, save your call, check your Portfolio, make a PnL card, and, if you switch it on, trade within limits you set." }),
    el("div", { class: "agents-try" }, ...["How is my portfolio doing?", "Research the Fed's December decision", "Make a PnL card for my biggest position", "What changed since my calls?"].map((t) => el("span", { class: "chip", text: `“${t}”` }))));
  if (!user) {
    app.replaceChildren(intro, el("div", { class: "card empty" }, el("h2", { text: "Sign in to connect your AI" }), el("p", { class: "muted", text: "Your assistant works as you: your Journal, your Portfolio, your limits." }), el("button", { class: "btn primary", type: "button", text: "Sign in", onclick: () => openAccountDialog("Sign in to connect your AI.") })));
    document.addEventListener("clue:account", () => { if (location.hash.startsWith("#/agents")) route(); }, { once: true });
    return;
  }
  agentHosts.keys = el("section", { class: "card agents-sec" });
  agentHosts.wallet = el("section", { class: "card agents-sec" });
  const plugin = el("section", { class: "card agents-sec" },
    el("h2", { text: "The Clue plugin for Claude Code" }),
    el("p", { class: "muted", text: "One install adds research, your Journal, your Portfolio, PnL cards and trading to Claude Code, with commands like /clue:research, /clue:portfolio, /clue:card, /clue:brief and /clue:trade." }),
    snippet("Install", "export CLUE_KEY=YOUR_KEY\nclaude plugin marketplace add majorlabs/cluemarket\nclaude plugin install clue@clue"),
    el("p", { class: "muted small" }, "Make a key above first. For trading, tick Can trade and set up Assistant trading below. ", el("a", { href: "#/docs/agents", text: "Read the guide" })));
  app.replaceChildren(el("div", { class: "agents-page" }, intro, agentHosts.keys, plugin, agentHosts.wallet));
  openAssistants(); openAgentWallet();
}

/* ---------- portfolio: what a person holds, and how it is doing ---------- */
// Everything here is read from Polymarket's public data service for the person's own trading account (no sign-in step, so it is quick),
// and the cash from the chain. Nothing is sent anywhere and nothing is changed by looking.
const DATA_API = "https://data-api.polymarket.com/v2";
const pfUsd = (n) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
const pfSigned = (n) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(2)}`;
const pfPct = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(1)}%`;
const pfCents = (p) => `${(p * 100).toFixed(1).replace(/\.0$/, "")}¢`;
async function dataGet(path) {
  const r = await fetch(`${DATA_API}${path}`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("Polymarket's data is not answering right now. Try again in a minute.");
  return r.json();
}
async function myTradingWallet() {
  if (tradingSetup && isAddr(tradingSetup.wallet)) return tradingSetup.wallet;
  const saved = user ? savedSetup(user.id) : null; if (saved) return saved.wallet;
  try { const d = await api("/api/trading/account"); return d.account && isAddr(d.account.wallet) ? d.account.wallet : null; } catch { return null; }
}
async function portfolioView(stale) {
  const T = window.ClueTicket;
  if (!user) {
    app.replaceChildren(el("div", { class: "card empty" }, el("h2", { text: "Your portfolio" }), el("p", { class: "muted", text: "Sign in to see what you hold and how it is doing." }), el("button", { class: "btn primary", type: "button", text: "Sign in", onclick: () => openAccountDialog("Sign in to see your portfolio.") })));
    document.addEventListener("clue:account", () => { if (location.hash.startsWith("#/portfolio")) route(); }, { once: true });
    return;
  }
  app.replaceChildren(el("p", { class: "loading", role: "status", text: "Opening your portfolio…" }));
  const wallet = await myTradingWallet();
  if (stale()) return;
  if (!wallet) {
    app.replaceChildren(el("div", { class: "card empty" }, el("h2", { text: "Your portfolio" }), el("p", { class: "muted", text: "Set up trading on any market and make your first call. Your positions show up here." }), el("a", { class: "btn primary", href: "#/", text: "Find a market" })));
    return;
  }
  const root = el("div", { class: "pf-root" });
  const summary = el("div", { class: "pf-summary" });
  const claimAll = el("div", { class: "pf-claimall" }), claimAllPanel = el("div", { class: "claim-panel" });
  const body = el("div", { class: "pf-body" });
  let tab = "positions", positions = null, history = null, cash = null, failed = "";
  let orders = null, ordersError = null, titles = {}, ordersLoading = false;           // open orders are read only when the tab is opened

  const stat = (label, value, tone = "", note) => el("div", { class: `card pf-stat ${tone}` }, el("small", { class: "muted", text: label }), el("b", { class: "num", text: value }), note ? el("small", { class: "muted", text: note }) : null);
  function drawSummary() {
    const t = T.portfolioTotals(positions || []);
    const total = (cash || 0) + t.value + t.toClaim;
    summary.replaceChildren(
      stat("Total", positions || cash !== null ? pfUsd(total) : "…", "big"),
      stat("Cash", cash === null ? "…" : pfUsd(cash)),
      stat("In calls", pfUsd(t.value), "", `${t.open} open`),
      stat("Open profit", pfSigned(t.openPnl), t.openPnl > 0 ? "pos" : t.openPnl < 0 ? "neg" : ""),
      ...(t.toClaim > 0 ? [stat("Waiting for you", pfUsd(t.toClaim), "pos")] : []));
    const claimable = (positions || []).filter((p) => ["won", "partial"].includes(T.positionState(p)) && T.claimId(p));
    claimAll.replaceChildren(...(claimable.length > 1 ? [el("button", { class: "btn primary", type: "button", text: `Claim all · ${pfUsd(claimable.reduce((s, p) => s + T.positionNumbers(p).value, 0))}`, onclick: (ev) => { ev.currentTarget.hidden = true; claimPositions(claimable, claimAllPanel); } }), claimAllPanel] : []));
  }

  // Claims one or more ended markets, one after the other, with live steps. Ends with a plain result, then the page reloads its numbers.
  async function claimPositions(list, into) {
    const ids = [...new Set(list.map((p) => T.claimId(p)).filter(Boolean))];
    const total = list.reduce((sum, p) => sum + T.positionNumbers(p).value, 0);
    if (!ids.length) { into.replaceChildren(el("p", { class: "status err", text: "That call cannot be claimed." })); return; }
    const pr = progress([{ id: "load", label: "Getting ready" }, { id: "account", label: "Opening your trading account" }, { id: "sign", label: "Signing with your wallet" }, { id: "confirm", label: ids.length > 1 ? "Collecting your winnings…" : "Collecting your winnings" }]);
    into.replaceChildren(pr.node); pr.advance("load");
    try { await loadTrading(); } catch (e) { pr.fail("load"); into.append(el("p", { class: "status err", text: e.message })); return; }
    for (let i = 0; i < ids.length; i++) {
      const r = await window.clueTrading.claim({ conditionId: ids[i], onStep: (s) => pr.advance(s) });
      if (!r.ok) { pr.fail(); into.append(el("div", { class: "ending bad" }, el("span", { class: "ending-i", "aria-hidden": "true", text: "✕" }), el("b", { text: i ? `Claimed ${i} of ${ids.length}, then stopped` : "Not claimed" })), el("p", { text: r.error }), r.detail ? el("small", { class: "err-detail", text: `(${r.detail})` }) : null); return; }
      if (i < ids.length - 1) pr.advance("account");
    }
    pr.finish();
    into.append(el("div", { class: "ending ok" }, el("span", { class: "ending-i", "aria-hidden": "true", text: "✓" }), el("b", { text: `Done. ${pfUsd(total)} is in your cash.` })));
    setTimeout(() => load(true), 6000);                                              // the data service and the chain catch up a moment later
  }

  function positionRow(p) {
    const s = T.positionState(p), n = T.positionNumbers(p), sharePanel = el("div", { class: "share-panel" }), claimPanel = el("div", { class: "claim-panel" });
    const tone = n.pnl > 0 ? "pos" : n.pnl < 0 ? "neg" : "";
    const share = () => {
      const data = s === "won" ? { kind: "won", payout: n.value } : s === "lost" ? { kind: "lost" } : { kind: "open", now: n.now };
      openShare({ ...data, question: p.title, side: p.outcome, entry: n.avg, shares: n.shares, paid: n.paid, eventSlug: p.event_slug }, sharePanel);
    };
    return el("div", { class: "card pf-row" },
      el("div", { class: "pf-top" },
        p.icon ? el("img", { class: "pf-icon", src: p.icon, alt: "", loading: "lazy", width: "40", height: "40" }) : null,
        el("div", { class: "pf-title" }, el("a", { href: `#/event/${encodeURIComponent(p.event_slug || p.slug)}`, text: p.title }),
          el("div", { class: "pf-sub" }, el("span", { class: "pf-side", text: p.outcome }), el("span", { class: "muted", text: `${n.shares.toFixed(2)} shares · ${pfCents(n.avg)}${s === "open" ? ` → ${pfCents(n.now)}` : ""}` }))),
        el("div", { class: "pf-val" }, el("b", { class: "num", text: pfUsd(n.value) }), el("small", { class: `num ${tone}`, text: `${pfSigned(n.pnl)} · ${pfPct(n.pct)}` }))),
      s !== "open" ? el("p", { class: `pf-end ${s === "lost" ? "neg" : "pos"}`, text: s === "won" ? `Ended: you called it. ${pfUsd(n.value)} is waiting for you.` : s === "partial" ? `Ended: this market paid out part. ${pfUsd(n.value)} is waiting for you.` : "Ended: it went the other way." }) : null,
      el("div", { class: "pf-actions" },
        s === "won" || s === "partial" ? el("button", { class: "btn primary small", type: "button", text: `Claim ${pfUsd(n.value)}`, onclick: (ev) => { ev.currentTarget.hidden = true; claimPositions([p], claimPanel); } }) : null,
        s !== "partial" ? el("button", { class: "btn small", type: "button", text: "Share", onclick: (ev) => { ev.currentTarget.hidden = true; share(); } }) : null,
        el("a", { class: "btn small", href: `#/event/${encodeURIComponent(p.event_slug || p.slug)}`, text: "View market" })),
      claimPanel, sharePanel);
  }

  // ---- open orders: what is still waiting on the market, with a way to cancel it ----
  async function loadOrders() {
    if (ordersLoading) return;
    ordersLoading = true; ordersError = null; orders = null; drawBody();
    const pr = progress([{ id: "load", label: "Getting ready" }, { id: "account", label: "Opening your trading account" }, { id: "read", label: "Reading your open orders" }]);
    body.replaceChildren(pr.node); pr.advance("load");
    try {
      await loadTrading(); pr.advance("account");
      const r = await window.clueTrading.openOrders();
      if (!r.ok) { ordersError = r; return; }
      pr.advance("read"); orders = r.orders;
      const ids = [...new Set(orders.map((o) => o.conditionId).filter(Boolean))];
      if (ids.length) { try { titles = { ...titles, ...(await api(`/api/markets/by-condition?ids=${ids.join(",")}`)).markets }; } catch { /* the order still shows, without a name */ } }
    } catch (e) { ordersError = { error: e.message }; }
    finally { ordersLoading = false; if (stale() || !root.isConnected) return; drawBody(); }
  }

  async function cancelThese(list, into, all) {
    const pr = progress([{ id: "load", label: "Getting ready" }, { id: "account", label: "Opening your trading account" }, { id: "cancel", label: list.length > 1 || all ? "Cancelling your orders" : "Cancelling your order" }]);
    into.replaceChildren(pr.node); pr.advance("load");
    try { await loadTrading(); } catch (e) { pr.fail("load"); into.append(el("p", { class: "status err", text: e.message })); return; }
    const r = await window.clueTrading.cancelOrders({ orderIds: list.map((o) => o.id), all, onStep: (s) => pr.advance(s) });
    const bad = (title, ...more) => { pr.fail(); into.append(el("div", { class: "ending bad" }, el("span", { class: "ending-i", "aria-hidden": "true", text: "✕" }), el("b", { text: title })), ...more); };
    if (!r.ok) { bad("Not cancelled", el("p", { text: r.error }), r.detail ? el("small", { class: "err-detail", text: `(${r.detail})` }) : null); return; }
    const done = new Set(r.canceled), missed = Object.entries(r.notCanceled || {});
    const freed = list.filter((o) => done.has(o.id)).reduce((s, o) => s + T.orderNumbers(o).held, 0);
    if (!done.size && missed.length) { bad("Not cancelled", el("p", { text: "It may have just been filled, or was already cancelled. Check your positions." })); return; }
    pr.finish();
    into.append(el("div", { class: "ending ok" }, el("span", { class: "ending-i", "aria-hidden": "true", text: "✓" }), el("b", { text: `${done.size} cancelled${freed > 0 ? `. ${pfUsd(freed)} is free again.` : "."}${missed.length ? ` ${missed.length} could not be (probably filled).` : ""}` })));
    setTimeout(() => { orders = (orders || []).filter((o) => !done.has(o.id)); drawBody(); load(true); }, 1800);   // the cancelled order leaves the list after a moment
  }

  function orderRow(o) {
    const n = T.orderNumbers(o), ti = titles[String(o.conditionId || "").toLowerCase()], cancelPanel = el("div", { class: "cancel-panel" });
    const when = o.createdAt ? new Date(o.createdAt) : null;
    return el("div", { class: "card pf-row" },
      el("div", { class: "pf-top" },
        el("div", { class: "pf-title" }, ti && ti.eventSlug ? el("a", { href: `#/event/${encodeURIComponent(ti.eventSlug)}`, text: ti.question || ti.group || "Open market" }) : el("span", { class: "muted", text: ti ? ti.question : "An order on a market" }),
          el("div", { class: "pf-sub" }, el("span", { class: "pf-side", text: `${o.side === "SELL" ? "Sell" : "Buy"} ${o.outcome || ""}`.trim() }), el("span", { class: "muted", text: `${n.size.toFixed(2)} shares at ${pfCents(n.price)}${n.matched > 0 ? ` · ${n.matched.toFixed(2)} filled` : ""}` }))),
        el("div", { class: "pf-val" }, el("b", { class: "num", text: n.held > 0 ? pfUsd(n.held) : `${n.remaining.toFixed(2)} sh` }), el("small", { class: "muted", text: n.held > 0 ? "held for it" : "left to sell" }))),
      when && Number.isFinite(when.getTime()) ? el("p", { class: "muted small", style: "margin:0", text: `Placed ${when.toLocaleDateString([], { day: "numeric", month: "short" })} ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. It waits until someone takes it, or you cancel.` }) : null,
      el("div", { class: "pf-actions" }, el("button", { class: "btn small", type: "button", text: "Cancel order", onclick: (ev) => { ev.currentTarget.hidden = true; cancelThese([o], cancelPanel, false); } })),
      cancelPanel);
  }

  function ordersBody() {
    if (ordersLoading) return null;
    if (ordersError) return [errBox("Couldn’t load your open orders", ordersError.error, loadOrders), ordersError.detail ? el("small", { class: "err-detail", text: `(${ordersError.detail})` }) : null];
    if (!orders) return null;
    if (!orders.length) return [el("div", { class: "card empty" }, el("h2", { text: "No open orders" }), el("p", { class: "muted", text: "Orders placed with Clue fill completely or not at all, so they never wait. An order shows here only if one is waiting on a market, for example one placed on Polymarket itself." }), el("button", { class: "btn small", type: "button", text: "Check again", onclick: loadOrders }))];
    const top = orders.length > 1 ? [el("div", { class: "pf-claimall" }, el("button", { class: "btn", type: "button", text: `Cancel all ${orders.length} orders`, onclick: (ev) => { ev.currentTarget.hidden = true; cancelThese(orders, allPanel, true); } }), allPanel)] : [];
    return [...top, ...orders.map(orderRow)];
  }
  const allPanel = el("div", { class: "cancel-panel" });

  // ---- Withdraw: cash out as USDC on a chain the person uses ----
  // Only these USDC contracts can be chosen (the well-known ones); the smallest amount for each is read live from Polymarket.
  const WD_CHAINS = [
    { id: "8453", name: "Base", logo: "base", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    { id: "1", name: "Ethereum", logo: "eth", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    { id: "42161", name: "Arbitrum", logo: "arb", token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
    { id: "10", name: "Optimism", logo: "op", token: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
    { id: "137", name: "Polygon", logo: "pol", token: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
  ];
  let wdNode = null;
  function withdrawPanel() {
    if (wdNode) return wdNode;
    const out = el("div", { class: "card pad withdraw-panel" });
    let chain = WD_CHAINS[0], mins = {}, cashUnitsNow = null, timer = null;
    const msg = el("p", { class: "status", role: "status", "aria-live": "polite" });
    const say = (t, cls = "") => { msg.className = `status ${cls}`; msg.textContent = t; };
    const amount = el("input", { type: "text", inputmode: "decimal", placeholder: "5.00", autocomplete: "off", "aria-label": "How much to withdraw, in dollars" });
    const recipient = el("input", { type: "text", placeholder: "0x…", autocomplete: "off", spellcheck: "false", "aria-label": "The address to send it to" });
    const hint = el("small", { class: "muted" });
    const result = el("div", { class: "wd-result" });
    const chainBtns = el("div", { class: "seg wd-chains", role: "group", "aria-label": "Which chain to receive it on" }, WD_CHAINS.map((c) => el("button", { type: "button", "aria-pressed": String(c === chain), onclick: (ev) => { chain = c; chainBtns.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false")); ev.currentTarget.setAttribute("aria-pressed", "true"); result.replaceChildren(); drawHint(); } },
      el("img", { src: `/assets/coins/chain-${c.logo}.svg`, alt: "", width: "18", height: "18" }), ` ${c.name}`)));
    const minOf = () => mins[chain.id] || 2;
    function drawHint() { hint.textContent = `You receive USDC on ${chain.name}. Polymarket charges no fee. The smallest withdrawal is about $${minOf().toFixed(2)}.`; }
    const ownNow = () => (tradingSetup && tradingSetup.signer) || "";
    const useMine = el("button", { class: "btn small", type: "button", text: "Use my Clue wallet", onclick: () => { if (!ownNow()) { say("Set up trading first, so your Clue wallet is ready.", "err"); return; } recipient.value = ownNow(); result.replaceChildren(); } });
    const maxBtn = el("button", { class: "btn small", type: "button", text: "Max", onclick: async () => {
      say("Reading your cash…"); const u = await readCashUnits(wallet); say("");
      if (u === null) { say("Could not read your cash right now. Try again.", "err"); return; }
      cashUnitsNow = u; const n = BigInt(u); amount.value = `${n / 1000000n}.${String(n % 1000000n).padStart(6, "0")}`.replace(/0+$/, "").replace(/\.$/, "") || "0";
    } });
    // the supported minimums, read live
    fetch("https://bridge.polymarket.com/supported-assets").then((r) => r.json()).then((d) => { for (const c of WD_CHAINS) { const m = (d.supportedAssets || []).find((x) => String(x.chainId) === c.id && String(x.token && x.token.address).toLowerCase() === c.token.toLowerCase()); if (m && Number(m.minCheckoutUsd) > 0) mins[c.id] = Number(m.minCheckoutUsd); } drawHint(); }).catch(() => {});

    async function review() {
      result.replaceChildren(); say("Checking…");
      const u = await readCashUnits(wallet); say(""); cashUnitsNow = u;
      const chk = window.ClueTicket.withdrawCheck({ amount: amount.value, balanceUnits: u, minUsd: minOf(), recipient: recipient.value });
      if (!chk.ok) { say(chk.reason, "err"); return; }
      const mine = ownNow() && chk.recipient.toLowerCase() === ownNow().toLowerCase();
      const sure = el("input", { type: "checkbox", id: "wd-sure" });
      const go = el("button", { class: "btn primary", type: "button", disabled: !mine, text: `Withdraw ${pfUsd(chk.usd)}`, onclick: () => send(chk) });
      sure.addEventListener("change", () => { go.disabled = !sure.checked; });
      result.replaceChildren(el("div", { class: "review" },
        el("b", { text: "Review your withdrawal" }),
        el("div", { class: "tk-row" }, el("span", { class: "muted", text: "You send" }), el("b", { class: "num", text: pfUsd(chk.usd) })),
        el("div", { class: "tk-row" }, el("span", { class: "muted", text: "You receive" }), el("b", { class: "num", text: `about ${pfUsd(chk.usd)} in USDC on ${chain.name}` })),
        el("div", { class: "wd-to" }, el("span", { class: "muted", text: "To this address" }), el("code", { text: chk.recipient })),
        el("p", { class: "tk-warn warn", text: `This cannot be undone. It must be an address you control on ${chain.name}. If it is wrong, or it is on a different chain, the money is lost.` }),
        mine ? el("p", { class: "muted small", text: "This is your own Clue wallet." }) : el("label", { class: "wd-sure" }, sure, " I checked the address and the chain."),
        el("div", { class: "share-row" }, go, el("button", { class: "btn", type: "button", text: "Cancel", onclick: () => result.replaceChildren() }))));
    }

    async function send(chk) {
      const pr = progress([{ id: "load", label: "Getting ready" }, { id: "account", label: "Opening your trading account" }, { id: "prepare", label: "Preparing the withdrawal" }, { id: "sign", label: "Signing with your wallet" }, { id: "confirm", label: "Sending your cash" }, { id: "deliver", label: `Delivering USDC on ${chain.name}` }]);
      result.replaceChildren(pr.node); pr.advance("load");
      try { await loadTrading(); } catch (e) { pr.fail("load"); result.append(el("p", { class: "status err", text: e.message })); return; }
      const cfg = await ordersConfigFor();
      const r = await window.clueTrading.withdraw({ units: chk.units, chainId: chain.id, tokenAddress: chain.token, recipient: chk.recipient, builderCode: cfg.builderCode, onStep: (s) => pr.advance(s) });
      if (!r.ok) { pr.fail(); result.append(el("div", { class: "ending bad" }, el("span", { class: "ending-i", "aria-hidden": "true", text: "✕" }), el("b", { text: "Not withdrawn" })), el("p", { text: r.error }), r.detail ? el("small", { class: "err-detail", text: `(${r.detail})` }) : null); return; }
      pr.advance("deliver"); setTimeout(() => load(true), 4000);
      const finish = (kind, title, note) => { pr.finish(); result.append(el("div", { class: `ending ${kind}` }, el("span", { class: "ending-i", "aria-hidden": "true", text: kind === "ok" ? "✓" : "…" }), el("b", { text: title })), note ? el("p", { class: "muted small", text: note }) : null); };
      let tries = 0;
      clearInterval(timer);
      timer = setInterval(async () => {
        tries++;
        try {
          const st = window.ClueTicket.bridgeState(await (await fetch(`https://bridge.polymarket.com/status/${r.bridgeAddress}`)).json());
          if (st.state === "done") { clearInterval(timer); finish("ok", `Done. ${pfUsd(chk.usd)} in USDC is on ${chain.name}.`); setTimeout(() => load(true), 1500); }
          else if (st.state === "failed") { clearInterval(timer); pr.fail("deliver"); result.append(el("div", { class: "ending bad" }, el("span", { class: "ending-i", "aria-hidden": "true", text: "✕" }), el("b", { text: "The bridge could not deliver it" })), el("p", { text: "Your cash left your account. Polymarket's bridge holds it; contact Polymarket support with this address." }), el("code", { text: r.bridgeAddress }));
          }
        } catch { /* ask again */ }
        if (tries >= 40) { clearInterval(timer); finish("wait", "Still on its way", `It can take a few minutes. Your cash has left your account and will arrive on ${chain.name}. Bridge address, for support if needed: ${r.bridgeAddress}`); }
      }, 6000);
    }

    drawHint();
    out.append(el("div", { class: "fund-title" }, el("h2", { text: "Withdraw" }), el("button", { class: "btn small", type: "button", text: "Close", onclick: () => { out.hidden = true; } })),
      el("p", { class: "small", text: "Take cash out of your trading account as USDC, on a chain you use. Polymarket's bridge does the swap and charges no fee." }),
      el("div", { class: "field" }, el("span", { text: "Which chain?" }), chainBtns),
      el("label", { class: "field" }, el("span", { text: "How much? ($)" }), el("div", { class: "wd-amt" }, amount, maxBtn), hint),
      el("label", { class: "field" }, el("span", { text: "Send it to" }), recipient, useMine),
      el("button", { class: "btn primary", type: "button", text: "Review withdrawal", onclick: review }), msg, result);
    wdNode = out; return out;
  }

  function historyRow(a) {
    const when = new Date(Number(a.timestamp) * 1000);
    const what = a.type === "TRADE" ? `${a.side === "SELL" ? "Sold" : "Bought"} ${Number(a.size).toFixed(2)} ${a.outcome || ""} at ${pfCents(Number(a.price))}` : a.type === "REDEEM" ? "Claimed winnings" : String(a.type || "").toLowerCase();
    return el("div", { class: "card pf-hist" }, el("div", null, el("a", { href: `#/event/${encodeURIComponent(a.event_slug || a.slug || "")}`, text: a.title || "—" }), el("div", { class: "muted small", text: `${what} · ${when.toLocaleDateString([], { day: "numeric", month: "short" })} ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` })),
      a.usdc_size != null ? el("b", { class: "num", text: pfUsd(Number(a.usdc_size)) }) : null);
  }

  function drawBody() {
    if (failed && tab !== "orders") { body.replaceChildren(errBox("Couldn’t load your portfolio", failed, load)); return; }
    if (tab === "orders") { const nodes = ordersBody(); if (nodes) body.replaceChildren(...kids(nodes)); return; }
    if (tab === "positions") {
      if (!positions) { body.replaceChildren(el("p", { class: "loading", role: "status", text: "Loading your calls…" })); return; }
      if (!positions.length) { body.replaceChildren(el("div", { class: "card empty" }, el("h2", { text: "No calls yet" }), el("p", { class: "muted", text: "When you place an order, it shows up here with its profit or loss." }), el("a", { class: "btn primary", href: "#/", text: "Find a market" }))); return; }
      const order = (p) => ({ won: 0, open: 1, lost: 2 })[T.positionState(p)];
      body.replaceChildren(...[...positions].sort((x, y) => order(x) - order(y) || T.positionNumbers(y).value - T.positionNumbers(x).value).map(positionRow));
    } else {
      if (!history) { body.replaceChildren(el("p", { class: "loading", role: "status", text: "Loading your history…" })); return; }
      body.replaceChildren(...(history.length ? history.map(historyRow) : [el("div", { class: "card empty" }, el("p", { class: "muted", text: "Nothing yet." }))]));
    }
  }

  // Something is in progress on the page (a claim running or its result, or a share panel the person opened): leave the page alone.
  const busy = () => [...root.querySelectorAll(".claim-panel, .share-panel, .cancel-panel, .wd-result")].some((n) => n.childElementCount > 0) || ordersLoading;
  let lastSig = "";
  async function load(force) {
    failed = "";
    try {
      const [pos, act, c] = await Promise.all([dataGet(`/positions?user=${wallet}&limit=100`), dataGet(`/activity?user=${wallet}&limit=50`), readCash(wallet)]);
      if (stale() || !root.isConnected) return;
      const sig = JSON.stringify([pos.data, act.data, c]);
      if (!force && (sig === lastSig || busy())) return;                  // nothing new, or the person is in the middle of something
      lastSig = sig;
      positions = pos.data || []; history = (act.data || []).filter((x) => x.type === "TRADE" || x.type === "REDEEM"); cash = c;
    } catch (e) { if (stale()) return; if (!force && busy()) return; failed = e.message; }
    drawSummary(); drawBody();
  }
  const seg = el("div", { class: "seg", role: "group", "aria-label": "Portfolio sections" }, [["positions", "Positions"], ["orders", "Open orders"], ["history", "History"]].map(([id, text], i) =>
    el("button", { type: "button", text, "aria-pressed": String(i === 0), onclick: (ev) => { tab = id; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false")); ev.currentTarget.setAttribute("aria-pressed", "true"); if (id === "orders" && orders === null && !ordersLoading) loadOrders(); else drawBody(); } })));
  const withdrawBtn = el("button", { class: "btn", type: "button", text: "Withdraw", onclick: () => { const p = withdrawPanel(); p.hidden = !p.hidden; if (!p.hidden) p.scrollIntoView({ block: "nearest", behavior: "smooth" }); } });
  root.append(el("h1", { class: "pf-h1", text: "Portfolio" }), summary, el("div", { class: "pf-actions" }, withdrawBtn), withdrawPanel(), claimAll, seg, body);
  withdrawPanel().hidden = true;
  app.replaceChildren(root);
  drawSummary(); drawBody(); load();
  // Stays fresh while it is open, and when the person comes back to the tab. Never in the middle of something (see busy above).
  const timer = setInterval(() => { if (!root.isConnected || stale()) { clearInterval(timer); return; } if (!busy()) load(); }, 30000);
  const onVisible = () => { if (!root.isConnected || stale()) { document.removeEventListener("visibilitychange", onVisible); return; } if (!document.hidden && !busy()) load(); };
  document.addEventListener("visibilitychange", onVisible);
}

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
    el("span", { class: "hero-kicker", text: "Live markets · real evidence" }),
    el("h1", null, "A clearer view of ", el("em", { text: "what comes next." })),
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
    if (!stale()) grid.replaceWith(errBox("Couldn’t load markets", e.message, route));
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
  const rightCol = el("aside", { class: "rightcol" }, ticketBox, workspaceBox);
  const left = el("div", null, stage);

  const header = el("div", { class: "ev-head" }, thumb(ev),
    el("div", null,
      el("h1", { text: ev.title }),
      el("div", { class: "meta" },
        ended(ev.endDate) ? el("span", { class: "tag ended", text: "Ended · awaiting result" }) : el("span", { class: "tag live", text: "Open" }),
        el("span", { text: `${money(ev.volume)} volume` }),
        el("span", { text: `${money(ev.volume24hr)} in 24h` }),
        el("button", { class: "btn small jump-trade", type: "button", text: "Trade ↓", onclick: () => ticketBox.scrollIntoView({ behavior: "smooth", block: "start" }) }),
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
      el("button", { type: "button", "aria-pressed": String(i === outcomeIdx), text: `${o} ${pct(sel.outcomePrices[i])}`, onclick: () => { outcomeIdx = i; renderAll(); } }))) : null;

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
            el("p", { class: "muted small", text: `${outcomes[outcomeIdx]} · live market price` })),
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
      el("p", { class: "muted small", style: "margin-bottom:10px", text: "The market’s own rules, which decide how this question settles." }),
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

  function renderAll() { renderStage(); mountTicket(ticketBox, { market: sel, outcome: sel.outcomes[outcomeIdx] || "Yes", token: sel.tokenIds[outcomeIdx], eventTitle: ev.title, outcomes: sel.outcomes.length ? sel.outcomes : ["Yes", "No"], prices: sel.outcomePrices, outcomeIdx, pick: (i) => { outcomeIdx = i; renderAll(); } }); mountWorkspace(workspaceBox, { market: sel, event: ev, outcome: () => (sel.outcomes[outcomeIdx] || "Yes"), outcomeIdx: () => outcomeIdx }); }
  renderAll();
}


/* ---------- progress: what is happening now, what is done ---------- */
// A short list of steps. The one in progress shows a spinner, finished ones a tick, a failed one a cross.
// advance(id) marks everything before it done and starts it; finish() ticks all; fail(id) crosses one.
function progress(defs) {
  const items = defs.map((d) => ({ ...d, node: el("li", { class: "pstep pending" }, el("span", { class: "pstep-i", "aria-hidden": "true" }), el("span", { class: "pstep-t", text: d.label })) }));
  const node = el("ol", { class: "prog", role: "status", "aria-live": "polite" }, ...items.map((i) => i.node));
  const set = (i, state) => { i.node.className = `pstep ${state}`; };
  return {
    node,
    advance(id) { const at = items.findIndex((i) => i.id === id); if (at < 0) return; items.forEach((i, n) => { if (n < at) set(i, "done"); else if (n === at) set(i, "active"); }); },
    finish() { items.forEach((i) => set(i, "done")); },
    fail(id) { const i = items.find((x) => x.id === id) || items.find((x) => x.node.className.includes("active")) || items[0]; set(i, "failed"); },
  };
}

/* ---------- sharing a call: a 16:9 picture of it, drawn on the person's own phone ---------- */
let cardLoading = null;
function loadCard() {
  cardLoading ||= new Promise((resolve, reject) => {
    const s = el("script", { src: "/card.js" });
    s.onload = resolve; s.onerror = () => reject(new Error("Could not make the card. Check your connection and try again."));
    document.head.append(s);
  }).catch((e) => { cardLoading = null; throw e; });
  return cardLoading;
}
// data: { kind, question, side, entry, shares, paid, now?, payout? }. Only numbers the person already saw go on it.
// Opens a small panel: the picture, the post (editable), and a way to send it anywhere.
async function openShare(data, into) {
  const status = el("p", { class: "status", role: "status", "aria-live": "polite" });
  const say = (t, cls = "") => { status.className = `status ${cls}`; status.textContent = t; };
  into.replaceChildren(el("p", { class: "muted small", text: "Making your card…" }));
  let blob, post, imgUrl;
  const home = /^(localhost|127\.|\[::1\])/.test(location.hostname) ? location.origin : "https://www.oncluemarket.xyz";   // shared links always point at the real site
  const url = data.eventSlug ? `${home}/#/event/${encodeURIComponent(data.eventSlug)}` : `${home}${location.pathname}${location.hash}`;
  try {
    await loadCard();
    blob = await window.ClueCard.toBlob({ ...data, url });
    post = window.ClueCard.postText(data, url);
    imgUrl = URL.createObjectURL(blob);
  } catch (e) { into.replaceChildren(el("p", { class: "status err", text: e.message || "Could not make the card." })); return; }
  const file = new File([blob], "my-call-on-clue.png", { type: "image/png" });
  const box = el("textarea", { class: "post-text", rows: "9", "aria-label": "What your post will say" }); box.value = post.full;
  const text = () => box.value.trim();
  const saveCard = () => { const a = el("a", { href: imgUrl, download: "my-call-on-clue.png" }); document.body.append(a); a.click(); a.remove(); };
  const copy = async () => { try { await navigator.clipboard.writeText(text()); say("Post text copied.", "ok"); } catch { box.select(); say("Select the text and copy it.", ""); } };
  const canShareFile = navigator.canShare && navigator.canShare({ files: [file] });
  const buttons = [];
  if (canShareFile) buttons.push(el("button", { class: "btn primary small", type: "button", text: "Share…", onclick: async () => {
    try { await navigator.share({ files: [file], text: text() }); say(""); } catch (e) { if (!e || e.name !== "AbortError") say("Could not open the share sheet. Use Post on X or Save card.", "err"); }
  } }));
  buttons.push(el("button", { class: `btn ${canShareFile ? "" : "primary "}small`, type: "button", text: "Post on X", onclick: async () => {
    // X fills in the text and link; it cannot attach a picture, so on a computer the card is copied (or saved) to add by hand.
    const lines = text().split("\n"), link = lines[lines.length - 1].startsWith("http") ? lines.pop() : url;
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(lines.join("\n").trim())}&url=${encodeURIComponent(link)}`, "_blank", "noopener");
    if (canShareFile) return;
    // On a computer: put the card on the clipboard so it can be pasted into the post; if that is not allowed, save it instead.
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); say("Card copied. In your X post, paste it (Ctrl+V, or Cmd+V on a Mac).", "ok"); }
    catch { saveCard(); say("Card saved. Add it to your X post.", "ok"); }
  } }));
  buttons.push(el("button", { class: "btn small", type: "button", text: "Copy text", onclick: copy }));
  buttons.push(el("button", { class: "btn small", type: "button", text: "Save card", onclick: () => { saveCard(); say("Card saved.", "ok"); } }));
  into.replaceChildren(el("img", { class: "card-preview", src: imgUrl, alt: "Your share card" }), box, el("div", { class: "share-row" }, ...buttons),
    canShareFile ? null : el("p", { class: "muted small", text: "Post on X opens X with your words and copies the card. Paste the card into your post." }), status);
}

/* ---------- trade ticket: preview, and an order check that sends nothing unless real orders are switched on ---------- */
const ordersConfigFor = () => api("/api/pm/config").catch(() => ({ ordersLive: false, builderCode: null }));
let geoPromise = null, ordersConfigCache = null, lastSpend = "50";   // lastSpend: what was typed, kept when the side is switched
const geoOnce = () => (geoPromise ||= window.ClueTicket.checkGeoblock());
async function mountTicket(box, ctx) {
  const m = ctx.market, T = window.ClueTicket;
  let mode = "market", book = null, bookErr = "", lastPreview = null, lastGeo = null, depositOpen = false;
  const usd = (n) => `$${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
  const cents = (p) => (p == null ? "—" : `${(p * 100).toFixed(1)}¢`);
  // The side to buy: the market's own two words (Yes and No, Up and Down, a team's name ...), each with its price.
  const sideSeg = (ctx.outcomes || []).length > 1 ? el("div", { class: "seg side-seg", role: "group", "aria-label": "Which side to buy" }, ctx.outcomes.slice(0, 4).map((o, i) =>
    el("button", { type: "button", "aria-pressed": String(i === ctx.outcomeIdx), text: `${o} ${cents(Number(ctx.prices && ctx.prices[i]))}`, onclick: () => ctx.pick(i) }))) : null;
  const spend = el("input", { type: "number", min: "0", step: "1", value: lastSpend, inputmode: "decimal", "aria-label": "Amount to spend in dollars" });
  const limitPrice = el("input", { type: "number", min: "0", max: "100", step: "0.1", inputmode: "decimal", "aria-label": "Limit price in cents" });
  const shares = el("input", { type: "number", min: "0", step: "1", value: "10", inputmode: "decimal", "aria-label": "Number of shares" });
  const geoBox = el("div", { class: "geo", role: "status" }, el("span", { class: "muted small", text: "Checking your location…" }));
  const preview = el("div", { class: "tk-preview", "aria-live": "polite" });
  const fields = el("div");

  function drawFields() {
    const f = (label, input, hint) => el("label", { class: "field" }, el("span", { text: label }), hint && el("small", { text: hint }), input);
    fields.replaceChildren(f("Amount to spend ($)", spend, "Buys from the cheapest sellers first."));
  }

  function drawPreview() {
    if (bookErr) { preview.replaceChildren(el("p", { class: "status err", text: bookErr })); return; }
    if (!book) { preview.replaceChildren(el("p", { class: "muted small", text: "Loading live orders…" })); return; }
    if (book.available === false) { preview.replaceChildren(el("p", { class: "tk-warn block", text: "Nobody is buying or selling this outcome right now, so it can’t be traded. Pick another question above." })); return; }
    const r = T.previewBuy({
      mode, asks: book.asks, bestBid: book.bids[0]?.price ?? null,
      spend: Number(spend.value), shares: Number(shares.value), limitPrice: Number(limitPrice.value) / 100,
      feesEnabled: m.feesEnabled, feeRate: m.feeRate, ...rulesOf(book), accepting: m.acceptingOrders, builderFeeBps: 0,
    });
    lastPreview = r; syncOrder();
    const row = (k, v) => el("div", { class: "tk-row" }, el("span", { class: "muted", text: k }), el("b", { class: "num", text: v }));
    const total = r.sharesFilled + r.restingShares;
    preview.replaceChildren(...[
      ...(total > 0 ? [
        r.sharesFilled > 0 ? row("You'd get", `${r.sharesFilled.toFixed(2)} shares · ${cents(r.avgPrice)} each`) : null,
        r.restingShares > 0 ? row("Waiting for a seller", `${r.restingShares.toFixed(2)} shares at ${cents(r.restingPrice)}`) : null,
        row("You pay", usd(r.cost)),
        row("Fee", m.feesEnabled ? `${usd(r.platformFee)} · none from Clue` : "none"),
        el("div", { class: "tk-outcomes" },
          el("div", { class: "tk-win" }, el("small", { text: `If "${ctx.outcome}" happens` }), el("b", { class: "num", text: `+${usd(r.profitIfWin ?? 0)}` }), el("small", { text: `you receive ${usd(total)}` })),
          el("div", { class: "tk-lose" }, el("small", { text: "If it doesn't" }), el("b", { class: "num", text: `−${usd(r.cost + r.platformFee)}` }), el("small", { text: "you lose what you paid" }))),
      ] : []),
      ...r.warnings.map((w) => el("p", { class: `tk-warn ${w.level}`, text: w.text })),
      el("p", { class: "muted small", style: "margin-top:8px", text: `Live prices${book.bookTime ? ` at ${new Date(book.bookTime).toLocaleTimeString()}` : ""}. The final price and fee are confirmed when you order.` }),
    ].filter(Boolean));
  }

  // The Add money panel holds what the person is typing, a price, a deposit address and a running status. It is built once and put back
  // as it was whenever the account line is redrawn (a balance refresh redraws it every 30 seconds), never rebuilt.
  let depositNode = null, depositWallet = null;
  function depositNodeFor(geo, wallet) {
    if (!depositNode || depositWallet !== wallet) { depositNode = depositPanel(geo); depositWallet = wallet; }
    return depositNode;
  }

  // Reads the balance and redraws the account line. Safe to call often: one read at a time.
  // There is no timer. The balance is read when the card opens, after an order fills, after a deposit finishes, when the person taps the balance,
  // and when they come back to the tab. It never reads in the background while someone is adding money.
  let cashAsking = false;
  const onVisible = () => {
    if (!box.isConnected) { document.removeEventListener("visibilitychange", onVisible); return; }
    if (!document.hidden && tradingSetup && !depositOpen) refreshCash();
  };
  document.addEventListener("visibilitychange", onVisible);
  async function refreshCash(asked) {
    if (!tradingSetup || cashAsking) return;
    cashAsking = true;
    try {
      const wallet = tradingSetup.wallet, cash = await readCash(wallet);
      if (tradingSetup && tradingSetup.wallet === wallet) {
        const before = `${tradingSetup.balance}|${tradingSetup.cashFailed}`;
        tradingSetup = cash === null ? { ...tradingSetup, cashFailed: tradingSetup.balance == null } : { ...tradingSetup, balance: cash, cashFailed: false };
        if (lastGeo && before !== `${tradingSetup.balance}|${tradingSetup.cashFailed}`) drawChecklist(lastGeo);   // only when something changed
      }
    } finally { cashAsking = false; }
  }

  // ---- ordering: every check is repeated on a fresh book at the moment of ordering ----
  // Every market has its own minimum size and price step. The live book reports the real ones; the listing is only a fallback.
  const rulesOf = (b) => ({ minSize: Number(b && b.minOrderSize) || m.minOrderSize, tickSize: Number(b && b.tickSize) || m.tickSize });
  const orderOut = el("div", { class: "order-out", role: "status", "aria-live": "polite" });
  const orderNote = el("p", { class: "order-note muted small" });
  const placeBtn = el("button", { class: "btn dark tk-submit", type: "button", disabled: true, text: "Review my order", onclick: () => submitOrder() });
  // asked again when a different person signs in, because real orders can be switched on for one account only
  const ordersConfig = () => {
    const id = user ? user.id : "";
    if (!ordersConfigCache || ordersConfigCache.id !== id) ordersConfigCache = { id, promise: api("/api/pm/config").catch(() => ({ ordersLive: false, builderCode: null })) };
    return ordersConfigCache.promise;
  };
  const planFor = (preview) => T.orderPlan({
    preview: mode === "market" ? preview : null, signedIn: Boolean(user), geo: lastGeo, setUp: Boolean(tradingSetup), balance: tradingSetup ? (tradingSetup.balance == null ? Number.MAX_SAFE_INTEGER : tradingSetup.balance) : null,
    accepting: m.acceptingOrders, ...rulesOf(book),
  });
  const previewOn = (b) => T.previewBuy({ mode: "market", asks: b.asks, bestBid: b.bids[0]?.price ?? null, spend: Number(spend.value), feesEnabled: m.feesEnabled, feeRate: m.feeRate, ...rulesOf(b), accepting: m.acceptingOrders, builderFeeBps: 0 });
  async function syncOrder() {
    const cfg = await ordersConfig();
    placeBtn.textContent = cfg.ordersLive ? "Place order" : "Review my order";
    const p = planFor(lastPreview);
    placeBtn.disabled = !p.ok; placeBtn.title = p.ok ? "" : p.reason;
    orderNote.textContent = p.ok ? "" : p.reason;   // on a phone there is no hover, so the reason is written out
  }
  // The last look before real money moves, on the page itself (not the browser's pop-up): what is bought, what it costs, the worst price.
  function reviewOrder(plan) {
    return new Promise((resolve) => {
      const row = (k, v) => el("div", { class: "tk-row" }, el("span", { class: "muted", text: k }), el("b", { class: "num", text: v }));
      const done = (yes) => { box.removeEventListener("keydown", esc); resolve(yes); };
      const esc = (ev) => { if (ev.key === "Escape") done(false); };
      const go = el("button", { class: "btn primary", type: "button", text: `Confirm · ${usd(plan.expectedCost)}`, onclick: () => done(true) });
      orderOut.className = "order-out review";
      orderOut.replaceChildren(
        el("b", { text: "Review your order" }),
        row("Buy", `${ctx.outcome} · ${m.groupItemTitle || m.question}`.slice(0, 60)),
        row("Shares", plan.shares.toFixed(2)),
        row("You pay, at most", usd(plan.expectedCost)),
        row("Worst price", `${cents(plan.maxPrice)} a share`),
        el("p", { class: "muted small", text: "All or nothing. If it cannot fill completely at that price, nothing is bought and no money is spent." }),
        el("div", { class: "share-row" }, go, el("button", { class: "btn", type: "button", text: "Cancel", onclick: () => done(false) })));
      box.addEventListener("keydown", esc); go.focus();
    });
  }

  async function submitOrder() {
    placeBtn.disabled = true;
    const show = (cls, ...nodes) => { orderOut.className = `order-out ${cls}`; orderOut.replaceChildren(...nodes); };
    const line = (k, v) => el("div", { class: "tk-row" }, el("span", { class: "muted", text: k }), el("b", { class: "num", text: v }));
    const ending = (kind, title, ...more) => el("div", { class: `ending ${kind}` }, el("span", { class: "ending-i", "aria-hidden": "true", text: kind === "ok" ? "✓" : kind === "bad" ? "✕" : "…" }), el("b", { text: title }), ...more);
    try {
      const cfg = await ordersConfig();
      const live = cfg.ordersLive;
      const steps = progress([{ id: "prices", label: "Checking the live prices" }, ...(live ? [{ id: "confirm", label: "Your confirmation" }] : []), { id: "account", label: "Opening your trading account" }, { id: "sign", label: "Signing with your wallet" },
        ...(live ? [{ id: "send", label: "Sending your order" }, { id: "match", label: "Matching with sellers" }] : [])]);
      show("working", steps.node); steps.advance("prices");
      if (tradingSetup && tradingSetup.balance == null) {
        await loadTrading();
        const b = await window.clueTrading.balance();
        if (!b.ok) { show("err", el("p", { text: b.error })); return; }
        tradingSetup = { ...tradingSetup, balance: b.balance }; drawChecklist(lastGeo);
      }
      const fresh = await api(`/api/book?token=${encodeURIComponent(ctx.token)}&depth=60`);
      book = fresh; const plan = planFor(previewOn(fresh));
      if (!plan.ok) { show("err", el("p", { text: plan.reason })); return; }
      if (live) {
        steps.advance("confirm");
        if (!(await reviewOrder(plan))) { show("", el("p", { text: "Cancelled. Nothing was sent." })); return; }
        show("working", steps.node); steps.advance("account");
      } else steps.advance("account");
      await loadTrading();
      const res = await window.clueTrading.order({ assetId: ctx.token, spend: plan.spend, maxPrice: plan.maxPrice, builderCode: cfg.builderCode, send: live, onStep: (s) => steps.advance(s) });
      if (!res.ok) { steps.fail(); show("err", steps.node, ending("bad", res.sent ? "Not filled" : "Not placed"), el("p", { text: res.error }), res.detail ? el("small", { class: "err-detail", text: `(${res.detail})` }) : null); }
      else if (!res.sent) { steps.finish(); show("test", steps.node, ending("ok", "Checked. Your order is ready, and it was NOT sent."), line("Would spend", usd(plan.spend)), line("Worst price accepted", cents(plan.maxPrice)), line("Fills", "completely or not at all"),
        el("p", { class: "muted small", text: "Real orders are not switched on for this account, so no money moved." })); }
      else if (res.filled) {
        steps.finish();
        const sharePanel = el("div", { class: "share-panel" });
        setTimeout(refreshCash, 4000); setTimeout(refreshCash, 15000);                  // the spent money leaves the balance a moment after the fill
        show("ok", steps.node, ending("ok", "Done. Your order was filled."), line("Shares bought", res.shares.toFixed(2)), line("You paid", usd(res.paid)), line("Average price", cents(res.avgPrice)),
          el("button", { class: "btn primary small", type: "button", style: "margin-top:10px", text: "Share this call", onclick: (ev) => { ev.currentTarget.hidden = true; openShare({ kind: "placed", question: m.question, side: ctx.outcome, entry: res.avgPrice, shares: res.shares, paid: res.paid }, sharePanel); } }), sharePanel);
      } else { setTimeout(refreshCash, 5000); show("warn", steps.node, ending("wait", "Accepted, still matching"), el("p", { text: res.note })); }
    } catch (e) { show("err", el("p", { text: e.message || "Could not check the order. Nothing was sent." })); }
    finally { syncOrder(); }
  }

  // Putting money into the trading account: Polymarket gives the account its own address for each chain.
  function directPanel(geo) {
    const out = el("div", { class: "deposit" });
    const status = el("p", { class: "status", role: "status", "aria-live": "polite" });
    const copy = (text) => el("button", { class: "btn small", type: "button", text: "Copy", onclick: async (ev) => { try { await navigator.clipboard.writeText(text); ev.currentTarget.textContent = "Copied"; } catch { ev.currentTarget.textContent = "Select and copy"; } } });
    const refresh = el("button", { class: "btn small", type: "button", text: "Refresh my balance", onclick: async () => {
      refresh.disabled = true; status.className = "status"; status.textContent = "Checking your balance…";
      try { await loadTrading(); } catch (e) { status.className = "status err"; status.textContent = e.message; refresh.disabled = false; return; }
      const r = await window.clueTrading.balance(); refresh.disabled = false;
      if (r.ok) { tradingSetup = { ...tradingSetup, balance: r.balance }; drawChecklist(geo); } else { status.className = "status err"; status.textContent = r.error; }
    } });
    const show = el("button", { class: "btn small", type: "button", text: "Show my deposit address", onclick: async () => {
      show.disabled = true; status.className = "status"; status.textContent = "Getting your deposit address…";
      try { await confirmAccount((t) => { status.textContent = t; }); } catch (e) { status.className = "status err"; status.textContent = e.message; show.disabled = false; return; }
      const cfg = await ordersConfig();
      const [a, mins] = await Promise.all([window.clueTrading.depositAddresses(tradingSetup.wallet, cfg.builderCode), window.clueTrading.depositMinimums()]);
      if (!a.ok) { status.className = "status err"; status.textContent = a.error; show.disabled = false; return; }
      const choices = [
        { id: "svm", label: "Solana", token: "USDC", addr: a.svm, min: mins.solana },
        { id: "evm", label: "Polygon", token: "USDC", addr: a.evm, min: mins.polygon },
      ].filter((c) => T.validDepositAddress(c.id, c.addr));
      if (!choices.length) { status.className = "status err"; status.textContent = "Polymarket returned an address Clue could not check, so it is not shown. Try again in a minute."; show.disabled = false; return; }
      const detail = el("div");
      const pick = (c) => detail.replaceChildren(
        el("p", { class: "small" }, "Send ", el("b", { text: `${c.token} on ${c.label}` }), c.min ? ` (at least $${c.min})` : "", " to:"),
        el("div", { class: "acct-addr" }, el("code", { text: c.addr }), copy(c.addr)),
        el("p", { class: "tk-warn warn", text: `Send only ${c.token} on ${c.label}. Other coins, or the same coin on another chain, can be lost for good. Anything under the minimum is not processed.` }),
        el("p", { class: "muted small", text: "This address belongs to your trading account only. It can take a few minutes to arrive. Tap Refresh my balance to check." }));
      const seg2 = el("div", { class: "seg", role: "group", "aria-label": "Where is your money" }, choices.map((c, i) => el("button", { type: "button", text: c.label, "aria-pressed": String(i === 0), onclick: (ev) => { seg2.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false")); ev.currentTarget.setAttribute("aria-pressed", "true"); pick(c); } })));
      status.textContent = ""; out.replaceChildren(seg2, detail, refresh, status); pick(choices[0]);
    } });
    out.append(show, refresh, status);
    return out;
  }

  // Before a deposit address is shown, read the real trading account from the wallet and fix the saved one if it differs.
  // This is the one place a wrong address would cost money, so it is checked, not trusted.
  async function confirmAccount(say) {
    if (tradingSetup && tradingSetup.confirmedFor === user.id) return;                  // already checked on this page, so a second tap is quick
    say("Checking your trading account. This can take a few seconds…");
    await loadTrading();
    const r = await window.clueTrading.balance();
    if (!r.ok) throw new Error(r.detail ? `${r.error} (${r.detail})` : r.error);
    if (isAddr(r.wallet) && r.wallet.toLowerCase() !== String(tradingSetup.wallet || "").toLowerCase()) tradingSetup = { ...tradingSetup, wallet: r.wallet, signer: r.signer };
    tradingSetup = { ...tradingSetup, balance: r.balance, confirmedFor: user.id }; rememberSetup(user.id, tradingSetup);
  }

  // ---- Adding money from NEAR or any other chain, carried by NEAR Intents ----
  // The person picks a coin they hold; Clue asks NEAR Intents for the price, then for a one-time deposit address. Whatever is sent there
  // arrives as USDC at the person's own Polymarket deposit address. Clue never holds the money.
  const WORDS = { waiting: "Waiting for your deposit…", seen: "Deposit seen. Swapping it now…", swapping: "Swapping it now…", short: "You sent less than the amount. Send the rest, or it will be returned.", refunded: "The swap could not finish, so your money was returned to your refund address.", failed: "The swap failed. If you sent money, it will be returned to your refund address." };
  function intentsPanel(geo) {
    const out = el("div", { class: "intents" });
    let assets = null, quoteInfo = null, timer = null, edited = false;
    const status = el("p", { class: "status", role: "status", "aria-live": "polite" });
    const say = (t, cls = "") => { status.className = `status ${cls}`; status.textContent = t; };
    const copy = (text) => el("button", { class: "btn small", type: "button", text: "Copy", onclick: async (ev) => { try { await navigator.clipboard.writeText(text); ev.currentTarget.textContent = "Copied"; } catch { ev.currentTarget.textContent = "Select and copy"; } } });
    let picked = null;                                                       // the coin chosen, by its id
    const amount = el("input", { type: "text", inputmode: "decimal", placeholder: "2", "aria-label": "How much you will send", autocomplete: "off" });
    const refund = el("input", { type: "text", placeholder: "", "aria-label": "Where to return your money if the swap cannot finish", autocomplete: "off", spellcheck: "false" });
    const hint = el("small", { class: "muted" });
    const refundHint = el("small", { class: "muted" });
    const result = el("div", { class: "intents-result" });
    const chosen = () => (assets || []).find((x) => x.assetId === picked);
    // A coin with its logo, and the logo of the chain it is on in the corner. The logos ship with Clue (public/assets/coins).
    const LOGO = { wNEAR: "near", USDC: "usdc", USDT: "usdt", ETH: "eth", SOL: "sol" };
    const coinOf = (x) => el("span", { class: "coin" }, el("img", { class: "coin-main", src: `/assets/coins/${LOGO[x.symbol] || "near"}.svg`, alt: "", width: "34", height: "34" }), el("img", { class: "coin-chain", src: `/assets/coins/chain-${x.chain}.svg`, alt: "", width: "16", height: "16" }));
    const coinText = (x) => el("span", { class: "coin-text" }, el("b", { text: x.symbol }), el("small", { class: "muted", text: x.symbol === "wNEAR" ? "wrapped NEAR, on NEAR" : `on ${x.chainName}` }));
    const coinList = el("div", { class: "coin-list", role: "listbox", "aria-label": "Coins you can send", hidden: true });
    const coinBtn = el("button", { class: "coin-btn", type: "button", "aria-haspopup": "listbox", "aria-expanded": "false", onclick: () => { coinList.hidden = !coinList.hidden; coinBtn.setAttribute("aria-expanded", String(!coinList.hidden)); } });
    const picker = el("div", { class: "coin-picker" }, coinBtn, coinList);
    function drawPicker() {
      const x = chosen(); if (!x) return;
      coinBtn.replaceChildren(coinOf(x), coinText(x), el("span", { class: "coin-chev", "aria-hidden": "true", text: "▾" }));
      coinList.replaceChildren(...assets.map((o) => el("button", { type: "button", class: "coin-opt", role: "option", "aria-selected": String(o.assetId === picked), onclick: () => choose(o.assetId) }, coinOf(o), coinText(o))));
    }
    function choose(id) { picked = id; coinList.hidden = true; coinBtn.setAttribute("aria-expanded", "false"); edited = false; quoteInfo = null; result.replaceChildren(); setRefundDefault(); drawHint(); drawPicker(); }
    const usdOf = () => { const x = chosen(), n = Number(amount.value); return x && Number.isFinite(n) ? n * x.price : 0; };
    function setRefundDefault() {
      const x = chosen(); if (!x || edited) return;
      refund.value = x.refundKind === "near" ? (user && String(user.id).startsWith("near:") ? user.name : "") : x.refundKind === "evm" ? ((tradingSetup && tradingSetup.signer) || "") : "";
      refund.placeholder = x.refundKind === "near" ? "yourname.near" : x.refundKind === "sol" ? "Your Solana address" : "0x…";
      refundHint.textContent = x.refundKind === "near" ? "Your NEAR account. It has to exist." : x.refundKind === "evm" ? "Your wallet. It is filled in for you." : "A Solana address you control.";
    }
    let lim = { minUsd: 2.5, maxUsd: 50000 };
    function drawHint() { const u = usdOf(), floor = `The smallest amount is about $${lim.minUsd.toFixed(2)}.`; hint.textContent = u > 0 ? `About $${u.toFixed(2)}. ${floor}` : floor; }
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    async function ask(dry) {
      const x = chosen();
      return post("/api/fund/intents/quote", { assetId: x.assetId, amount: amount.value.trim(), refundTo: refund.value.trim(), wallet: tradingSetup.wallet, dry });
    }
    const price = el("button", { class: "btn primary small", type: "button", text: "See what I’d get", onclick: async () => {
      price.disabled = true; stop(); result.replaceChildren(); say("Getting the price…");
      try { quoteInfo = await ask(true); } catch (e) { say(e.message, "err"); price.disabled = false; return; }
      price.disabled = false; say("");
      const q = quoteInfo;
      result.replaceChildren(el("div", { class: "receipt" },
        el("dl", { class: "fund-dl" },
          el("dt", { text: "You send" }), el("dd", { class: "num", text: `${q.send.amount} ${q.send.symbol} on ${q.send.chain} (about $${q.send.usd.toFixed(2)})` }),
          el("dt", { text: "You get about" }), el("dd", { class: "num", text: `${q.receive.amount} USDC in your trading account` }),
          q.receive.minimum ? el("dt", { text: "At worst" }) : null, q.receive.minimum ? el("dd", { class: "num", text: `${q.receive.minimum} USDC` }) : null,
          q.seconds != null ? el("dt", { text: "Takes" }) : null, q.seconds != null ? el("dd", { class: "num", text: `about ${q.seconds} seconds, plus a minute or two for your trading account` }) : null)),
        el("button", { class: "btn dark small", type: "button", text: "Get my deposit address", onclick: (ev) => deposit(ev.currentTarget) }));
    } });

    async function deposit(btn) {
      btn.disabled = true;
      let q;
      try { await confirmAccount(say); say("Getting your deposit address…"); q = await ask(false); } catch (e) { say(e.message, "err"); btn.disabled = false; return; }
      loadMine();
      say("");
      const until = new Date(q.deadline);
      result.replaceChildren(...kids(
        el("p", { class: "small" }, "Send exactly ", el("b", { text: `${q.send.amount} ${q.send.symbol}` }), " on ", el("b", { text: q.send.chain }), " to:"),
        el("div", { class: "acct-addr" }, el("code", { text: q.depositAddress }), copy(q.depositAddress)),
        q.depositMemo ? el("p", { class: "small" }, "Memo: ", el("code", { text: q.depositMemo })) : null,
        el("p", { class: "tk-warn warn", text: `Send only ${q.send.symbol} on ${q.send.chain}, from a wallet you control, before ${Number.isFinite(until.getTime()) ? until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "the deadline"}. This address is for this one swap. If it cannot finish, your money is returned to ${q.refundTo}.` }),
        el("p", { class: "muted small", text: "Swapped by NEAR Intents. Clue never holds your money." })));
      const live = el("p", { class: "status working", role: "status", "aria-live": "polite", text: WORDS.waiting });
      const after = el("div");
      result.append(live, after);
      const poll = async () => {
        if (!out.isConnected) { stop(); return; }
        let s; try { s = await api(`/api/fund/intents/status?deposit=${encodeURIComponent(q.depositAddress)}`); } catch { return; }
        if (s.state === "done") {
          stop(); setTimeout(refreshCash, 5000); setTimeout(refreshCash, 30000);
          live.className = "status ok"; live.textContent = `Done. ${s.delivered && s.delivered.amount ? `${s.delivered.amount} USDC` : "Your money"} is on its way to your trading account.`;
          after.replaceChildren(el("p", { class: "muted small", text: "Polymarket turns it into trading money in a minute or two. Then your balance shows it." }), refreshBtn());
        } else if (s.state === "refunded" || s.state === "failed") { stop(); live.className = "status err"; live.textContent = WORDS[s.state]; }
        else { live.className = "status working"; live.textContent = WORDS[s.state] || WORDS.swapping; }
      };
      timer = setInterval(poll, 6000); poll();
    }
    function refreshBtn() {
      const b = el("button", { class: "btn small", type: "button", text: "Refresh my balance", onclick: async () => {
        b.disabled = true;
        try { await loadTrading(); const r = await window.clueTrading.balance(); if (r.ok) { tradingSetup = { ...tradingSetup, balance: r.balance }; drawChecklist(geo); return; } say(r.error, "err"); } catch (e) { say(e.message, "err"); }
        b.disabled = false;
      } });
      return b;
    }

    // ---- Every deposit, and where it is. It is read from the server, so it is still here after a refresh. ----
    const mine = el("div", { class: "my-deposits" });
    const ago = (iso) => { const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000)); return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`; };
    const minsSince = (iso) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    const lineFor = (d) => {
      if (d.state === "done") return { cls: "ok", text: `Done. ${d.delivered ? `${d.delivered} USDC` : "Your money"} is on its way to your trading account. Your balance shows it in a minute or two.` };
      if (d.state === "refunded") return { cls: "err", text: "The swap could not finish, so your money was returned to your refund address." };
      if (d.state === "failed") return { cls: "err", text: "The swap failed. If you sent money, it is returned to your refund address." };
      if (d.state === "short") return { cls: "err", text: "You sent less than the amount. Send the rest, or it will be returned." };
      if (d.expired) return { cls: "", text: "No deposit arrived before the deadline, so nothing was swapped. You can ignore this one." };
      if (d.state === "waiting") return { cls: "working", text: "Waiting for your deposit to arrive…" };
      const m = minsSince(d.createdAt);
      return { cls: "working", text: m >= 5 ? `Still swapping, ${m} minutes so far. This is taking longer than usual, but your money is safe: it will arrive or be returned to your refund address.` : "Swapping it now. This usually takes a minute or two." };
    };
    // What is still on its way goes at the top, where a person waiting will look. Finished ones go below.
    const minePending = el("div", { class: "my-deposits pending" });
    const rowFor = (d) => {
      const l = lineFor(d), pending = !(d.final || d.expired);
      const by = pending && d.deadline && Date.parse(d.deadline) > Date.now() ? new Date(d.deadline).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
      return el("div", { class: "md-row" },
        el("div", { class: "md-top" }, el("b", { text: `${d.send.amount} ${d.send.symbol} on ${d.send.chain}` }), el("small", { class: "muted", text: `${d.send.usd ? `about $${Number(d.send.usd).toFixed(2)} · ` : ""}${ago(d.createdAt)}` })),
        el("p", { class: `status ${l.cls}`, text: l.text }),
        ...kids(
          by ? el("p", { class: "small muted", text: `If it is not finished by ${by}, it is returned${d.refundTo ? ` to ${d.refundTo}` : " to your refund address"}.` }) : null,
          pending ? el("div", { class: "acct-addr" }, el("code", { text: d.depositAddress }), copy(d.depositAddress)) : null,
          pending ? el("a", { class: "small", href: `https://explorer.near-intents.org/transactions/${encodeURIComponent(d.depositAddress)}?referral=clue`, target: "_blank", rel: "noopener noreferrer", text: "See it on NEAR Intents ↗" }) : null));
    };
    function drawMine(list) {
      const onItsWay = list.filter((x) => !x.final && !x.expired), rest = list.filter((x) => x.final || x.expired).slice(0, 3);
      minePending.replaceChildren(...(onItsWay.length ? [el("h4", { class: "md-title", text: onItsWay.length === 1 ? "Your deposit is on its way" : "Your deposits are on their way" }), ...onItsWay.map(rowFor)] : []));
      mine.replaceChildren(...(rest.length ? [el("h4", { class: "md-title", text: "Recent deposits" }), ...rest.map(rowFor)] : []), oldBox);
    }
    // Sent one before this list existed, or from elsewhere? Paste its address and see where it is.
    const oldIn = el("input", { type: "text", placeholder: "Paste the deposit address you sent to", "aria-label": "Deposit address", autocomplete: "off", spellcheck: "false" });
    const oldOut = el("p", { class: "status", role: "status", "aria-live": "polite" });
    const oldBtn = el("button", { class: "btn small", type: "button", text: "Check", onclick: async () => {
      const a = oldIn.value.trim();
      if (a.length < 10) { oldOut.className = "status err"; oldOut.textContent = "Paste the whole address you sent to."; return; }
      oldBtn.disabled = true; oldOut.className = "status working"; oldOut.textContent = "Checking…";
      try {
        const s = await api(`/api/fund/intents/status?deposit=${encodeURIComponent(a)}`);
        if (s.state === "waiting") { oldOut.className = "status"; oldOut.textContent = "Nothing seen at this address yet. Check that you pasted the whole address, and that the money was sent to it."; }
        else { const l = lineFor({ state: s.state, delivered: s.delivered && s.delivered.amount, createdAt: (s.quote && s.quote.createdAt) || new Date().toISOString(), expired: false }); oldOut.className = `status ${l.cls}`; oldOut.textContent = l.text;
          // Keep it: it joins the list above, so it is still there after a refresh.
          try { const t = await post("/api/fund/deposits/track", { depositAddress: a }); if (t && t.tracked) { oldOut.textContent += " It is now in your deposits above."; oldIn.value = ""; loadMine(); } } catch { /* the status above is still shown */ }
        }
      } catch (e) { oldOut.className = "status err"; oldOut.textContent = e.message || "Could not check right now. Try again in a minute."; }
      oldBtn.disabled = false;
    } });
    const oldBox = el("details", { class: "md-old" }, el("summary", { text: "Sent one earlier? Check it by its address" }), el("div", { class: "md-old-row" }, oldIn, oldBtn), oldOut);
    const seen = new Map(); let mineTimer = null;
    async function loadMine() {
      clearTimeout(mineTimer);
      let d; try { d = await api("/api/fund/deposits"); } catch { return; }
      const list = d.deposits || []; drawMine(list);
      for (const x of list) { if (x.state === "done" && seen.has(x.id) && seen.get(x.id) !== "done") { setTimeout(refreshCash, 5000); setTimeout(refreshCash, 30000); } seen.set(x.id, x.state); }
      if (list.some((x) => !x.final && !x.expired)) mineTimer = setTimeout(loadMine, 10000);       // keep looking while one is on its way
    }

    amount.addEventListener("input", () => { quoteInfo = null; result.replaceChildren(); drawHint(); });
    refund.addEventListener("input", () => { edited = true; quoteInfo = null; result.replaceChildren(); });

    out.replaceChildren(el("p", { class: "muted small", text: "Loading what you can send…" }));
    api("/api/fund/intents/assets").then((d) => {
      assets = d.assets || []; if (d.limits) lim = d.limits;
      if (!assets.length) { out.replaceChildren(el("p", { class: "status err", text: "Adding money from other chains is not available right now. Try again in a minute." })); return; }
      picked = assets[0].assetId;
      const field = (title, input, ...extra) => el("label", { class: "field" }, el("span", { text: title }), input, ...extra);
      out.replaceChildren(
        minePending,
        el("p", { class: "small" }, "Send NEAR or a coin from another chain. ", el("b", { text: "NEAR Intents" }), " swaps it and delivers it to your trading account."),
        el("div", { class: "field" }, el("span", { text: "Where is your money?" }), picker), field("How much?", amount, hint), field("If it can’t finish, return it to", refund, refundHint), price, result, status, mine);
      setRefundDefault(); drawHint(); drawPicker(); loadMine();
    }).catch((e) => out.replaceChildren(el("p", { class: "status err", text: e.message || "Adding money from other chains is not available right now." })));
    return out;
  }

  // The panel under "Add money": NEAR Intents first, and the direct deposit addresses as the other choice.
  function depositPanel(geo) {
    const box = el("div", { class: "deposit-choice" });
    const body = el("div");
    const modes = [["near", "NEAR & other chains", () => intentsPanel(geo)], ["direct", "Solana or Polygon", () => directPanel(geo)]];
    const seg = el("div", { class: "seg", role: "group", "aria-label": "How to add money" }, modes.map(([id, text], i) => el("button", { type: "button", text, "aria-pressed": String(i === 0), onclick: (ev) => {
      seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false")); ev.currentTarget.setAttribute("aria-pressed", "true");
      body.replaceChildren(modes.find((m) => m[0] === id)[2]());
    } })));
    body.replaceChildren(modes[0][2]());
    box.append(seg, body);
    return box;
  }

  // After a refresh, a deposit that is still on its way opens Add money by itself, so the person sees where it is.
  let depositsAsked = false;
  function watchDeposits() {
    if (depositsAsked || !user) return; depositsAsked = true;
    api("/api/fund/deposits").then((d) => { if ((d.deposits || []).some((x) => !x.final && !x.expired) && !depositOpen) { depositOpen = true; if (lastGeo) drawChecklist(lastGeo); } }).catch(() => {});
  }
  function drawChecklist(geo) {
    const isPrivy = user && String(user.id || "").startsWith("privy:"), isNear = user && String(user.id || "").startsWith("near:");
    if (isPrivy && !tradingSetup) tradingSetup = savedSetup(user.id);
    if (isPrivy && !tradingSetup && accountLookup.id !== user.id) {
      accountLookup = { id: user.id, state: "pending" };
      api("/api/trading/account").then((d) => {
        accountLookup.state = d.account ? "found" : "none";
        if (d.account && isAddr(d.account.wallet) && user && !tradingSetup) { tradingSetup = { signer: isAddr(d.account.signer) ? d.account.signer : null, wallet: d.account.wallet, approved: true, balance: null }; try { localStorage.setItem(setupKey(user.id), JSON.stringify({ signer: tradingSetup.signer, wallet: tradingSetup.wallet })); } catch { /* fine */ } }
        drawChecklist(geo);
      }).catch(() => { accountLookup.state = "none"; drawChecklist(geo); });
    }
    lastGeo = geo; syncOrder();
    const t = tradingSetup;
    const status = el("p", { class: "status", role: "status", "aria-live": "polite" });
    const strip = (text, action, tone = "") => el("div", { class: `acct-strip ${tone}` }, typeof text === "string" ? el("span", { class: "as-text", text }) : text, action);
    let line;
    if (geo.state === "blocked") line = strip(`Trading isn't available in ${[geo.region, geo.country].filter(Boolean).join(", ") || "your location"}.`, null, "bad");
    else if (geo.state !== "ok") line = strip("Couldn't check your location, so trading is off.", null, "bad");
    else if (!user) line = strip("Sign in to trade.", el("button", { class: "btn small", type: "button", text: "Sign in", onclick: () => openAccountDialog("Sign in to trade.") }));
    else if (isNear) line = strip("Trading needs an email or Ethereum sign-in.", null);
    else if (isPrivy && !t && accountLookup.state === "pending") line = strip("Checking your trading account…", null);
    else if (isPrivy && !t) {
      const go = el("button", { class: "btn primary small", type: "button", text: "Set up trading", onclick: async () => {
        go.disabled = true; status.className = "status";
        const pr = progress([{ id: "load", label: "Getting ready" }, { id: "wallet", label: "Setting up your trading account" }, { id: "permissions", label: "Setting permission to trade" }, { id: "balance", label: "Checking your balance" }]);
        status.className = "status"; status.replaceChildren(pr.node, el("small", { class: "muted", text: "Approve it in your wallet if it asks." })); pr.advance("load");
        try { await loadTrading(); } catch (e) { pr.fail("load"); status.className = "status err"; status.append(el("p", { text: e.message })); go.disabled = false; return; }
        const r = await window.clueTrading.setup((step) => pr.advance(step));
        if (r.ok) { pr.finish(); tradingSetup = r; rememberSetup(user.id, r); setTimeout(() => drawChecklist(geo), 700); } else { pr.fail(); status.className = "status err"; status.append(el("p", { text: r.error }), r.detail ? el("small", { class: "err-detail", text: ` (${r.detail})` }) : null); go.disabled = false; }
      } });
      line = strip("Trading isn't set up yet.", go);
    } else if (t) {
      watchDeposits();
      if (t.balance == null && !t.cashFailed && !cashAsking) refreshCash();
      line = strip(t.balance != null ? el("button", { class: "as-text as-cash", type: "button", title: "Tap to refresh your balance", "aria-label": `Balance $${t.balance.toFixed(2)}. Tap to refresh.`, onclick: () => refreshCash(true) }, el("small", { class: "muted", text: "Balance ↻" }), el("b", { class: "num", text: `$${t.balance.toFixed(2)}` }))
        : t.cashFailed ? "Ready to trade" : "Checking your balance…", el("button", { class: "btn small", type: "button", text: depositOpen ? "Hide" : "Add money", onclick: () => { depositOpen = !depositOpen; drawChecklist(geo); } }), "ok");
    }
    geoBox.replaceChildren(...kids(line, t && depositOpen ? depositNodeFor(geo, t.wallet) : null, status));
  }

  function draw() { drawFields(); drawPreview(); }
  box.replaceChildren(
    el("div", { class: "panel-head tk-head" }, el("h2", { text: "Trade" })),
    el("div", { class: "pad" },
      geoBox,
      sideSeg ? el("p", { class: "muted small", style: "margin:12px 0 6px" }, "Pick a side") : null,
      sideSeg,
      el("p", { class: "small", style: "margin-top:10px" }, el("b", { text: `Buy "${ctx.outcome}"` }), el("span", { class: "muted", text: ` · ${m.groupItemTitle || m.question}` })),
      fields, preview,
      placeBtn, orderNote, orderOut));
  [spend, limitPrice, shares].forEach((i) => i.addEventListener("input", drawPreview));
  spend.addEventListener("input", () => { lastSpend = spend.value; });
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

  const refLine = market ? el("p", { class: "ref" }, `The market is at ${pct(market.lastTradePrice, 0)}.`) : null;

  const step1 = el("section", { class: "step active" },
    el("div", { class: "step-title" }, el("span", { class: "step-n", text: "1" }), "Research it"),
    el("p", { class: "muted small", text: market ? "Clue searches the web for evidence for and against." : "Clue searches the web for evidence for and against, and says when evidence is thin." }),
    el("label", { class: "field" }, el("span", { text: "Your question" }), q),
    el("div", { class: "actions" }, researchBtn), allowLine, rStatus, reportBox);

  const step2 = el("section", { class: "step" },
    el("div", { class: "step-title" }, el("span", { class: "step-n", text: "2" }), "What do you think?"),
    el("p", { class: "muted small", text: "Private to you." }),
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
    const readable = String(r.content || "").replace(/\(?\[[^\]]*\]\([^)]*\)\)?|https?:\/\/\S+/g, "x");   // a link counts as one character, since it shows as a short site name
    const long = readable.length > 2200;                                    // a short answer is shown whole, a long one is folded
    const text = el("div", { class: long ? "report-text clamp" : "report-text" });
    renderAnswer(text, r.content, r.sources || []);
    const more = long ? el("button", { class: "btn small ghost", type: "button", text: "Read full research", onclick: () => { const c = text.classList.toggle("clamp"); more.textContent = c ? "Read full research" : "Show less"; } }) : null;
    reportBox.replaceChildren(
      el("span", { class: "label" }, "Sources"),
      sourceChips(r.sources || []), text, ...(more ? [more] : []),
      el("p", { class: "muted small", style: "margin-top:8px", title: `Written by ${r.model}`, text: `Researched ${when(r.retrievedAt)}.` }));
    reportBox.hidden = false;
  }

  async function runResearch() {
    const question = q.value.trim();
    if (question.length < 5) { rStatus.className = "status err"; rStatus.textContent = "Write a question of at least 5 characters."; q.focus(); return; }
    if (!user) { openAccountDialog("Sign in to run research. It keeps your work private to you."); return; }
    researchBtn.disabled = true; rStatus.className = "status";
    // A clock, so a longer wait still shows that it is working and how long it has been.
    const began = Date.now();
    const tick = () => { const s = Math.round((Date.now() - began) / 1000); rStatus.textContent = `Searching sources… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}. This usually takes one to two minutes.`; };
    tick(); const clock = setInterval(tick, 1000);
    try {
      const start = await post("/api/research", { question, market: marketRef && marketRef.id ? { id: marketRef.id } : null });
      let d = null, hiccups = 0;
      for (let i = 0; i < 180 && !d; i++) {
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
    finally { clearInterval(clock); researchBtn.disabled = false; }
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
    const text = el("div", { class: "report-text" }); renderAnswer(text, d.snapshot.content, d.snapshot.sources || []);
    app.replaceChildren(el("div", { class: "ask-page" },
      el("p", { class: "muted small", text: `Shared research · ${when(d.publishedAt)}` }),
      el("h1", { text: d.snapshot.question }),
      el("div", { class: "card pad", style: "margin-top:20px" }, el("span", { class: "label", style: "color:var(--brand-text);font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase", text: "Sources" }), sourceChips(d.snapshot.sources || []), text),
      el("p", { class: "note", text: "Shared by its author. Their private forecasts stay private." })));
  } catch (e) { app.replaceChildren(errBox("Shared research unavailable", e.message)); }
}

/* ---------- boot ---------- */
(async () => {
  const share = new URLSearchParams(location.search).get("share");
  await refreshAccount();
  if (share) return sharedView(share);
  route();
})();
