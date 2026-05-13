#!/usr/bin/env node
/**
 * One-shot extractor: reads the React prototype data files in _unpacked/
 * and writes the canonical JSON tree under data/.
 *
 * Per-entity folders are created so each item can grow its own research/
 * extras over time (see data/README.md for the contract).
 *
 * The prototype data is structured as `const X = ...; window.X = X;` plain
 * JavaScript (no JSX inside the actual data values), so we just evaluate it
 * in a vm sandbox with a `window` stub.
 *
 * Locale: only `en` is kept for now — other locales are dropped on the way in.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const SRC       = join(ROOT, '_unpacked', 'src');
const DATA      = join(ROOT, 'data');

const LOCALE = 'en';

/* ──────────────────────────── helpers ──────────────────────────── */

const sandbox = { window: {}, console };
vm.createContext(sandbox);

function loadIntoSandbox(file) {
  const src = readFileSync(join(SRC, file), 'utf8');
  vm.runInContext(src, sandbox, { filename: file });
}

/** Pick the locale string from a `{ en, de, es }` object, or return as-is. */
function pick(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && LOCALE in v) return v[LOCALE];
  return v;
}

/** Deep-pick: recurse into arrays/objects and pluck the locale at every leaf. */
function deepPick(v) {
  if (Array.isArray(v)) return v.map(deepPick);
  if (v && typeof v === 'object') {
    // i18n object?
    if (LOCALE in v && Object.keys(v).every(k => ['en', 'de', 'es'].includes(k))) {
      return v[LOCALE];
    }
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = deepPick(val);
    return out;
  }
  return v;
}

function writeJson(file, value) {
  const path = join(DATA, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function ensureFolder(rel) {
  mkdirSync(join(DATA, rel), { recursive: true });
}

/* ──────────────────────────── load source ──────────────────────────── */

console.log('Loading prototype data…');
loadIntoSandbox('data.jsx');
loadIntoSandbox('dictionary.jsx');
loadIntoSandbox('concept-articles.jsx');

const {
  CATEGORIES,
  PATTERNS,
  SOURCES,
  PATTERN_KEYWORDS,
  CONCEPTS,
  TOOLS_LIST,
  TOOL_KINDS,
  CONCEPT_ARTICLES,
} = sandbox.window;

if (!PATTERNS) throw new Error('PATTERNS not found in sandbox');

/* ──────────────────────────── clean target ──────────────────────────── */

console.log('Resetting data/ tree…');
for (const sub of ['patterns', 'categories', 'concepts', 'tools', 'sources']) {
  const p = join(DATA, sub);
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  mkdirSync(p, { recursive: true });
}

/* ──────────────────────────── patterns ──────────────────────────── */
// Schema (per pattern.json):
//   id, num, category, layer, classify ("new"|"intensified"|"proven"|"anti-pattern"),
//   title, one_liner, problem, solution, keywords[]
// Each pattern gets its own folder with empty research/ slots ready to be filled.

const RESEARCH_FILES = {
  'critique.json':           { stance: 'unknown', summary: '', points: [] },
  'counter-arguments.json':  { stance: 'unknown', summary: '', points: [] },
  'tools.json':              { summary: '', items: [] },
  'extensions.json':         { summary: '', items: [] },
  'sources.json':            { summary: '', items: [] },
};

console.log(`Writing ${PATTERNS.length} pattern folders…`);
for (const p of PATTERNS) {
  const folder = `patterns/${p.id}`;
  ensureFolder(folder);
  ensureFolder(`${folder}/research`);
  ensureFolder(`${folder}/examples`);

  const classify = p.kind === 'anti-pattern' ? 'anti-pattern' : (p.classify || 'unknown');

  const pattern = {
    id:        p.id,
    num:       p.num,
    category:  p.cat,
    layer:     p.layer,
    classify,
    title:     pick(p.title),
    one_liner: pick(p.one),
    problem:   pick(p.problem),
    solution:  pick(p.solution),
    keywords:  PATTERN_KEYWORDS?.[p.id] ?? [],
  };
  writeJson(`${folder}/pattern.json`, pattern);

  // Stub research files (only if not already present).
  for (const [name, scaffold] of Object.entries(RESEARCH_FILES)) {
    const target = `${folder}/research/${name}`;
    if (!existsSync(join(DATA, target))) {
      writeJson(target, scaffold);
    }
  }
}

/* ──────────────────────────── categories ──────────────────────────── */

console.log(`Writing ${CATEGORIES.length} category folders…`);
for (const c of CATEGORIES) {
  const folder = `categories/${c.id}`;
  ensureFolder(folder);
  writeJson(`${folder}/category.json`, {
    id:      c.id,
    num:     c.num,
    color:   c.color,
    name:    pick(c.name),
    tagline: pick(c.tagline),
    blurb:   pick(c.blurb),
  });
}

/* ──────────────────────────── concepts ──────────────────────────── */

console.log(`Writing ${CONCEPTS.length} concept folders…`);
for (const c of CONCEPTS) {
  const folder = `concepts/${c.id}`;
  ensureFolder(folder);
  writeJson(`${folder}/concept.json`, {
    id:       c.id,
    term:     pick(c.term),
    short:    pick(c.short),
    patterns: c.pats || [],
  });

  const article = CONCEPT_ARTICLES?.[c.id];
  if (article) {
    writeJson(`${folder}/article.json`, {
      lede: pick(article.lede),
      body: deepPick(article.body),
    });
  }
}

/* ──────────────────────────── tools ──────────────────────────── */

console.log(`Writing ${TOOLS_LIST.length} tool folders…`);
for (const t of TOOLS_LIST) {
  const folder = `tools/${t.id}`;
  ensureFolder(folder);
  ensureFolder(`${folder}/research`);
  const tool = {
    id:       t.id,
    name:     t.name,
    vendor:   t.vendor,
    kind:     t.kind,
    blurb:    pick(t.blurb),
    url:      t.url,
    oss_url:  t.oss || null,
    patterns: t.pats || [],
  };
  writeJson(`${folder}/tool.json`, tool);
}

/* ──────────────────────────── sources ──────────────────────────── */

console.log(`Writing ${SOURCES.length} source entries…`);
for (const s of SOURCES) {
  const folder = `sources/${s.id}`;
  ensureFolder(folder);
  writeJson(`${folder}/source.json`, {
    id:       s.id,
    title:    pick(s.title),
    author:   pick(s.author),
    kind:     s.kind,
    url:      s.url,
    patterns: s.pats || [],
  });
}

/* ──────────────────────────── meta / indexes ──────────────────────────── */

writeJson('_meta/tool-kinds.json', TOOL_KINDS.map(k => ({
  id:    k.id,
  label: pick(k.label),
  intro: pick(k.intro),
})));

writeJson('_meta/manifest.json', {
  generatedAt: new Date().toISOString(),
  locale:      LOCALE,
  counts: {
    patterns:   PATTERNS.length,
    categories: CATEGORIES.length,
    concepts:   CONCEPTS.length,
    tools:      TOOLS_LIST.length,
    sources:    SOURCES.length,
  },
});

console.log('Done.');
