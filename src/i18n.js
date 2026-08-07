/**
 * Les textes, via i18next (MIT, vendoré dans `vendor/i18next/`).
 *
 * Pourquoi une lib pour une douzaine de chaînes : ce n'est pas la traduction qui
 * coûte, c'est la MÉCANIQUE — interpolation, pluriels, repli quand une clé manque
 * dans une langue, et surtout un fichier JSON par langue. Ajouter une langue
 * devient « déposer `es.json` et l'ajouter à LANGS », sans toucher au code. Un
 * JSON est aussi ce qu'un traducteur remplit sans rien casser.
 *
 * Pourquoi PAS `chrome.i18n`, le système natif : il suit la langue de l'interface
 * de Chrome et ne peut pas être changé depuis l'extension. Impossible d'offrir un
 * sélecteur, et impossible de relire l'anglais sans basculer tout son navigateur.
 * (Il reste le seul moyen de traduire le `manifest.json` — non fait, assumé.)
 *
 * Les fichiers sont chargés par `fetch` sur `chrome.runtime.getURL` : une page
 * d'extension a le droit de lire ses propres ressources, et on garde ainsi de
 * vrais `.json` plutôt que des objets JS déguisés.
 */
import i18next from './vendor/i18next/i18next.js';

/** Ajouter une langue : déposer le JSON, ajouter la ligne ici. Rien d'autre. */
export const LANGS = [
  { code: 'fr', label: 'Français', locale: 'fr-FR' },
  { code: 'en', label: 'English', locale: 'en-GB' },
];

const FALLBACK = 'fr';
let current = FALLBACK;

const urlFor = (code) =>
  typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL(`src/i18n/${code}.json`)
    : `./i18n/${code}.json`;

async function load(code) {
  const res = await fetch(urlFor(code));
  if (!res.ok) throw new Error(`i18n ${code}: HTTP ${res.status}`);
  return res.json();
}

/** Langue retenue au dernier passage, sinon celle du navigateur, sinon le repli. */
async function preferred() {
  try {
    const { lang } = await chrome.storage.local.get({ lang: '' });
    if (lang && LANGS.some((l) => l.code === lang)) return lang;
  } catch {}
  const nav = (navigator.language || '').slice(0, 2).toLowerCase();
  return LANGS.some((l) => l.code === nav) ? nav : FALLBACK;
}

export async function initI18n() {
  current = await preferred();
  // Les deux langues sont chargées d'entrée : elles pèsent moins de 2 Ko et ça
  // rend le changement instantané, sans état de chargement à gérer à l'écran.
  const bundles = await Promise.all(
    LANGS.map(async (l) => [l.code, await load(l.code).catch(() => ({}))]),
  );
  await i18next.init({
    lng: current,
    fallbackLng: FALLBACK,
    resources: Object.fromEntries(bundles.map(([code, data]) => [code, { translation: data }])),
    interpolation: { escapeValue: false },
  });
  return current;
}

export function t(key, vars) {
  return i18next.t(key, vars);
}

export function lang() {
  return current;
}

/** Locale complète (`fr-FR`) — c'est elle qui formate les montants. Sans ça,
 *  l'interface passait en anglais mais les prix restaient au format français. */
export function locale() {
  return LANGS.find((l) => l.code === current)?.locale ?? 'fr-FR';
}

export async function setLang(code) {
  if (!LANGS.some((l) => l.code === code)) return;
  current = code;
  await i18next.changeLanguage(code);
  try {
    await chrome.storage.local.set({ lang: code });
  } catch {}
}
