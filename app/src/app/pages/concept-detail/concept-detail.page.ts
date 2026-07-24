import { isPlatformBrowser } from '@angular/common';
import { Component, computed, effect, inject, PLATFORM_ID, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title, Meta } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CONCEPT_BY_ID, CONCEPTS, PATTERN_BY_ID } from '../../../data';

interface ConceptArticle {
  lede: string;
  body: Array<{ h: string; p: string }>;
}

@Component({
  selector: 'app-concept-detail',
  imports: [RouterLink],
  templateUrl: './concept-detail.page.html',
})
export class ConceptDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly http  = inject(HttpClient);
  private readonly title = inject(Title);
  private readonly meta  = inject(Meta);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly id = toSignal(this.route.paramMap, { requireSync: true });

  protected readonly concept = computed(() => {
    const id = this.id().get('id');
    return id ? CONCEPT_BY_ID.get(id) ?? null : null;
  });

  protected readonly relatedConcepts = computed(() => {
    const c = this.concept();
    if (!c) return [];
    const sharedPatterns = new Set(c.patterns);
    return CONCEPTS
      .filter(other => other.id !== c.id && other.patterns.some(pid => sharedPatterns.has(pid)))
      .slice(0, 8);
  });

  protected readonly article = signal<ConceptArticle | null>(null);

  protected patternTitle(id: string): string {
    return PATTERN_BY_ID.get(id)?.title ?? id;
  }
  protected patternNum(id: string): string {
    return PATTERN_BY_ID.get(id)?.num ?? '';
  }

  async ngOnInit() {
    const c = this.concept();
    if (!c) return;

    this.title.setTitle(`${c.term} · ai-patterns.dev`);
    this.meta.updateTag({ name: 'description', content: c.short });
  }

  private async loadArticle() {
    const c = this.concept();
    if (!c) return;
    if (c.has_article) {
      try {
        this.article.set(await firstValueFrom(
          this.http.get<ConceptArticle>(`/data/concepts/${c.id}/article.json`)
        ));
      } catch {
        this.article.set(null);
      }
    }
  }

  constructor() {
    effect(() => {
      const c = this.concept();
      if (c) this.title.setTitle(`${c.term} · ai-patterns.dev`);
    });
    if (isPlatformBrowser(this.platformId)) {
      setTimeout(() => void this.loadArticle());
    }
  }
}
