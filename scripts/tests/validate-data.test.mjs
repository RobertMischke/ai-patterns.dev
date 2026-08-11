import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from '../lib/catalog.mjs';

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANONICAL_DATA = join(SCRIPT_ROOT, 'data');
const temporaryRoots = [];

function fixture() {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'ai-patterns-catalog-'));
  temporaryRoots.push(temporaryRoot);
  const dataRoot = join(temporaryRoot, 'data');
  cpSync(CANONICAL_DATA, dataRoot, { recursive: true });
  return dataRoot;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function snapshot(...paths) {
  const originals = paths.map(path => [path, readFileSync(path)]);
  return () => {
    for (const [path, contents] of originals) writeFileSync(path, contents);
  };
}

function patternIds(dataRoot) {
  return readdirSync(join(dataRoot, 'patterns')).sort();
}

function sourceIds(dataRoot) {
  return readdirSync(join(dataRoot, 'sources')).sort();
}

function toolIds(dataRoot) {
  return readdirSync(join(dataRoot, 'tools')).sort();
}

function validate(dataRoot) {
  return validateCatalog({ dataRoot, strict: true });
}

function errorText(result) {
  return result.errors.join('\n');
}

const TEST_DATA = fixture();

after(() => {
  for (const temporaryRoot of temporaryRoots) {
    const resolved = resolve(temporaryRoot);
    assert.ok(resolved.startsWith(resolve(tmpdir())), `unsafe temporary path: ${resolved}`);
    assert.match(resolved.split(/[\\/]/).at(-1), /^ai-patterns-catalog-/);
    rmSync(resolved, { recursive: true, force: true });
  }
});

test('the canonical catalogue passes strict validation', () => {
  const result = validate(CANONICAL_DATA);
  assert.equal(result.valid, true, errorText(result));
  assert.deepEqual(result.errors, []);
});

test('duplicate pattern numbers are rejected', () => {
  const dataRoot = TEST_DATA;
  const [firstId, secondId] = patternIds(dataRoot);
  const first = readJson(join(dataRoot, 'patterns', firstId, 'pattern.json'));
  const secondPath = join(dataRoot, 'patterns', secondId, 'pattern.json');
  const restore = snapshot(secondPath);
  const second = readJson(secondPath);
  try {
    second.num = first.num;
    writeJson(secondPath, second);

    const result = validate(dataRoot);
    assert.equal(result.valid, false);
    assert.match(errorText(result), /duplicate num/);
  } finally {
    restore();
  }
});

test('folder identity and JSON schema violations are rejected', () => {
  const dataRoot = TEST_DATA;
  const id = patternIds(dataRoot)[0];
  const path = join(dataRoot, 'patterns', id, 'pattern.json');
  const restore = snapshot(path);
  const pattern = readJson(path);
  try {
    pattern.id = 'different-valid-id';
    delete pattern.title;
    writeJson(path, pattern);

    const result = validate(dataRoot);
    assert.equal(result.valid, false);
    assert.match(errorText(result), /folder id .* does not match record id/);
    assert.match(errorText(result), /schema must have required property 'title'/);
  } finally {
    restore();
  }
});

test('unexpected canonical data entries are rejected', () => {
  const path = join(TEST_DATA, 'unexpected.json');
  try {
    writeFileSync(path, '{}\n', 'utf8');
    const result = validate(TEST_DATA);
    assert.equal(result.valid, false);
    assert.match(errorText(result), /unexpected entry at the canonical data root/);
  } finally {
    rmSync(path, { force: true });
  }
});

test('entity references require a backlink to their pattern', () => {
  const dataRoot = TEST_DATA;
  const patterns = patternIds(dataRoot);
  const sources = sourceIds(dataRoot);
  let selected;
  for (const patternId of patterns) {
    for (const sourceId of sources) {
      const source = readJson(join(dataRoot, 'sources', sourceId, 'source.json'));
      if (!source.patterns.includes(patternId)) {
        selected = { patternId, sourceId };
        break;
      }
    }
    if (selected) break;
  }
  assert.ok(selected, 'fixture needs an unlinked pattern/source pair');
  const researchPath = join(dataRoot, 'patterns', selected.patternId, 'research', 'sources.json');
  const restore = snapshot(researchPath);
  const research = readJson(researchPath);
  try {
    research.items.push({
      text: 'Deliberately missing reverse catalogue link.',
      ref_type: 'source',
      ref_id: selected.sourceId,
    });
    writeJson(researchPath, research);

    const result = validate(dataRoot);
    assert.equal(result.valid, false);
    assert.match(errorText(result), /is missing backlink to pattern/);
  } finally {
    restore();
  }
});

test('pattern extension links must be reciprocal', () => {
  const dataRoot = TEST_DATA;
  const ids = patternIds(dataRoot);
  let selected;
  for (const sourceId of ids) {
    const sourceExtensions = readJson(join(dataRoot, 'patterns', sourceId, 'research', 'extensions.json'));
    const outgoing = new Set(sourceExtensions.items.filter(item => item.ref_type === 'pattern').map(item => item.ref_id));
    for (const targetId of ids) {
      if (targetId === sourceId || outgoing.has(targetId)) continue;
      const targetExtensions = readJson(join(dataRoot, 'patterns', targetId, 'research', 'extensions.json'));
      if (!targetExtensions.items.some(item => item.ref_type === 'pattern' && item.ref_id === sourceId)) {
        selected = { sourceId, targetId, sourceExtensions };
        break;
      }
    }
    if (selected) break;
  }
  assert.ok(selected, 'fixture needs an unrelated pattern pair');
  const path = join(dataRoot, 'patterns', selected.sourceId, 'research', 'extensions.json');
  const restore = snapshot(path);
  try {
    selected.sourceExtensions.items.push({
      text: 'Deliberately asymmetric test relation.',
      ref_type: 'pattern',
      ref_id: selected.targetId,
    });
    writeJson(path, selected.sourceExtensions);

    const result = validate(dataRoot);
    assert.equal(result.valid, false);
    assert.match(errorText(result), /is not reciprocal/);
  } finally {
    restore();
  }
});

test('placeholder URLs and mixed reference contracts are rejected', () => {
  const dataRoot = TEST_DATA;
  const sourceId = sourceIds(dataRoot)[0];
  const sourcePath = join(dataRoot, 'sources', sourceId, 'source.json');
  const source = readJson(sourcePath);
  const patternId = patternIds(dataRoot)[0];
  const researchPath = join(dataRoot, 'patterns', patternId, 'research', 'sources.json');
  const restore = snapshot(sourcePath, researchPath);
  const research = readJson(researchPath);
  try {
    source.url = '#';
    writeJson(sourcePath, source);
    research.items.push({
      text: 'Internal references may not also carry an external URL.',
      ref_type: 'source',
      ref_id: sourceId,
      url: 'https://example.com/not-allowed-here',
    });
    writeJson(researchPath, research);

    const result = validate(dataRoot);
    assert.equal(result.valid, false);
    assert.match(errorText(result), /URL must be absolute HTTPS|schema must match pattern/);
    assert.match(errorText(result), /schema must NOT be valid|schema must match "then" schema/);
  } finally {
    restore();
  }
});

test('unknown tool kinds are rejected', () => {
  const dataRoot = TEST_DATA;
  const id = toolIds(dataRoot)[0];
  const path = join(dataRoot, 'tools', id, 'tool.json');
  const restore = snapshot(path);
  const tool = readJson(path);
  try {
    tool.kind = 'not-a-registered-kind';
    writeJson(path, tool);

    const result = validate(dataRoot);
    assert.equal(result.valid, false);
    assert.match(errorText(result), /unknown tool kind/);
  } finally {
    restore();
  }
});

test('every pattern requires an exact radar position', () => {
  const dataRoot = TEST_DATA;
  const path = join(dataRoot, '_meta', 'radar.json');
  const restore = snapshot(path);
  const radar = readJson(path);
  const missingId = Object.keys(radar.positions)[0];
  try {
    delete radar.positions[missingId];
    writeJson(path, radar);

    const result = validate(dataRoot);
    assert.equal(result.valid, false);
    assert.match(errorText(result), new RegExp(`missing radar position for pattern "${missingId}"`));
  } finally {
    restore();
  }
});

test('stale manifest counts are rejected', () => {
  const dataRoot = TEST_DATA;
  const path = join(dataRoot, '_meta', 'manifest.json');
  const restore = snapshot(path);
  const manifest = readJson(path);
  try {
    manifest.counts.patterns += 1;
    writeJson(path, manifest);

    const result = validate(dataRoot);
    assert.equal(result.valid, false);
    assert.match(errorText(result), /stale patterns count/);
  } finally {
    restore();
  }
});

test('empty research is rejected in strict publication mode', () => {
  const dataRoot = TEST_DATA;
  const patternId = patternIds(dataRoot)[0];
  const path = join(dataRoot, 'patterns', patternId, 'research', 'sources.json');
  const restore = snapshot(path);
  try {
    writeJson(path, { summary: '', items: [] });

    const result = validate(dataRoot);
    assert.equal(result.valid, false);
    assert.match(errorText(result), /summary must not be empty in a published catalogue/);
    assert.match(errorText(result), /items must not be empty in a published catalogue/);
  } finally {
    restore();
  }
});
