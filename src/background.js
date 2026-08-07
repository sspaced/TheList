import { makeItem, putItem, getSettings, setSettings } from './store.js';
import { categorize } from './categorize.js';
import { toast } from './toast.js';
import { makeQuote, putMedia } from './media.js';
import { initI18n, t } from './i18n.js';

// Les textes du toast partent d'ici : la fonction injectée dans la page ne peut
// rien importer, elle reçoit du texte déjà traduit. L'init est paresseuse et
// mémorisée — le service worker est réveillé puis tué à chaque ajout.
let i18nReady = null;
const ready = () => (i18nReady ||= initI18n().catch(() => {}));

const WISHLIST_URL = chrome.runtime.getURL('src/wishlist.html');

async function badge(tabId, text, color) {
  if (!tabId) return;
  try {
    await chrome.action.setBadgeBackgroundColor({ color, tabId });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff', tabId });
    await chrome.action.setBadgeText({ text, tabId });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }).catch(() => {}), 2500);
  } catch {}
}

// getContexts() évite la permission "tabs" (qui afficherait un avertissement
// "lire votre historique") juste pour retrouver un onglet déjà ouvert.
async function openWishlist() {
  try {
    const ctxs = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [WISHLIST_URL] });
    const c = ctxs.find((x) => x.tabId >= 0);
    if (c) {
      await chrome.tabs.update(c.tabId, { active: true });
      if (c.windowId >= 0) await chrome.windows.update(c.windowId, { focused: true });
      return;
    }
  } catch {}
  await chrome.tabs.create({ url: WISHLIST_URL });
}

// Le clic = l'ajout. C'est le seul geste : pas de popup intermédiaire.
async function addFromTab(tab) {
  const tabId = tab?.id;
  if (!tabId || !/^https?:/i.test(tab.url || '')) return badge(tabId, '×', '#cc0000');

  let product = null;
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/extract.js'],
    });
    product = res?.result || null;
  } catch (e) {
    await ready();
    await setSettings({ lastError: `${t('toastFailed')} (${e.message})` });
    toast(tabId, { title: t('toastFailed'), kind: 'error' });
    return badge(tabId, '×', '#cc0000');
  }

  if (!product?.title) {
    await ready();
    await setSettings({ lastError: t('toastNoProduct') });
    toast(tabId, { title: t('toastNoProduct'), kind: 'warn' });
    return badge(tabId, '?', '#cc0000');
  }

  await ready();
  const settings = await getSettings();

  /**
   * UNE PAGE PEUT PORTER PLUSIEURS PRODUITS.
   *
   * `extract.js` ne rend une liste que sur une page de type panier — jamais sur
   * une fiche, où les blocs voisins sont des recommandations qu'il ne faut
   * surtout pas enregistrer. Ici on se contente de la suivre.
   *
   * Chaque article porte SON URL (le lien de sa ligne) : sans ça, deux articles
   * de la même page auraient le même identifiant et le second écraserait le
   * premier — on aurait ajouté deux choses pour n'en garder qu'une.
   */
  const list = Array.isArray(product.products) && product.products.length > 1 ? product.products : [product];
  let saved = 0;
  let error = '';
  for (const one of list) {
    const src = { ...product, ...one, site: product.site };
    const res = await categorize(src, settings);
    error = res.error || error;
    try {
      // `Date.now() + saved` : l'horodatage ordonne la grille, et deux articles
      // enregistrés dans la même milliseconde se seraient marché dessus.
      await putItem(makeItem(src, res.category, Date.now() + saved));
      saved++;
    } catch (e) {
      await ready();
      await setSettings({ lastError: `${t('toastFull')} : ${e.message}` });
      toast(tabId, { title: t('toastFull'), kind: 'error' });
      return badge(tabId, 'FUL', '#cc0000');
    }
  }

  await setSettings({ lastError: error || '' });
  toast(tabId, {
    title: saved > 1 ? t('toastAddedN', { count: saved }) : t('toastAdded'),
    kind: 'ok',
  });
  await badge(tabId, '✓', error ? '#cc0000' : '#000000');
}

chrome.action.onClicked.addListener(addFromTab);

/**
 * ENREGISTRER UN PASSAGE.
 *
 * Deux chemins, et ils n'obtiennent pas le texte de la même façon :
 *   - le MENU CONTEXTUEL le reçoit tout cuit dans `info.selectionText` ;
 *   - le RACCOURCI ne reçoit rien — une commande clavier ne sait pas ce qui est
 *     sélectionné — il faut donc aller le lire dans la page.
 *
 * Le titre et l'URL viennent de la page dans les deux cas : sans eux, un extrait
 * de trois phrases n'a plus de provenance, et une citation sans source ne vaut
 * pas grand-chose.
 */
async function readSelection(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        text: String(getSelection() ?? ''),
        title: document.title,
        url:
          document.querySelector('link[rel="canonical"]')?.href ||
          document.querySelector('meta[property="og:url"]')?.content ||
          location.href,
        site: location.hostname.replace(/^www\./, ''),
      }),
    });
    return res?.result ?? null;
  } catch {
    return null;
  }
}

async function saveQuote(tab, selectionText) {
  const tabId = tab?.id;
  if (!tabId) return;
  await ready();

  const page = await readSelection(tabId);
  // Le texte du menu contextuel fait foi : Chrome le fournit tel que
  // l'utilisateur l'a surligné, alors que relire la sélection depuis la page
  // peut arriver après qu'un clic l'a effacée.
  const text = (selectionText || page?.text || '').trim();
  if (!text) {
    toast(tabId, { title: t('toastNoSelection'), kind: 'warn' });
    return badge(tabId, '?', '#cc0000');
  }

  try {
    await putMedia(
      makeQuote(
        {
          text,
          title: page?.title ?? '',
          url: page?.url ?? tab.url ?? '',
          site: page?.site ?? '',
        },
        Date.now(),
      ),
    );
  } catch (e) {
    await setSettings({ lastError: `${t('toastFull')} : ${e.message}` });
    toast(tabId, { title: t('toastFull'), kind: 'error' });
    return badge(tabId, 'FUL', '#cc0000');
  }

  toast(tabId, { title: t('toastQuoteSaved'), kind: 'ok' });
  await badge(tabId, '✓', '#000000');
}

/**
 * Les entrées du menu contextuel, reposées à CHAQUE réveil du service worker et
 * pas seulement à l'installation.
 *
 * `onInstalled` ne se déclenche qu'une fois ; si le worker a échoué à ce
 * moment-là — une erreur d'import, une version cassée — les entrées n'existent
 * jamais et rien ne le dit. `removeAll` d'abord rend l'opération idempotente,
 * donc la répéter ne coûte rien.
 *
 * Les libellés sont figés à la création : Chrome les mémorise, ils ne suivront
 * un changement de langue qu'au réveil suivant.
 */
async function installMenus() {
  await ready();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'add', title: t('menuAddProduct'), contexts: ['page'] });
    chrome.contextMenus.create({ id: 'quote', title: t('menuSaveQuote'), contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'open', title: t('menuOpen'), contexts: ['action', 'page'] });
  });
}

chrome.runtime.onInstalled.addListener(installMenus);
chrome.runtime.onStartup.addListener(installMenus);
installMenus();

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'add') addFromTab(tab);
  if (info.menuItemId === 'quote') saveQuote(tab, info.selectionText);
  if (info.menuItemId === 'open') openWishlist();
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd === 'open-wishlist') return openWishlist();
  if (cmd === 'save-quote') {
    const target = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    return saveQuote(target, '');
  }
});
