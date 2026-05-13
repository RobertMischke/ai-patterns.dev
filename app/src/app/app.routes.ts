import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/landing/landing.page').then(m => m.LandingPage),
    title: 'ai-patterns.dev — Operating patterns for agentic software work',
  },
  {
    path: 'patterns',
    loadComponent: () => import('./pages/patterns-list/patterns-list.page').then(m => m.PatternsListPage),
    title: 'Patterns · ai-patterns.dev',
  },
  {
    path: 'patterns/:id',
    loadComponent: () => import('./pages/pattern-detail/pattern-detail.page').then(m => m.PatternDetailPage),
  },
  {
    path: 'categories',
    loadComponent: () => import('./pages/categories-list/categories-list.page').then(m => m.CategoriesListPage),
    title: 'Groups · ai-patterns.dev',
  },
  {
    path: 'categories/:id',
    loadComponent: () => import('./pages/category-detail/category-detail.page').then(m => m.CategoryDetailPage),
  },
  {
    path: 'concepts',
    loadComponent: () => import('./pages/concepts/concepts.page').then(m => m.ConceptsPage),
    title: 'Concepts · ai-patterns.dev',
  },
  {
    path: 'concepts/:id',
    loadComponent: () => import('./pages/concept-detail/concept-detail.page').then(m => m.ConceptDetailPage),
  },
  {
    path: 'tools',
    loadComponent: () => import('./pages/tools/tools.page').then(m => m.ToolsPage),
    title: 'Tools · ai-patterns.dev',
  },
  {
    path: 'sources',
    loadComponent: () => import('./pages/sources/sources.page').then(m => m.SourcesPage),
    title: 'Sources · ai-patterns.dev',
  },
  {
    path: 'radar',
    loadComponent: () => import('./pages/radar/radar.page').then(m => m.RadarPage),
    title: 'Radar · ai-patterns.dev',
  },
  {
    path: 'submit',
    loadComponent: () => import('./pages/submit/submit.page').then(m => m.SubmitPage),
    title: 'Submit · ai-patterns.dev',
  },
  {
    path: '**',
    loadComponent: () => import('./pages/not-found/not-found.page').then(m => m.NotFoundPage),
    title: 'Not found · ai-patterns.dev',
  },
];
