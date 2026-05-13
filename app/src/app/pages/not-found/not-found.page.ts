import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <section class="nf">
      <p class="eyebrow">404</p>
      <h1>Page not found.</h1>
      <p><a routerLink="/">Back to the library.</a></p>
    </section>
  `,
  styles: `
    .nf { padding: 4rem 0; }
    .eyebrow { color: var(--ink-muted); font-family: var(--font-mono); margin: 0 0 0.5rem; }
    h1 { font-family: var(--font-serif); font-size: 2rem; margin: 0 0 1rem; }
    a { color: var(--accent); }
  `,
})
export class NotFoundPage {}
