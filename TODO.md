# TODO

Open work, roughly in the order it is worth doing. Each entry says what is wrong
and what has already been measured, so nobody has to rediscover it.

## Saving from X

**A selected passage is not tied to the tweet it came from.** Measured: highlight
text in a timeline, save it, and the item reads `x.com` / `(21) Home / X`. The text
is right, the provenance is the page — so the same source line appears for every
tweet ever saved from the feed, and the tweet itself can never be reopened.

The fix must not become an X adapter. The candidate is generic and standard: the
nearest `<article>` ancestor of the selection is the entry, and its permalink is
the `<a>` that wraps a `<time>` — the pattern every feed uses, from blogs to
Mastodon. Same rule would fix comment threads and forum posts.

- [ ] Tie a passage to its entry: `article` ancestor for the boundary, `a > time`
      for the URL, and the author's handle as the title rather than the page's.
- [ ] **Save a tweet on its own** (`⌥A` on a status page), with author, text, date.
- [ ] **A thread**: several entries under one item, the way a basket page yields
      several products. `firstGroup()` in extract.js already groups siblings by
      their nearest common container — probably the same machinery.
- [ ] **Images and video in a tweet.** An image is easy (it is an `<img>`); the
      video is the same problem as YouTube, below.

## Saving from YouTube

- [ ] A video is not a product and not a passage: it needs its own media kind.
      Detection is declared, so it stays generic: `og:type` of `video.*`, or a
      JSON-LD `VideoObject`. A bare `<video>` tag proves nothing — Arte's homepage
      plays a background teaser.
- [ ] The tile: thumbnail, title, channel, duration. `VideoObject.duration` gives
      it in ISO 8601; Vimeo's iframe player exposes nothing, so some tiles will
      have no duration at all. **Open question: is a duration-less tile acceptable,
      or should it say why it has none?**
- [ ] **Open question: should a saved video resume where you stopped?** The
      playback position exists but the syntax for it is per-site (`?t=` on
      YouTube), which is exactly the kind of rule this codebase refuses. Probably
      not worth it.

## Left over from earlier

- [ ] **Blurry image on lacentrale.** The site ships one small file and no
      `srcset`, so the widest-variant rule has nothing to pick from. The only lever
      left is raising a size in the URL's query parameters — worth doing *only*
      with verification: load the bigger candidate, keep it only if it decodes
      larger. Needs the stored image URL to see whether the size is even in a
      parameter.
- [ ] **`⌥S` inside a PDF.** Structurally impossible as it stands: PDFium's
      selection is in the plugin, in no DOM an extension may read. The one
      workaround is reading the clipboard after the user presses `⌘C`, which costs
      the `clipboardRead` permission ("read data you copy and paste") and risks
      saving a stale clipboard. Right-click works today and says so.
