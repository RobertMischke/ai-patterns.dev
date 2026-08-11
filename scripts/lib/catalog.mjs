import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(SCRIPT_DIR, '..', '..');
export const DEFAULT_DATA_ROOT = join(REPOSITORY_ROOT, 'data');
const APP_PACKAGE = join(REPOSITORY_ROOT, 'app', 'package.json');

const requireFromApp = createRequire(APP_PACKAGE);
const Ajv = requireFromApp('ajv');
const addFormats = requireFromApp('ajv-formats');

export const RESEARCH_FILES = Object.freeze([
  'counter-arguments.json',
  'critique.json',
  'extensions.json',
  'sources.json',
  'tools.json',
]);

const COLLECTIONS = Object.freeze({
  patterns: { file: 'pattern.json', schema: 'pattern.schema.json', title: 'title', singular: 'pattern' },
  categories: { file: 'category.json', schema: 'category.schema.json', title: 'name', singular: 'category' },
  concepts: { file: 'concept.json', schema: 'concept.schema.json', title: 'term', singular: 'concept' },
  tools: { file: 'tool.json', schema: 'tool.schema.json', title: 'name', singular: 'tool' },
  sources: { file: 'source.json', schema: 'source.schema.json', title: 'title', singular: 'source' },
});

const META_FILES = Object.freeze({
  radar: { file: 'radar.json', schema: 'radar.schema.json' },
  manifest: { file: 'manifest.json', schema: 'manifest.schema.json' },
  toolKinds: { file: 'tool-kinds.json', schema: 'tool-kinds.schema.json' },
});

const ABSTRACTIONS = new Set([
  'principle',
  'hub',
  'pattern',
  'variant',
  'recipe',
  'application',
]);
const RADAR_RINGS = new Set(['adopt', 'trial', 'assess', 'hold']);
const INTERNAL_REF_TYPES = new Set(['pattern', 'concept', 'tool', 'source']);

function portablePath(base, path) {
  const value = relative(base, path).split(sep).join('/');
  return value || '.';
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(compareText).map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedText(value) {
  return String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
      url.port = '';
    }
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    const sorted = [...url.searchParams.entries()].sort(([ak, av], [bk, bv]) => compareText(ak, bk) || compareText(av, bv));
    url.search = '';
    for (const [key, item] of sorted) url.searchParams.append(key, item);
    return url.toString();
  } catch {
    return String(value).trim();
  }
}

function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function hasMojibake(value) {
  return /\u00e2\u20ac|\u00c3[\u0080-\u00ff]|\u00c2[\u0080-\u00bf]|\u00ef\u00bb\u00bf|\u00f0\u0178|[\u0080-\u009f]/u.test(value);
}

function walk(value, path, visit) {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, visit));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`, visit);
  }
}

function formatAjvError(path, error) {
  const location = error.instancePath ? `${path}${error.instancePath}` : path;
  const detail = error.params?.missingProperty ? ` (${error.params.missingProperty})` : '';
  return `${location}: schema ${error.message ?? 'validation failed'}${detail}`;
}

function loadSchemaValidators(dataRoot, errors) {
  const schemaRoot = join(dataRoot, 'schemas');
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validators = new Map();
  const schemaNames = new Set([
    ...Object.values(COLLECTIONS).map(value => value.schema),
    ...Object.values(META_FILES).map(value => value.schema),
    'concept-article.schema.json',
    'research.schema.json',
  ]);

  for (const name of [...schemaNames].sort(compareText)) {
    const path = join(schemaRoot, name);
    if (!existsSync(path)) {
      errors.push(`schemas/${name}: required schema is missing`);
      continue;
    }
    try {
      const schema = JSON.parse(readFileSync(path, 'utf8'));
      validators.set(name, ajv.compile(schema));
    } catch (error) {
      errors.push(`schemas/${name}: cannot compile schema (${error.message})`);
    }
  }
  return validators;
}

function listDirectories(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter(entry => !entry.name.startsWith('_') && entry.isDirectory())
    .map(entry => entry.name)
    .sort(compareText);
}

function scanForSymlinks(path, root, errors) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    const label = portablePath(root, entryPath);
    if (entry.isSymbolicLink()) {
      errors.push(`${label}: symbolic links are not allowed in canonical data`);
    } else if (entry.isDirectory()) {
      scanForSymlinks(entryPath, root, errors);
    }
  }
}

/**
 * Load and validate the canonical catalogue without mutating it.
 *
 * @param {{ dataRoot?: string, strict?: boolean }} options
 * @returns {{ valid: boolean, errors: string[], warnings: string[], catalog: object }}
 */
export function validateCatalog({ dataRoot = DEFAULT_DATA_ROOT, strict = false } = {}) {
  const root = resolve(dataRoot);
  const errors = [];
  const warnings = [];
  const documents = [];
  const validators = loadSchemaValidators(root, errors);
  const catalog = {
    patterns: [],
    categories: [],
    concepts: [],
    tools: [],
    sources: [],
    articles: new Map(),
    research: new Map(),
    radar: undefined,
    manifest: undefined,
    toolKinds: undefined,
  };

  const reportPublicationIssue = message => (strict ? errors : warnings).push(message);

  if (!existsSync(root)) {
    return {
      valid: false,
      errors: [`${root}: data root does not exist`],
      warnings,
      catalog,
    };
  }

  scanForSymlinks(root, root, errors);
  const allowedRootEntries = new Set([
    ...Object.keys(COLLECTIONS),
    '_meta',
    'schemas',
    'README.md',
  ]);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!allowedRootEntries.has(entry.name)) {
      errors.push(`${entry.name}: unexpected entry at the canonical data root`);
    }
  }

  function readDocument(path) {
    const label = portablePath(root, path);
    if (!existsSync(path)) {
      errors.push(`${label}: required file is missing`);
      return undefined;
    }
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'));
      documents.push({ label, value });
      return value;
    } catch (error) {
      errors.push(`${label}: invalid JSON (${error.message})`);
      return undefined;
    }
  }

  function applySchema(name, value, label) {
    if (value === undefined) return;
    const validate = validators.get(name);
    if (!validate) return;
    if (!validate(value)) {
      for (const error of validate.errors ?? []) errors.push(formatAjvError(label, error));
    }
  }

  for (const [collectionName, config] of Object.entries(COLLECTIONS)) {
    const collectionRoot = join(root, collectionName);
    if (!existsSync(collectionRoot)) {
      errors.push(`${collectionName}: required directory is missing`);
      continue;
    }
    const collectionState = lstatSync(collectionRoot);
    if (collectionState.isSymbolicLink() || !collectionState.isDirectory()) {
      errors.push(`${collectionName}: required collection must be a real directory`);
      continue;
    }
    for (const entry of readdirSync(collectionRoot, { withFileTypes: true })) {
      if (!entry.name.startsWith('_') && !entry.isDirectory()) {
        errors.push(`${collectionName}/${entry.name}: entity collections may contain directories only`);
      }
    }
    for (const folder of listDirectories(collectionRoot)) {
      const entityRoot = join(collectionRoot, folder);
      const allowedEntityEntries = new Set(
        collectionName === 'patterns'
          ? [config.file, 'research', 'examples']
          : collectionName === 'concepts'
            ? [config.file, 'article.json']
            : [config.file],
      );
      for (const entry of readdirSync(entityRoot, { withFileTypes: true })) {
        if (!allowedEntityEntries.has(entry.name)) {
          errors.push(`${portablePath(root, join(entityRoot, entry.name))}: unexpected entity entry`);
        }
      }

      const path = join(entityRoot, config.file);
      const label = portablePath(root, path);
      const record = readDocument(path);
      applySchema(config.schema, record, label);
      if (record === undefined || typeof record !== 'object' || Array.isArray(record)) continue;
      catalog[collectionName].push(record);
      if (record.id !== folder) errors.push(`${label}: folder id "${folder}" does not match record id "${String(record.id)}"`);

      if (collectionName === 'concepts') {
        const articlePath = join(collectionRoot, folder, 'article.json');
        if (existsSync(articlePath)) {
          const article = readDocument(articlePath);
          applySchema('concept-article.schema.json', article, portablePath(root, articlePath));
          if (article !== undefined) catalog.articles.set(record.id, article);
        }
      }
    }
  }

  for (const [key, config] of Object.entries(META_FILES)) {
    const path = join(root, '_meta', config.file);
    const value = readDocument(path);
    applySchema(config.schema, value, portablePath(root, path));
    catalog[key] = value;
  }

  const idsByType = {};
  for (const [collectionName, config] of Object.entries(COLLECTIONS)) {
    const records = catalog[collectionName];
    const ids = new Set();
    const numbers = new Map();
    const titles = new Map();
    for (const record of records) {
      if (typeof record.id === 'string') {
        if (ids.has(record.id)) errors.push(`${collectionName}: duplicate id "${record.id}"`);
        ids.add(record.id);
      }
      if (typeof record.num === 'string') {
        const previous = numbers.get(record.num);
        if (previous) errors.push(`${collectionName}: duplicate num "${record.num}" (${previous}, ${record.id})`);
        else numbers.set(record.num, record.id);
      }
      const title = record[config.title];
      if (typeof title === 'string' && title.trim()) {
        const normalized = normalizedText(title);
        const previous = titles.get(normalized);
        if (previous) errors.push(`${collectionName}: duplicate title "${title}" (${previous}, ${record.id})`);
        else titles.set(normalized, record.id);
      }
    }
    idsByType[config.singular] = ids;
  }

  const patternById = new Map(catalog.patterns.map(record => [record.id, record]));
  const categoryIds = idsByType.category ?? new Set();
  const toolKindIds = new Set();
  if (Array.isArray(catalog.toolKinds)) {
    for (const kind of catalog.toolKinds) {
      if (toolKindIds.has(kind?.id)) errors.push(`_meta/tool-kinds.json: duplicate tool kind id "${String(kind?.id)}"`);
      if (typeof kind?.id === 'string') toolKindIds.add(kind.id);
    }
  }

  for (const pattern of catalog.patterns) {
    if (!categoryIds.has(pattern.category)) {
      errors.push(`patterns/${pattern.id}/pattern.json: missing category "${String(pattern.category)}"`);
    }
    if (!ABSTRACTIONS.has(pattern.abstraction ?? 'pattern')) {
      errors.push(`patterns/${pattern.id}/pattern.json: unknown abstraction "${String(pattern.abstraction)}"`);
    }
    if (!Array.isArray(pattern.keywords) || pattern.keywords.length === 0) {
      reportPublicationIssue(`patterns/${pattern.id}/pattern.json: keywords must not be empty in a published catalogue`);
    }
    if (pattern.classify === 'unknown') {
      reportPublicationIssue(`patterns/${pattern.id}/pattern.json: classify must be resolved before publication`);
    }
  }

  for (const concept of catalog.concepts) {
    for (const patternId of concept.patterns ?? []) {
      if (!patternById.has(patternId)) errors.push(`concepts/${concept.id}/concept.json: missing pattern "${patternId}"`);
    }
  }
  for (const tool of catalog.tools) {
    if (!toolKindIds.has(tool.kind)) errors.push(`tools/${tool.id}/tool.json: unknown tool kind "${String(tool.kind)}"`);
    for (const patternId of tool.patterns ?? []) {
      if (!patternById.has(patternId)) errors.push(`tools/${tool.id}/tool.json: missing pattern "${patternId}"`);
    }
  }
  for (const source of catalog.sources) {
    for (const patternId of source.patterns ?? []) {
      if (!patternById.has(patternId)) errors.push(`sources/${source.id}/source.json: missing pattern "${patternId}"`);
    }
  }

  const refs = {
    pattern: new Map(catalog.patterns.map(record => [record.id, record])),
    concept: new Map(catalog.concepts.map(record => [record.id, record])),
    tool: new Map(catalog.tools.map(record => [record.id, record])),
    source: new Map(catalog.sources.map(record => [record.id, record])),
  };
  const patternLinks = new Map(catalog.patterns.map(pattern => [pattern.id, new Set()]));

  for (const pattern of catalog.patterns) {
    const researchRoot = join(root, 'patterns', pattern.id, 'research');
    if (!existsSync(researchRoot)) {
      errors.push(`patterns/${pattern.id}/research: required directory is missing`);
      continue;
    }
    const researchEntries = readdirSync(researchRoot, { withFileTypes: true });
    const actualFiles = researchEntries
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
      .sort(compareText);
    for (const missing of RESEARCH_FILES.filter(name => !actualFiles.includes(name))) {
      errors.push(`patterns/${pattern.id}/research/${missing}: required research sidecar is missing`);
    }
    for (const entry of researchEntries.filter(entry => !RESEARCH_FILES.includes(entry.name))) {
      errors.push(`patterns/${pattern.id}/research/${entry.name}: unexpected research entry`);
    }

    const patternResearch = {};
    for (const file of RESEARCH_FILES) {
      const path = join(researchRoot, file);
      if (!existsSync(path)) continue;
      const label = portablePath(root, path);
      const research = readDocument(path);
      applySchema('research.schema.json', research, label);
      if (research === undefined || typeof research !== 'object' || Array.isArray(research)) continue;
      patternResearch[file] = research;
      const opinionated = file === 'critique.json' || file === 'counter-arguments.json';
      if (opinionated && !Array.isArray(research.points)) errors.push(`${label}: expected an opinionated research document with points`);
      if (!opinionated && !Array.isArray(research.items)) errors.push(`${label}: expected an item-list research document with items`);
      if (typeof research.summary !== 'string' || !research.summary.trim()) {
        reportPublicationIssue(`${label}: summary must not be empty in a published catalogue`);
      }
      const entries = opinionated ? research.points : research.items;
      if (!Array.isArray(entries) || entries.length === 0) {
        reportPublicationIssue(`${label}: ${opinionated ? 'points' : 'items'} must not be empty in a published catalogue`);
      }
      if (opinionated && research.stance === 'unknown') {
        reportPublicationIssue(`${label}: stance must be resolved before publication`);
      }

      if (opinionated) {
        for (const [index, point] of (research.points ?? []).entries()) {
          if (!point?.source_id) continue;
          const target = refs.source.get(point.source_id);
          if (!target) {
            errors.push(`${label}.points[${index}]: missing source "${point.source_id}"`);
          } else if (!target.patterns?.includes(pattern.id)) {
            errors.push(`${label}.points[${index}]: source "${point.source_id}" is missing backlink to pattern "${pattern.id}"`);
          }
        }
      } else {
        const logicalRefs = new Map();
        for (const [index, item] of (research.items ?? []).entries()) {
          if (!item || typeof item !== 'object') continue;
          const itemPath = `${label}.items[${index}]`;
          if (item.ref_type === 'external') {
            if (!isHttpsUrl(item.url)) errors.push(`${itemPath}: external reference requires an absolute HTTPS URL`);
          } else if (INTERNAL_REF_TYPES.has(item.ref_type)) {
            const target = refs[item.ref_type].get(item.ref_id);
            if (!target) {
              errors.push(`${itemPath}: missing ${item.ref_type} "${String(item.ref_id)}"`);
            } else if (item.ref_type === 'pattern') {
              if (item.ref_id === pattern.id) errors.push(`${itemPath}: pattern must not reference itself`);
              patternLinks.get(pattern.id)?.add(item.ref_id);
            } else if (!target.patterns?.includes(pattern.id)) {
              errors.push(`${itemPath}: ${item.ref_type} "${item.ref_id}" is missing backlink to pattern "${pattern.id}"`);
            }
          }

          if (item.ref_type) {
            const logicalKey = item.ref_type === 'external'
              ? `external:${normalizedUrl(item.url)}`
              : `${item.ref_type}:${item.ref_id}`;
            const previous = logicalRefs.get(logicalKey);
            if (previous !== undefined) errors.push(`${itemPath}: duplicate logical reference (already at items[${previous}])`);
            else logicalRefs.set(logicalKey, index);
          }
        }
      }
    }
    catalog.research.set(pattern.id, patternResearch);
  }

  for (const [sourceId, targets] of patternLinks) {
    for (const targetId of targets) {
      if (!patternLinks.get(targetId)?.has(sourceId)) {
        errors.push(`patterns/${sourceId}/research/extensions.json: pattern extension to "${targetId}" is not reciprocal`);
      }
    }
  }
  for (const pattern of catalog.patterns) {
    if ((pattern.abstraction ?? 'pattern') !== 'pattern' && (patternLinks.get(pattern.id)?.size ?? 0) === 0) {
      errors.push(`patterns/${pattern.id}/research/extensions.json: abstraction "${pattern.abstraction}" requires a pattern relation`);
    }
  }

  const urls = new Map();
  for (const [kind, records] of [['source', catalog.sources], ['tool', catalog.tools]]) {
    for (const record of records) {
      for (const field of kind === 'tool' ? ['url', 'oss_url'] : ['url']) {
        const value = record[field];
        if (value === null || value === undefined) continue;
        const label = `${kind}s/${record.id}/${kind}.json.${field}`;
        if (!isHttpsUrl(value)) {
          errors.push(`${label}: URL must be absolute HTTPS`);
          continue;
        }
        const normalized = normalizedUrl(value);
        const previous = urls.get(normalized);
        if (previous && previous.recordId !== record.id) {
          errors.push(`${label}: duplicate normalized URL (already used by ${previous.label})`);
        } else if (!previous) {
          urls.set(normalized, { label, recordId: record.id });
        }
      }
    }
  }

  if (catalog.radar && typeof catalog.radar === 'object') {
    const ringIds = new Set();
    for (const ring of catalog.radar.rings ?? []) {
      if (ringIds.has(ring?.id)) errors.push(`_meta/radar.json: duplicate ring id "${String(ring?.id)}"`);
      if (typeof ring?.id === 'string') ringIds.add(ring.id);
    }
    for (const expected of RADAR_RINGS) {
      if (!ringIds.has(expected)) errors.push(`_meta/radar.json: required ring "${expected}" is missing`);
    }
    for (const actual of ringIds) {
      if (!RADAR_RINGS.has(actual)) errors.push(`_meta/radar.json: unknown ring "${actual}"`);
    }

    const positions = catalog.radar.positions ?? {};
    for (const pattern of catalog.patterns) {
      if (!Object.hasOwn(positions, pattern.id)) errors.push(`_meta/radar.json: missing radar position for pattern "${pattern.id}"`);
    }
    for (const [patternId, ringId] of Object.entries(positions)) {
      if (!patternById.has(patternId)) errors.push(`_meta/radar.json: radar position references missing pattern "${patternId}"`);
      if (!RADAR_RINGS.has(ringId)) errors.push(`_meta/radar.json: radar position for "${patternId}" uses unknown ring "${ringId}"`);
    }

    const sectors = catalog.radar.sector_short ?? {};
    for (const categoryId of categoryIds) {
      if (!Object.hasOwn(sectors, categoryId)) errors.push(`_meta/radar.json: missing sector label for category "${categoryId}"`);
    }
    for (const categoryId of Object.keys(sectors)) {
      if (!categoryIds.has(categoryId)) errors.push(`_meta/radar.json: sector label references missing category "${categoryId}"`);
    }
  }

  if (catalog.manifest && typeof catalog.manifest === 'object') {
    const expectedCounts = {
      patterns: catalog.patterns.length,
      categories: catalog.categories.length,
      concepts: catalog.concepts.length,
      tools: catalog.tools.length,
      sources: catalog.sources.length,
    };
    for (const [name, count] of Object.entries(expectedCounts)) {
      if (catalog.manifest.counts?.[name] !== count) {
        errors.push(`_meta/manifest.json: stale ${name} count ${String(catalog.manifest.counts?.[name])}; expected ${count}`);
      }
    }
  }

  for (const { label, value } of documents) {
    walk(value, label, (item, itemPath) => {
      if (typeof item === 'string' && hasMojibake(item)) errors.push(`${itemPath}: probable mojibake`);
      if (Array.isArray(item)) {
        const seen = new Map();
        item.forEach((entry, index) => {
          const key = canonicalJson(entry);
          if (seen.has(key)) errors.push(`${itemPath}[${index}]: duplicate array item (already at index ${seen.get(key)})`);
          else seen.set(key, index);
        });
      }
    });
  }

  errors.sort(compareText);
  warnings.sort(compareText);
  return { valid: errors.length === 0, errors, warnings, catalog };
}

export function formatValidationResult(result) {
  const lines = [];
  if (result.errors.length) {
    lines.push(`Validation failed with ${result.errors.length} error(s):`);
    for (const error of result.errors) lines.push(`  - ${error}`);
  } else {
    lines.push('Catalogue validation passed.');
  }
  if (result.warnings.length) {
    lines.push(`Warnings (${result.warnings.length}):`);
    for (const warning of result.warnings) lines.push(`  - ${warning}`);
  }
  return lines.join('\n');
}
