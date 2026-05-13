import { RenderMode, ServerRoute } from '@angular/ssr';
import { PATTERNS, CATEGORIES, CONCEPTS } from '../data';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'patterns/:id',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => PATTERNS.map(p => ({ id: p.id })),
  },
  {
    path: 'categories/:id',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => CATEGORIES.map(c => ({ id: c.id })),
  },
  {
    path: 'concepts/:id',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => CONCEPTS.map(c => ({ id: c.id })),
  },
  {
    path: '**',
    renderMode: RenderMode.Prerender,
  },
];
