// Catégorisation via OpenRouter, avec repli local par mots-clés.
// Taxonomie fermée : on force le modèle à choisir dedans, sinon les catégories
// dérivent et le filtrage devient inutilisable.
//
// LES CATÉGORIES SONT DES CLÉS, PAS DES LIBELLÉS.
//
// Elles étaient stockées en français (`category: 'Meuble'`), donc la même chaîne
// servait de clé de rangement ET de texte affiché. Impossible à traduire : un
// article rangé en « Meuble » l'aurait été pour toujours, et une recatégorisation
// en anglais aurait créé un doublon « Furniture » à côté. On stocke donc un
// identifiant stable (`furniture`) et l'affichage passe par i18n.
//
// `LEGACY_LABELS` n'est pas un vestige à nettoyer : il sert à MIGRER les articles
// déjà enregistrés (cf. `migrateLegacyCategories` dans store.js) et à ramener la
// réponse du modèle — qui répond en français — vers la clé.

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

/** Libellé français d'origine → clé. Table de migration ET de normalisation. */
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

/** Le modèle raisonne mieux sur des noms de catégories que sur des slugs : on
 *  l'interroge donc en français et on retraduit sa réponse en clé. */
const PROMPT_LABELS = Object.entries(LEGACY_LABELS).map(([label]) => label);

const FALLBACK = 'other';

/**
 * LE LEXIQUE EST BILINGUE, ET IL DOIT L'ÊTRE.
 *
 * Il ne parlait que français. Sur une boutique anglophone, « Chase T-Shirt »
 * tombait dans la mode — le mot figurait dans la liste — mais « Stripe Shirt » et
 * « Down Jacket » finissaient dans « Autre » : deux articles du même site, du
 * même rayon, rangés différemment. Un repli qui ne comprend qu'une langue ne
 * rattrape rien sur la moitié du web.
 *
 * L'ordre compte : les règles étroites passent avant les larges, sinon
 * « running shoe » serait rangé en sport et « laptop bag » en mode.
 */
const KEYWORDS = [
  ['shoes', /chaussure|sneaker|basket|boot|botte|sandale|sandal|mocassin|loafer|escarpin|heels?|trainers?|running shoe/i],
  ['jewellery', /montre|watch|bijou|jewel|collier|necklace|bracelet|bague|ring\b|boucle d.oreille|earring/i],
  ['beauty', /parfum|perfume|fragrance|creme|crème|cream|serum|sérum|maquillage|makeup|rouge à lèvres|lipstick|shampoing|shampoo|skincare|cosmeti/i],
  ['computing', /laptop|macbook|ordinateur|pc portable|clavier|keyboard|souris|mouse\b|ssd|disque dur|hard drive|ram |écran \d|monitor|imprimante|printer/i],
  ['audio', /casque|écouteur|ecouteur|headphone|earbud|enceinte|speaker|ampli|turntable|platine|micro |microphone/i],
  ['photo', /appareil photo|objectif|lens\b|caméra|camera|gopro|trépied|tripod|drone/i],
  ['electronics', /iphone|smartphone|téléphone|phone\b|tablette|tablet|ipad|tv |télévision|television|console|playstation|xbox|nintendo|montre connectée|smartwatch/i],
  ['kitchen', /poêle|casserole|pan\b|pot\b|couteau de cuisine|kitchen knife|robot cuiseur|mixeur|blender|cafetière|coffee maker|expresso|espresso|vaisselle|assiette|plate\b|verre à|mug\b/i],
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
  // La mode en DERNIER : ses mots sont les plus génériques (« shirt », « bag »)
  // et happeraient sinon « laptop bag » ou « running shoe ».
  ['fashion', /t-?shirt|shirt\b|chemise|top\b|pantalon|trousers|pants\b|jean|robe|dress\b|veste|jacket|manteau|coat\b|parka|pull|sweater|knit|sweat|hoodie|jupe|skirt|short|sac\b|bag\b|ceinture|belt\b|lunettes de soleil|sunglasses|cap\b|beanie|scarf|écharpe|socks?|chaussettes?/i],
];

export function guess(product) {
  const hay = [product.title, product.brand, product.desc, product.site].filter(Boolean).join(' ');
  for (const [cat, re] of KEYWORDS) if (re.test(hay)) return cat;
  return FALLBACK;
}

// Le modèle répond en texte libre ET en français : on ramène sa réponse dans la
// taxonomie, et ce qu'on rend est une CLÉ.
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
  // Le modèle a pu répondre par la clé elle-même.
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

// Ne casse jamais l'ajout : en cas d'échec réseau/clé/modèle, on retombe sur
// les mots-clés et on remonte l'erreur pour l'afficher dans les réglages.
export async function categorize(product, settings) {
  if (!settings.autoCategorize || !settings.apiKey) return { category: guess(product), error: null };
  try {
    const cat = await categorizeRemote(product, settings);
    return { category: cat || guess(product), error: null };
  } catch (e) {
    return { category: guess(product), error: String(e.message || e) };
  }
}
