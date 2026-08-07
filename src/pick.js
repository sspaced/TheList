/**
 * PICK MODE: THE HUMAN POINTS, THE READER READS.
 *
 * A search page, a category page, a grid of results — there is no product to
 * find there, there are forty, and they are structurally identical. Measured on
 * Apple's search results for "studio display": extraction reads all 24 cards
 * correctly and `⌥A` saved every one of them, all under the same link, so 24
 * writes collapsed into a single item whose contents were whichever card came
 * last. Worse than a failure, because it looks like a success.
 *
 * No heuristic can choose between forty siblings — the page holds no signal that
 * says which one you meant. So we stop guessing and ask: the pointer designates a
 * block, the click confirms it, and `extract.js` reads THAT block with exactly
 * the rules it already uses. Nothing about any particular site is added.
 *
 * The block is handed over through `window.__theListPicked`, in this extension's
 * isolated world, which the next injection into the same frame shares.
 */
(async () => {
  // A second press LEAVES, rather than stacking a second overlay. The teardown
  // lives on the window because that is the only thing two injections share.
  if (typeof window.__theListPickOff === 'function') {
    window.__theListPickOff();
    return 'off';
  }

  // The copy is asked for, not hard-coded: an injected file cannot receive
  // arguments, and the service worker is the only place that knows the language.
  let hint = 'Click a product · Esc to cancel';
  try {
    const r = await chrome.runtime.sendMessage({ theList: 'pick-copy' });
    if (r?.hint) hint = r.hint;
  } catch {}

  /**
   * THE OUTLINE IS AN APPROXIMATION, AND THAT IS ON PURPOSE.
   *
   * This rule — climb to the nearest ancestor holding both an image and an
   * amount — is `productRecords()` without its refinements: no struck-through
   * prices, no instalments, no landmark exclusions. It only has to be roughly
   * right, because it decides what is OUTLINED, never what is saved. What gets
   * saved comes from `extract.js` reading the chosen element, so there is still
   * one implementation of "what a product is" and no second one to keep in sync.
   */
  const CUR = '(?:[€$£¥]|\\b(?:CHF|EUR|USD|GBP|CAD|JPY)\\b)';
  const PRICE = new RegExp(`${CUR}\\s?\\d|\\d[\\d\\s.,]*\\s?${CUR}`, 'i');
  const MIN_AREA = 10000; // 100x100, same floor as the reader's small threshold

  const hasImage = (el) => {
    for (const img of el.querySelectorAll('img')) {
      // `srcset` counts: a lazily-loaded card carries a `data:` placeholder in
      // `src` and its real variants in `srcset`, and skipping it outlined nothing.
      const src = img.currentSrc || img.getAttribute('srcset') || img.src || '';
      if (!src || src.startsWith('data:') || /\.svg(?:[?#]|$)/i.test(src)) continue;
      const r = img.getBoundingClientRect();
      if (r.width * r.height >= MIN_AREA) return true;
    }
    return false;
  };

  /**
   * How many PACKSHOT-sized images a block holds. One card shows one photo, two
   * if it swaps on hover. A grid holds twenty-four.
   *
   * Counting stops at three: the number itself is of no interest, only whether we
   * have climbed past the card, and this runs on every pointer move.
   */
  const CARD_AREA = 40000; // ~200x200: a packshot, not a gallery thumbnail
  const bigImages = (el) => {
    let n = 0;
    for (const img of el.querySelectorAll('img')) {
      const r = img.getBoundingClientRect();
      if (r.width * r.height >= CARD_AREA && ++n > 2) break;
    }
    return n;
  };

  /**
   * The climb stops at the first block holding an image and an amount — AND
   * refuses it if that block is plainly the whole list.
   *
   * Measured on END's listing: a cookie banner covers the pointer, so the stack
   * below hands us one of the banner's own nodes, whose ancestors are the page
   * root. The climb then "succeeded" on a block containing the twenty-four cards,
   * the filter sidebar and a promo link. Refusing it lets the caller try the next
   * element in the stack, which is the card actually under the cursor.
   */
  const candidate = (from) => {
    for (let n = from; n && n !== document.body; n = n.parentElement) {
      if (!hasImage(n) || !PRICE.test(n.innerText || '')) continue;
      return bigImages(n) > 2 ? null : n;
    }
    return null;
  };

  // Closed shadow DOM, as for the toast: the shop's stylesheet has no business
  // reaching the outline, and ours none reaching the shop.
  const host = document.createElement('div');
  host.id = '__thelist_pick__';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({ mode: 'closed' });

  const box = document.createElement('div');
  // A white halo under the black rule: on a dark packshot a 1 px black outline
  // simply disappears, and the mode then looks broken rather than empty.
  box.style.cssText =
    'position:fixed;border:1px solid #000;box-shadow:0 0 0 1px #fff,0 0 0 2px rgba(0,0,0,.25);display:none';

  const tag = document.createElement('div');
  tag.textContent = hint;
  tag.style.cssText =
    'position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:9px 12px;border:1px solid #000;' +
    'background:#fff;color:#000;font:13px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap';

  root.append(box, tag);
  document.documentElement.append(host);

  const prevCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = 'crosshair';

  let current = null;
  let pending = false;

  function draw() {
    pending = false;
    if (!current || !current.isConnected) {
      box.style.display = 'none';
      return;
    }
    const r = current.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${Math.max(0, r.width - 2)}px`;
    box.style.height = `${Math.max(0, r.height - 2)}px`;
  }

  // Coalesced into a frame: `mousemove` fires far more often than the screen
  // refreshes, and each redraw reads a layout.
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(draw);
  };

  /**
   * `elementsFromPoint`, PLURAL — and that is not a detail.
   *
   * Measured on END's listing: a cookie banner lays a full-viewport filter over
   * the page, so `elementFromPoint` returns the filter, the climb finds no
   * product, and pick mode outlines nothing while looking perfectly alive. Reading
   * the whole stack lets us find the card underneath. Our own host is
   * `pointer-events:none`, so it never appears in that stack.
   */
  const at = (x, y) => {
    for (const el of document.elementsFromPoint(x, y).slice(0, 8)) {
      const hit = candidate(el);
      if (hit) return hit;
    }
    return null;
  };

  let lastX = 0;
  let lastY = 0;

  const onMove = (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
    const next = at(lastX, lastY);
    if (next === current) return;
    current = next;
    schedule();
  };

  // The outline is in viewport coordinates, so scrolling moves the block under it.
  const onScroll = () => schedule();

  /**
   * SWALLOWING THE CLICK, IN CAPTURE, BEFORE THE SHOP SEES IT.
   *
   * Every card in a grid is a link: an unswallowed click navigates and the pick
   * is lost. `pointerdown` and `mousedown` have to go too — plenty of grids
   * navigate on the press rather than the click — and `auxclick` for the middle
   * button, which opens a tab.
   */
  const kill = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  const onClick = (e) => {
    kill(e);
    // Re-resolved at the click rather than trusting `current`: a click can land
    // without a preceding move (a trackpad tap, a synthetic event).
    const el = at(e.clientX, e.clientY) ?? current;
    if (!el) return;
    off();
    window.__theListPicked = el;
    chrome.runtime.sendMessage({ theList: 'picked' }).catch(() => {});
  };

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    kill(e);
    off();
  };

  function off() {
    delete window.__theListPickOff;
    document.documentElement.style.cursor = prevCursor;
    host.remove();
    removeEventListener('mousemove', onMove, true);
    removeEventListener('scroll', onScroll, true);
    removeEventListener('resize', onScroll, true);
    removeEventListener('pointerdown', kill, true);
    removeEventListener('mousedown', kill, true);
    removeEventListener('mouseup', kill, true);
    removeEventListener('click', onClick, true);
    removeEventListener('auxclick', kill, true);
    removeEventListener('contextmenu', onContext, true);
    removeEventListener('keydown', onKey, true);
  }

  // Right-click leaves: it is the reflex for "not that, get out of here".
  const onContext = (e) => {
    kill(e);
    off();
  };

  window.__theListPickOff = off;
  addEventListener('mousemove', onMove, true);
  addEventListener('scroll', onScroll, true);
  addEventListener('resize', onScroll, true);
  addEventListener('pointerdown', kill, true);
  addEventListener('mousedown', kill, true);
  addEventListener('mouseup', kill, true);
  addEventListener('click', onClick, true);
  addEventListener('auxclick', kill, true);
  addEventListener('contextmenu', onContext, true);
  addEventListener('keydown', onKey, true);

  return 'on';
})();
