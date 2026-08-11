#!/usr/bin/env node
/**
 * Validate data/, then generate the TypeScript catalogue and public JSON assets.
 * All output is prepared in sibling staging directories before the existing
 * generated directories are swapped. Canonical data/ is read-only here.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatValidationResult,
  validateCatalog,
} from './lib/catalog.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const DATA = join(ROOT, 'data');
const APP = join(ROOT, 'app');
const OUT_TS = resolve(APP, 'src', 'data');
const OUT_ASSET = resolve(APP, 'public', 'data');
const ALLOWED_TARGETS = new Set([OUT_TS, OUT_ASSET]);

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function portableRelative(path) {
  return relative(ROOT, path).split(sep).join('/');
}

function copyTree(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source).sort(compareText)) {
    const sourcePath = join(source, entry);
    const destinationPath = join(destination, entry);
    if (statSync(sourcePath).isDirectory()) copyTree(sourcePath, destinationPath);
    else copyFileSync(sourcePath, destinationPath);
  }
}

function patternNumber(record) {
  const match = /^(P|A)-(\d+)$/.exec(record.num);
  return match
    ? { family: match[1] === 'P' ? 0 : 1, value: Number(match[2]) }
    : { family: 2, value: Number.MAX_SAFE_INTEGER };
}

function sortPatterns(records) {
  return [...records].sort((left, right) => {
    const a = patternNumber(left);
    const b = patternNumber(right);
    return a.family - b.family || a.value - b.value || compareText(left.id, right.id);
  });
}

function sortCategories(records) {
  return [...records].sort((left, right) => Number(left.num) - Number(right.num) || compareText(left.id, right.id));
}

function sortBy(field, records) {
  return [...records].sort((left, right) => compareText(left[field], right[field]) || compareText(left.id, right.id));
}

function sortSources(records) {
  return [...records].sort((left, right) => {
    const a = /^s(\d+)$/.exec(left.id);
    const b = /^s(\d+)$/.exec(right.id);
    return Number(a?.[1] ?? Number.MAX_SAFE_INTEGER) - Number(b?.[1] ?? Number.MAX_SAFE_INTEGER)
      || compareText(left.id, right.id);
  });
}

function assertGeneratedPath(path, kind) {
  const resolved = resolve(path);
  if (kind === 'target') {
    if (!ALLOWED_TARGETS.has(resolved)) throw new Error(`Refusing unexpected generated target: ${resolved}`);
    return;
  }
  const parent = dirname(resolved);
  const target = [...ALLOWED_TARGETS].find(candidate => dirname(candidate) === parent);
  const expectedPrefix = target ? `.${basename(target)}.${kind}-` : '';
  if (!target || !basename(resolved).startsWith(expectedPrefix)) {
    throw new Error(`Refusing unexpected generated ${kind} path: ${resolved}`);
  }
}

function removeGenerated(path, kind) {
  assertGeneratedPath(path, kind);
  if (existsSync(path)) rmSync(path, { recursive: true, force: true });
}

function createStage(target) {
  assertGeneratedPath(target, 'target');
  mkdirSync(dirname(target), { recursive: true });
  return mkdtempSync(join(dirname(target), `.${basename(target)}.stage-`));
}

function renameWithRetry(source, destination) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      renameSync(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!['EACCES', 'EBUSY', 'EPERM'].includes(error.code) || attempt === 3) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
  throw lastError;
}

function installStage(entry) {
  entry.installStarted = true;
  try {
    renameWithRetry(entry.stage, entry.target);
  } catch (error) {
    if (process.platform !== 'win32' || !['EACCES', 'EBUSY', 'EPERM'].includes(error.code)) throw error;
    // Windows can reject a directory rename while a descendant was recently
    // scanned. The fully prepared stage is still copied as one guarded unit;
    // rollback removes a partial target if this fallback itself fails.
    copyTree(entry.stage, entry.target);
  }
  entry.installed = true;
}

function installStages(entries) {
  for (const entry of entries) {
    assertGeneratedPath(entry.target, 'target');
    assertGeneratedPath(entry.stage, 'stage');
    assertGeneratedPath(entry.backup, 'backup');
  }

  let completed = false;
  try {
    for (const entry of entries) {
      entry.hadTarget = existsSync(entry.target);
      if (entry.hadTarget) {
        renameWithRetry(entry.target, entry.backup);
        entry.backedUp = true;
      }
      installStage(entry);
    }
    completed = true;
  } catch (installError) {
    const rollbackErrors = [];
    for (const entry of [...entries].reverse()) {
      try {
        if (entry.installStarted && existsSync(entry.target)) removeGenerated(entry.target, 'target');
        if (entry.backedUp && existsSync(entry.backup)) renameWithRetry(entry.backup, entry.target);
      } catch (rollbackError) {
        rollbackErrors.push(`${portableRelative(entry.target)}: ${rollbackError.message}`);
      }
    }
    if (rollbackErrors.length) {
      throw new Error(`${installError.message}; rollback also failed: ${rollbackErrors.join('; ')}`);
    }
    throw installError;
  } finally {
    for (const entry of entries) {
      if (existsSync(entry.stage)) removeGenerated(entry.stage, 'stage');
      if (completed && existsSync(entry.backup)) removeGenerated(entry.backup, 'backup');
    }
  }
}

console.log('Validating canonical data...');
const validation = validateCatalog({ dataRoot: DATA, strict: true });
if (!validation.valid) {
  console.error(formatValidationResult(validation));
  process.exit(1);
}

const { catalog } = validation;
const patterns = sortPatterns(catalog.patterns);
const categories = sortCategories(catalog.categories);
const concepts = sortBy('id', catalog.concepts).map(concept => ({
  ...concept,
  has_article: catalog.articles.has(concept.id),
}));
const tools = sortBy('id', catalog.tools);
const sources = sortSources(catalog.sources);
const toolKinds = catalog.toolKinds;
const radarMeta = catalog.radar;

const typesSource = `// AUTO-GENERATED by scripts/build-data.mjs — do not edit by hand.

export type PatternClassify = 'new' | 'intensified' | 'proven' | 'anti-pattern' | 'unknown';
export type PatternLayer    = 'operating' | 'infra';
export type PatternAbstraction = 'principle' | 'hub' | 'pattern' | 'variant' | 'recipe' | 'application';

export interface Pattern {
  id: string;
  num: string;
  category: string;
  layer: PatternLayer;
  classify: PatternClassify;
  abstraction?: PatternAbstraction;
  title: string;
  one_liner: string;
  problem: string;
  solution: string;
  keywords: string[];
}

export interface Category {
  id: string;
  num: string;
  color: string;
  name: string;
  tagline: string;
  blurb: string;
}

export interface Concept {
  id: string;
  term: string;
  short: string;
  patterns: string[];
  has_article: boolean;
}

export interface Tool {
  id: string;
  name: string;
  vendor: string;
  kind: string;
  blurb: string;
  url: string;
  oss_url: string | null;
  patterns: string[];
}

export interface Source {
  id: string;
  title: string;
  author: string;
  kind: 'post' | 'doc' | 'paper' | 'video' | 'book' | 'other';
  url: string;
  patterns: string[];
}

export interface ToolKind {
  id: string;
  label: string;
  intro: string;
}

export type RadarRingId = 'adopt' | 'trial' | 'assess' | 'hold';
export interface RadarRing {
  id: RadarRingId;
  label: string;
  color: string;
  hint: string;
}
export interface RadarMeta {
  rings: readonly RadarRing[];
  sector_short: Readonly<Record<string, string>>;
  positions: Readonly<Record<string, RadarRingId>>;
}
`;

const indexSource = `// AUTO-GENERATED by scripts/build-data.mjs — do not edit by hand.

import type { Pattern, PatternAbstraction, Category, Concept, Tool, Source, ToolKind, RadarMeta, RadarRingId } from './types';

export const PATTERNS:   readonly Pattern[]   = ${JSON.stringify(patterns, null, 2)} as const;
export const CATEGORIES: readonly Category[]  = ${JSON.stringify(categories, null, 2)} as const;
export const CONCEPTS:   readonly Concept[]   = ${JSON.stringify(concepts, null, 2)} as const;
export const TOOLS:      readonly Tool[]      = ${JSON.stringify(tools, null, 2)} as const;
export const SOURCES:    readonly Source[]    = ${JSON.stringify(sources, null, 2)} as const;
export const TOOL_KINDS: readonly ToolKind[]  = ${JSON.stringify(toolKinds, null, 2)} as const;
export const RADAR:      RadarMeta            = ${JSON.stringify(radarMeta, null, 2)} as const;

export const PATTERN_BY_ID:  ReadonlyMap<string, Pattern>  = new Map(PATTERNS.map(p => [p.id, p]));
export const CATEGORY_BY_ID: ReadonlyMap<string, Category> = new Map(CATEGORIES.map(c => [c.id, c]));
export const CONCEPT_BY_ID:  ReadonlyMap<string, Concept>  = new Map(CONCEPTS.map(c => [c.id, c]));
export const TOOL_BY_ID:     ReadonlyMap<string, Tool>     = new Map(TOOLS.map(t => [t.id, t]));
export const SOURCE_BY_ID:   ReadonlyMap<string, Source>   = new Map(SOURCES.map(s => [s.id, s]));

/** Explicit abstraction kind, with legacy records treated as regular patterns. */
export function patternAbstractionOf(p: Pattern): PatternAbstraction {
  return p.abstraction ?? 'pattern';
}

/** Curated radar position for a pattern, falling back to the classify-derived ring. */
export function radarRingOf(p: Pattern): RadarRingId {
  const curated = RADAR.positions[p.id];
  if (curated) return curated;
  if (p.classify === 'anti-pattern') return 'hold';
  if (p.classify === 'proven') return 'adopt';
  if (p.classify === 'intensified') return 'trial';
  return 'assess';
}

export type { Pattern, PatternAbstraction, Category, Concept, Tool, Source, ToolKind, RadarMeta, RadarRingId, RadarRing } from './types';
`;

let tsStage;
let assetStage;
let entries = [];
try {
  tsStage = createStage(OUT_TS);
  assetStage = createStage(OUT_ASSET);
  entries = [
    {
      target: OUT_TS,
      stage: tsStage,
      backup: join(dirname(OUT_TS), `.${basename(OUT_TS)}.backup-${randomUUID()}`),
    },
    {
      target: OUT_ASSET,
      stage: assetStage,
      backup: join(dirname(OUT_ASSET), `.${basename(OUT_ASSET)}.backup-${randomUUID()}`),
    },
  ];
  writeFileSync(join(tsStage, 'types.ts'), typesSource, 'utf8');
  writeFileSync(join(tsStage, 'index.ts'), indexSource, 'utf8');
  for (const subdirectory of ['_meta', 'categories', 'concepts', 'patterns', 'sources', 'tools']) {
    copyTree(join(DATA, subdirectory), join(assetStage, subdirectory));
  }
  installStages(entries);
} catch (error) {
  if (tsStage && existsSync(tsStage)) removeGenerated(tsStage, 'stage');
  if (assetStage && existsSync(assetStage)) removeGenerated(assetStage, 'stage');
  console.error(`Generation failed: ${error.message}`);
  process.exit(1);
}

console.log(`Generated ${portableRelative(OUT_TS)} and ${portableRelative(OUT_ASSET)}.`);
console.log(
  `Summary: ${patterns.length} patterns, ${categories.length} categories, ` +
  `${concepts.length} concepts, ${tools.length} tools, ${sources.length} sources`,
);
