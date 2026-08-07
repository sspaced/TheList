/**
 * Les sons d'interface — délégués à Cuelume (MIT, vendoré dans
 * `vendor/cuelume/`).
 *
 * Mes deux clics maison sonnaient cheap, et pas parce que le code était mauvais :
 * un son d'interface réussi est un objet DESIGNÉ, calibré à l'oreille. Or je ne
 * peux pas écouter ce que j'écris. Cuelume apporte dix-sept recettes réglées par
 * quelqu'un qui, lui, a entendu le résultat.
 *
 * Pourquoi celle-ci et pas Howler ou use-sound : elles ne font que LIRE un
 * fichier, donc il faudrait embarquer des `.wav` (poids, licence, latence de
 * décodage). Cuelume synthétise en Web Audio — aucun octet d'asset, aucune
 * latence, et aucune dépendance transitive à auditer. Vérifié avant de le
 * vendorer : ni `fetch`, ni `localStorage`, ni `eval` dans son code.
 *
 * Le choix des recettes est un choix de SENS, pas de goût :
 *   - `tick`    sélection dans le menu — sec, instantané, un cran ;
 *   - `press`   retirer un article — un coup mat, sans brillance ; l'action est
 *               destructive, elle ne doit pas sonner joyeuse ;
 *   - `toggle`  l'interrupteur de son — un clic-clac de bascule mécanique.
 *
 * Les dix-sept sont auditionnables sur `src/sounds-preview.html` : c'est là qu'on
 * tranche, à l'oreille, pas ici.
 */
import { play, setEnabled, setVolume } from './vendor/cuelume/index.js';

let muted = false;

setVolume(0.9);

/** L'état est persisté : un son qu'on a coupé doit rester coupé. */
export async function loadMute() {
  try {
    const r = await chrome.storage.local.get({ muted: false });
    muted = !!r.muted;
  } catch {
    muted = false;
  }
  setEnabled(!muted);
  return muted;
}

export function isMuted() {
  return muted;
}

export async function setMuted(v) {
  muted = !!v;
  setEnabled(!muted);
  try {
    await chrome.storage.local.set({ muted });
  } catch {}
}

// Un son indisponible n'est jamais une raison de casser un clic.
const safe = (name) => () => {
  try {
    play(name);
  } catch {}
};

/** Sélection, cran, ouverture de menu. */
export const tick = safe('tick');
/** Action destructive — retirer un article. */
export const tock = safe('press');
/** Bascule de l'interrupteur de son. */
export const flip = safe('toggle');
