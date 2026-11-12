// The share card: a flat 2D picture of one call, 1920 x 1080 (16:9), drawn straight onto a canvas.
// Built to public/card.js with `npm run build:card` and loaded only when someone taps Share.
// Everything on the card is a number the person already saw on screen. Nothing private goes on it.
import qrcode from 'qrcode-generator';

const W = 1920, H = 1080, M = 104;
const CREAM = '#f6efe4', INK = '#101a21', ORANGE = '#ff5a1f', ORANGE_DEEP = '#e24a12', SOFT = '#5d6a72', LINE = '#d9cfbf';
const SANS = '"Geist", system-ui, sans-serif', MONO = '"Geist Mono", ui-monospace, monospace';

const cents = (p) => `${(p * 100).toFixed(p < 0.1 ? 1 : p >= 0.995 ? 0 : 1).replace(/\.0$/, '')}¢`;
const usd = (n) => `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`;
const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(Math.round(n * 100))}%`;

// What the card says for each kind of call. `placed` shows what the call pays if it lands (a possible result, labelled as one).
export function describe(d) {
  const entry = Number(d.entry), shares = Number(d.shares) || 0, paid = Number.isFinite(Number(d.paid)) ? Number(d.paid) : shares * entry;
  const ifLands = entry > 0 ? 1 / entry - 1 : 0;                       // a share pays $1 if the call is right
  if (d.kind === 'won') {
    const payout = Number.isFinite(Number(d.payout)) ? Number(d.payout) : shares;
    return { tag: 'CALLED IT', big: pct(paid > 0 ? payout / paid - 1 : ifLands), sub: `${usd(payout - paid)} made on this call`, dark: false, stats: [['SHARES', shares.toFixed(2)], ['PAID', usd(paid)], ['PAID OUT', usd(payout)]] };
  }
  if (d.kind === 'lost') return { tag: 'MISSED THIS ONE', big: '−100%', sub: 'It went the other way. On to the next.', dark: true, stats: [['SHARES', shares.toFixed(2)], ['PAID', usd(paid)], ['PAID OUT', '$0.00']] };
  if (d.kind === 'open') {
    const now = Number(d.now), value = shares * now, pnl = value - paid;
    return { tag: 'LIVE CALL', big: pct(paid > 0 ? pnl / paid : 0), sub: `${usd(pnl)} right now`, dark: pnl < 0, stats: [['SHARES', shares.toFixed(2)], ['PAID', usd(paid)], ['WORTH NOW', usd(value)]] };
  }
  return { tag: "I'M IN", big: pct(ifLands), sub: `if ${d.side || 'Yes'} lands`, dark: false, stats: [['SHARES', shares.toFixed(2)], ['PAID', usd(paid)], ['PAYS IF IT LANDS', usd(shares)]] };
}

// The post that goes with each card. Plain paragraphs, no formatting marks, no hashtags, nothing that sounds like an advert.
// X counts a link as 23 characters and allows 280 in all, so the question is shortened until the whole post fits.
const X_LIMIT = 280, X_LINK = 23;
export function postText(d, url) {
  const entry = Number(d.entry), shares = Number(d.shares) || 0, paid = Number.isFinite(Number(d.paid)) ? Number(d.paid) : shares * entry;
  const side = String(d.side || 'Yes'), px = cents(entry);
  const build = (q) => {
    const Q = `"${q}"`;
    if (d.kind === 'won') {
      const payout = Number.isFinite(Number(d.payout)) ? Number(d.payout) : shares;
      return [`Called it. I said ${side} on ${Q} at ${px} and it landed.`, `${usd(paid)} in, ${usd(payout)} back. That is ${usd(payout - paid)} made.`, 'Make your own call:'];
    }
    if (d.kind === 'lost') return [`Missed this one. I took ${side} on ${Q} at ${px} and it went the other way.`, `${usd(paid)} gone. That is what putting real money behind a call means. On to the next one.`, 'Make your own call:'];
    if (d.kind === 'open') {
      const now = Number(d.now), pnl = shares * now - paid;
      const how = pnl >= 0 ? `That is ${usd(pnl)} up on ${usd(paid)} so far.` : `That is ${usd(-pnl)} down on ${usd(paid)} so far.`;
      return [`Checking in on my ${side} call on ${Q}. I got in at ${px} and it is at ${cents(now)} now.`, `${how} Still open, so it can go either way.`, 'Follow it here:'];
    }
    return [`I'm in on ${side} at ${px}: ${Q}`, `If it lands, ${usd(paid)} turns into ${usd(shares)}. If it does not, I lose the ${usd(paid)}.`, 'Make your own call:'];
  };
  let q = String(d.question || '').replace(/["“”]/g, '').trim();
  const fits = (s) => s.join('\n\n').length + 1 + X_LINK <= X_LIMIT;
  while (!fits(build(q)) && q.length > 12) q = `${q.slice(0, -2).trimEnd()}…`.replace(/……$/, '…');
  const body = build(q).join('\n\n');
  return { body, full: `${body}\n${url}` };
}

function wrap(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test; else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last.trimEnd()}…`;
    return kept;
  }
  return lines;
}

// The browser draws the card on the person's phone; the server draws the same card for assistants (card-server.mjs).
let env = {
  canvas: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; },
  image: (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; }),
  fonts: true,
};
export function useEnvironment(e) { env = { ...env, ...e }; }
const loadImage = (src) => env.image(src);

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawQR(ctx, url, x, y, size) {
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  const n = qr.getModuleCount(), quiet = 2, cell = size / (n + quiet * 2);
  ctx.fillStyle = CREAM; roundRect(ctx, x, y, size, size, 22); ctx.fill();
  ctx.fillStyle = INK;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(Math.round(x + (c + quiet) * cell), Math.round(y + (r + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
}

async function fonts() {
  if (!env.fonts || typeof document === 'undefined' || !document.fonts) return;
  await Promise.all(['800 200px "Geist"', '700 60px "Geist"', '500 30px "Geist"', '500 24px "Geist Mono"'].map((f) => document.fonts.load(f).catch(() => {})));
}

export async function render(d) {
  await fonts();
  const t = describe(d);
  const canvas = env.canvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';

  // ground
  ctx.fillStyle = CREAM; ctx.fillRect(0, 0, W, H);

  // the right-hand block: one flat colour, with the mark's cut-out circle echoed in it
  const PX = 1168, panel = t.dark ? INK : ORANGE, deep = t.dark ? '#1b2a33' : ORANGE_DEEP;
  ctx.fillStyle = panel; ctx.fillRect(PX, 0, W - PX, H);
  ctx.save(); ctx.beginPath(); ctx.rect(PX, 0, W - PX, H); ctx.clip();
  ctx.fillStyle = deep; ctx.beginPath(); ctx.arc(W - 40, 200, 330, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = CREAM; ctx.beginPath(); ctx.arc(W - 40, 200, 96, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // top row: mark and name, the kind of card
  try { const mark = await loadImage('/assets/clue-mark.svg'); ctx.drawImage(mark, M, M - 14, 84, 84); } catch { /* the name below is enough */ }
  ctx.fillStyle = INK; ctx.font = `800 64px ${SANS}`; ctx.fillText('clue', M + 108, M + 50);
  ctx.fillStyle = ORANGE; ctx.fillText('.', M + 108 + ctx.measureText('clue').width, M + 50);
  ctx.font = `600 26px ${MONO}`;
  const tagW = ctx.measureText(t.tag).width + 56;
  ctx.strokeStyle = INK; ctx.lineWidth = 3; roundRect(ctx, PX - M - tagW, M - 6, tagW, 64, 32); ctx.stroke();
  ctx.fillStyle = INK; ctx.fillText(t.tag, PX - M - tagW + 28, M + 36);

  // the question
  ctx.fillStyle = INK; ctx.font = `700 76px ${SANS}`;
  const lines = wrap(ctx, d.question || '', PX - M * 2, 3);
  let y = 330; for (const l of lines) { ctx.fillText(l, M, y); y += 92; }

  // the call: which side, at what price
  const side = String(d.side || 'Yes'), yy = Math.max(y + 24, 560);
  ctx.font = `800 54px ${SANS}`;
  const sw = ctx.measureText(side.toUpperCase()).width + 56;
  ctx.fillStyle = INK; roundRect(ctx, M, yy, sw, 92, 20); ctx.fill();
  ctx.fillStyle = CREAM; ctx.fillText(side.toUpperCase(), M + 28, yy + 66);
  ctx.fillStyle = INK; ctx.font = `600 54px ${SANS}`;
  const at = `at ${cents(Number(d.entry))}`, atW = ctx.measureText(at).width;   // measured in its own font, before the smaller one is set
  ctx.fillText(at, M + sw + 28, yy + 66);
  ctx.fillStyle = SOFT; ctx.font = `500 30px ${SANS}`;
  if (d.kind === 'open' && Number.isFinite(Number(d.now))) ctx.fillText(`now ${cents(Number(d.now))}`, M + sw + 28 + atW + 22, yy + 66);

  // three small numbers
  const sy = 800;
  ctx.strokeStyle = LINE; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(M, sy - 40); ctx.lineTo(PX - M, sy - 40); ctx.stroke();
  const colW = (PX - M * 2) / 3;
  t.stats.forEach(([label, value], i) => {
    const x = M + colW * i;
    ctx.fillStyle = SOFT; ctx.font = `500 22px ${MONO}`; ctx.fillText(label, x, sy);
    ctx.fillStyle = INK; ctx.font = `700 52px ${SANS}`; ctx.fillText(value, x, sy + 64);
  });

  // the big number
  const ink = t.dark ? CREAM : INK;
  ctx.fillStyle = t.dark ? CREAM : CREAM; ctx.textAlign = 'left';
  let size = 232; ctx.font = `800 ${size}px ${SANS}`;
  while (ctx.measureText(t.big).width > W - PX - 140 && size > 120) { size -= 6; ctx.font = `800 ${size}px ${SANS}`; }
  ctx.fillText(t.big, PX + 72, 560);
  ctx.font = `600 40px ${SANS}`; ctx.fillStyle = t.dark ? '#c9d4d9' : '#fff3ea';
  const subLines = wrap(ctx, t.sub, W - PX - 144, 2); subLines.forEach((l, i) => ctx.fillText(l, PX + 76, 628 + i * 52));

  // the way in: a code that opens the market, and the site name to type
  const qs = 232, qx = PX + 72, qy = H - 72 - qs;
  drawQR(ctx, d.url || 'https://www.oncluemarket.xyz', qx, qy, qs);
  ctx.fillStyle = ink; ctx.fillStyle = CREAM; ctx.font = `700 36px ${SANS}`;
  ctx.fillText('Make your own call', qx + qs + 32, qy + 86);
  ctx.font = `500 26px ${MONO}`; ctx.fillStyle = t.dark ? '#c9d4d9' : '#fff3ea';
  ctx.fillText('oncluemarket.xyz', qx + qs + 32, qy + 136);
  ctx.font = `500 22px ${SANS}`; ctx.fillText('Scan to open this market', qx + qs + 32, qy + 182);

  return canvas;
}

export const toBlob = async (d) => { const c = await render(d); return new Promise((resolve) => c.toBlob(resolve, 'image/png')); };

if (typeof window !== 'undefined') window.ClueCard = { render, toBlob, describe, postText };
