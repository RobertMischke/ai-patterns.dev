# `data/` — content database for ai-patterns.dev

Single source of truth for every entity rendered by the Angular app. The
build step copies this tree into `app/src/assets/data/` and generates a
typed index — never edit the copy.

## Layout

```
data/
  patterns/<id>/
    pattern.json              # core record (see schemas/pattern.schema.json)
    research/
      critique.json           # critical questioning round
      counter-arguments.json  # what speaks against this pattern
      tools.json              # tools that implement it (cross-refs)
      extensions.json         # ways to extend / variants
      sources.json            # supporting sources (cross-refs)
    examples/                 # use-case studies, free-form JSON
  categories/<id>/category.json
  concepts/<id>/
    concept.json              # short vocabulary entry
    article.json              # optional long-form article
  tools/<id>/
    tool.json
    research/                 # same idea as patterns/<id>/research
  sources/<id>/source.json
  _meta/
    tool-kinds.json
    manifest.json             # generated counts + locale
  schemas/                    # JSON Schemas for every entity above
```

## Conventions

- **IDs** are kebab-case, stable, and used as folder names *and* the `id`
  field inside each JSON. Renaming an entity = renaming the folder.
- **Cross-references** use plain id strings (e.g. `"patterns": ["plan-mode"]`).
  The build step validates that every reference resolves.
- **Locale**: English only for now. Each text field is a plain string. When
  we add more locales, fields become `{ en, de, … }` objects and a new
  build step picks the active locale per build.
- **Schemas** under `data/schemas/` are authoritative — `scripts/validate.mjs`
  (TODO) will fail the build on any drift.

## Regenerating from the React prototype

```
node scripts/extract.mjs
```

Destructive: wipes `data/patterns/`, `categories/`, `concepts/`, `tools/`,
`sources/` and rewrites them from `_unpacked/src/*.jsx`. Once the prototype
is gone, this script is replaced by `scripts/validate.mjs` only.
