/**
 * Media: what you keep to READ, next to what you keep to buy.
 *
 * Stored in `chrome.storage.local`, not in `sync` like products, and that is not
 * a matter of convenience: `sync` caps at 100 KB in TOTAL and 8 KB per key. A
 * quoted passage fits; a whole article runs 20 to 50 KB and would blow the quota
 * on the second save. The two kinds simply cannot share that space.
 *
 * The consequence is deliberate and worth stating plainly: media does NOT sync
 * between several Chrome installs. Products do.
 */

const PREFIX = 'm:';

/** djb2 → base36, same as for products. */
function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** For a title, a URL, a hostname: everything on one line. */
const cut = (s, n) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/**
 * For the PASSAGE itself, line breaks are kept.
 *
 * `\s+` → space swallowed them along with the rest: ten paragraphs came back as
 * a single compact block, unreadable. Yet the structure is part of what was
 * selected. So we normalise only the noise: extra horizontal spaces, spaces
 * trailing at end of line, and runs of blank lines — at most one, as in print.
 */
const cutText = (s, n) =>
  typeof s === 'string'
    ? s
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t\u00a0]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, n)
    : '';

/**
 * A passage is identified by ITS PAGE AND ITS TEXT: quoting the same paragraph
 * twice does not create two entries, but two different passages from the same
 * article remain two distinct media items.
 */
export function makeQuote({ text, title, url, site }, now) {
  const body = cutText(text, 5000);
  return {
    id: hashId(`${url}#${body.slice(0, 120)}`),
    kind: 'quote',
    text: body,
    title: cut(title, 140),
    url: cut(url, 500),
    site: cut(site, 60),
    ts: now,
  };
}

export async function allMedia() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(PREFIX))
    .map(([, v]) => v)
    .filter((v) => v && v.id)
    .sort((a, b) => b.ts - a.ts);
}

export async function putMedia(item) {
  await chrome.storage.local.set({ [PREFIX + item.id]: item });
}

export async function removeMedia(id) {
  await chrome.storage.local.remove(PREFIX + id);
}
