import { sanitizeFigureSvg } from './figure-svg-sanitizer';

const wrap = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;

// Mirrors the vocabulary the shipped figures use: defs/marker, grouped paths and
// rects with presentational styles, url(#id) marker references and styled text.
const REALISTIC_FIGURE = wrap(
  '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ink-3)"/></marker></defs>' +
  '<g style="font-family:var(--sans)"><rect width="196" height="236" rx="8" fill="var(--paper-2)" stroke="var(--line)" stroke-width="1.5"/>' +
  '<text x="14" y="22" style="font-family:var(--mono);font-size:10px;letter-spacing:.14em;fill:var(--ink-3)">HUMANS</text></g>' +
  '<path d="M 214 174 H 298" fill="none" stroke="var(--ink-3)" stroke-width="1.5" marker-end="url(#arrow)"/>',
);

describe('sanitizeFigureSvg', () => {
  it('accepts a figure that uses the real shipped vocabulary', () => {
    const result = sanitizeFigureSvg(REALISTIC_FIGURE);
    expect(result.violations).toEqual([]);
    expect(result.html).not.toBeNull();
    expect(result.html).toContain('<marker');
    expect(result.html).toContain('marker-end="url(#arrow)"');
  });

  const bypasses: Record<string, string> = {
    'smil onbegin via "/" separator': wrap('<animate attributeName="x" dur="1s" /onbegin="alert(1)"/>'),
    'smil onend via "/" separator': wrap('<set attributeName="x" to="y" dur="1s"/onend="alert(1)"/>'),
    'unquoted external href': wrap('<a href=https://evil.example/x><rect width="4" height="4"/></a>'),
    'style element': wrap('<style>rect{fill:red}</style><rect width="4" height="4"/>'),
    'handler on an allowed element': wrap('<rect width="4" height="4" /onclick="alert(1)"/>'),
    'non-fragment url() in fill': wrap('<rect width="4" height="4" fill="url(https://evil/x)"/>'),
    'style import': wrap('<rect width="4" height="4" style="@import url(x)"/>'),
    'html comment node': wrap('<!-- x --><rect width="4" height="4"/>'),
  };

  for (const [name, markup] of Object.entries(bypasses)) {
    it(`rejects: ${name}`, () => {
      const result = sanitizeFigureSvg(markup);
      expect(result.html).toBeNull();
      expect(result.violations.length).toBeGreaterThan(0);
    });
  }

  it('accepts a local fragment url() reference', () => {
    const result = sanitizeFigureSvg(
      wrap('<defs><marker id="m"/></defs><rect width="4" height="4" fill="url(#m)"/>'),
    );
    expect(result.html).not.toBeNull();
  });
});
