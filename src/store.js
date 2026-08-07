// Storage is entirely local. Items go into chrome.storage.sync (synced between
// your Chrome installs, ~100 KB / 512 keys max) — one key per item, no central
// index to rewrite. The OpenRouter API key stays in storage.local: never synced.

const PREFIX = 'i:';

export const SYNC_QUOTA = 102400; // chrome.storage.sync.QUOTA_BYTES

export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'anthropic/claude-haiku-4.5',
  autoCategorize: true,
  lastError: '',
};

// djb2 -> base36. Deterministic: re-adding a product updates its entry.
export function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const cut = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

/**
 * A URL is never TRUNCATED.
 *
 * `image` used to go through `cut(…, 300)`. But image CDNs sign their URLs:
 * Apple serves its bag thumbnails with a `.v=` token over a hundred characters
 * long, plus sizing and tracing parameters. Past 300 we stored a CUT URL — an
 * image that never loads, a grey tile, and no message. The worst state: neither
 * the image nor the reason.
 *
 * So the cap is generous (a storage.sync key holds 8 KB, a 1000-character URL is
 * nothing), and beyond it we prefer NOTHING to a dead link.
 */
const MAX_URL = 1000;
const keepUrl = (s) => (typeof s === 'string' && s.length <= MAX_URL ? s : '');

// An item must stay under 8 KB and remain small: we never store the image
// itself, only its URL.
export function makeItem(product, category, now) {
  return {
    id: hashId(product.url),
    url: cut(product.url, 500),
    title: cut(product.title, 140),
    image: keepUrl(product.image),
    price: typeof product.price === 'number' ? Math.round(product.price * 100) / 100 : null,
    currency: cut(product.currency, 4),
    site: cut(product.site, 60),
    brand: cut(product.brand, 60),
    category: cut(category, 40),
    ts: now,
  };
}

export async function allItems() {
  const all = await chrome.storage.sync.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(PREFIX))
    .map(([, v]) => v)
    .filter((v) => v && v.id)
    .sort((a, b) => b.ts - a.ts);
}

export async function getItem(id) {
  const k = PREFIX + id;
  const r = await chrome.storage.sync.get(k);
  return r[k] || null;
}

export async function putItem(item) {
  await chrome.storage.sync.set({ [PREFIX + item.id]: item });
}

/**
 * Moves already-stored items onto the category keys.
 *
 * They carried a French label (`category: 'Meuble'`) that served as both the key
 * and the displayed text. Without this migration an older item would sit in a
 * "Meuble" category the filter cannot see — the menu only lists known keys — and
 * it would have vanished from the interface without being deleted.
 *
 * The conversion is deterministic and lossless: we only write what changes, so
 * running the migration again costs nothing.
 */
export async function migrateLegacyCategories() {
  const { LEGACY_LABELS } = await import('./categorize.js');
  const items = await allItems();
  let n = 0;
  for (const it of items) {
    const key = LEGACY_LABELS[it.category];
    if (!key || key === it.category) continue;
    await putItem({ ...it, category: key });
    n++;
  }
  return n;
}

export async function removeItem(id) {
  await chrome.storage.sync.remove(PREFIX + id);
}

export async function usage() {
  const [bytes, items] = await Promise.all([chrome.storage.sync.getBytesInUse(null), allItems()]);
  return { bytes, quota: SYNC_QUOTA, count: items.length };
}

export async function getSettings() {
  return chrome.storage.local.get(DEFAULT_SETTINGS);
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}
