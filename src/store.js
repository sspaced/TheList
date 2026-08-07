// Stockage 100 % local. Les items vont dans chrome.storage.sync (synchro entre
// tes Chrome, ~100 Ko / 512 clés max) — une clé par item, pas d'index central à
// réécrire. La clé API OpenRouter reste dans storage.local : jamais synchronisée.

const PREFIX = 'i:';

export const SYNC_QUOTA = 102400; // chrome.storage.sync.QUOTA_BYTES

export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'anthropic/claude-haiku-4.5',
  autoCategorize: true,
  lastError: '',
};

// djb2 -> base36. Déterministe : ré-ajouter un produit met à jour sa fiche.
export function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const cut = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

/**
 * Une URL ne se TRONQUE pas.
 *
 * `image` passait par `cut(…, 300)`. Or les CDN d'images signent leurs URL :
 * Apple sert ses vignettes de panier avec un jeton `.v=` de plus de cent
 * caractères, plus des paramètres de taille et de traçage. Au-delà de 300, on
 * enregistrait une URL COUPÉE — donc une image qui ne charge jamais, une tuile
 * grise, et aucun message. Le pire des états : ni l'image, ni la raison.
 *
 * On garde donc large (une clé de storage.sync tient 8 Ko, une URL de 1 000
 * caractères ne pèse rien), et au-delà on préfère RIEN à un lien mort.
 */
const MAX_URL = 1000;
const keepUrl = (s) => (typeof s === 'string' && s.length <= MAX_URL ? s : '');

// Un item doit tenir sous 8 Ko et rester petit : on ne stocke jamais l'image
// elle-même, seulement son URL.
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
 * Ramène les articles déjà enregistrés vers les clés de catégorie.
 *
 * Ils portaient un libellé français (`category: 'Meuble'`) qui servait à la fois
 * de clé et de texte affiché. Sans cette migration, un article ancien resterait
 * dans une catégorie « Meuble » invisible du filtre — le menu ne liste que les
 * clés connues — et il aurait disparu de l'interface sans être supprimé.
 *
 * Conversion déterministe et sans perte : on n'écrit que ce qui change, donc
 * relancer la migration ne coûte rien.
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
