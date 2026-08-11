#!/usr/bin/env node

/**
 * Scheduled external-link audit. Network availability must not be a release
 * dependency, so CI invokes this from a separate weekly/manual workflow.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");
const DATA = join(ROOT, "data");
const DATA_ROOTS = [
  "patterns",
  "categories",
  "concepts",
  "tools",
  "sources",
  "_meta",
];
const DEFAULTS = { concurrency: 8, retries: 2, timeoutMs: 12_000 };

function usage() {
  return (
    "Usage: node scripts/check-external-links.mjs " +
    "[--concurrency N] [--retries N] [--timeout-ms N]"
  );
}

function parsePositiveInteger(value, flag, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || (allowZero ? number < 0 : number < 1)) {
    throw new Error(
      `${flag} expects ${allowZero ? "a non-negative" : "a positive"} integer`,
    );
  }
  return number;
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--concurrency") {
      options.concurrency = parsePositiveInteger(value, flag);
      index += 1;
    } else if (flag === "--retries") {
      options.retries = parsePositiveInteger(value, flag, { allowZero: true });
      index += 1;
    } else if (flag === "--timeout-ms") {
      options.timeoutMs = parsePositiveInteger(value, flag);
      index += 1;
    } else if (flag === "--help" || flag === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument ${JSON.stringify(flag)}. ${usage()}`);
    }
  }
  return options;
}

function* jsonFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) yield* jsonFiles(absolute);
    else if (entry.isFile() && entry.name.endsWith(".json")) yield absolute;
  }
}

function collectUrlFields(value, context, found) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectUrlFields(item, `${context}/${index}`, found),
    );
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    const pointer = `${context}/${key}`;
    if (
      (key === "url" || key === "oss_url") &&
      typeof child === "string" &&
      child.trim()
    ) {
      const url = child.trim();
      const contexts = found.get(url) ?? [];
      contexts.push(pointer);
      found.set(url, contexts);
    }
    collectUrlFields(child, pointer, found);
  }
}

function collectUrls() {
  const found = new Map();
  for (const rootName of DATA_ROOTS) {
    const root = join(DATA, rootName);
    for (const path of jsonFiles(root)) {
      let document;
      try {
        document = JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        throw new Error(`${path}: invalid JSON (${error.message})`);
      }
      const relativePath = path.slice(DATA.length + 1).replaceAll("\\", "/");
      collectUrlFields(document, relativePath, found);
    }
  }
  return found;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function statusIsReachable(status) {
  // Authentication, bot protection and rate limiting still prove that the URL
  // resolves. They are reported but do not create noisy false link failures.
  return status < 400 || status === 401 || status === 403 || status === 429;
}

async function request(url, method, timeoutMs) {
  const headers = {
    "user-agent":
      "ai-patterns.dev-link-audit/1.0 (+https://github.com/agent-orc/ai-patterns.dev)",
    accept: "text/html,application/json,application/pdf;q=0.9,*/*;q=0.8",
  };
  if (method === "GET") headers.range = "bytes=0-1023";

  const response = await fetch(url, {
    method,
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  await response.body?.cancel();
  return { status: response.status, finalUrl: response.url };
}

async function probe(url, options) {
  let lastError;
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      let result = await request(url, "HEAD", options.timeoutMs);
      if (!statusIsReachable(result.status)) {
        result = await request(url, "GET", options.timeoutMs);
      }
      if (statusIsReachable(result.status)) return { ok: true, ...result };
      lastError = new Error(`HTTP ${result.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < options.retries) await sleep(400 * 2 ** attempt);
  }
  return { ok: false, error: lastError?.message ?? "unknown request failure" };
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function consume() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, consume),
  );
  return results;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

let occurrences;
try {
  occurrences = collectUrls();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const invalid = [];
const urls = [];
for (const [rawUrl, contexts] of occurrences) {
  try {
    const parsed = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsed.protocol))
      throw new Error("expected http(s)");
    urls.push(rawUrl);
  } catch (error) {
    invalid.push({ url: rawUrl, contexts, error: error.message });
  }
}

console.log(
  `Auditing ${urls.length} unique external URLs (${options.concurrency} concurrent, ${options.retries} retries).`,
);
const results = await runPool(urls, options.concurrency, (url) =>
  probe(url, options),
);
const failures = [];
for (let index = 0; index < urls.length; index += 1) {
  const url = urls[index];
  const result = results[index];
  if (result.ok) {
    const redirect =
      result.finalUrl && result.finalUrl !== url
        ? ` -> ${result.finalUrl}`
        : "";
    console.log(`  OK ${result.status} ${url}${redirect}`);
  } else {
    failures.push({ url, contexts: occurrences.get(url), error: result.error });
  }
}

for (const failure of [...invalid, ...failures]) {
  console.error(`  FAIL ${failure.url}: ${failure.error}`);
  for (const context of failure.contexts) console.error(`       ${context}`);
}

if (invalid.length || failures.length) {
  console.error(
    `External-link audit failed: ${invalid.length + failures.length} broken or invalid URL(s).`,
  );
  process.exitCode = 1;
} else {
  console.log(`External-link audit passed: ${urls.length} URL(s) reachable.`);
}
