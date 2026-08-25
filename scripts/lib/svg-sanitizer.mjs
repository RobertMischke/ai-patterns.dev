/**
 * Allowlist sanitiser for inline pattern-figure SVG markup.
 *
 * Figures are shipped verbatim into the app assets and rendered through
 * `bypassSecurityTrustHtml` + `[innerHTML]`, so the markup is a stored-XSS sink.
 * A denylist over raw markup is inherently leaky (HTML lets `/` separate
 * attributes, SMIL elements carry event handlers, entities hide schemes, …).
 * Instead we parse the markup exactly as the browser's innerHTML would, then
 * accept it only if every element, attribute and value is on a fixed allowlist.
 *
 * The browser render path enforces the same vocabulary in
 * app/src/app/shared/figure-svg-sanitizer.ts — keep the two in sync.
 */

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_PACKAGE = resolve(SCRIPT_DIR, '..', '..', 'app', 'package.json');
const requireFromApp = createRequire(APP_PACKAGE);

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

// Structural and presentational SVG elements the real figures use, plus their
// obvious safe companions. No scripting (script), no embedded/external content
// (foreignObject, image, iframe, object, embed, use), no animation elements
// (animate, set, …) that can carry SMIL event handlers.
export const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'marker',
  'path', 'rect', 'circle', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'title', 'desc',
]);

// Presentational / structural attributes allowed on any allowed element.
const GLOBAL_ATTRIBUTES = new Set([
  'id', 'class', 'style', 'transform',
  'fill', 'fill-opacity', 'fill-rule', 'clip-rule',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'stroke-miterlimit',
  'opacity', 'color',
  'font-family', 'font-size', 'font-weight', 'font-style',
  'letter-spacing', 'word-spacing',
  'text-anchor', 'dominant-baseline', 'alignment-baseline',
  'marker-start', 'marker-mid', 'marker-end',
  'role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden',
]);

// Element-specific geometry / layout attributes (compared case-insensitively;
// the HTML parser already normalises SVG attribute casing such as viewBox).
const ELEMENT_ATTRIBUTES = new Map([
  ['svg', new Set(['xmlns', 'xmlns:xlink', 'version', 'viewbox', 'width', 'height', 'preserveaspectratio', 'x', 'y'])],
  ['marker', new Set(['viewbox', 'refx', 'refy', 'markerwidth', 'markerheight', 'markerunits', 'orient', 'preserveaspectratio', 'overflow'])],
  ['path', new Set(['d', 'pathlength'])],
  ['rect', new Set(['x', 'y', 'width', 'height', 'rx', 'ry'])],
  ['circle', new Set(['cx', 'cy', 'r'])],
  ['line', new Set(['x1', 'y1', 'x2', 'y2'])],
  ['polyline', new Set(['points'])],
  ['polygon', new Set(['points'])],
  ['text', new Set(['x', 'y', 'dx', 'dy', 'rotate', 'textlength', 'lengthadjust'])],
  ['tspan', new Set(['x', 'y', 'dx', 'dy', 'rotate', 'textlength', 'lengthadjust'])],
]);

// CSS properties permitted inside a `style` attribute.
const STYLE_PROPERTIES = new Set([
  'font-family', 'font-size', 'font-weight', 'font-style',
  'letter-spacing', 'word-spacing',
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-opacity',
  'opacity', 'color', 'text-anchor', 'dominant-baseline',
]);

// Any url(...) reference (in an attribute value or a style value) may only
// point at a local fragment such as url(#arrow).
function urlReferencesAreLocalFragments(value) {
  if (!/url\(/i.test(value)) return true;
  let matched = false;
  for (const match of value.matchAll(/url\(\s*(['"]?)\s*([^'")]*)\1\s*\)/gi)) {
    matched = true;
    if (!match[2].trim().startsWith('#')) return false;
  }
  // "url(" present but not a well-formed local reference -> reject.
  return matched;
}

function styleErrors(value, where) {
  const errors = [];
  const lowered = value.toLowerCase();
  for (const token of ['javascript:', 'expression', '@', '<', '>', '\\']) {
    if (lowered.includes(token)) {
      errors.push(`${where}: style contains a disallowed token "${token}"`);
    }
  }
  if (!urlReferencesAreLocalFragments(value)) {
    errors.push(`${where}: style url() may only reference a local #fragment`);
  }
  for (const declaration of value.split(';')) {
    const trimmed = declaration.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) {
      errors.push(`${where}: malformed style declaration "${trimmed}"`);
      continue;
    }
    const property = trimmed.slice(0, colon).trim().toLowerCase();
    if (!STYLE_PROPERTIES.has(property)) {
      errors.push(`${where}: style property "${property}" is not allowed`);
    }
  }
  return errors;
}

function attributeErrors(element, elementName, where) {
  const errors = [];
  const elementSpecific = ELEMENT_ATTRIBUTES.get(elementName);
  for (const rawName of element.getAttributeNames()) {
    const name = rawName.toLowerCase();
    const value = element.getAttribute(rawName) ?? '';
    if (name.startsWith('on')) {
      errors.push(`${where}: event-handler attribute "${rawName}" is not allowed`);
      continue;
    }
    if (!GLOBAL_ATTRIBUTES.has(name) && !(elementSpecific?.has(name) ?? false)) {
      errors.push(`${where}: attribute "${rawName}" is not allowed on <${elementName}>`);
      continue;
    }
    if (name === 'style') {
      errors.push(...styleErrors(value, where));
      continue;
    }
    if (!urlReferencesAreLocalFragments(value)) {
      errors.push(`${where}: attribute "${rawName}" url() may only reference a local #fragment`);
    }
    // Defence in depth: no scheme-bearing script URL may survive on any value.
    if (/javascript\s*:/i.test(value)) {
      errors.push(`${where}: attribute "${rawName}" contains a javascript: URL`);
    }
  }
  return errors;
}

function walkNode(node, errors, path) {
  for (const child of node.childNodes) {
    switch (child.nodeType) {
      case 1: { // element
        const element = child;
        if (element.namespaceURI !== SVG_NAMESPACE) {
          errors.push(`${path}: element <${element.localName}> is outside the SVG namespace`);
          break; // do not descend into foreign content
        }
        const name = element.localName.toLowerCase();
        const where = `${path}/${name}`;
        if (!ALLOWED_ELEMENTS.has(name)) {
          errors.push(`${where}: element <${name}> is not allowed`);
          break; // reject the whole subtree
        }
        errors.push(...attributeErrors(element, name, where));
        walkNode(element, errors, where);
        break;
      }
      case 3: // text
        break;
      case 4: // CDATA section
        errors.push(`${path}: CDATA sections are not allowed in figure markup`);
        break;
      case 7: // processing instruction
        errors.push(`${path}: processing instructions are not allowed in figure markup`);
        break;
      case 8: // comment
        errors.push(`${path}: comments are not allowed in figure markup`);
        break;
      default:
        errors.push(`${path}: node type ${child.nodeType} is not allowed in figure markup`);
    }
  }
}

let sharedDocument;
function getDocument() {
  if (!sharedDocument) {
    const { JSDOM } = requireFromApp('jsdom');
    sharedDocument = new JSDOM('<!doctype html>').window.document;
  }
  return sharedDocument;
}

/**
 * Validate inline figure SVG markup against the allowlist.
 *
 * @param {string} markup
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function sanitizeFigureSvg(markup) {
  if (typeof markup !== 'string' || markup.trim() === '') {
    return { ok: false, errors: ['figure markup must be a non-empty string'] };
  }
  const errors = [];
  const template = getDocument().createElement('template');
  // <template> content is inert: parsing does not run scripts or fetch anything.
  template.innerHTML = markup;
  const roots = template.content.children;
  const root = roots[0];
  if (roots.length !== 1 || !root || root.namespaceURI !== SVG_NAMESPACE || root.localName.toLowerCase() !== 'svg') {
    errors.push('figure markup must be a single <svg> root element');
  }
  walkNode(template.content, errors, 'figure');
  return { ok: errors.length === 0, errors };
}
