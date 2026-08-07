/**
 * The list reduced to what it shows: product images, four per row, full frame.
 *
 * Everything else was stripped out (search, sorting, category filters, OpenRouter
 * settings, export/import). Nothing broke for it: saving, categorising and
 * storage live in the service worker and in store.js, this page only drove them.
 * Whatever proves useful comes back, case by case.
 */
import {
  allItems,
  migrateFromSync,
  migrateLegacyCategories,
  putItem,
  recategorizeIfStale,
  removeItem,
} from './store.js';
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
/** Displayed category, `null` = all of them. */
let filter = null;
/** Displayed section: the products, or what is kept to read. */
let section = 'all';
/** Free-text search, applied to the current section. */
let query = '';

/**
 * THE UNDO STACK.
 *
 * The cross deletes without confirmation — deliberately: a dialog on every
 * removal would be worse than the risk. Deleting without a net is not, though:
 * ⌘Z (⌃Z elsewhere) puts the last removed item back, as many times as needed.
 *
 * In memory only, and that is deliberate: undo repairs a gesture you have just
 * made. Surviving a reload would make it a wastebasket, which is a different
 * object — and we would then have to decide when to empty it.
 */
const undone = [];

/**
 * SEARCH COVERS EVERYTHING THAT IS STORED.
 *
 * A product is found by its title, brand, hostname, price or category — and by
 * that category's LABEL as much as by its key, otherwise typing "meuble" would
 * find nothing while the tile displays exactly that. A passage is found by its
 * text, its title and its hostname.
 *
 * Accents and case are folded on both sides: searching "electronique" has to
 * find "Électronique".
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
    : fold([o.title, o.brand, o.site, o.category, t(`cat.${o.category}`), o.desc, o.price, o.currency].join(' '));
}

/**
 * The text, with search hits wrapped in `<mark>`.
 *
 * This fragment is NEVER built through `innerHTML`: the text comes from
 * third-party pages, and injecting markup into it would expose the page to
 * whatever a merchant wrote in their title.
 *
 * The difficulty lies elsewhere: search is accent-insensitive, so "energie" has
 * to highlight "énergie". Comparing folded strings is not enough — folding
 * changes lengths, and the positions no longer line up. So we build a table
 * mapping each folded character back to its original index.
 */
function foldIndexed(s) {
  let out = '';
  const map = [];
  for (let i = 0; i < s.length; i++) {
    const f = s[i]
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    for (const c of f) {
      out += c;
      map.push(i);
    }
  }
  map.push(s.length); // final bound, for the end index of a word at the tail
  return { out, map };
}

function marked(text) {
  const frag = document.createDocumentFragment();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!text || !words.length) {
    frag.append(document.createTextNode(text ?? ''));
    return frag;
  }

  const { out, map } = foldIndexed(text);
  // Every range to highlight, merged: two overlapping words must not produce two
  // nested marks.
  const spans = [];
  for (const w of words) {
    let at = out.indexOf(w);
    while (at !== -1) {
      spans.push([map[at], map[at + w.length]]);
      at = out.indexOf(w, at + w.length);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [a, b] of spans) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }

  let cursor = 0;
  for (const [a, b] of merged) {
    if (a > cursor) frag.append(document.createTextNode(text.slice(cursor, a)));
    const m = document.createElement('mark');
    m.textContent = text.slice(a, b);
    frag.append(m);
    cursor = b;
  }
  if (cursor < text.length) frag.append(document.createTextNode(text.slice(cursor)));
  return frag;
}

function matches(o) {
  if (!query) return true;
  const hay = haystack(o);
  // Every word must be present, in any order: "chaise amazon" finds the chair on
  // Amazon, not everything containing one OR the other.
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/**
 * The title shown on a tile: TWO WORDS, capped.
 *
 * Merchants write whole sentences — "Mellow Clo Everyday Stretch Nylon
 * TrousersBlack" — and on a line shared with the hostname and the price there is
 * room for nothing else. The first two words are enough to recognise an item you
 * saved yourself.
 *
 * The character cap is a second barrier: two words can be very long. The ellipsis
 * only appears when something was cut — showing it always would suggest a
 * truncated text where there is none.
 */
const TITLE_WORDS = 2;
const TITLE_CHARS = 22;

function shortTitle(s) {
  const full = (s ?? '').trim();
  if (!full) return '';
  const words = full.split(/\s+/);
  let out = words.slice(0, TITLE_WORDS).join(' ');
  let cut = words.length > TITLE_WORDS;
  if (out.length > TITLE_CHARS) {
    out = out.slice(0, TITLE_CHARS).trimEnd();
    cut = true;
  }
  return cut ? `${out}…` : out;
}

/** A span of the given class, whose text carries the search marks. */
function withText(cls, text) {
  const el = document.createElement('span');
  el.className = cls;
  el.append(marked(text));
  return el;
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
    // Currency unreadable on the page: we still show the number.
    return `${item.price} ${item.currency || ''}`.trim();
  }
}

function tile(item) {
  // The delete button cannot live INSIDE the link — a <button> within an <a> is
  // invalid HTML, and the click would navigate to the product page anyway. Hence
  // the wrapper: the link covers the tile, the cross is its sibling.
  const cell = document.createElement('div');
  cell.className = 'cell';

  const a = document.createElement('a');
  a.className = 'link';
  a.href = item.url;
  a.target = '_blank';
  a.rel = 'noreferrer noopener';

  const shot = document.createElement('div');
  shot.className = 'shot';
  if (item.image) {
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    // An image that fails to load SAYS SO. It used to be removed in silence: the
    // tile turned grey with no way to tell whether extraction had failed, the URL
    // was wrong, or the host refused the request. Three very different causes, one
    // mute symptom — enough to search for a long time.
    img.onerror = () => {
      const why = document.createElement('div');
      why.className = 'broken';
      why.textContent = item.image;
      img.replaceWith(why);
    };
    shot.append(img);
  }

  // Everything on one line: hostname left, title centred, price right. Both ends
  // are short and fixed, the title takes what is left — so it is the one that
  // gives way when room runs out.
  const info = document.createElement('div');
  info.className = 'info';
  info.append(
    withText('site', item.site || ''),
    withText('ptitle', shortTitle(item.title)),
    Object.assign(document.createElement('span'), {
      className: 'price' + (item.price == null ? ' none' : ''),
      textContent: money(item),
    }),
  );
  a.append(shot, info);

  const del = document.createElement('button');
  del.className = 'del';
  del.type = 'button';
  del.textContent = '×';
  // `aria-label` rather than `title`: the native tooltip is a grey box that pops
  // up over the neighbouring tile a second after the cursor stops, and the cross
  // needs no caption to be understood. The label is still owed to screen readers,
  // which would otherwise announce the button as "multiplication sign".
  del.setAttribute('aria-label', t('removeItem'));
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
 * A passage tile: the text fills the square, the bottom line keeps a product's
 * shape — hostname left, title centred. No image to show, so nothing grey to
 * look at.
 */
function mediaTile(item) {
  const cell = document.createElement('div');
  cell.className = 'cell';

  const a = document.createElement('a');
  a.className = 'link';
  a.href = item.url;
  a.target = '_blank';
  a.rel = 'noreferrer noopener';

  const shot = document.createElement('div');
  shot.className = 'shot shot-quote';
  const q = document.createElement('div');
  q.className = 'quote';
  q.append(marked(item.text));
  shot.append(q);

  const info = document.createElement('div');
  info.className = 'info';
  info.append(
    withText('site', item.site || ''),
    // No shortening here: with no price to house, a passage's line has room for
    // the whole title — and an article's title is what makes it recognisable, far
    // more than its first two words.
    withText('mtitle', item.title || ''),
  );

  a.append(shot, info);

  const del = document.createElement('button');
  del.className = 'del';
  del.type = 'button';
  del.textContent = '×';
  del.setAttribute('aria-label', t('removeMedia'));
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
 * The menu lists only the categories ACTUALLY present, with their count.
 * Offering the taxonomy's twenty categories when eighteen are empty is offering
 * clicks into the void. The canonical order of `CATEGORIES` is kept — a menu that
 * reorders itself on every save cannot be memorised.
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
 * The shortcuts, READ FROM CHROME rather than copied out by hand.
 *
 * `chrome.commands.getAll()` returns what is ACTUALLY bound. Hard-coding "⌥⇧A"
 * would lie the moment another extension claims the combination — Chrome then
 * leaves the shortcut empty, without a word, and that is exactly the kind of
 * silence that makes you search for a long time.
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

  // This one is not a Chrome command but a shortcut of the page: it does not come
  // back from `getAll()`, so it is added by hand. Leaving it out would make it
  // undiscoverable.
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

  // A shortcut is changed on a Chrome-internal page, which an ordinary link is
  // not allowed to open — hence going through `tabs.create`.
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
 * The language picker. It replays the WHOLE render after a change — category
 * labels, button titles, shortcuts panel, and amount formatting (`Intl` follows
 * the locale). Repainting only the copy would leave "1 729 €" in French format on
 * an English interface.
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
 * The section picker. The category filter only makes sense on products —
 * passages have none — so it is hidden rather than left offering a choice with
 * no effect.
 */
const SECTIONS = [
  { key: 'all', label: () => t('all') },
  { key: 'products', label: () => t('sectionProducts') },
  { key: 'media', label: () => t('sectionMedia') },
];

/** What a section holds, already filtered by the search. Sorted by date: mixed
 *  together, products and passages read in the order they arrived, not as two
 *  separate piles. */
function contentOf(key) {
  const list = key === 'products' ? items : key === 'media' ? media : [...items, ...media];
  return list.filter(matches).sort((a, b) => b.ts - a.ts);
}

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
          // The counter follows the search: that is how you see there are hits
          // in ANOTHER section without having to switch to it.
          textContent: String(contentOf(x.key).length),
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
  muteBtn.setAttribute('aria-label', isMuted() ? t('muteOff') : t('muteOn'));
  qInput.placeholder = t('search');
  keysBtn.setAttribute('aria-label', t('shortcuts'));
}

muteBtn.onclick = async () => {
  await setMuted(!isMuted());
  paintMute();
  // The confirmation sound only plays when UNMUTING: it is the proof that sound
  // works again. Playing it while muting would be absurd.
  if (!isMuted()) flip();
};
keysBtn.onclick = async () => {
  tick();
  if (keysPanel.hidden) {
    // Re-read on every opening: they may have just been changed in the next tab,
    // and a panel showing the previous state is of no use.
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

// An open panel must be dismissable without choosing: click elsewhere, or Esc.
document.addEventListener('click', (e) => {
  if (!e.target.closest('#cats')) closeDropdown();
  if (!e.target.closest('#keys')) closeKeys();
  if (!e.target.closest('#lang')) closeLang();
  if (!e.target.closest('#section')) closeSection();
});
document.addEventListener('keydown', async (e) => {
  // ⌘Z on Mac, ⌃Z elsewhere. Ignored while typing: in the search field ⌘Z must
  // bring back the erased text, not resurrect an item.
  const typing = e.target instanceof HTMLInputElement || e.target?.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !typing) {
    const last = undone.pop();
    if (!last) return;
    e.preventDefault();
    tick();
    // We switch ONLY if the restored item would be invisible where we are. The
    // ALL section shows everything, and staying in the view you chose beats being
    // moved for nothing.
    if (section !== 'all' && section !== last.section) section = last.section;
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
 * Total in euros of what is DISPLAYED — so it follows the category filter.
 *
 * Only what is actually in euros is summed: a price in dollars, or a price we
 * failed to read, cannot enter a total in euros. And it is not hidden — the
 * number of items left out is shown beside it, otherwise the total would be
 * wrong without saying so.
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
    const shown = contentOf('media');
    grid.replaceChildren(...shown.map(mediaTile));
    // No euro total on passages: we count items.
    totalEl.textContent = String(shown.length);
  } else if (section === 'all') {
    const shown = contentOf('all');
    grid.replaceChildren(...shown.map((o) => (o.kind === 'quote' ? mediaTile(o) : tile(o))));
    // The euro total stays correct: `renderTotal` counts what has no price
    // separately, and a passage has none — so it shows up as "out of total".
    renderTotal(shown);
  } else {
    const shown = contentOf('products').filter((i) => !filter || i.category === filter);
    grid.replaceChildren(...shown.map(tile));
    renderDropdown();
    renderTotal(shown);
  }
  renderSection();
}

async function refresh() {
  [items, media] = await Promise.all([allItems(), allMedia()]);
  items.sort((a, b) => b.ts - a.ts);
  // The filtered category may have vanished (its last item deleted): without this
  // we would sit on an empty grid with no idea why.
  if (filter && !items.some((i) => i.category === filter)) filter = null;
  render();
}

// Saving happens in the service worker: we watch storage so the page updates on
// its own when it is already open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // Products (`i:`) and passages (`m:`) now share `local`. Everything else is
  // ignored — the language key, the mute setting — otherwise muting would repaint
  // the entire grid.
  if (Object.keys(changes).some((k) => k.startsWith('i:') || k.startsWith('m:'))) refresh();
});

qInput.oninput = () => {
  query = qInput.value;
  render();
};
// Esc clears the field: leaving a search should not require selecting the text
// to erase it.
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
// Three maintenance passes, all idempotent, and the order matters: items have to
// be brought back from `sync` before their categories can be corrected, and the
// French labels have to become keys before the lexicon is re-run over them.
await migrateFromSync();
await migrateLegacyCategories();
const recategorised = await recategorizeIfStale();
// Reported rather than done in silence: a pass that rewrites categories under you
// owes you the list of what it changed.
if (recategorised.length) {
  console.info(`[TheList] ${recategorised.length} item(s) re-categorised`, recategorised);
}
await refresh();
