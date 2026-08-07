// Injecté à la demande dans l'onglet actif (activeTab). Aucun état global :
// tout est dans une IIFE, dont la valeur de retour remonte via executeScript().
(() => {
  const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

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
    // Un séparateur suivi de 1-2 chiffres = décimale ; sinon c'est du groupement.
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
    const scope = document.querySelector('[itemtype*="schema.org/Product" i]');
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

  // ---------- 4. Heuristique DOM ----------
  // « 169,99 € » autant que « €169.99 » : le symbole précède ou suit le montant.
  // L'ancienne expression exigeait un caractère de MOT après le symbole (`\b`) : un
  // prix à la française, symbole en dernier et rien derrière, ne matchait donc
  // JAMAIS. Seuls les sites en locale anglaise (« €169.99 ») étaient lus.
  //
  // Le quantificateur du montant est PARESSEUX : sur « 169,99 € 209,99 € », une
  // capture gourmande avalait les deux et parsePrice en tirait un nombre absurde.
  const CUR_RE = '(?:[€$£¥]|\\b(?:CHF|EUR|USD|GBP|CAD|JPY)\\b)';
  const PRICE_RE = new RegExp(`${CUR_RE}\\s?\\d[\\d\\s.,]*|\\d[\\d\\s.,]*?\\s?${CUR_RE}`, 'i');

  // Deux seuils, essayés dans l'ordre. Le premier cherche un packshot ; le
  // second n'existe que pour rattraper les petites vignettes (celle d'un article
  // de panier fait ~200 px de côté et se faisait rejeter comme du décor). Sans
  // ce dégradé, abaisser le seuil unique faisait gagner une icône SVG.
  const BIG_AREA = 45000; // ~212x212
  const SMALL_AREA = 10000; // 100x100

  /**
   * CE QUI N'EST PAS LE CONTENU DE LA PAGE.
   *
   * Landmarks HTML et rôles ARIA, rien d'autre : c'est du standard, pas de la
   * connaissance d'un site. Mesuré sur une fiche Amazon avec panier rempli, le
   * volet panier est un `[role=dialog]` dans un `[role=navigation]` dans un
   * `<header>` — et il s'installe à 12 px du haut, avec son propre `<h1>`
   * (« Sous-total »), son propre prix et sa propre vignette produit.
   *
   * C'est ce panneau qui gagnait : ni la surface ni la position ne pouvaient
   * l'écarter puisqu'il est en haut et qu'il contient un vrai produit. Sa nature,
   * en revanche, le dit sans ambiguïté — c'est de la navigation.
   */
  const CHROME = [
    'header', 'nav', 'footer', 'aside', 'dialog',
    '[role=navigation]', '[role=banner]', '[role=contentinfo]',
    '[role=complementary]', '[role=dialog]', '[aria-modal=true]',
  ].join(',');
  const inChrome = (el) => !!el.closest(CHROME);

  /**
   * La zone de contenu déclarée par la page (`<main>` ou `[role=main]`). Quand
   * elle existe, tout se joue dedans : la fiche Amazon déclare un
   * `[role=main]` dont le volet panier est, par construction, dehors.
   */
  const contentRoot = () => document.querySelector('main, [role=main]') || document.body;

  /**
   * LE PACKSHOT EST EN HAUT DE LA PAGE.
   *
   * « Prendre la plus grande image » ne pouvait pas marcher, et ce n'est pas un
   * réglage à ajuster : c'est le critère qui est faux. Mesuré sur une fiche
   * Amazon, la bannière marketing fait 915 000 px² à 7 643 px du haut, le
   * packshot 460 000 px² à 300 px. Le marketing est PLUS GRAND que le produit,
   * toujours — c'est fait pour.
   *
   * La position verticale, elle, sépare proprement les deux : le produit est en
   * tête de page, le discours commercial en dessous. On ne regarde donc que le
   * haut du document, et on prend la plus grande de CELLES-LÀ.
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
      if (inChrome(img)) continue; // en-tête, volet panier, bandeau…
      const r = img.getBoundingClientRect();
      if (!r.width || !r.height) continue; // caché
      // Coordonnées DOCUMENT, pas fenêtre : l'utilisateur a pu scroller avant
      // d'appuyer sur le raccourci, et le haut de la page reste le haut de la page.
      if (r.top + window.scrollY > maxTop) continue;
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:')) continue;
      // Un SVG est un pictogramme — étoile de notation, badge, logo — et il
      // annonce des dimensions arbitraires, donc une surface énorme. Aucune
      // boutique ne photographie un produit en SVG.
      if (/\.svg(?:[?#]|$)/i.test(src)) continue;
      best = src;
      bestArea = area;
    }
    return abs(best);
  }

  /**
   * LE PRODUIT, PAS LA PAGE — d'où venaient le mauvais prix et la mauvaise photo.
   *
   * Chercher « la plus grande image » et « le premier prix » dans le document
   * entier, c'est accepter tout ce qui entoure le produit : le panier et son
   * sous-total, les bandeaux promotionnels, les articles sponsorisés, le contenu
   * marketing en bas de page — lequel porte des images bien plus grandes que le
   * packshot. Mesuré sur une fiche Amazon : sous-total du PANIER retenu comme
   * prix, bannière publicitaire retenue comme photo.
   *
   * On délimite donc d'abord le bloc produit : le plus petit ancêtre du titre qui
   * contienne aussi une vraie image. En dessous il n'y a que du texte, au-dessus
   * on ressort de la fiche. Le titre est le seul point d'ancrage fiable d'une
   * page produit — il y en a un, et l'image comme le prix vivent avec lui.
   *
   * Aucune connaissance d'un site en particulier ici : rien à maintenir quand une
   * boutique refait son thème, et ça vaut pour la prochaine boutique inconnue.
   */
  /**
   * QUEL <h1> EST LE TITRE DU PRODUIT ?
   *
   * Pas le premier du DOM, pas le plus haut à l'écran — les deux m'ont trompé.
   * Amazon en pose sept : un en-tête d'accessibilité, deux gabarits invisibles,
   * des titres de section, et — panier rempli — celui du volet panier, à 12 px du
   * haut. Aucun critère géométrique ne les sépare.
   *
   * Le signal qui les sépare ne dépend d'aucun site : le <title> du document EST
   * le nom du produit sur une fiche produit. Mesuré sur cette page, le
   * recoupement de vocabulaire entre chaque h1 et le <title> vaut 1,00 pour le
   * titre du produit et 0,00 pour tous les leurres.
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
      if (!r.width || !r.height) continue; // gabarit, jamais affiché
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
   * LE PRODUIT EST LE CONTENEUR QUI TIENT SON TITRE, SON PRIX ET SON IMAGE.
   *
   * Idée de Loïc, et les mesures la confirment. Tout ce que j'avais tenté avant
   * était un critère GLOBAL — la plus grande image, le montant le plus haut, le
   * plus gros corps de texte — et chacun se faisait battre par un élément de la
   * page qui n'était pas le produit : bannière marketing, volet panier, carte de
   * recommandation.
   *
   * Or un bloc produit est un fait de STRUCTURE. Mesuré sur la fiche Amazon, en
   * remontant depuis chaque montant jusqu'au premier ancêtre contenant une image :
   *
   *   div#dp-container   1310x14871   53 images   63 prix   <- toute la page
   *   div#ppd            1274x1947     9 images   40 prix
   *   div#centerCol       463x1947     1 image    30 prix   <- titre = <title>
   *   div.p13n-…faceout   165x411      1 image     1 prix   <- recommandation
   *
   * Ni l'aire ni le nombre d'images ne séparent le produit d'une recommandation :
   * elles ont le même profil. Ce qui les sépare, c'est le TITRE — le seul bloc
   * dont l'en-tête est celui du document. On part donc de là, et on remonte juste
   * assez : au premier ancêtre qui porte un prix, puis au premier qui porte une
   * image. Le produit et ses attributs voyagent ensemble ; le reste de la page ne
   * les suit pas.
   */

  // Un prix BARRÉ est un ancien prix, un prix conseillé, un prix de référence —
  // jamais celui qu'on paie. Il précède souvent le vrai dans le DOM.
  function struckThrough(el) {
    if (el.closest('del, s')) return true;
    return (getComputedStyle(el).textDecorationLine || '').includes('line-through');
  }

  /** Un montant est-il exploitable ici ? Rend {price, currency} ou null. */
  function amountAt(el) {
    if (inChrome(el) || struckThrough(el)) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    let found = null;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3) continue;
      const txt = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!txt || txt.length > 40) continue;
      // « 72,04 €/mois » est une mensualité, pas le prix du produit.
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

  /** La plus grande image de produit portée par cet élément, ou ''. */
  function imageIn(el, minArea) {
    let best = '';
    let bestArea = 0;
    for (const img of el.querySelectorAll('img')) {
      if (inChrome(img)) continue;
      const r = img.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:')) continue;
      // Un SVG est un pictogramme (étoile, badge, logo) et annonce des
      // dimensions arbitraires. Aucune boutique ne photographie en SVG.
      if (/\.svg(?:[?#]|$)/i.test(src)) continue;
      const area = (img.naturalWidth || r.width) * (img.naturalHeight || r.height);
      if (area < minArea || area <= bestArea) continue;
      best = src;
      bestArea = area;
    }
    return abs(best);
  }

  /**
   * LE BLOC PRODUIT : L'IMAGE ET LE PRIX SORTENT DU MÊME ENDROIT.
   *
   * L'ancrage précédent partait du titre. Sur une page PANIER, le titre est
   * l'en-tête « Le montant total de votre panier est de… », qui n'appartient à
   * aucun article : en remontant depuis lui on atteignait le conteneur de tout le
   * panier, d'où sortaient le prix du premier article et l'image du second.
   * Mesuré sur un panier Apple à deux lignes : photo de l'iPhone, prix du
   * MacBook. Une chimère — un produit qui n'existe pas — et c'est pire qu'un
   * champ vide, parce que ça ne se voit pas.
   *
   * On part donc du PRIX, pas du titre, et on remonte jusqu'au premier ancêtre
   * qui porte aussi une image : ce bloc est l'unité. L'image vient de lui. Le
   * mélange devient impossible par construction, pas par vigilance.
   *
   * Quand plusieurs blocs existent (un panier, une liste), on garde les plus
   * INTÉRIEURS — sinon le conteneur qui les englobe tous serait lui-même un
   * candidat — et on prend le premier dans l'ordre du document.
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
    // On ne filtre PLUS les blocs englobants ici. « Garder les plus intérieurs »
    // semblait évident et détruisait le bon : les pastilles de coloris et les
    // cartes de recommandation sont elles aussi des blocs image+prix, et elles
    // sont imbriquées DANS le bloc du produit — qui se faisait donc éliminer.
    // C'est le titre qui tranche, plus bas, pas la profondeur.
    return [...found.keys()].map((el) => ({ el, amounts: found.get(el) }));
  }

  /**
   * LE PRIX D'UN BLOC EST CELUI QUI S'Y RÉPÈTE.
   *
   * « Le premier montant rencontré » a tenu trois fois sur quatre, puis Amazon a
   * inséré une offre d'occasion à 109,99 € avant sa buybox et on est reparti avec
   * elle. Ses modules varient d'une charge à l'autre : aucune règle de position
   * ne survit à ça.
   *
   * Mais une fiche RÉPÈTE son prix — buybox, libellé d'accessibilité, pastille de
   * coloris, encart « autres vendeurs » : 169,99 € apparaît quatre fois sur cette
   * page, l'offre parasite une seule. On prend donc le montant le plus fréquent,
   * et l'ordre du document ne sert plus qu'à départager les ex æquo.
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
   * L'en-tête d'un bloc, et à quel point il recoupe le `<title>` du document.
   *
   * Sur une fiche produit, le `<title>` EST le nom du produit : le recoupement
   * vaut 1,00 pour le bon bloc et 0,00 pour les blocs sponsorisés. Sur une page
   * panier, le `<title>` vaut « Panier » et ne recoupe rien — le score est nul
   * partout, et c'est cette absence qui dit qu'on n'est pas sur une fiche.
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
   * L'image du bloc, en remontant TANT QU'ON NE CROISE PAS UN AUTRE PRODUIT.
   *
   * Sur Amazon, le prix et le packshot vivent dans deux colonnes distinctes : le
   * bloc du prix ne contient qu'une vignette de 100 px, le packshot est un cran
   * au-dessus. Il faut donc pouvoir monter. Mais monter sans borne, c'est
   * retomber sur la chimère du panier — on s'arrête dès que l'ancêtre engloberait
   * un autre bloc produit.
   */
  function imageFor(rec, records) {
    // Seuls les blocs ÉTRANGERS arrêtent la montée. Un bloc imbriqué (une
    // pastille de coloris) appartient au même produit, il n'a rien à bloquer ;
    // un bloc voisin (l'autre article du panier) est justement le danger.
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
    // Aucun packshot : la vignette du bloc lui-même fera l'affaire (panier).
    return imageIn(rec.el, SMALL_AREA);
  }

  /**
   * Décrit un bloc comme un produit à part entière. Chaque article d'un panier
   * porte un lien vers sa fiche : c'est lui qu'on garde comme URL, sinon les
   * deux articles d'une même page auraient la même adresse — donc le même
   * identifiant — et le second écraserait le premier au stockage.
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
   * LES ARTICLES D'UNE LISTE SONT FRÈRES ; LES RECOMMANDATIONS AUSSI, AILLEURS.
   *
   * Sur une page panier, les articles vivent dans un même conteneur (`<ol>` des
   * lignes de panier) et le bloc « Recommandations pour vous » dans un autre.
   * Rien ne les distingue par la forme : mêmes image, prix et titre. Ce qui les
   * distingue, c'est l'APPARTENANCE — et le fait que le panier vienne avant.
   *
   * On regroupe donc chaque bloc par son plus proche ancêtre qui en contient au
   * moins deux (le conteneur de la liste), et on garde le groupe qui ouvre le
   * document. Les recommandations sont toujours en dessous : elles arrivent
   * après ce qu'on est venu voir.
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
    // `compareDocumentPosition` plutôt qu'une coordonnée : une position en pixels
    // dépend de la mise en page, l'ordre du document non.
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
    if (!records.length) {
      // Aucun bloc image+prix : page sans produit lisible. On rend quand même un
      // titre, les couches supérieures ont pu remplir le reste.
      const h1 = pickH1(contentRoot());
      const title = clean(h1 && h1.textContent) || clean(document.title).split(/\s[|–-]\s/)[0];
      return title ? { title, image: '', brand: '', desc: '', source: 'dom' } : null;
    }

    /**
     * QUEL BLOC EST LE PRODUIT.
     *
     * Sur une FICHE, le `<title>` du document est le nom du produit : le bloc qui
     * le reprend est le bon, et les cartes sponsorisées ne le reprennent pas. On
     * garde alors le plus PETIT des blocs qui le reprennent — les ancêtres le
     * reprennent aussi, et le plus petit est celui qui serre le produit au plus
     * près.
     *
     * Sur un PANIER, le `<title>` vaut « Panier » et personne ne le reprend. Ce
     * score nul partout est le signal qu'on n'est pas sur une fiche : on prend
     * alors le premier article, c'est-à-dire le bloc le plus intérieur qui vient
     * en tête du document.
     */
    const docWords = wordsOf(document.title);
    const scored = records.map((r) => ({ ...r, head: headingOf(r.el, docWords) }));
    const top = scored.reduce((a, b) => (b.head.score > a.head.score ? b : a), scored[0]);

    /**
     * L'IMAGE ET LE PRIX NE VEULENT PAS LA MÊME LARGEUR.
     *
     * Le bloc le plus SERRÉ autour du titre est le bon point de départ pour
     * l'image — au-delà on ramasse la bannière marketing. Mais sur Amazon la
     * buybox vit dans une AUTRE COLONNE que le titre : le prix payé est hors de
     * ce bloc, et il n'y restait que le prix conseillé (179,99 € au lieu de
     * 169,99 €).
     *
     * On dissocie donc : le bloc serré ancre l'image et le titre, et le prix se
     * compte sur toute la RÉGION du produit — le plus grand bloc qui reprend
     * encore le titre. Élargir ne dilue pas : les prix des recommandations sont
     * tous différents, seul celui du produit se répète.
     */
    // Seuil, et pas « strictement positif » : sur un panier Apple, l'en-tête
    // « Le montant total de votre Panier est de 118,00 € » partage UN mot avec le
    // `<title>` (« Panier »), soit 0,17 — assez pour gagner, et on repartait avec
    // le total du panier. On exige donc que la MOITIÉ des mots de l'en-tête
    // viennent du titre du document : 1,00 sur une fiche produit, 0,17 ici.
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
      // Page de type LISTE (un panier) : chaque bloc est un produit complet.
      // Mais une page panier porte AUSSI un bloc « Recommandations pour vous »,
      // dont les cartes ont exactement la même forme — on en avait enregistré
      // cinq au lieu de deux. On ne garde donc qu'un seul GROUPE (cf. `groupOf`).
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

  // ---------- URL canonique, sans tracking ----------
  const STRIP = /^(utm_|gclid|fbclid|msclkid|mc_|_ga|ref|ref_|tag|source|spm|cm_|psc|th|smid|linkCode|creative|camp)/i;
  function canonical() {
    const raw = meta('link[rel="canonical"]', 'href') || meta('meta[property="og:url"]') || location.href;
    try {
      const u = new URL(raw, location.href);
      for (const k of [...u.searchParams.keys()]) if (STRIP.test(k)) u.searchParams.delete(k);
      u.hash = '';
      return u.href;
    } catch {
      return location.href;
    }
  }

  // ---------- Fusion : on part du plus fiable et on complète ----------
  const layers = [fromJsonLd(), fromMicrodata(), fromMeta(), fromDom()].filter(Boolean);
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
  // La fusion ne connaît que les champs d'un produit unique : la liste des
  // articles d'une page-panier se rattache à part, sinon elle serait perdue.
  const domLayer = layers.find((l) => l.source === 'dom');
  if (domLayer?.products?.length > 1) out.products = domLayer.products;
  if (!out.title) return null;
  // Forme de sortie stable, même quand une couche n'a rien donné.
  for (const k of ['image', 'brand', 'desc', 'currency']) out[k] = out[k] || '';
  out.price = typeof out.price === 'number' ? out.price : null;
  if (!out.currency && out.price != null) out.currency = sniffCurrency(document.body.innerText.slice(0, 4000));
  return out;
})();
