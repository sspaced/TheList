/**
 * Les médias : ce qu'on garde pour LIRE, à côté de ce qu'on garde pour acheter.
 *
 * Rangés dans `chrome.storage.local`, pas dans `sync` comme les produits, et ce
 * n'est pas un choix de confort : `sync` plafonne à 100 Ko au TOTAL et 8 Ko par
 * clé. Un passage cité tient ; un article entier fait 20 à 50 Ko et ferait
 * exploser le quota au deuxième enregistrement. Les deux sortes ne peuvent donc
 * pas cohabiter.
 *
 * Conséquence assumée, à dire clairement : les médias ne se synchronisent PAS
 * entre plusieurs Chrome. Les produits, si.
 */

const PREFIX = 'm:';

/** djb2 → base36, comme pour les produits. */
function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Pour un titre, une URL, un domaine : tout sur une ligne. */
const cut = (s, n) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/**
 * Pour le PASSAGE, on garde les retours à la ligne.
 *
 * `\s+` → espace les avalait avec le reste : un texte de dix paragraphes
 * revenait en un seul bloc compact, illisible. Or la structure fait partie de ce
 * qu'on a sélectionné. On normalise donc seulement ce qui est du bruit : les
 * espaces horizontaux en trop, ceux qui traînent en bout de ligne, et les
 * enfilades de lignes vides — au plus une, comme dans un texte imprimé.
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
 * L'identité d'un passage tient à SA PAGE ET À SON TEXTE : citer deux fois le
 * même paragraphe ne crée pas deux entrées, mais deux passages différents d'un
 * même article restent deux médias distincts.
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
