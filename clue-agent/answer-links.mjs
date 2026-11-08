// AI answers may only link to pages the web search actually returned.
// Any other URL (for example one planted by a prompt injection) is replaced with a plain notice.
const URL_RE = /https?:\/\/[^\s<>()[\]{}"'`]+/g;
const TRAILING = /[.,;:!?*_~]+$/;
export const REMOVED = '[link removed: not from a search result]';

function key(raw) {
  try {
    const u = new URL(raw.replace(TRAILING, ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return (u.origin + u.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch { return null; }
}

export function cleanAnswer(content, sources) {
  const allowed = new Set((sources || []).map(key).filter(Boolean));
  return String(content).replace(URL_RE, (m) => {
    const tail = (m.match(TRAILING) || [''])[0];
    const k = key(m);
    return k && allowed.has(k) ? m : REMOVED + tail;
  });
}
