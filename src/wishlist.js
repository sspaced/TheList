/**
 * La wishlist réduite à ce qu'elle montre : les images des produits, quatre par
 * ligne, plein cadre.
 *
 * Tout le reste a été retiré (recherche, tri, filtres par catégorie, réglages
 * OpenRouter, export/import). Rien n'est cassé pour autant : l'ajout, la
 * catégorisation et le stockage vivent dans le service worker et dans store.js,
 * cette page ne faisait que les piloter. Ce qui est utile revient au cas par cas.
 */
import { allItems, migrateLegacyCategories, putItem, removeItem } from './store.js';
import { allMedia, putMedia, removeMedia } from './media.js';
import { CATEGORIES } from './categorize.js';
import { flip, isMuted, loadMute, setMuted, tick, tock } from './sound.js';
import { initI18n, lang, LANGS, locale, setLang, t } from './i18n.js';

const grid = document.getElementById('grid');
const ddBtn = document.getElementById('cats-btn');
const ddPanel = document.getElementById('cats-panel');
const ddLabel = document.getElementById('cats-label');
const totalEl = document.getElementById('total');
const muteBtn = document.getElementById('mute');
const qInput = document.getElementById('q');
const keysBtn = document.getElementById('keys-btn');
const keysPanel = document.getElementById('keys-panel');
const langBtn = document.getElementById('lang-btn');
const langPanel = document.getElementById('lang-panel');
const langLabel = document.getElementById('lang-label');

const sectionBtn = document.getElementById('section-btn');
const sectionPanel = document.getElementById('section-panel');
const sectionLabel = document.getElementById('section-label');
const catsBox = document.getElementById('cats');

let items = [];
let media = [];
/** Catégorie affichée, `null` = toutes. */
let filter = null;
/** Section affichée : les produits, ou ce qu'on garde pour lire. */
let section = 'products';
/** Recherche libre, appliquée à la section courante. */
let query = '';

/**
 * LA PILE D'ANNULATION.
 *
 * La croix supprime sans confirmation — c'est voulu, une boîte de dialogue à
 * chaque retrait serait pire que le risque. Mais supprimer sans filet ne l'est
 * pas : ⌘Z (⌃Z ailleurs) remet le dernier retiré, autant de fois qu'il le faut.
 *
 * En mémoire seulement, et c'est délibéré : l'annulation répare un geste qu'on
 * vient de faire. Survivre à un rechargement en ferait une corbeille, ce qui est
 * un autre objet — et il faudrait alors décider quand la vider.
 */
const undone = [];

/**
 * LA RECHERCHE PORTE SUR TOUT CE QUI EST ENREGISTRÉ.
 *
 * Un produit se cherche par son titre, sa marque, son domaine, son prix ou sa
 * catégorie — et par le LIBELLÉ de celle-ci autant que par sa clé, sinon taper
 * « meuble » ne trouverait rien alors que la tuile l'affiche. Un passage se
 * cherche par son texte, son titre et son domaine.
 *
 * Accents et casse sont neutralisés des deux côtés : chercher « electronique »
 * doit trouver « Électronique ».
 */
const fold = (v) =>
  (v ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

function haystack(o) {
  return o.kind === 'quote'
    ? fold([o.text, o.title, o.site].join(' '))
    : fold([o.title, o.brand, o.site, o.category, t(`cat.${o.category}`), o.price, o.currency].join(' '));
}

function matches(o) {
  if (!query) return true;
  const hay = haystack(o);
  // Tous les mots doivent être présents, dans n'importe quel ordre : « chaise
  // amazon » trouve la chaise sur Amazon, pas tout ce qui contient l'un OU
  // l'autre.
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function money(item) {
  if (item.price == null) return t('noPrice');
  try {
    return new Intl.NumberFormat(locale(), {
      style: 'currency',
      currency: item.currency || 'EUR',
      maximumFractionDigits: item.price % 1 ? 2 : 0,
    }).format(item.price);
  } catch {
    // Devise illisible sur la page : on montre quand même le nombre.
    return `${item.price} ${item.currency || ''}`.trim();
  }
}

function tile(item) {
  // Le bouton de suppression ne peut pas vivre DANS le lien — un <button> dans
  // un <a> est du HTML invalide, et le clic partirait quand même sur la fiche
  // produit. D'où l'enveloppe : le lien couvre la tuile, la croix est sa voisine.
  const cell = document.createElement('div');
  cell.className = 'cell';

  const a = document.createElement('a');
  a.className = 'link';
  a.href = item.url;
  a.target = '_blank';
  a.rel = 'noreferrer noopener';
  a.title = item.title || '';

  const shot = document.createElement('div');
  shot.className = 'shot';
  if (item.image) {
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    // Une image qui ne charge pas le DIT. Avant, on la retirait en silence : la
    // tuile devenait grise sans qu'on sache si l'extraction avait échoué, si
    // l'URL était mauvaise, ou si l'hébergeur refusait la requête. Trois causes
    // très différentes, un seul symptôme muet — de quoi chercher longtemps.
    img.onerror = () => {
      const why = document.createElement('div');
      why.className = 'broken';
      why.textContent = item.image;
      img.replaceWith(why);
    };
    shot.append(img);
  }

  const info = document.createElement('div');
  info.className = 'info';

  const site = document.createElement('span');
  site.className = 'site';
  site.textContent = item.site || '';

  const price = document.createElement('span');
  price.className = 'price' + (item.price == null ? ' none' : '');
  price.textContent = money(item);

  info.append(site, price);
  a.append(shot, info);

  const del = document.createElement('button');
  del.className = 'del';
  del.type = 'button';
  del.textContent = '×';
  del.title = t('removeItem');
  del.onclick = async () => {
    tock();
    undone.push({ section: 'products', item });
    await removeItem(item.id);
    await refresh();
  };

  cell.append(a, del);
  return cell;
}

/**
 * Une tuile de passage : le texte occupe le carré, la ligne du bas garde la
 * forme d'un produit — le domaine à gauche, la date à droite. Rien à afficher en
 * image, donc rien de gris à regarder.
 */
function mediaTile(item) {
  const cell = document.createElement('div');
  cell.className = 'cell';

  const a = document.createElement('a');
  a.className = 'link';
  a.href = item.url;
  a.target = '_blank';
  a.rel = 'noreferrer noopener';
  a.title = item.title || '';

  const shot = document.createElement('div');
  shot.className = 'shot shot-quote';
  const q = document.createElement('div');
  q.className = 'quote';
  q.textContent = item.text;
  shot.append(q);

  const info = document.createElement('div');
  info.className = 'info';
  info.append(
    Object.assign(document.createElement('span'), { className: 'site', textContent: item.site || '' }),
    Object.assign(document.createElement('span'), { className: 'mtitle', textContent: item.title || '' }),
  );

  a.append(shot, info);

  const del = document.createElement('button');
  del.className = 'del';
  del.type = 'button';
  del.textContent = '×';
  del.title = t('removeMedia');
  del.onclick = async () => {
    tock();
    undone.push({ section: 'media', item });
    await removeMedia(item.id);
    await refresh();
  };

  cell.append(a, del);
  return cell;
}

/**
 * Le menu ne liste que les catégories RÉELLEMENT présentes, avec leur nombre.
 * Proposer les vingt catégories du modèle dont dix-huit sont vides, c'est faire
 * cliquer dans le vide. L'ordre canonique de `CATEGORIES` est conservé — un menu
 * qui se réordonne à chaque ajout ne se mémorise pas.
 */
function renderDropdown() {
  const counts = new Map();
  for (const i of items) counts.set(i.category, (counts.get(i.category) || 0) + 1);
  const present = [
    ...CATEGORIES.filter((c) => counts.has(c)),
    ...[...counts.keys()].filter((c) => c && !CATEGORIES.includes(c)),
  ];

  const opt = (value, label, n) => {
    const b = document.createElement('button');
    b.className = 'dd-opt';
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(filter === value));
    b.append(Object.assign(document.createElement('span'), { textContent: label }));
    b.append(Object.assign(document.createElement('span'), { className: 'dd-n', textContent: String(n) }));
    b.onclick = () => {
      tick();
      filter = value;
      closeDropdown();
      render();
    };
    return b;
  };

  const label = (key) => t(`cat.${key}`).toUpperCase();
  ddPanel.replaceChildren(
    opt(null, t('all'), items.length),
    ...present.map((c) => opt(c, label(c), counts.get(c))),
  );
  ddLabel.textContent = filter ? label(filter) : t('all');
}

function openDropdown() {
  ddPanel.hidden = false;
  ddBtn.setAttribute('aria-expanded', 'true');
}

function closeDropdown() {
  ddPanel.hidden = true;
  ddBtn.setAttribute('aria-expanded', 'false');
}

ddBtn.onclick = () => {
  tick();
  ddPanel.hidden ? openDropdown() : closeDropdown();
};

/**
 * Les raccourcis, LUS DANS CHROME et non recopiés à la main.
 *
 * `chrome.commands.getAll()` rend ce qui est RÉELLEMENT attribué. Écrire
 * « ⌥⇧A » en dur mentirait dès que la combinaison est prise par une autre
 * extension — Chrome laisse alors le raccourci vide, sans rien dire, et c'est
 * exactement le genre de silence qui fait chercher longtemps.
 */
const PRETTY = { Command: '⌘', Ctrl: '⌃', MacCtrl: '⌃', Alt: '⌥', Shift: '⇧' };
const prettyCombo = (s) =>
  s
    .split('+')
    .map((k) => PRETTY[k] ?? k)
    .join(' ');

async function renderKeys() {
  let cmds = [];
  try {
    cmds = await chrome.commands.getAll();
  } catch {}
  const rows = cmds.map((c) => {
    const row = document.createElement('div');
    row.className = 'keys-row';
    row.append(
      Object.assign(document.createElement('span'), {
        textContent: t(`cmd.${c.name}`, { defaultValue: c.description || c.name }),
      }),
      Object.assign(document.createElement('span'), {
        className: 'keys-combo' + (c.shortcut ? '' : ' none'),
        textContent: c.shortcut ? prettyCombo(c.shortcut) : t('shortcutUnbound'),
      }),
    );
    return row;
  });

  // Celui-ci n'est pas une commande Chrome mais un raccourci de la page : il ne
  // remonte pas dans `getAll()`, on l'ajoute donc à la main. Le taire le rendrait
  // introuvable.
  const undo = document.createElement('div');
  undo.className = 'keys-row';
  undo.append(
    Object.assign(document.createElement('span'), { textContent: t('undoDelete') }),
    Object.assign(document.createElement('span'), {
      className: 'keys-combo',
      textContent: navigator.platform.startsWith('Mac') ? '⌘ Z' : '⌃ Z',
    }),
  );
  rows.push(undo);

  // Un raccourci se change dans une page interne de Chrome, qu'un lien ordinaire
  // n'a pas le droit d'ouvrir — d'où le passage par `tabs.create`.
  const edit = document.createElement('button');
  edit.className = 'dd-opt keys-edit';
  edit.type = 'button';
  edit.textContent = t('editShortcuts');
  edit.onclick = () => {
    tick();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  };

  keysPanel.replaceChildren(...rows, edit);
}

/**
 * Le sélecteur de langue. Il rejoue TOUT le rendu après le changement — libellés
 * de catégories, titres des boutons, panneau des raccourcis, et le format des
 * montants (`Intl` suit la locale). Ne repeindre que les textes laisserait
 * « 1 729 € » au format français sur une interface anglaise.
 */
function renderLang() {
  langLabel.textContent = lang().toUpperCase();
  langPanel.replaceChildren(
    ...LANGS.map((l) => {
      const b = document.createElement('button');
      b.className = 'dd-opt';
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(l.code === lang()));
      b.append(Object.assign(document.createElement('span'), { textContent: l.label }));
      b.append(
        Object.assign(document.createElement('span'), {
          className: 'dd-n',
          textContent: l.code.toUpperCase(),
        }),
      );
      b.onclick = async () => {
        tick();
        await setLang(l.code);
        closeLang();
        renderLang();
        paintMute();
        render();
        if (!keysPanel.hidden) await renderKeys();
      };
      return b;
    }),
  );
}

function closeLang() {
  langPanel.hidden = true;
  langBtn.setAttribute('aria-expanded', 'false');
}

langBtn.onclick = () => {
  tick();
  const open = langPanel.hidden;
  langPanel.hidden = !open;
  langBtn.setAttribute('aria-expanded', String(open));
};

/**
 * Le sélecteur de section. Le filtre de catégories n'a de sens que sur les
 * produits — les passages n'en ont pas — on le masque plutôt que de le laisser
 * proposer un choix sans effet.
 */
const SECTIONS = [
  { key: 'products', label: () => t('sectionProducts') },
  { key: 'media', label: () => t('sectionMedia') },
];

function renderSection() {
  sectionLabel.textContent = SECTIONS.find((x) => x.key === section).label();
  catsBox.hidden = section !== 'products';
  sectionPanel.replaceChildren(
    ...SECTIONS.map((x) => {
      const b = document.createElement('button');
      b.className = 'dd-opt';
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(x.key === section));
      b.append(Object.assign(document.createElement('span'), { textContent: x.label() }));
      b.append(
        Object.assign(document.createElement('span'), {
          className: 'dd-n',
          // Le compteur suit la recherche : c'est ainsi qu'on voit qu'il y a des
          // résultats dans l'AUTRE section sans avoir à y basculer pour vérifier.
          textContent: String((x.key === 'products' ? items : media).filter(matches).length),
        }),
      );
      b.onclick = () => {
        tick();
        section = x.key;
        closeSection();
        render();
      };
      return b;
    }),
  );
}

function closeSection() {
  sectionPanel.hidden = true;
  sectionBtn.setAttribute('aria-expanded', 'false');
}

sectionBtn.onclick = () => {
  tick();
  const open = sectionPanel.hidden;
  sectionPanel.hidden = !open;
  sectionBtn.setAttribute('aria-expanded', String(open));
};

function paintMute() {
  muteBtn.setAttribute('aria-pressed', String(isMuted()));
  muteBtn.title = isMuted() ? t('muteOff') : t('muteOn');
  qInput.placeholder = t('search');
  keysBtn.title = t('shortcuts');
}

muteBtn.onclick = async () => {
  await setMuted(!isMuted());
  paintMute();
  // Le son de confirmation ne se joue qu'en RÉTABLISSANT : il est la preuve que
  // ça remarche. Le jouer en coupant serait absurde.
  if (!isMuted()) flip();
};
keysBtn.onclick = async () => {
  tick();
  if (keysPanel.hidden) {
    // Relu à chaque ouverture : l'utilisateur peut venir de les changer dans
    // l'onglet d'à côté, et un panneau qui affiche l'état d'avant ne sert à rien.
    await renderKeys();
    keysPanel.hidden = false;
    keysBtn.setAttribute('aria-expanded', 'true');
  } else {
    closeKeys();
  }
};

function closeKeys() {
  keysPanel.hidden = true;
  keysBtn.setAttribute('aria-expanded', 'false');
}

// Un panneau ouvert doit pouvoir se refermer sans choisir : clic ailleurs, ou Échap.
document.addEventListener('click', (e) => {
  if (!e.target.closest('#cats')) closeDropdown();
  if (!e.target.closest('#keys')) closeKeys();
  if (!e.target.closest('#lang')) closeLang();
  if (!e.target.closest('#section')) closeSection();
});
document.addEventListener('keydown', async (e) => {
  // ⌘Z sur Mac, ⌃Z ailleurs. Ignoré pendant une saisie : dans le champ de
  // recherche, ⌘Z doit rendre le texte effacé, pas ressusciter un article.
  const typing = e.target instanceof HTMLInputElement || e.target?.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !typing) {
    const last = undone.pop();
    if (!last) return;
    e.preventDefault();
    tick();
    // On revient d'abord dans la section concernée : rendre un article sans le
    // montrer laisserait croire qu'il ne s'est rien passé.
    section = last.section;
    if (last.section === 'media') await putMedia(last.item);
    else await putItem(last.item);
    await refresh();
    return;
  }
  if (e.key !== 'Escape') return;
  closeDropdown();
  closeKeys();
  closeLang();
  closeSection();
});

/**
 * Total en euros de ce qui est AFFICHÉ — il suit donc le filtre de catégorie.
 *
 * On n'additionne que ce qui est réellement en euros : un prix en dollars ou un
 * prix qu'on n'a pas su lire ne peut pas entrer dans une somme en euros. Et on
 * ne le tait pas — le nombre d'articles laissés de côté s'affiche à côté, sinon
 * le total serait faux sans le dire.
 */
function renderTotal(shown) {
  const counted = shown.filter((i) => i.price != null && (!i.currency || i.currency === 'EUR'));
  const sum = counted.reduce((n, i) => n + i.price, 0);
  const out = shown.length - counted.length;
  totalEl.replaceChildren(
    document.createTextNode(
      new Intl.NumberFormat(locale(), {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: sum % 1 ? 2 : 0,
      }).format(sum),
    ),
  );
  if (out > 0) {
    totalEl.append(
      Object.assign(document.createElement('span'), {
        className: 'out',
        textContent: ' ' + t('outOfTotal', { count: out }),
      }),
    );
  }
}

function render() {
  if (section === 'media') {
    const shown = media.filter(matches);
    grid.replaceChildren(...shown.map(mediaTile));
    // Pas de total en euros sur des passages : on compte des éléments.
    totalEl.textContent = String(shown.length);
  } else {
    const shown = items.filter((i) => (!filter || i.category === filter) && matches(i));
    grid.replaceChildren(...shown.map(tile));
    renderDropdown();
    renderTotal(shown);
  }
  renderSection();
}

async function refresh() {
  [items, media] = await Promise.all([allItems(), allMedia()]);
  items.sort((a, b) => b.ts - a.ts);
  // La catégorie filtrée peut avoir disparu (dernier article supprimé) : sans ça
  // on resterait sur une grille vide sans savoir pourquoi.
  if (filter && !items.some((i) => i.category === filter)) filter = null;
  render();
}

// L'ajout se fait depuis le service worker : on suit le stockage pour que la
// page se mette à jour toute seule si elle est déjà ouverte.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') refresh();
  // Les médias sont dans `local` : sans cette écoute, un passage enregistré
  // depuis une autre page n'apparaîtrait qu'au prochain rechargement.
  if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('m:'))) refresh();
});

qInput.oninput = () => {
  query = qInput.value;
  render();
};
// Échap vide le champ : sortir d'une recherche ne doit pas demander de
// sélectionner le texte pour l'effacer.
qInput.onkeydown = (e) => {
  if (e.key !== 'Escape' || !qInput.value) return;
  e.stopPropagation();
  qInput.value = '';
  query = '';
  render();
};

await initI18n();
await loadMute();
paintMute();
renderLang();
// Une seule fois utile, mais idempotente : elle n'écrit que ce qui change.
await migrateLegacyCategories();
await refresh();
