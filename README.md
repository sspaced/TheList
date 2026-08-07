# TheList

A Chrome extension for keeping what you want to buy **and** what you want to read
again. One shortcut on any page: a product, a whole basket, or a passage of text.

## Philosophy

**No per-site rules.** Writing an Amazon adapter, then an Apple adapter, then
starting over at every theme redesign would have been easy. Extraction is
deliberately structural: we first read what the merchant **declares** (JSON-LD
`schema.org/Product` and `BreadcrumbList`, microdata, OpenGraph) and only fall
back to reasoning about page structure — never about class names. The same rule
picks the photo: the widest variant the page's own `srcset` names, not the small
one the browser happened to load for a thumbnail slot.

**A product's name says what it is called; the shelf says what it is.** Titles are
a brand and a model code — "Studio Display XDR" contains no category noun at all —
so a category is read from where the merchant filed the product (`Mac > Moniteurs`)
and from the URL's path, before ever falling back to the name.

**A product is a block, not a collection of fields.** Title, price and image come
out of the *same* container. That is what prevents the classic chimera: one item's
photo with another item's price.

**When there is nothing to deduce, we ask.** A search page holds forty products,
all structurally identical, and nothing on it says which one you meant — so `⌥P`
lets you point at one and the reader reads that block. No heuristic pretends to
choose, and no per-site list of "what a result card looks like" gets maintained.

**Nothing is guessed in silence.** An image that fails to load shows its URL, a
total that leaves items out says so, an unassigned shortcut displays as such. A
silent failure costs more than a noisy one.

**As little interface as possible.** A grid of images and a 40 px bar. Anything
that does not help you find an object again has no place on screen.

## Features

| | |
|---|---|
| `⌥A` | Adds the product on the page. On a **basket** page, adds every line item — without the "recommended for you" block. |
| `⌥S` | Saves the selected text along with its source. Also from the context menu. |
| `⌥P` | **Pick** one product: the block under the pointer is outlined, a click saves it. For search pages and category grids. Esc or right-click leaves. |
| `⌥L` | Opens the list. |
| `⌘Z` | Puts back the last item you removed, as many times as needed. |

- **PDFs**: the shortcut cannot see a selection there, and now says so instead of
  claiming there is none. Chrome's viewer draws through PDFium, whose selection
  belongs to the plugin and to no DOM an extension may read — the main document
  is empty. The right-click menu works, because Chrome hands it the selected text
  itself; the title and address then come from the tab.
- **Two sections**: products, and media (saved passages).
- **Search over everything stored** — title, brand, hostname, price, category and
  its label, a passage's whole text. Accent-insensitive, and every hit visible on
  screen is highlighted.
- **Category filter** and a **total** of whatever is displayed, in the currency of
  your choice — click the total to change it. Prices in other currencies are
  converted at the European Central Bank's daily rate; a `≈` says when any were,
  and whatever could not enter the total is counted beside it.
- **Categorisation** by a model through OpenRouter when a key is configured,
  otherwise by a bilingual keyword lexicon. A failure never blocks the save. The
  lexicon carries a revision: when it is fixed, already-stored items are
  re-classified once, and what changed is reported rather than applied silently.
- **French / English**, switchable live — the locale also drives amount formatting.
- **Interface sounds**, synthesised, mutable in one click.

## What is stored, and where

Everything lives in `chrome.storage.local` — products and passages alike.

Products used to sit in `storage.sync` so the list would follow you between
Chrome installs. That convenience cost more than it was worth: sync caps at
100 KB in total and 8 KB per key, and that ceiling is what truncated image URLs
into dead links and forced descriptions to be thrown away right after being used
to classify. What we give up is stated plainly: **the list no longer syncs between
several Chrome installs**. What we gain is room — descriptions are kept and
searchable, and both kinds share one store.

Nothing is sent anywhere, with two exceptions. When an OpenRouter key is
configured, the product's title and brand go to the model to be classified. And
once every twelve hours the list asks frankfurter.dev for the ECB's rate table —
a request that carries no data about you, not even which currencies you hold, and
whose answer is the same for everyone. A failure there is never fatal: the last
cached table is used, and with none the total behaves as it did before, summing
one currency and declaring the rest out.

## Install

`chrome://extensions` → developer mode → "Load unpacked" → pick this folder.

No build step: everything is ESM loaded directly by the browser.

## Dependencies

Two libraries, vendored under `src/vendor/` with their licence, no transitive
dependencies:

- [i18next](https://www.i18next.com) (MIT) — translations.
- [cuelume](https://github.com/Danilaa1/cuelume) (MIT) — interface sounds,
  synthesised through Web Audio, no audio file shipped.

Extraction itself uses nothing but browser APIs.

## Layout

```
manifest.json
src/
  background.js   service worker: saving, menus, shortcuts
  extract.js      reading a product page (injected on demand)
  pick.js         pointing at one product in a grid (injected on demand)
  rates.js        ECB exchange rates, cached, for the total
  categorize.js   closed taxonomy, model with a keyword fallback
  store.js        products (storage.local)
  media.js        passages (storage.local)
  toast.js        visual feedback, injected into the page
  i18n.js         language loading
  wishlist.*      the list page
```
