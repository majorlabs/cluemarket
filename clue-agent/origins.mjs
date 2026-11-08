// Which browser origins may make POST requests (sign-in, saving research, forecasts).
// The site is served from more than one address (Vercel domains), so this is a short allowlist.
// Set CLUE_PUBLIC_ORIGINS (comma-separated https origins) to change it without a code change.
export function allowedOrigins(baseUrl, extra = process.env.CLUE_PUBLIC_ORIGINS) {
  const list = [new URL(baseUrl).origin];
  const more = extra === undefined ? 'https://clue-markets.vercel.app' : extra;
  for (const raw of String(more).split(',').map((s) => s.trim()).filter(Boolean)) {
    try { const u = new URL(raw); if (u.protocol === 'https:') list.push(u.origin); } catch { /* ignore bad entries */ }
  }
  return [...new Set(list)];
}

// Returns the matching allowed origin, or null. Exact match only: no wildcards, no prefix tricks.
export function checkOrigin(origin, allowed) {
  return typeof origin === 'string' && allowed.includes(origin) ? origin : null;
}
