// Injected on demand into the active tab (activeTab). No global state: everything
// lives in an IIFE, whose return value travels back through executeScript().
(() => {
  const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

  /**
   * A PICKED BLOCK NARROWS EVERYTHING BELOW.
   *
   * `pick.js` leaves the element the user pointed at here, in this extension's
   * isolated world, which both injections share. When it is set, no guessing is
   * left to do: the human already said which of the forty cards they meant.
   *
   * Read ONCE and cleared immediately. A scope left behind would silently narrow
   * the next ordinary save, and nothing on screen would explain why the wrong
   * product came out.
   */
  const PICKED = (() => {
    const el = window.__theListPicked;
    delete window.__theListPicked;
    // `nodeType === 1` and not `instanceof Element`: a node coming from an iframe
    // belongs to another realm and fails the `instanceof` of this one, which would
    // silently drop the pick. It also keeps this readable by the offline suite,
    // whose DOM has no `Element` global.
    return el && el.nodeType === 1 && el.isConnected ? el : null;
  })();

  const abs = (u) => {
    if (!u || typeof u !== 'string') return '';
    try {
      const h = new URL(u, location.href);
      return h.protocol === 'http:' || h.protocol === 'https:' ? h.href : '';
    } catch {
      return '';
    }
  };

  // "1 299,00 €" -> 1299   "$1,299.00" -> 1299   "19,99" -> 19.99
  const parsePrice = (raw) => {
    if (raw == null) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
    const s = String(raw).replace(/[^\d.,]/g, '');
    if (!/\d/.test(s)) return null;
    const i = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    // A separator followed by 1-2 digits is a decimal point; otherwise grouping.
    const out =
      i >= 0 && /^\d{1,2}$/.test(s.slice(i + 1))
        ? s.slice(0, i).replace(/[.,]/g, '') + '.' + s.slice(i + 1)
        : s.replace(/[.,]/g, '');
    const n = parseFloat(out);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const CUR = { '€': 'EUR', $: 'USD', '£': 'GBP', '¥': 'JPY', 'CHF': 'CHF', 'chf': 'CHF' };
  const sniffCurrency = (raw) => {
    const s = String(raw || '');
    for (const k of Object.keys(CUR)) if (s.includes(k)) return CUR[k];
    const iso = s.match(/\b(EUR|USD|GBP|CHF|CAD|JPY|SEK|DKK|NOK|PLN|AUD)\b/i);
    return iso ? iso[1].toUpperCase() : '';
  };

  const meta = (sel, attr = 'content') => {
    const el = document.querySelector(sel);
    return el ? clean(el.getAttribute(attr)) : '';
  };

  const metaAny = (...sels) => {
    for (const s of sels) {
      const v = meta(s);
      if (v) return v;
    }
    return '';
  };

  // ---------- 1. JSON-LD schema.org/Product ----------
  function* walk(node, depth = 0) {
    if (depth > 6 || !node) return;
    if (Array.isArray(node)) {
      for (const n of node) yield* walk(n, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    yield node;
    for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item', 'about', 'hasVariant']) {
      if (node[k]) yield* walk(node[k], depth + 1);
    }
  }

  const isType = (node, want) =>
    []
      .concat(node['@type'] || [])
      .some((t) => String(t).toLowerCase() === want);

  const firstImage = (img, depth = 0) => {
    if (!img || depth > 3) return '';
    if (typeof img === 'string') return abs(img);
    if (Array.isArray(img)) {
      for (const i of img) {
        const v = firstImage(i, depth + 1);
        if (v) return v;
      }
      return '';
    }
    if (typeof img === 'object') return firstImage(img.url || img.contentUrl || img['@id'], depth + 1);
    return '';
  };

  const fromOffers = (offers, depth = 0) => {
    if (!offers || depth > 3) return {};
    if (Array.isArray(offers)) {
      for (const o of offers) {
        const v = fromOffers(o, depth + 1);
        if (v.price != null) return v;
      }
      return {};
    }
    if (typeof offers !== 'object') return {};
    const spec = offers.priceSpecification;
    const price =
      parsePrice(offers.price) ??
      parsePrice(offers.lowPrice) ??
      parsePrice(spec && (Array.isArray(spec) ? spec[0]?.price : spec.price));
    const currency =
      clean(offers.priceCurrency) ||
      clean(spec && (Array.isArray(spec) ? spec[0]?.priceCurrency : spec.priceCurrency));
    return price != null ? { price, currency: currency.toUpperCase() } : {};
  };

  function fromJsonLd() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(script.textContent.trim());
      } catch {
        continue;
      }
      for (const node of walk(data)) {
        if (!isType(node, 'product')) continue;
        const title = clean(node.name);
        if (!title) continue;
        const brandRaw = node.brand;
        return {
          title,
          image: firstImage(node.image),
          brand: clean(typeof brandRaw === 'object' ? brandRaw?.name : brandRaw),
          desc: clean(node.description).slice(0, 300),
          ...fromOffers(node.offers),
          source: 'json-ld',
        };
      }
    }
    return null;
  }

  // ---------- 2. OpenGraph / Twitter ----------
  function fromMeta() {
    const title = metaAny(
      'meta[property="og:title"]',
      'meta[name="og:title"]',
      'meta[name="twitter:title"]'
    );
    if (!title) return null;
    const priceRaw = metaAny(
      'meta[property="product:price:amount"]',
      'meta[property="og:price:amount"]',
      'meta[name="twitter:data1"]',
      'meta[itemprop="price"]'
    );
    const curRaw = metaAny(
      'meta[property="product:price:currency"]',
      'meta[property="og:price:currency"]',
      'meta[itemprop="priceCurrency"]'
    );
    return {
      title,
      image: abs(
        metaAny('meta[property="og:image:secure_url"]', 'meta[property="og:image"]', 'meta[name="twitter:image"]')
      ),
      brand: metaAny('meta[property="og:site_name"]', 'meta[property="product:brand"]'),
      desc: metaAny('meta[property="og:description"]', 'meta[name="description"]').slice(0, 300),
      price: parsePrice(priceRaw),
      currency: (clean(curRaw) || sniffCurrency(priceRaw)).toUpperCase(),
      source: 'opengraph',
    };
  }

  // ---------- 3. Microdata ----------
  function fromMicrodata() {
    // Scoped to the picked block, and it may BE the block: a listing that marks up
    // each card individually then gives an exact title and price, which beats
    // anything read off the layout.
    const SEL = '[itemtype*="schema.org/Product" i]';
    const scope = (PICKED?.matches(SEL) && PICKED) || (PICKED ?? document).querySelector(SEL);
    if (!scope) return null;
    const prop = (name) => scope.querySelector(`[itemprop="${name}" i]`);
    const val = (el) => (el ? clean(el.getAttribute('content') || el.getAttribute('src') || el.textContent) : '');
    const title = val(prop('name'));
    if (!title) return null;
    return {
      title,
      image: abs(val(prop('image'))),
      brand: val(prop('brand')),
      desc: val(prop('description')).slice(0, 300),
      price: parsePrice(val(prop('price')) || val(prop('lowPrice'))),
      currency: clean(val(prop('priceCurrency'))).toUpperCase(),
      source: 'microdata',
    };
  }

  // ---------- 4. DOM heuristics ----------
  // "169,99 €" as much as "€169.99": the symbol comes before or after the amount.
  // The previous expression required a WORD character after the symbol (`\b`), so a
  // French-style price — symbol last, nothing behind it — NEVER matched. Only shops
  // in an English locale ("€169.99") were being read.
  //
  // The amount's quantifier is LAZY: on "169,99 € 209,99 €" a greedy capture
  // swallowed both and parsePrice pulled an absurd number out of it.
  const CUR_RE = '(?:[€$£¥]|\\b(?:CHF|EUR|USD|GBP|CAD|JPY)\\b)';
  const PRICE_RE = new RegExp(`${CUR_RE}\\s?\\d[\\d\\s.,]*|\\d[\\d\\s.,]*?\\s?${CUR_RE}`, 'i');
  const ONLY_MONEY = new RegExp(`^(?:${CUR_RE})?[\\s\\d.,]+(?:${CUR_RE})?$`, 'i');

  /** The rendered lines of a block, minus the ones that are only an amount. */
  const cardText = (el) =>
    (el.innerText || '')
      .split('\n')
      .map(clean)
      .filter((l) => l && !ONLY_MONEY.test(l))
      .join(' ')
      .slice(0, 140);

  /**
   * A CARD WITH NO HEADING STILL HAS LINES.
   *
   * Measured on END's grid: its cards carry no `h1`–`h3` and no `aria-label`, so
   * the name had to come from the card's own text — and `textContent` glues block
   * elements together with nothing between them: "…Vacation ShirtBlack &
   * Beige£125".
   *
   * `innerText` is the difference: it is what is RENDERED, so each block becomes
   * its own line. Lines that are nothing but an amount are dropped — the price
   * already has a field of its own — and the rest reads as the product's name.
   */
  // Two thresholds, tried in order. The first looks for a packshot; the second
  // only exists to catch small thumbnails (a basket line's image is around 200 px
  // a side and was being rejected as decoration). Without that gradation, lowering
  // a single threshold let an SVG icon win.
  const BIG_AREA = 45000; // ~212x212
  const SMALL_AREA = 10000; // 100x100

  /**
   * WHAT IS NOT THE PAGE'S CONTENT.
   *
   * HTML landmarks and ARIA roles, nothing else: that is standard, not knowledge
   * of a site. Measured on an Amazon product page with a filled basket, the basket
   * flyout is a `[role=dialog]` inside a `[role=navigation]` inside a `<header>` —
   * and it settles 12 px from the top, with its own `<h1>` ("Sous-total"), its own
   * price and its own product thumbnail.
   *
   * That panel was winning: neither area nor position could rule it out, since it
   * sits at the top and does contain a real product. Its NATURE, on the other hand,
   * says so unambiguously — it is navigation.
   */
  const CHROME = [
    'header', 'nav', 'footer', 'aside', 'dialog',
    '[role=navigation]', '[role=banner]', '[role=contentinfo]',
    '[role=complementary]', '[role=dialog]', '[aria-modal=true]',
  ].join(',');
  // Pointing at a block outranks any landmark: a grid of results can perfectly
  // well live inside an <aside>, and refusing to read it because of that would be
  // overruling the only unambiguous signal on the page. So when something is
  // picked, "not the content" simply means "outside the picked block".
  const inChrome = (el) => (PICKED ? !PICKED.contains(el) : !!el.closest(CHROME));

  /**
   * The content area the page declares (`<main>` or `[role=main]`). When it exists
   * everything happens inside it: the Amazon product page declares a `[role=main]`
   * that the basket flyout is, by construction, outside of.
   */
  const contentRoot = () => PICKED || document.querySelector('main, [role=main]') || document.body;

  /**
   * THE PACKSHOT IS AT THE TOP OF THE PAGE.
   *
   * "Take the biggest image" could not work, and it is not a threshold to tune:
   * the criterion itself is wrong. Measured on an Amazon product page, the
   * marketing banner is 915,000 px² at 7,643 px from the top, the packshot
   * 460,000 px² at 300 px. Marketing is BIGGER than the product, always — that is
   * what it is for.
   *
   * Vertical position, on the other hand, separates the two cleanly: the product
   * heads the page, the sales pitch sits below. So we only look at the top of the
   * document, and take the biggest among THOSE.
   */
  const foldLimit = () => Math.max(1.2 * (window.innerHeight || 800), 1000);

  function biggestImage(root, maxTop = Infinity, minArea = BIG_AREA) {
    let best = null;
    let bestArea = minArea;
    for (const img of root.querySelectorAll('img')) {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const area = w * h;
      if (!area || area <= bestArea) continue;
      if (inChrome(img)) continue; // header, basket flyout, banner…
      const r = img.getBoundingClientRect();
      if (!r.width || !r.height) continue; // hidden
      // DOCUMENT coordinates, not viewport: the user may have scrolled before
      // pressing the shortcut, and the top of the page is still the top of the page.
      if (r.top + window.scrollY > maxTop) continue;
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:')) continue;
      // An SVG is a pictogram — a rating star, a badge, a logo — and it declares
      // arbitrary dimensions, hence a huge area. No shop photographs a product in
      // SVG.
      if (/\.svg(?:[?#]|$)/i.test(src)) continue;
      best = src;
      bestArea = area;
    }
    return abs(best);
  }

  /**
   * WHICH <h1> IS THE PRODUCT'S TITLE?
   *
   * Not the first in the DOM, not the highest on screen — both fooled me. Amazon
   * puts up seven: a screen-reader heading, two invisible templates, section
   * headings, and — with a filled basket — the flyout's own, 12 px from the top.
   * No geometric criterion separates them.
   *
   * The signal that does depends on no site at all: on a product page the
   * document's <title> IS the product's name. Measured on that page, the vocabulary
   * overlap between each h1 and the <title> is 1.00 for the product's title and
   * 0.00 for every decoy.
   */
  const wordsOf = (s) =>
    new Set(
      (s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 2),
    );

  function pickH1(root) {
    const docWords = wordsOf(document.title);
    let best = null;
    let bestScore = -1;
    let bestTop = Infinity;
    for (const el of root.querySelectorAll('h1')) {
      if (inChrome(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue; // a template, never displayed
      const w = wordsOf(el.textContent);
      const overlap = w.size ? [...w].filter((x) => docWords.has(x)).length / w.size : 0;
      const top = r.top + window.scrollY;
      if (overlap > bestScore || (overlap === bestScore && top < bestTop)) {
        best = el;
        bestScore = overlap;
        bestTop = top;
      }
    }
    return best || [...document.querySelectorAll('h1')].find((el) => !inChrome(el)) || null;
  }

  /**
   * A PRODUCT IS THE CONTAINER THAT HOLDS ITS TITLE, ITS PRICE AND ITS IMAGE.
   *
   * Loïc's idea, and the measurements bear it out. Everything I had tried before
   * was a GLOBAL criterion — the biggest image, the topmost amount, the largest
   * body of text — and each was beaten by something on the page that was not the
   * product: a marketing banner, the basket flyout, a recommendation card.
   *
   * A product block, though, is a fact of STRUCTURE. Measured on the Amazon page,
   * climbing from each amount to the first ancestor containing an image:
   *
   *   div#dp-container   1310x14871   53 images   63 prices  <- the whole page
   *   div#ppd            1274x1947     9 images   40 prices
   *   div#centerCol       463x1947     1 image    30 prices  <- heading = <title>
   *   div.p13n-…faceout   165x411      1 image     1 price   <- recommendation
   *
   * Neither area nor image count separates the product from a recommendation: they
   * have the same profile. What separates them is the TITLE — the only block whose
   * heading is the document's. So we start there and climb just enough: to the
   * first ancestor carrying a price, then to the first carrying an image. A product
   * and its attributes travel together; the rest of the page does not follow.
   */

  // A STRUCK-THROUGH price is a former price, a list price, a reference price —
  // never the one you pay. It often precedes the real one in the DOM.
  function struckThrough(el) {
    if (el.closest('del, s')) return true;
    return (getComputedStyle(el).textDecorationLine || '').includes('line-through');
  }

  /** Is there a usable amount here? Returns {price, currency} or null. */
  function amountAt(el) {
    if (inChrome(el) || struckThrough(el)) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    let found = null;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3) continue;
      const txt = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 40) continue;
      // "72,04 €/mois" is a monthly instalment, not the product's price.
      if (PER_PERIOD.test(txt)) continue;
      const m = txt.match(PRICE_RE);
      if (!m) continue;
      const price = parsePrice(m[0]);
      if (price == null) continue;
      found = { price, currency: sniffCurrency(m[0]) };
      break;
    }
    return found;
  }
  const PER_PERIOD = /\/\s*(?:mois|month|mo|an|year|yr)\b|par\s+mois|per\s+month/i;

  /** The largest product image carried by this element, or ''. */
  function imageIn(el, minArea) {
    let best = '';
    let bestArea = 0;
    for (const img of el.querySelectorAll('img')) {
      if (inChrome(img)) continue;
      const r = img.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:')) continue;
      // An SVG is a pictogram (star, badge, logo) and declares arbitrary
      // dimensions. No shop photographs in SVG.
      if (/\.svg(?:[?#]|$)/i.test(src)) continue;
      const area = (img.naturalWidth || r.width) * (img.naturalHeight || r.height);
      if (area < minArea || area <= bestArea) continue;
      best = src;
      bestArea = area;
    }
    return abs(best);
  }

  /**
   * THE PRODUCT BLOCK: THE IMAGE AND THE PRICE COME OUT OF THE SAME PLACE.
   *
   * The previous anchor started from the title. On a BASKET page the title is the
   * heading "Le montant total de votre panier est de…", which belongs to no line
   * item: climbing from it reached the container of the whole basket, out of which
   * came the first item's price and the second item's image. Measured on a
   * two-line Apple bag: the iPhone's photo, the MacBook's price. A chimera — a
   * product that does not exist — and that is worse than an empty field, because
   * it does not show.
   *
   * So we start from the PRICE, not the title, and climb to the first ancestor that
   * also carries an image: that block is the unit. The image comes from it. Mixing
   * becomes impossible by construction, not by vigilance.
   *
   * When several blocks exist (a basket, a list), we keep the INNERMOST ones —
   * otherwise the container enclosing them all would be a candidate itself — and
   * take the first in document order.
   */
  function productRecords() {
    const found = new Map();
    for (const el of contentRoot().querySelectorAll('*')) {
      const money = amountAt(el);
      if (!money) continue;
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (!imageIn(n, SMALL_AREA)) continue;
        if (!found.has(n)) found.set(n, []);
        found.get(n).push(money);
        break;
      }
    }
    // Enclosing blocks are NO LONGER filtered out here. "Keep the innermost"
    // seemed obvious and destroyed the right one: colour swatches and
    // recommendation cards are image+price blocks too, and they are nested INSIDE
    // the product's block — which therefore got eliminated. It is the title that
    // decides, further down, not depth.
    return [...found.keys()].map((el) => ({ el, amounts: found.get(el) }));
  }

  /**
   * A BLOCK'S PRICE IS THE ONE THAT REPEATS INSIDE IT.
   *
   * "The first amount encountered" held three runs out of four, then Amazon
   * inserted a used offer at 109,99 € before its buybox and we walked away with
   * that. Its modules vary from one load to the next: no positional rule survives
   * that.
   *
   * But a product page REPEATS its price — buybox, screen-reader label, colour
   * swatch, "other sellers" panel: 169,99 € appears four times on that page, the
   * parasitic offer only once. So we take the most frequent amount, and document
   * order now only breaks ties.
   */
  function pickAmount(list) {
    const tally = new Map();
    for (const m of list) {
      const k = `${m.price}|${m.currency}`;
      if (!tally.has(k)) tally.set(k, { money: m, n: 0 });
      tally.get(k).n++;
    }
    let best = null;
    for (const v of tally.values()) if (!best || v.n > best.n) best = v;
    return best.money;
  }

  /**
   * A block's heading, and how far it overlaps the document's `<title>`.
   *
   * On a product page the `<title>` IS the product's name: the overlap is 1.00 for
   * the right block and 0.00 for sponsored ones. On a basket page the `<title>` is
   * "Panier" and overlaps nothing — the score is zero everywhere, and it is that
   * absence which says we are not on a product page.
   */
  function headingOf(el, docWords) {
    const heads = [...el.querySelectorAll('h1,h2,h3,[role=heading]')].filter((h) => {
      const r = h.getBoundingClientRect();
      return r.width && r.height && !inChrome(h);
    });
    let best = null;
    let score = 0;
    for (const h of heads) {
      const w = wordsOf(h.textContent);
      const overlap = w.size ? [...w].filter((x) => docWords.has(x)).length / w.size : 0;
      if (overlap > score) {
        best = h;
        score = overlap;
      }
    }
    return { text: clean((best ?? heads[0])?.textContent), score };
  }

  /**
   * The block's image, climbing AS LONG AS WE DO NOT CROSS ANOTHER PRODUCT.
   *
   * On Amazon the price and the packshot live in two separate columns: the price's
   * block only holds a 100 px thumbnail, the packshot is one level up. So climbing
   * has to be possible. But climbing without a bound lands back on the basket's
   * chimera — we stop as soon as the ancestor would enclose another product block.
   */
  function imageFor(rec, records) {
    // Only FOREIGN blocks stop the climb. A nested block (a colour swatch) belongs
    // to the same product and has nothing to block; a sibling block (the basket's
    // other line) is precisely the danger.
    const others = records
      .filter((r) => r.el !== rec.el && !rec.el.contains(r.el) && !r.el.contains(rec.el))
      .map((r) => r.el);
    let n = rec.el;
    while (n && n !== document.body) {
      const img = imageIn(n, BIG_AREA);
      if (img) return img;
      const up = n.parentElement;
      if (!up || up === document.body || others.some((o) => up.contains(o))) break;
      n = up;
    }
    // No packshot: the block's own thumbnail will do (basket).
    return imageIn(rec.el, SMALL_AREA);
  }

  /**
   * Describes a block as a product in its own right. Every basket line carries a
   * link to its own page: that is what we keep as the URL, otherwise two items from
   * the same page would share an address — hence an identifier — and the second
   * would overwrite the first in storage.
   */
  function recordProduct(r, records, docWords) {
    const money = pickAmount(r.amounts);
    const head = r.head ?? headingOf(r.el, docWords);
    const link = [...r.el.querySelectorAll('a[href]')]
      .map((a) => abs(a.getAttribute('href')))
      .find((h) => h && !h.endsWith('#'));
    return {
      title: head.text,
      image: imageFor(r, records),
      price: money.price,
      currency: money.currency,
      url: link || canonical(),
    };
  }

  /**
   * A LIST'S ITEMS ARE SIBLINGS; SO ARE THE RECOMMENDATIONS, ELSEWHERE.
   *
   * On a basket page the line items live in one container (the `<ol>` of basket
   * rows) and the "Recommendations for you" block in another. Nothing tells them
   * apart by shape: same image, price and title. What tells them apart is
   * MEMBERSHIP — and the fact that the basket comes first.
   *
   * So each block is grouped by its nearest ancestor containing at least two of
   * them (the list's container), and we keep the group that opens the document.
   * Recommendations are always below: they come after what you came to see.
   */
  function firstGroup(recs) {
    if (recs.length < 2) return recs;
    const key = (r) => {
      for (let n = r.el.parentElement; n && n !== document.body; n = n.parentElement) {
        if (recs.filter((o) => n.contains(o.el)).length >= 2) return n;
      }
      return document.body;
    };
    const groups = new Map();
    for (const r of recs) {
      const k = key(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    // `compareDocumentPosition` rather than a coordinate: a pixel position depends
    // on layout, document order does not.
    let first = null;
    for (const [el, list] of groups) {
      if (!first) { first = { el, list }; continue; }
      const after = first.el.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
      if (!after) first = { el, list };
    }
    return first.list;
  }

  function fromDom() {
    const records = productRecords();

    /**
     * A PICKED BLOCK IS EXACTLY ONE PRODUCT.
     *
     * No title match to look for — a search page's `<title>` is "Apple (FR)" and
     * echoes nothing — and no list to build either: the branches below exist to
     * decide something that has already been decided here.
     *
     * The image is taken from INSIDE the block and never by climbing. Climbing is
     * what lets a basket line reach its packshot one level up, but on a grid the
     * level up is the neighbouring card, and that is the chimera all over again.
     * A card carries its own photo; if it does not, we would rather have none.
     */
    if (PICKED) {
      const head = headingOf(PICKED, wordsOf(document.title));
      const money = records.length
        ? pickAmount(records.flatMap((r) => r.amounts))
        : { price: null, currency: '' };
      const title = head.text || clean(PICKED.getAttribute('aria-label')) || cardText(PICKED);
      if (!title) return null;
      return {
        title,
        image: imageIn(PICKED, BIG_AREA) || imageIn(PICKED, SMALL_AREA),
        brand: '',
        desc: '',
        price: money.price,
        currency: money.currency,
        source: 'picked',
      };
    }

    if (!records.length) {
      // No image+price block: a page with no readable product. We still return a
      // title, the upper layers may have filled in the rest.
      const h1 = pickH1(contentRoot());
      const title = clean(h1 && h1.textContent) || clean(document.title).split(/\s[|–-]\s/)[0];
      return title ? { title, image: '', brand: '', desc: '', source: 'dom' } : null;
    }

    /**
     * WHICH BLOCK IS THE PRODUCT.
     *
     * On a PRODUCT PAGE the document's `<title>` is the product's name: the block
     * that echoes it is the right one, and sponsored cards do not echo it. We then
     * keep the SMALLEST of the blocks that do — the ancestors echo it too, and the
     * smallest is the one hugging the product most closely.
     *
     * On a BASKET the `<title>` is "Panier" and nobody echoes it. That
     * zero-everywhere score is the signal that we are not on a product page: we
     * then take the first item, that is, the innermost block coming first in
     * document order.
     */
    const docWords = wordsOf(document.title);
    const scored = records.map((r) => ({ ...r, head: headingOf(r.el, docWords) }));
    const top = scored.reduce((a, b) => (b.head.score > a.head.score ? b : a), scored[0]);

    /**
     * THE IMAGE AND THE PRICE DO NOT WANT THE SAME WIDTH.
     *
     * The block hugging the title most TIGHTLY is the right starting point for the
     * image — beyond it we pick up the marketing banner. But on Amazon the buybox
     * lives in a DIFFERENT COLUMN from the title: the price actually paid is
     * outside that block, and all that remained inside was the list price
     * (179,99 € instead of 169,99 €).
     *
     * So the two are decoupled: the tight block anchors the image and the title,
     * and the price is counted over the product's whole REGION — the largest block
     * that still echoes the title. Widening does not dilute: the recommendations'
     * prices are all different, only the product's repeats.
     */
    // A threshold, and not "strictly positive": on an Apple bag the heading "Le
    // montant total de votre Panier est de 118,00 €" shares ONE word with the
    // `<title>` ("Panier"), i.e. 0.17 — enough to win, and we walked away with the
    // bag's total. So we require HALF the heading's words to come from the
    // document's title: 1.00 on a product page, 0.17 here.
    const MATCH = 0.5;
    let rec;
    let region;
    let products;
    if (top.head.score >= MATCH) {
      const matched = scored.filter((r) => r.head.score === top.head.score);
      rec = matched.reduce((a, b) => (a.el.contains(b.el) ? b : a));
      region = matched.reduce((a, b) => (b.el.contains(a.el) ? b : a));
      products = null;
    } else {
      const inner = scored.filter((r) => !scored.some((o) => o !== r && r.el.contains(o.el)));
      rec = inner[0] ?? scored[0];
      region = rec;
      // A LIST-shaped page (a basket): every block is a complete product. But a
      // basket page ALSO carries a "Recommendations for you" block whose cards have
      // exactly the same shape — we once saved five items instead of two. So only
      // one GROUP is kept (see `firstGroup`).
      const group = firstGroup(inner);
      products = group.length > 1 ? group.map((r) => recordProduct(r, records, docWords)) : null;
    }
    const money = pickAmount(region.amounts);

    const title =
      rec.head.text ||
      clean(pickH1(contentRoot())?.textContent) ||
      clean(document.title).split(/\s[|–-]\s/)[0];
    if (!title) return null;
    return {
      title,
      image: imageFor(rec, records),
      brand: '',
      desc: meta('meta[name="description"]').slice(0, 300),
      price: money.price,
      currency: money.currency,
      source: 'dom',
      ...(products ? { products } : {}),
    };
  }

  /**
   * WHERE THE MERCHANT FILES THE PRODUCT.
   *
   * A title is a brand and a model code: "Studio Display XDR", "Carhartt WIP
   * Leavel". It almost never contains the name of a category, which is why
   * classifying from it lands things in "other". The merchant, though, says
   * exactly where the product sits — Apple declares `Mac > Moniteurs`, END
   * declares `Mens > Clothing > Shirts` — and says it in a standard place, because
   * search engines demand it.
   *
   * So this is the same discipline as the rest of the file: read what is DECLARED
   * (BreadcrumbList, `product:category`), never a class name, nothing per-site.
   *
   * The product's own name is dropped from the trail: the last crumb is the page
   * itself, and keeping it would just feed the title back in under another name.
   * On a PICKED page that pruning is switched off — a listing is a shelf, not a
   * product, so its last crumb ("Shirts") is precisely the answer.
   */
  const SHELF_NOISE =
    /^(?:home|accueil|shop|boutique|store|index|catalog(?:ue)?|all|tout|sale|soldes|outlet|new in|nouveaut[eé]s?|brands?|marques?|search|recherche|men|mens|women|womens|homme|femme|unisexe?)$/i;

  function declaredShelf(productTitle) {
    const names = [];
    const walk = (n, d = 0) => {
      if (!n || d > 6) return;
      if (Array.isArray(n)) return n.forEach((x) => walk(x, d + 1));
      if (typeof n !== 'object') return;
      if (isType(n, 'breadcrumblist')) {
        for (const it of [].concat(n.itemListElement || [])) {
          const nm = clean(it?.name || it?.item?.name);
          if (nm) names.push(nm);
        }
      }
      if (isType(n, 'product') && n.category) {
        names.push(clean(typeof n.category === 'object' ? n.category?.name : n.category));
      }
      for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item', 'isPartOf']) {
        if (n[k]) walk(n[k], d + 1);
      }
    };
    for (const sc of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        walk(JSON.parse(sc.textContent.trim()));
      } catch {}
    }
    names.push(meta('meta[property="product:category"]'), meta('meta[itemprop="category"]'));

    const titleWords = PICKED ? new Set() : wordsOf(productTitle || document.title);
    return [
      ...new Set(
        names
          .filter(Boolean)
          .filter((n) => !SHELF_NOISE.test(n))
          .filter((n) => {
            // Half the crumb's words already in the product's name means the crumb
            // IS the product. Same measure as `headingOf`, same threshold.
            const w = wordsOf(n);
            if (!w.size || !titleWords.size) return true;
            return [...w].filter((x) => titleWords.has(x)).length / w.size < 0.5;
          }),
      ),
    ]
      .join(' > ')
      .slice(0, 200);
  }

  // ---------- Canonical URL, tracking stripped ----------
  const STRIP = /^(utm_|gclid|fbclid|msclkid|mc_|_ga|ref|ref_|tag|source|spm|cm_|psc|th|smid|linkCode|creative|camp)/i;
  function canonical() {
    // A picked card links to its own product page, and that link is the item's
    // address. The page's canonical URL is the LISTING: every card would share one
    // identifier, so twenty-four saves would overwrite each other down to one item
    // holding whichever card came last.
    const own = PICKED
      ? [...(PICKED.matches('a[href]') ? [PICKED] : []), ...PICKED.querySelectorAll('a[href]')]
          .map((a) => abs(a.getAttribute('href')))
          .find((h) => h && !h.endsWith('#'))
      : '';
    const raw = own || meta('link[rel="canonical"]', 'href') || meta('meta[property="og:url"]') || location.href;
    try {
      const u = new URL(raw, location.href);
      for (const k of [...u.searchParams.keys()]) if (STRIP.test(k)) u.searchParams.delete(k);
      u.hash = '';
      return u.href;
    } catch {
      return location.href;
    }
  }

  // ---------- Merge: start from the most reliable layer and fill in ----------
  // Scoped, the JSON-LD and OpenGraph layers are DROPPED: they describe the page,
  // and on a listing page that means the listing — the exact source of the wrong
  // product. Microdata stays because it is scoped to the block itself.
  const layers = (PICKED
    ? [fromMicrodata(), fromDom()]
    : [fromJsonLd(), fromMicrodata(), fromMeta(), fromDom()]
  ).filter(Boolean);
  if (!layers.length) return null;

  const out = { url: canonical(), site: location.hostname.replace(/^www\./, ''), source: '' };
  const sources = [];
  for (const key of ['title', 'image', 'price', 'currency', 'brand', 'desc']) {
    for (const l of layers) {
      const v = l[key];
      if (v !== undefined && v !== null && v !== '') {
        out[key] = v;
        if (!sources.includes(l.source)) sources.push(l.source);
        break;
      }
    }
  }
  out.source = sources.join('+');
  // The merge only knows about a single product's fields: a basket page's list of
  // items is attached separately, otherwise it would be lost.
  const domLayer = layers.find((l) => l.source === 'dom');
  if (domLayer?.products?.length > 1) out.products = domLayer.products;
  if (!out.title) return null;
  // Stored alongside the product, not merely used once: the lexicon gets fixed
  // from time to time, and the pass that re-runs it over the whole list can only
  // do as well as what was kept.
  out.hint = declaredShelf(out.title);
  // A stable output shape, even when a layer gave nothing.
  for (const k of ['image', 'brand', 'desc', 'currency']) out[k] = out[k] || '';
  out.price = typeof out.price === 'number' ? out.price : null;
  if (!out.currency && out.price != null) out.currency = sniffCurrency(document.body.innerText.slice(0, 4000));
  return out;
})();
