#!/usr/bin/env node

import { resolve } from 'node:path';
import {
  DEFAULT_DATA_ROOT,
  formatValidationResult,
  validateCatalog,
} from './lib/catalog.mjs';

function usage() {
  return [
    'Usage: node scripts/validate-data.mjs [--strict] [--root <data-directory>]',
    '',
    '  --strict       Enforce publication completeness (keywords and research).',
    '  --root <path>  Validate another data tree, for example a test fixture.',
  ].join('\n');
}

let dataRoot = DEFAULT_DATA_ROOT;
let strict = false;
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === '--strict') {
    strict = true;
  } else if (argument === '--root') {
    const value = process.argv[index + 1];
    if (!value) {
      console.error('--root requires a directory.');
      console.error(usage());
      process.exit(2);
    }
    dataRoot = resolve(value);
    index += 1;
  } else if (argument === '--help' || argument === '-h') {
    console.log(usage());
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${argument}`);
    console.error(usage());
    process.exit(2);
  }
}

const result = validateCatalog({ dataRoot, strict });
console.log(formatValidationResult(result));
console.log(
  `Counts: ${result.catalog.patterns.length} patterns, ` +
  `${result.catalog.categories.length} categories, ` +
  `${result.catalog.concepts.length} concepts, ` +
  `${result.catalog.tools.length} tools, ` +
  `${result.catalog.sources.length} sources`,
);
process.exitCode = result.valid ? 0 : 1;
