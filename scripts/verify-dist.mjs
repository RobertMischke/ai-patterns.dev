#!/usr/bin/env node

/**
 * Verify that the production bundle is a complete, exact projection of data/.
 * Run after the Angular production build; this script never mutates files.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const DATA = join(ROOT, "data");
const APP_ROUTES = join(ROOT, "app", "src", "app", "app.routes.ts");
const DIST = resolve(ROOT, process.env.AI_PATTERNS_DIST ?? "app/dist/app");
const BROWSER = join(DIST, "browser");
const DIST_DATA = join(BROWSER, "data");

const DATA_ROOTS = [
  "patterns",
  "categories",
  "concepts",
  "tools",
  "sources",
  "_meta",
];
const RESEARCH_FILES = [
  "critique.json",
  "counter-arguments.json",
  "tools.json",
  "extensions.json",
  "sources.json",
];
const STATIC_ROUTES = [
  "/",
  "/patterns",
  "/categories",
  "/concepts",
  "/tools",
  "/sources",
  "/radar",
  "/submit",
];

// Redirect-only compatibility routes. They deliberately have no canonical entity
// or prerendered HTML page, but Angular records them in prerendered-routes.json.
const PATTERN_TOMBSTONES = new Map([
  ["/patterns/review-result", "fire-track-review"],
  [
    "/patterns/compute-investment-quality-signal",
    "compute-invest-as-quality-signal",
  ],
]);

const errors = [];

function fail(message) {
  errors.push(message);
}

function readJson(path, label = relative(ROOT, path)) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label}: invalid or unreadable JSON (${error.message})`);
    return null;
  }
}

function listEntityIds(kind, filename) {
  const base = join(DATA, kind);
  if (!existsSync(base)) {
    fail(`data/${kind}: directory is missing`);
    return [];
  }

  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort()
    .filter((id) => {
      const entityPath = join(base, id, filename);
      if (!existsSync(entityPath)) {
        fail(
          `data/${kind}/${id}/${filename}: canonical entity file is missing`,
        );
        return false;
      }
      return true;
    });
}

function collectFiles(base, prefix = "") {
  const files = new Map();
  if (!existsSync(base)) return files;

  for (const entry of readdirSync(base, { withFileTypes: true })) {
    const absolute = join(base, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      fail(
        `${relative(ROOT, absolute)}: symbolic links are not allowed in release data`,
      );
    } else if (entry.isDirectory()) {
      for (const [nestedPath, nestedAbsolute] of collectFiles(
        absolute,
        relativePath,
      )) {
        files.set(nestedPath, nestedAbsolute);
      }
    } else if (entry.isFile()) {
      files.set(relativePath, absolute);
    } else {
      fail(`${relative(ROOT, absolute)}: unsupported filesystem entry`);
    }
  }
  return files;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function routeHtmlPath(route) {
  if (route === "/") return join(BROWSER, "index.html");
  return join(BROWSER, ...route.slice(1).split("/"), "index.html");
}

function checkManifest(counts) {
  const canonicalPath = join(DATA, "_meta", "manifest.json");
  const manifest = readJson(canonicalPath);
  if (!manifest) return;

  if (manifest.locale !== "en") {
    fail(
      `data/_meta/manifest.json: locale must be "en", got ${JSON.stringify(manifest.locale)}`,
    );
  }
  if (!manifest.generatedAt || Number.isNaN(Date.parse(manifest.generatedAt))) {
    fail("data/_meta/manifest.json: generatedAt must be a valid timestamp");
  }

  for (const [kind, actual] of Object.entries(counts)) {
    const declared = manifest.counts?.[kind];
    if (declared !== actual) {
      fail(
        `data/_meta/manifest.json: counts.${kind} is ${String(declared)}, expected ${actual}`,
      );
    }
  }

  const outputManifest = readJson(
    join(DIST_DATA, "_meta", "manifest.json"),
    "dist data manifest",
  );
  if (
    outputManifest &&
    JSON.stringify(outputManifest) !== JSON.stringify(manifest)
  ) {
    fail("dist data manifest does not match data/_meta/manifest.json");
  }
}

function checkDataProjection(patternIds) {
  const canonical = new Map();
  for (const rootName of DATA_ROOTS) {
    const root = join(DATA, rootName);
    if (!existsSync(root)) {
      fail(`data/${rootName}: canonical data root is missing`);
      continue;
    }
    for (const [path, absolute] of collectFiles(root, rootName))
      canonical.set(path, absolute);
  }

  const output = collectFiles(DIST_DATA);
  for (const [path, canonicalPath] of canonical) {
    const outputPath = output.get(path);
    if (!outputPath) {
      fail(`dist/browser/data/${path}: missing generated asset`);
      continue;
    }
    if (sha256(canonicalPath) !== sha256(outputPath)) {
      fail(`dist/browser/data/${path}: differs from canonical data/${path}`);
    }
  }
  for (const path of output.keys()) {
    if (!canonical.has(path))
      fail(`dist/browser/data/${path}: unknown generated asset`);
  }

  for (const patternId of patternIds) {
    for (const filename of RESEARCH_FILES) {
      const relativePath = `patterns/${patternId}/research/${filename}`;
      if (!canonical.has(relativePath))
        fail(`data/${relativePath}: required research file is missing`);
      if (!output.has(relativePath))
        fail(
          `dist/browser/data/${relativePath}: required research asset is missing`,
        );
    }
  }

  for (const [route, targetId] of PATTERN_TOMBSTONES) {
    const oldId = route.split("/").at(-1);
    if (patternIds.includes(oldId))
      fail(`data/patterns/${oldId}: tombstoned id must not be republished`);
    if (!patternIds.includes(targetId))
      fail(`${route}: redirect target pattern ${targetId} is missing`);
    if (existsSync(join(DIST_DATA, "patterns", oldId))) {
      fail(
        `dist/browser/data/patterns/${oldId}: tombstoned pattern must not have data assets`,
      );
    }
  }
}

function checkRoutes(patternIds, categoryIds, conceptIds) {
  const routesPath = join(DIST, "prerendered-routes.json");
  const document = readJson(routesPath, "dist/prerendered-routes.json");
  const routeRecord = document?.routes;
  if (
    !routeRecord ||
    typeof routeRecord !== "object" ||
    Array.isArray(routeRecord)
  ) {
    fail("dist/prerendered-routes.json: expected a routes object");
    return;
  }

  const expected = new Set([
    ...STATIC_ROUTES,
    ...patternIds.map((id) => `/patterns/${id}`),
    ...categoryIds.map((id) => `/categories/${id}`),
    ...conceptIds.map((id) => `/concepts/${id}`),
    ...PATTERN_TOMBSTONES.keys(),
  ]);
  const actual = new Set(Object.keys(routeRecord));

  for (const route of expected) {
    if (!actual.has(route))
      fail(`dist/prerendered-routes.json: missing route ${route}`);
  }
  for (const route of actual) {
    if (!expected.has(route))
      fail(`dist/prerendered-routes.json: unknown/orphan route ${route}`);
  }

  for (const route of expected) {
    if (PATTERN_TOMBSTONES.has(route)) continue;
    const htmlPath = routeHtmlPath(route);
    if (!existsSync(htmlPath) || !statSync(htmlPath).isFile()) {
      fail(
        `${relative(ROOT, htmlPath).split(sep).join("/")}: prerendered HTML is missing for ${route}`,
      );
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkTombstoneDefinitions() {
  if (!existsSync(APP_ROUTES)) {
    fail("app/src/app/app.routes.ts: route definitions are missing");
    return;
  }

  const source = readFileSync(APP_ROUTES, "utf8");
  for (const [route, targetId] of PATTERN_TOMBSTONES) {
    const routePath = route.slice(1);
    const routePattern = new RegExp(
      `path\\s*:\\s*["']${escapeRegExp(routePath)}["'][\\s\\S]{0,400}` +
        `redirectTo\\s*:\\s*["']patterns/${escapeRegExp(targetId)}["'][\\s\\S]{0,200}` +
        `pathMatch\\s*:\\s*["']full["']`,
    );
    if (!routePattern.test(source)) {
      fail(`${route}: expected a full-match redirect to /patterns/${targetId}`);
    }
  }
}

if (!existsSync(DIST))
  fail(`${relative(ROOT, DIST)}: production build directory is missing`);
if (!existsSync(BROWSER))
  fail(`${relative(ROOT, BROWSER)}: browser bundle is missing`);
if (!existsSync(DIST_DATA))
  fail(`${relative(ROOT, DIST_DATA)}: generated data assets are missing`);

const patternIds = listEntityIds("patterns", "pattern.json");
const categoryIds = listEntityIds("categories", "category.json");
const conceptIds = listEntityIds("concepts", "concept.json");
const toolIds = listEntityIds("tools", "tool.json");
const sourceIds = listEntityIds("sources", "source.json");

const counts = {
  patterns: patternIds.length,
  categories: categoryIds.length,
  concepts: conceptIds.length,
  tools: toolIds.length,
  sources: sourceIds.length,
};

if (existsSync(DIST_DATA)) checkDataProjection(patternIds);
checkManifest(counts);
checkTombstoneDefinitions();
if (existsSync(DIST)) checkRoutes(patternIds, categoryIds, conceptIds);

if (errors.length) {
  console.error(
    `Distribution verification failed with ${errors.length} error(s):`,
  );
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  const routeCount =
    STATIC_ROUTES.length +
    patternIds.length +
    categoryIds.length +
    conceptIds.length +
    PATTERN_TOMBSTONES.size;
  console.log(
    `Distribution verified: ${routeCount} routes, ${patternIds.length} patterns, ` +
      `${categoryIds.length} categories, ${conceptIds.length} concepts, ` +
      `${toolIds.length} tools, ${sourceIds.length} sources.`,
  );
}
