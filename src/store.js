// Storage is entirely local, in every sense: nothing leaves the machine, and
// everything now lives in `chrome.storage.local`.
//
// Items used to sit in `chrome.storage.sync` to follow you between Chrome
// installs. That convenience cost more than it was worth: sync caps at 100 KB in
// TOTAL, 8 KB per key, 512 keys. That ceiling is what truncated image URLs into
// dead links and what forced us to throw away product descriptions after using
// them to classify. `local` gives ~10 MB, and `unlimitedStorage` removes the cap
// altogether.
//
// What we give up, plainly: the list no longer syncs between several Chrome
// installs. What we gain: descriptions are kept, so they can be searched, and
// media and products finally share one store.
//
// One key per item, no central index to rewrite.

const PREFIX = 'i:';

/** Chrome's default local quota. Lifted by the `unlimitedStorage`
 *  permission, and kept here only to display how much is in use. */
export const LOCAL_QUOTA = 10485760;

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
    // Kept now that the quota allows it. It was extracted, used to classify, then
    // dropped — so a product could not be found by searching its description.
    desc: cut(product.desc, 400),
    ts: now,
  };
}

export async function allItems() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(PREFIX))
    .map(([, v]) => v)
    .filter((v) => v && v.id)
    .sort((a, b) => b.ts - a.ts);
}

export async function getItem(id) {
  const k = PREFIX + id;
  const r = await chrome.storage.local.get(k);
  return r[k] || null;
}

export async function putItem(item) {
  await chrome.storage.local.set({ [PREFIX + item.id]: item });
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

/**
 * Moves items out of `storage.sync` and into `storage.local`.
 *
 * The order is the whole point: we WRITE to local before clearing sync. A crash
 * in between leaves duplicates under identical keys, which the next run
 * overwrites harmlessly — whereas clearing first could lose a list outright.
 *
 * Idempotent: once sync is empty it does nothing.
 */
export async function migrateFromSync() {
  try {
    const all = await chrome.storage.sync.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(PREFIX));
    if (!keys.length) return 0;
    await chrome.storage.local.set(Object.fromEntries(keys.map((k) => [k, all[k]])));
    await chrome.storage.sync.remove(keys);
    return keys.length;
  } catch {
    return 0;
  }
}

export async function removeItem(id) {
  await chrome.storage.local.remove(PREFIX + id);
}

export async function usage() {
  const [bytes, items] = await Promise.all([chrome.storage.local.getBytesInUse(null), allItems()]);
  return { bytes, quota: LOCAL_QUOTA, count: items.length };
}

export async function getSettings() {
  return chrome.storage.local.get(DEFAULT_SETTINGS);
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}
