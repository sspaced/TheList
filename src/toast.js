/**
 * Le retour visuel de l'ajout — affiché SUR LA PAGE PRODUIT, pas dans la
 * wishlist.
 *
 * C'est là qu'est l'utilisateur au moment où il appuie sur le raccourci. Le
 * badge de l'icône (✓ / ? / ×) existait déjà mais il est minuscule, dans un coin,
 * et disparaît en 2,5 s : on peut ajouter dix articles sans jamais le voir. On le
 * garde quand même — il reste le seul retour possible sur les pages où Chrome
 * interdit toute injection (chrome://, Web Store, visionneuse PDF).
 *
 * La fonction injectée est nécessairement AUTONOME : `executeScript` la
 * sérialise pour l'exécuter dans la page, elle ne peut donc rien capturer de ce
 * module. Tout ce dont elle a besoin arrive par `args`, textes traduits compris.
 */

/**
 * Rendu dans la page. Shadow DOM obligatoire : sans lui, la feuille de style du
 * marchand s'applique au toast — Amazon impose sa police, Apple ses marges — et
 * l'encart n'a plus aucune tenue. Le shadow root isole, dans les deux sens.
 */
function paint({ title, kind }) {
  const ID = '__wishlist_toast__';
  // La préférence se lit DANS la page, pas dans le service worker : c'est le
  // réglage système de l'utilisateur, et le worker n'a pas de matchMedia.
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.getElementById(ID)?.remove();

  const host = document.createElement('div');
  host.id = ID;
  // z-index maximal : les fiches produit empilent des bandeaux collants, des
  // volets panier et des cookies. En dessous, le toast serait invisible.
  host.style.cssText =
    'all:initial;position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none';

  const root = host.attachShadow({ mode: 'closed' });
  const box = document.createElement('div');
  box.setAttribute('role', 'status');
  box.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:12px',
    'padding:9px 12px',
    'border:1px solid #000',
    'background:#fff',
    'color:#000',
    'font:13px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace',
    'box-shadow:0 2px 0 rgba(0,0,0,.18)',
    reduceMotion ? '' : 'opacity:0;transform:translateY(-6px);transition:opacity .12s ease-out,transform .12s ease-out',
  ]
    .filter(Boolean)
    .join(';');

  const text = document.createElement('span');
  text.textContent = title;
  // Le verdict ne se coupe jamais en deux lignes : c'est le détail qui cède.
  text.style.cssText = 'font-weight:700;white-space:nowrap;flex:none';
  box.append(text);

  /**
   * LA MARQUE : UN CARRÉ DONT LE TRAIT S'ÉCRIT EN FAISANT LE TOUR.
   *
   * La forme reste carrée — c'est le vocabulaire de toute la page. Ce qui est
   * animé, c'est le TRACÉ : le trait part du milieu du bord haut et fait le tour
   * dans le sens horaire en 320 ms, comme une aiguille. Le ✓ est noir et présent
   * dès la première image : on n'attend pas la fin pour savoir que c'est acté,
   * le contour ne fait que le confirmer.
   *
   * Un SVG et non une bordure CSS : le tracé d'une bordure ne s'anime pas, alors
   * qu'un `stroke-dashoffset` qui revient à zéro dessine exactement le trait. Le
   * chemin démarre au milieu du haut plutôt qu'au coin — partir d'un angle se lit
   * comme un décalage, pas comme un départ. La longueur est MESURÉE
   * (`getTotalLength`) plutôt que calculée : un arrondi de un pixel laisserait un
   * trait inachevé.
   */
  const NS = 'http://www.w3.org/2000/svg';

  const mark = document.createElement('span');
  mark.style.cssText = 'position:relative;flex:none;width:20px;height:20px;display:block';

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.style.cssText = 'position:absolute;inset:0';

  const frame = document.createElementNS(NS, 'path');
  // Décalé d'un demi-pixel : un trait de 1 px centré sur le bord déborderait de
  // moitié et sortirait flou.
  frame.setAttribute('d', 'M10 .5 H19.5 V19.5 H.5 V.5 Z');
  frame.setAttribute('fill', 'none');
  frame.setAttribute('stroke', '#000');
  frame.setAttribute('stroke-width', '1');
  svg.append(frame);
  mark.append(svg);

  const glyph = document.createElement('span');
  glyph.textContent = kind === 'ok' ? '✓' : kind === 'warn' ? '?' : '×';
  // Pas de graisse forcée : le signe prend celle du texte de l'encart. En gras
  // il pesait plus lourd que le message qu'il accompagne.
  glyph.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1;color:#000';
  mark.append(glyph);

  box.append(mark);

  root.append(box);
  document.documentElement.append(host);

  // Après insertion seulement : `getTotalLength` exige que le chemin soit rendu.
  // TROIS TEMPS, ET L'ORDRE EST TOUT.
  //
  //   1. la longueur du tracé, en `px` : `stroke-dasharray` accepte un nombre nu,
  //      `stroke-dashoffset` exige une unité — sans elle il était ignoré ;
  //   2. on FIGE ce point de départ en lisant le style calculé, transition non
  //      encore armée ;
  //   3. seulement alors on arme la transition, et l'image suivante vise zéro.
  //
  // 520 ms, et une courbe peu chargée au départ : l'ancienne (.22,.61,.36,1)
  // abattait 35 % du tour en 40 ms, ce qui se lisait comme un saut suivi d'une
  // traîne. Le trait doit avancer d'un geste régulier, on doit le suivre.
  //
  // Armer la transition en même temps qu'on pose la valeur de départ animait le
  // départ lui-même — le navigateur transitionnait de 0 vers 76 pendant que
  // l'image suivante redemandait 0. L'offset ne quittait jamais zéro : le carré
  // était plein d'emblée, et aucune correction de durée n'y changeait rien.
  const len = frame.getTotalLength();
  frame.style.strokeDasharray = `${len}px`;
  frame.style.strokeDashoffset = reduceMotion ? '0px' : `${len}px`;
  if (!reduceMotion) {
    void getComputedStyle(frame).strokeDashoffset;
    frame.style.transition = 'stroke-dashoffset .52s cubic-bezier(.45,.05,.3,1)';
  }

  if (!reduceMotion) {
    requestAnimationFrame(() => {
      box.style.opacity = '1';
      box.style.transform = 'translateY(0)';
      frame.style.strokeDashoffset = '0px';
    });
  }

  setTimeout(() => {
    if (reduceMotion) return host.remove();
    box.style.opacity = '0';
    box.style.transform = 'translateY(-6px)';
    setTimeout(() => host.remove(), 160);
  }, 2400);
}

/**
 * Affiche le toast dans l'onglet. N'échoue jamais bruyamment : sur une page
 * interne de Chrome l'injection est refusée, et ce n'est pas une raison de
 * casser un ajout qui, lui, a réussi.
 */
export async function toast(tabId, payload) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: paint,
      args: [payload],
    });
  } catch {}
}
