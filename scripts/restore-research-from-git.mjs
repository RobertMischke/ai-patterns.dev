#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = realpathSync(resolve(SCRIPT_DIR, '..'));
const PATTERNS_DIR = realpathSync(join(ROOT, 'data', 'patterns'));
const RESEARCH_FILES = [
  'sources.json',
  'tools.json',
  'extensions.json',
  'critique.json',
  'counter-arguments.json',
];

function usage() {
  console.log('Usage: node scripts/restore-research-from-git.mjs --from <commit> [--apply]');
  console.log('Without --apply, the command performs a dry run. Only semantically empty files are eligible.');
}

const args = process.argv.slice(2);
const fromIndex = args.indexOf('--from');
const revision = fromIndex >= 0 ? args[fromIndex + 1] : undefined;
const apply = args.includes('--apply');

if (!revision || !/^[0-9a-fA-F]{7,40}$/.test(revision)) {
  usage();
  process.exitCode = 2;
} else {
  restore(revision, apply);
}

function isSemanticallyEmpty(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    if ('items' in value) return isSemanticallyEmpty(value.items);
    if ('stance' in value && 'summary' in value && 'points' in value) {
      return isSemanticallyEmpty(value.points);
    }
    return Object.values(value).every(isSemanticallyEmpty);
  }
  return false;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function assertInsidePatterns(filePath) {
  const absolute = resolve(filePath);
  if (absolute !== PATTERNS_DIR && !absolute.startsWith(`${PATTERNS_DIR}${sep}`)) {
    throw new Error(`Refusing to access a path outside data/patterns: ${absolute}`);
  }
}

function restore(revisionToRead, shouldApply) {
  const candidates = [];
  const skipped = [];

  for (const entry of readdirSync(PATTERNS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    for (const fileName of RESEARCH_FILES) {
      const filePath = join(PATTERNS_DIR, entry.name, 'research', fileName);
      assertInsidePatterns(filePath);
      if (!existsSync(filePath)) continue;

      const currentText = readFileSync(filePath, 'utf8');
      if (!isSemanticallyEmpty(parseJson(currentText, relative(ROOT, filePath)))) continue;

      const repositoryPath = relative(ROOT, filePath).split(sep).join('/');
      let historicalText;
      try {
        historicalText = execFileSync(
          'git',
          ['show', `${revisionToRead}:${repositoryPath}`],
          { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
      } catch {
        skipped.push(`${repositoryPath} (not present at ${revisionToRead})`);
        continue;
      }

      const historicalValue = parseJson(historicalText, `${revisionToRead}:${repositoryPath}`);
      if (isSemanticallyEmpty(historicalValue)) {
        skipped.push(`${repositoryPath} (also empty at ${revisionToRead})`);
        continue;
      }

      candidates.push({ filePath, repositoryPath, historicalValue });
    }
  }

  for (const candidate of candidates) {
    console.log(`${shouldApply ? 'RESTORE' : 'WOULD RESTORE'} ${candidate.repositoryPath}`);
    if (shouldApply) {
      writeFileSync(candidate.filePath, `${JSON.stringify(candidate.historicalValue, null, 2)}\n`, 'utf8');
    }
  }

  for (const message of skipped) console.warn(`SKIP ${message}`);
  console.log(`${shouldApply ? 'Restored' : 'Would restore'} ${candidates.length} file(s); skipped ${skipped.length}.`);
}
