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

const KEYWORDS = [
  ['shoes', /chaussure|sneaker|basket|boot|botte|sandale|mocassin|escarpin|running shoe/i],
  ['jewellery', /montre|watch|bijou|collier|bracelet|bague|boucle d.oreille|jewel/i],
  ['beauty', /parfum|creme|crème|serum|sérum|maquillage|rouge à lèvres|shampoing|skincare|cosmeti/i],
  ['fashion', /t-?shirt|chemise|pantalon|jean|robe|veste|manteau|pull|sweat|hoodie|jupe|short|sac à main|ceinture|lunettes de soleil/i],
  ['computing', /laptop|macbook|ordinateur|pc portable|clavier|souris|ssd|disque dur|ram |écran \d|monitor|imprimante/i],
  ['audio', /casque|écouteur|ecouteur|headphone|earbud|enceinte|speaker|ampli|platine|micro /i],
  ['photo', /appareil photo|objectif|caméra|camera|gopro|trépied|drone/i],
  ['electronics', /iphone|smartphone|téléphone|tablette|ipad|tv |télévision|console|playstation|xbox|nintendo|montre connectée/i],
  ['kitchen', /poêle|casserole|couteau de cuisine|robot cuiseur|mixeur|cafetière|expresso|vaisselle|assiette|verre à/i],
  ['furniture', /canapé|fauteuil|table |chaise|bureau |étagère|lit |matelas|commode|armoire/i],
  ['home', /coussin|rideau|tapis|lampe|luminaire|linge de lit|couette|décoration|bougie|aspirateur/i],
  ['games', /jeu de société|lego|puzzle|figurine|jouet|jeu vidéo|manette/i],
  ['books', /livre|roman|bd |manga|essai|beau livre|guide /i],
  ['sport', /haltère|yoga|fitness|vélo|velo|running|tapis de course|raquette|ballon|maillot/i],
  ['outdoor', /tente|randonnée|sac à dos|camping|duvet|escalade|ski|snowboard/i],
  ['kids', /bébé|bebe|poussette|biberon|couche|enfant|puériculture/i],
  ['pets', /chien|chat |croquette|litière|aquarium|niche|laisse/i],
  ['diy', /perceuse|visseuse|scie |outil|établi|peinture murale|quincaillerie/i],
  ['auto', /pneu|voiture|moto|casque moto|autoradio|coffre de toit|huile moteur/i],
  ['food', /café en grain|thé |chocolat|vin |whisky|bière|épice|huile d.olive/i],
  ['health', /complément alimentaire|vitamine|tensiomètre|masseur|orthèse|pharmacie/i],
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
