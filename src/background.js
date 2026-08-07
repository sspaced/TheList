import { makeItem, putItem, getSettings, setSettings } from './store.js';
import { categorize } from './categorize.js';
import { toast } from './toast.js';
import { makeQuote, putMedia } from './media.js';
import { initI18n, t } from './i18n.js';

// The toast's copy originates here: the function injected into the page can
// import nothing, so it receives text already translated. Init is lazy and
// memoised — the service worker is woken then killed around every save.
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

// getContexts() avoids needing the "tabs" permission — which would show a "read
// your browsing history" warning — just to find an already-open tab.
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

// A click IS the save. That is the only gesture: no intermediate popup.
/**
 * THE GESTURE DEPENDS ON WHAT IS SELECTED.
 *
 * One shortcut for two intentions, and the page decides between them: text
 * highlighted means "keep this passage", nothing highlighted means "keep this
 * product". So there is a single combination to remember, and the case where you
 * get it wrong does not exist — nobody highlights a paragraph by accident.
 *
 * `⌥S` remains: for when you want the passage unambiguously, or when the
 * selection is at risk of being lost.
 */
async function addFromTab(tab, fromPick = false) {
  const tabId = tab?.id;
  if (!tabId || !/^https?:/i.test(tab.url || '')) return badge(tabId, '×', '#cc0000');

  // After a pick, the selection is not consulted: the user pointed at a product,
  // and a stray highlight left over on the page must not turn that into a quote.
  if (!fromPick) {
    // We keep the read: `saveQuote` needs it for the title and the URL, and doing
    // it again would mean a second injection into the page for nothing.
    const page = await readSelection(tabId);
    const selected = page?.text?.trim();
    if (selected) return saveQuote(tab, selected, page);
  }

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
   * A PAGE CAN CARRY SEVERAL PRODUCTS.
   *
   * `extract.js` only returns a list on a basket-like page — never on a product
   * page, where the neighbouring blocks are recommendations that must on no
   * account be saved. Here we simply follow it.
   *
   * Each item carries ITS OWN URL (its row's link): without that, two items from
   * the same page would share an identifier and the second would overwrite the
   * first — two things saved to keep only one.
   */
  const list = Array.isArray(product.products) && product.products.length > 1 ? product.products : [product];
  let saved = 0;
  let error = '';
  for (const one of list) {
    const src = { ...product, ...one, site: product.site };
    const res = await categorize(src, settings);
    error = res.error || error;
    try {
      // `Date.now() + saved`: the timestamp orders the grid, and two items saved
      // within the same millisecond would have collided.
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

// `addListener(addFromTab)` would have handed Chrome's second argument straight
// to `fromPick`. It is not one today, and one day it will be.
chrome.action.onClicked.addListener((tab) => addFromTab(tab));

/**
 * PICK MODE: FOR PAGES THAT CARRY FORTY PRODUCTS.
 *
 * On a search page or a category page, `⌥A` had no chance: measured on Apple's
 * results for "studio display", it read all 24 cards correctly and saved every
 * one of them under the same link — 24 writes collapsing into one item whose
 * contents were whichever card came last.
 *
 * Nothing on such a page says which card you meant, so we stop pretending: the
 * pointer designates, the click confirms, and `extract.js` reads that block with
 * the rules it already has. The interaction lives in `pick.js`, in the page,
 * because the pointer is there.
 *
 * The click comes back as a MESSAGE rather than as the resolution of a promise
 * held here: pointing takes seconds, and the service worker is free to die in the
 * meantime — a message wakes it back up, an awaited promise would be lost with it.
 */
async function pickOn(tab) {
  const tabId = tab?.id;
  if (!tabId || !/^https?:/i.test(tab.url || '')) return badge(tabId, '×', '#cc0000');
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/pick.js'] });
  } catch (e) {
    await ready();
    await setSettings({ lastError: `${t('toastFailed')} (${e.message})` });
    toast(tabId, { title: t('toastFailed'), kind: 'error' });
    await badge(tabId, '×', '#cc0000');
  }
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // An injected file cannot receive arguments, so `pick.js` asks for its copy.
  // `return true` keeps the channel open for the asynchronous answer.
  if (msg?.theList === 'pick-copy') {
    ready().then(() => reply({ hint: t('pickHint') }));
    return true;
  }
  if (msg?.theList === 'picked') {
    addFromTab(sender.tab, true);
  }
  return false;
});

/**
 * SAVING A PASSAGE.
 *
 * Two paths, and they do not obtain the text the same way:
 *   - the CONTEXT MENU receives it ready-made in `info.selectionText`;
 *   - the SHORTCUT receives nothing — a keyboard command does not know what is
 *     selected — so the text has to be read from the page.
 *
 * The title and URL come from the page in both cases: without them a
 * three-sentence excerpt has no provenance, and a quote without a source is
 * worth very little.
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

async function saveQuote(tab, selectionText, known) {
  const tabId = tab?.id;
  if (!tabId) return;
  await ready();

  const page = known ?? (await readSelection(tabId));
  // The context menu's text wins: Chrome hands it over exactly as the user
  // highlighted it, whereas re-reading the selection from the page can happen
  // after a click has already cleared it.
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
 * The context-menu entries, re-registered on EVERY service-worker wake-up and not
 * only on install.
 *
 * `onInstalled` fires once; if the worker failed at that moment — a bad import, a
 * broken version — the entries never exist and nothing says so. Calling
 * `removeAll` first makes the operation idempotent, so repeating it costs
 * nothing.
 *
 * The labels are frozen at creation time: Chrome memorises them, so they only
 * follow a language change on the next wake-up.
 */
async function installMenus() {
  await ready();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'add', title: t('menuAddProduct'), contexts: ['page'] });
    chrome.contextMenus.create({ id: 'pick', title: t('menuPick'), contexts: ['page'] });
    chrome.contextMenus.create({ id: 'quote', title: t('menuSaveQuote'), contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'open', title: t('menuOpen'), contexts: ['action', 'page'] });
  });
}

chrome.runtime.onInstalled.addListener(installMenus);
chrome.runtime.onStartup.addListener(installMenus);
installMenus();

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'add') addFromTab(tab);
  if (info.menuItemId === 'pick') pickOn(tab);
  if (info.menuItemId === 'quote') saveQuote(tab, info.selectionText);
  if (info.menuItemId === 'open') openWishlist();
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd === 'open-wishlist') return openWishlist();
  if (cmd === 'pick-product') {
    const target = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    return pickOn(target);
  }
  if (cmd === 'save-quote') {
    const target = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    return saveQuote(target, '');
  }
});
