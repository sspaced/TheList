// Categorisation through OpenRouter, with a local keyword fallback.
// The taxonomy is closed: the model is forced to pick inside it, otherwise the
// categories drift and filtering becomes useless.
//
// CATEGORIES ARE KEYS, NOT LABELS.
//
// They used to be stored in French (`category: 'Meuble'`), so the same string
// served as both the storage key AND the displayed text. Impossible to
// translate: an item filed under "Meuble" would have stayed there forever, and
// re-categorising in English would have created a duplicate "Furniture" beside
// it. So we store a stable identifier (`furniture`) and display goes through i18n.
//
// `LEGACY_LABELS` is not a leftover to clean up: it MIGRATES already-stored items
// (see `migrateLegacyCategories` in store.js) and maps the model's answer — which
// comes back in French — onto the key.

export const CATEGORIES = [
  'fashion',
  'shoes',
  'jewellery',
  'beauty',
  'home',
  'furniture',
  'kitchen',
  'electronics',
  'computing',
  'audio',
  'photo',
  'sport',
  'outdoor',
  'games',
  'books',
  'kids',
  'pets',
  'diy',
  'auto',
  'food',
  'health',
  'other',
];

/** Original French label → key. Both a migration and a normalisation table. */
export const LEGACY_LABELS = {
  Mode: 'fashion',
  Chaussures: 'shoes',
  'Bijoux & Montres': 'jewellery',
  'Beauté': 'beauty',
  Maison: 'home',
  Meuble: 'furniture',
  Cuisine: 'kitchen',
  'Électronique': 'electronics',
  Informatique: 'computing',
  Audio: 'audio',
  Photo: 'photo',
  Sport: 'sport',
  Outdoor: 'outdoor',
  Jeux: 'games',
  Livres: 'books',
  'Bébé & Enfant': 'kids',
  Animaux: 'pets',
  Bricolage: 'diy',
  'Auto & Moto': 'auto',
  Alimentation: 'food',
  'Santé': 'health',
  Autre: 'other',
};

/** The model reasons better about category names than about slugs, so we ask it
 *  in French and map its answer back onto a key. */
const PROMPT_LABELS = Object.entries(LEGACY_LABELS).map(([label]) => label);

const FALLBACK = 'other';

/**
 * THE LEXICON IS BILINGUAL, AND IT HAS TO BE.
 *
 * It only spoke French. On an English-language shop "Chase T-Shirt" landed in
 * fashion — that word happened to be in the list — but "Stripe Shirt" and "Down
 * Jacket" ended up in "Other": two items from the same shop and the same aisle,
 * filed differently. A fallback that understands one language rescues nothing on
 * half the web.
 *
 * Order matters: narrow rules come before broad ones, otherwise "running shoe"
 * would be filed under sport and "laptop bag" under fashion.
 */
/**
 * Revision of the lexicon below. BUMP IT BY HAND whenever `KEYWORDS` changes.
 *
 * A category is not a fact about a product, it is the output of this lexicon at
 * one point in time. When the lexicon is fixed, everything already stored still
 * carries the old answer and nothing would ever revisit it — see
 * `recategorizeIfStale` in store.js, which re-runs the pass once per revision.
 */
export const CAT_REV = 2;

const KEYWORDS = [
  ['shoes', /chaussure|sneaker|basket|boot|bottin|botte|sandale|sandal|mocassin|loafer|escarpin|heels?|trainers?|running shoe|air max|air force|air jordan|espadrille|derby|richelieu/i],
  ['jewellery', /montre|watch|bijou|jewel|collier|necklace|bracelet|bague|ring\b|boucle d.oreille|earring/i],
  ['beauty', /parfum|perfume|fragrance|creme|crème|cream|serum|sérum|maquillage|makeup|rouge à lèvres|lipstick|shampoing|shampoo|skincare|cosmeti/i],
  ['computing', /laptop|macbook|ordinateur|pc portable|clavier|keyboard|souris|mouse\b|ssd|disque dur|hard drive|ram |écran \d|monitor|imprimante|printer/i],
  ['audio', /casque|écouteur|ecouteur|headphone|earbud|enceinte|speaker|ampli|turntable|platine|micro |microphone/i],
  ['photo', /appareil photo|objectif|lens\b|caméra|camera|gopro|trépied|tripod|drone/i],
  ['electronics', /iphone|smartphone|téléphone|phone\b|tablette|tablet|ipad|tv |télévision|television|console|playstation|xbox|nintendo|montre connectée|smartwatch/i],
  ['kitchen', /poêle|casserole|pan\b|pot\b|couteau de cuisine|kitchen knife|robot cuiseur|mixeur|blender|cafetière|coffee maker|expresso|espresso|vaisselle|assiette|plate\b|verre à|mug\b/i],
  // Before furniture: "Lampe de table" matched furniture's `table` first.
  ['home', /lampe de table|table lamp|lampe|luminaire|applique/i],
  ['furniture', /canapé|sofa|couch|fauteuil|armchair|table |desk\b|chaise|chair\b|bureau |étagère|shelf|shelving|lit |bed\b|matelas|mattress|commode|dresser|armoire|wardrobe/i],
  ['home', /coussin|cushion|rideau|curtain|tapis|rug\b|lampe|lamp\b|luminaire|linge de lit|bedding|couette|duvet cover|décoration|candle|bougie|aspirateur|vacuum/i],
  ['games', /jeu de société|board game|lego|puzzle|figurine|jouet|toy\b|jeu vidéo|video game|manette|controller/i],
  ['books', /livre|book\b|roman|novel|bd |manga|essai|guide /i],
  ['sport', /haltère|dumbbell|yoga|fitness|vélo|velo|bike\b|bicycle|running|tapis de course|treadmill|raquette|racket|ballon|maillot|jersey/i],
  ['outdoor', /tente|tent\b|randonnée|hiking|sac à dos|backpack|camping|duvet|escalade|climbing|ski|snowboard/i],
  ['kids', /bébé|bebe|baby|poussette|stroller|biberon|couche|nappy|diaper|enfant|kids?\b|puériculture/i],
  ['pets', /chien|dog\b|chat |cat\b|croquette|litière|litter|aquarium|niche|laisse|leash/i],
  ['diy', /perceuse|drill\b|visseuse|scie |saw\b|outil|tool\b|établi|workbench|peinture murale|quincaillerie|hardware/i],
  ['auto', /pneu|tyre|tire\b|voiture|\bcar\b|moto|motorbike|casque moto|autoradio|coffre de toit|huile moteur/i],
  ['food', /café en grain|coffee bean|thé |\btea\b|chocolat|chocolate|vin |wine\b|whisky|whiskey|bière|beer\b|épice|spice|huile d.olive|olive oil/i],
  ['health', /complément alimentaire|supplement|vitamine|vitamin|tensiomètre|masseur|massage|orthèse|pharmacie|pharmacy/i],
  // Fashion LAST: its words are the most generic ("shirt", "bag") and would
  // otherwise swallow "laptop bag" or "running shoe".
  ['fashion', /t-?shirt|shirt\b|chemise|top\b|pantalon|trousers|pants\b|jean|robe|dress\b|veste|jacket|manteau|coat\b|parka|pull|sweater|knit|sweat|hoodie|jupe|skirt|short|sac\b|bag\b|ceinture|belt\b|lunettes de soleil|sunglasses|cap\b|beanie|scarf|écharpe|socks?|chaussettes?/i],
];

export function guess(product) {
  const hay = [product.title, product.brand, product.desc, product.site].filter(Boolean).join(' ');
  for (const [cat, re] of KEYWORDS) if (re.test(hay)) return cat;
  return FALLBACK;
}

// The model answers in free text AND in French: we map its reply back into the
// taxonomy, and what we return is a KEY.
function normalize(raw) {
  const s = String(raw || '')
    .replace(/["'`.\n]/g, ' ')
    .trim();
  if (!s) return null;
  const fold = (v) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const target = fold(s);
  let best = null;
  for (const [label, key] of Object.entries(LEGACY_LABELS)) {
    const f = fold(label);
    if (target === f) return key;
    if (target.includes(f) || f.includes(target)) best = best || key;
  }
  // The model may have answered with the key itself.
  return best || (CATEGORIES.includes(target) ? target : null);
}

export async function categorizeRemote(product, settings) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
        'X-Title': 'Wishlist Extension',
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        max_tokens: 12,
        messages: [
          {
            // The prompt stays in FRENCH on purpose, and it is not an oversight
            // against the English-only rule: the model is shown the French
            // labels because it answers with one of them, and `normalize()` maps
            // that answer back onto a key. Asking in English would mean a second
            // label set to keep in sync for no gain.
            role: 'system',
            content:
              'Tu classes un produit e-commerce dans exactement une catégorie de cette liste : ' +
              PROMPT_LABELS.join(', ') +
              ". Réponds uniquement par le nom exact de la catégorie, sans ponctuation ni explication.",
          },
          {
            role: 'user',
            content: [
              `Titre: ${product.title}`,
              product.brand ? `Marque: ${product.brand}` : '',
              product.site ? `Site: ${product.site}` : '',
              product.desc ? `Description: ${String(product.desc).slice(0, 200)}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'OpenRouter error');
    return normalize(data.choices?.[0]?.message?.content);
  } finally {
    clearTimeout(timer);
  }
}

// Never breaks a save: on a network, key or model failure we fall back to the
// keywords and surface the error so it can be shown in the settings.
export async function categorize(product, settings) {
  if (!settings.autoCategorize || !settings.apiKey) return { category: guess(product), error: null };
  try {
    const cat = await categorizeRemote(product, settings);
    return { category: cat || guess(product), error: null };
  } catch (e) {
    return { category: guess(product), error: String(e.message || e) };
  }
}
