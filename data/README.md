# `data/` — content database for ai-patterns.dev

This directory is the single source of truth for every entity rendered by the
Angular app. `scripts/build-data.mjs` validates the catalog, generates the typed
index in `app/src/data/`, and copies runtime JSON to `app/public/data/`. Angular
then copies those assets into `app/dist/app/browser/data/`. Never edit a
generated copy.

## Layout

```text
data/
  patterns/<id>/
    pattern.json
    research/
      critique.json
      counter-arguments.json
      tools.json
      extensions.json
      sources.json
    examples/                 # optional use cases, free-form JSON
  categories/<id>/category.json
  concepts/<id>/
    concept.json
    article.json              # optional long-form article
  tools/<id>/tool.json
  sources/<id>/source.json
  _meta/
    tool-kinds.json
    radar.json
    manifest.json
  schemas/                    # authoritative JSON Schemas
```

## Catalog contract

- IDs are stable kebab-case strings and match their folder names. Pattern
  numbers are unique. Retired numbers stay retired.
- Cross-references resolve in both directions: if pattern research points to a
  source, tool, concept, or another pattern, the target records the originating
  pattern as well.
- Every pattern has all five research files listed above. Release validation
  rejects empty placeholder research and unresolved or malformed references.
- Canonical URLs use HTTPS and cannot be placeholders such as `#`. Live network
  checks run separately on a schedule so a temporary remote outage cannot block
  a deterministic release.
- `data/_meta/radar.json` has exactly one position per pattern and no orphan
  positions. `data/_meta/manifest.json` has counts matching the canonical tree.
- Pattern `abstraction` is optional. Allowed values are `principle`, `hub`,
  `pattern`, `variant`, `recipe`, and `application`; omission means `pattern`.
  Every explicit non-`pattern` abstraction links its parent, core, or components
  through `research/extensions.json`.
- English is the only locale for now. Text fields are plain strings.

`P-15` is a permanent tombstone: the former `review-result` entry was merged
into `P-23` (`fire-track-review`). The web route remains a compatibility
redirect, but neither the number nor the old entity ID may be reused.

## Local quality gates

Run commands from `app/`:

```sh
npm ci
npm run validate:data   # schemas, references, backlinks, radar, manifest
npm run test:data       # regression fixtures for invalid catalogs
npm run audit:prod      # block moderate-or-higher production advisories
npm run audit:dependencies # block moderate-or-higher toolchain advisories
npm run test:ci         # clean data generation plus Angular tests
npm run build:ci        # production build plus distribution verification
npm run check           # complete deterministic release gate
npm run audit:links     # live external URLs; scheduled, not a release blocker
```

`verify:dist` compares every released data asset byte-for-byte with the
canonical tree, rejects missing or unknown assets/routes, checks all required
research files, and accepts only the documented compatibility redirects.

## Build and release automation

`.github/workflows/quality.yml` runs `npm ci` and `npm run check` for pull
requests, pushes to `main`, manual runs, and reusable workflow calls. It uploads
the verified `dist/app` directory as an artifact. Tagging `v*` invokes
`.github/workflows/release.yml`, which consumes that exact artifact without a
second build, creates a deterministic archive and SHA-256 checksum, and then
publishes the GitHub Release. External links are checked weekly by
`.github/workflows/link-audit.yml` with bounded concurrency, retries, and
timeouts.

In the GitHub repository ruleset, require the check
`Quality / Validate, test, and build` before merging to `main`, disable force
pushes, and protect any production environment. Those controls live in GitHub
settings rather than this repository and must be enabled by an administrator.

## Historical extractor

The obsolete `scripts/extract.mjs` was removed because its source prototype no
longer exists and running it could delete the canonical catalog. If historical
investigation is necessary, retrieve the script from Git history; do not run it
against the current `data/` tree.
