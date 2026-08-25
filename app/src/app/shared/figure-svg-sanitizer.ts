/**
 * Browser-side allowlist sanitiser for inline pattern-figure SVG markup.
 *
 * Figures are rendered with `bypassSecurityTrustHtml` + `[innerHTML]`, which
 * disables Angular's own sanitiser. To keep that bypass safe, the markup is
 * first parsed as the browser's innerHTML would parse it and accepted only if
 * every element, attribute and value is on a fixed allowlist. Anything else
 * makes the figure fail closed (the caller renders nothing) rather than risk a
 * stored-XSS payload reaching the DOM.
 *
 * This vocabulary mirrors the authoritative build-time sanitiser in
 * scripts/lib/svg-sanitizer.mjs, which gates the data before it ever ships.
 * Keep the two in sync.
 */

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'marker',
  'path', 'rect', 'circle', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'title', 'desc',
]);

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

const ELEMENT_ATTRIBUTES = new Map<string, Set<string>>([
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

const STYLE_PROPERTIES = new Set([
  'font-family', 'font-size', 'font-weight', 'font-style',
  'letter-spacing', 'word-spacing',
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset',
  'stroke-linecap', 'stroke-linejoin', 'stroke-opacity',
  'opacity', 'color', 'text-anchor', 'dominant-baseline',
]);

export interface FigureSanitizeResult {
  /** Sanitised markup safe to trust, or null when the input violated the allowlist. */
  html: string | null;
  violations: string[];
}

function urlReferencesAreLocalFragments(value: string): boolean {
  if (!/url\(/i.test(value)) return true;
  let matched = false;
  for (const match of value.matchAll(/url\(\s*(['"]?)\s*([^'")]*)\1\s*\)/gi)) {
    matched = true;
    if (!match[2].trim().startsWith('#')) return false;
  }
  return matched;
}

function styleViolations(value: string, where: string): string[] {
  const violations: string[] = [];
  const lowered = value.toLowerCase();
  for (const token of ['javascript:', 'expression', '@', '<', '>', '\\']) {
    if (lowered.includes(token)) violations.push(`${where}: style contains a disallowed token "${token}"`);
  }
  if (!urlReferencesAreLocalFragments(value)) {
    violations.push(`${where}: style url() may only reference a local #fragment`);
  }
  for (const declaration of value.split(';')) {
    const trimmed = declaration.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) {
      violations.push(`${where}: malformed style declaration "${trimmed}"`);
      continue;
    }
    const property = trimmed.slice(0, colon).trim().toLowerCase();
    if (!STYLE_PROPERTIES.has(property)) violations.push(`${where}: style property "${property}" is not allowed`);
  }
  return violations;
}

function attributeViolations(element: Element, elementName: string, where: string): string[] {
  const violations: string[] = [];
  const elementSpecific = ELEMENT_ATTRIBUTES.get(elementName);
  for (const rawName of element.getAttributeNames()) {
    const name = rawName.toLowerCase();
    const value = element.getAttribute(rawName) ?? '';
    if (name.startsWith('on')) {
      violations.push(`${where}: event-handler attribute "${rawName}" is not allowed`);
      continue;
    }
    if (!GLOBAL_ATTRIBUTES.has(name) && !(elementSpecific?.has(name) ?? false)) {
      violations.push(`${where}: attribute "${rawName}" is not allowed on <${elementName}>`);
      continue;
    }
    if (name === 'style') {
      violations.push(...styleViolations(value, where));
      continue;
    }
    if (!urlReferencesAreLocalFragments(value)) {
      violations.push(`${where}: attribute "${rawName}" url() may only reference a local #fragment`);
    }
    if (/javascript\s*:/i.test(value)) {
      violations.push(`${where}: attribute "${rawName}" contains a javascript: URL`);
    }
  }
  return violations;
}

function walk(node: Node, violations: string[], path: string): void {
  for (const child of Array.from(node.childNodes)) {
    switch (child.nodeType) {
      case 1: { // element
        const element = child as Element;
        if (element.namespaceURI !== SVG_NAMESPACE) {
          violations.push(`${path}: element <${element.localName}> is outside the SVG namespace`);
          break;
        }
        const name = element.localName.toLowerCase();
        const where = `${path}/${name}`;
        if (!ALLOWED_ELEMENTS.has(name)) {
          violations.push(`${where}: element <${name}> is not allowed`);
          break;
        }
        violations.push(...attributeViolations(element, name, where));
        walk(element, violations, where);
        break;
      }
      case 3: // text
        break;
      case 4:
        violations.push(`${path}: CDATA sections are not allowed in figure markup`);
        break;
      case 7:
        violations.push(`${path}: processing instructions are not allowed in figure markup`);
        break;
      case 8:
        violations.push(`${path}: comments are not allowed in figure markup`);
        break;
      default:
        violations.push(`${path}: node type ${child.nodeType} is not allowed in figure markup`);
    }
  }
}

/**
 * Validate figure SVG markup against the allowlist. Returns the (normalised)
 * markup only when it is entirely clean; otherwise `html` is null and the
 * caller must not render it.
 */
export function sanitizeFigureSvg(markup: string): FigureSanitizeResult {
  if (typeof markup !== 'string' || markup.trim() === '') {
    return { html: null, violations: ['figure markup must be a non-empty string'] };
  }
  const template = document.createElement('template');
  // <template> content is an inert fragment: parsing runs no scripts and loads nothing.
  template.innerHTML = markup;
  const violations: string[] = [];
  const roots = template.content.children;
  const root = roots.item(0);
  if (roots.length !== 1 || !root || root.namespaceURI !== SVG_NAMESPACE || root.localName.toLowerCase() !== 'svg') {
    violations.push('figure markup must be a single <svg> root element');
  }
  walk(template.content, violations, 'figure');
  if (violations.length > 0) return { html: null, violations };
  return { html: template.innerHTML, violations };
}
