# Conventions

**Everything committed to this repository is written in English** — README, code
comments, commit messages, file and identifier names. No exceptions.

The only French left is *user-facing copy*, and it never lives in the source: it
belongs in `src/i18n/fr.json` alongside `en.json`. If you find yourself typing a
French sentence anywhere else, it is a string that should have been a
translation key.

## Comments

Explain **why**, not what. A comment that restates the line below it is noise; a
comment that records the measurement, the failed alternative, or the constraint
that forced a choice is what makes the next change safe.

Prefer recording what was actually observed — sizes, positions, counts — over
adjectives. "The banner is 915 000 px² at y=7643, the packshot 460 000 at y=300"
survives a refactor; "the banner is big" does not.

## No build step

Everything is ESM loaded directly by the browser. Dependencies are vendored under
`src/vendor/` with their licence, and must have no transitive dependencies.

## No per-site rules

Extraction reads what a page *declares* (JSON-LD, microdata, OpenGraph) and, when
it declares nothing, reasons about structure. Hard-coding a selector for a
specific shop is the last resort, not the first.
