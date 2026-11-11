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

const MD_LINK = /\(?\[([^\]\n]*)\]\((https?:\/\/[^)\s]+)\)\)?/g;

export function cleanAnswer(content, sources) {
  const allowed = new Set((sources || []).map(key).filter(Boolean));
  // A "[site](address)" link whose address was not a search result keeps just its words, with no address and no notice.
  const text = String(content).replace(MD_LINK, (m, label, url) => { const k = key(url); return k && allowed.has(k) ? m : label.trim(); });
  return text.replace(URL_RE, (m) => {
    const tail = (m.match(TRAILING) || [''])[0];
    const k = key(m);
    return k && allowed.has(k) ? m : REMOVED + tail;
  });
}
