/**
 * Copy, through i18next (MIT, vendored under `vendor/i18next/`).
 *
 * Why a library for a dozen strings: the translating is not what costs, the
 * MACHINERY is — interpolation, plurals, falling back when a key is missing in
 * one language, and above all one JSON file per language. Adding a language
 * becomes "drop `es.json` in and add it to LANGS", with no code to touch. A JSON
 * file is also what a translator can fill in without breaking anything.
 *
 * Why NOT `chrome.i18n`, the native system: it follows Chrome's own interface
 * language and cannot be changed from the extension. No picker is possible, and
 * there is no way to proof-read the English without switching the whole browser.
 * (It remains the only way to translate `manifest.json` — not done, deliberately.)
 *
 * The files are loaded with `fetch` over `chrome.runtime.getURL`: an extension
 * page is allowed to read its own resources, which keeps them real `.json` files
 * rather than JS objects in disguise.
 */
import i18next from './vendor/i18next/i18next.js';

/** Adding a language: drop the JSON in, add the line here. Nothing else. */
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

/** Language kept from last time, else the browser's, else the fallback. */
async function preferred() {
  try {
    const { lang } = await chrome.storage.local.get({ lang: '' });
    if (lang && LANGS.some((l) => l.code === lang)) return lang;
  } catch {}
  const nav = (navigator.language || '').slice(0, 2).toLowerCase();
  return LANGS.some((l) => l.code === nav) ? nav : FALLBACK;
}

/** The document's own language, so the browser knows what it is reading — it
 *  drives hyphenation, spellcheck and how a screen reader pronounces the page. */
function stamp() {
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}

export async function initI18n() {
  current = await preferred();
  // Both languages are loaded up front: they weigh under 2 KB and it makes
  // switching instant, with no loading state to handle on screen.
  const bundles = await Promise.all(
    LANGS.map(async (l) => [l.code, await load(l.code).catch(() => ({}))]),
  );
  await i18next.init({
    lng: current,
    fallbackLng: FALLBACK,
    resources: Object.fromEntries(bundles.map(([code, data]) => [code, { translation: data }])),
    interpolation: { escapeValue: false },
  });
  stamp();
  return current;
}

export function t(key, vars) {
  return i18next.t(key, vars);
}

export function lang() {
  return current;
}

/** Full locale (`fr-FR`) — it is what formats amounts. Without it the interface
 *  switched to English while prices stayed in the French format. */
export function locale() {
  return LANGS.find((l) => l.code === current)?.locale ?? 'fr-FR';
}

export async function setLang(code) {
  if (!LANGS.some((l) => l.code === code)) return;
  current = code;
  await i18next.changeLanguage(code);
  stamp();
  try {
    await chrome.storage.local.set({ lang: code });
  } catch {}
}
