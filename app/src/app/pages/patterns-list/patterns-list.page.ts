import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  PATTERNS, CATEGORIES, RADAR, radarRingOf,
  type Category, type Pattern, type RadarRingId, type ModelTier, type ModelGuidance,
} from '../../../data';

interface Group {
  category: Category;
  patterns: Pattern[];
}

@Component({
  selector: 'app-patterns-list',
  imports: [RouterLink],
  templateUrl: './patterns-list.page.html',
})
export class PatternsListPage {
  protected readonly categories = CATEGORIES;
  protected readonly totalCount = PATTERNS.length;
  protected readonly filter = signal<string>('all');
  protected readonly modelTier = signal<ModelTier | 'all'>('all');

  protected readonly groups = computed<Group[]>(() => {
    const categoryFilter = this.filter();
    const tier = this.modelTier();
    const categories = categoryFilter === 'all'
      ? CATEGORIES : CATEGORIES.filter(category => category.id === categoryFilter);
    return categories.map(category => ({
      category,
      patterns: PATTERNS.filter(pattern =>
        pattern.category === category.id
        && (tier === 'all' || pattern.model_guidance?.some(guidance => guidance.tier === tier))),
    })).filter(group => group.patterns.length > 0);
  });

  protected count(catId: string): number {
    const tier = this.modelTier();
    return PATTERNS.filter(pattern => pattern.category === catId
      && (tier === 'all' || pattern.model_guidance?.some(guidance => guidance.tier === tier))).length;
  }

  protected tierCount(tier: ModelTier): number {
    return PATTERNS.filter(pattern =>
      pattern.model_guidance?.some(guidance => guidance.tier === tier)).length;
  }

  protected guidanceFor(pattern: Pattern): ModelGuidance[] {
    const tier = this.modelTier();
    return tier === 'all' ? [] : pattern.model_guidance?.filter(guidance => guidance.tier === tier) ?? [];
  }

  protected ringOf(pattern: Pattern): RadarRingId {
    return radarRingOf(pattern);
  }

  protected ringLabel(id: RadarRingId): string {
    return RADAR.rings.find(ring => ring.id === id)?.label ?? id;
  }

  protected setFilter(event: Event): void {
    this.filter.set((event.target as HTMLSelectElement).value);
  }

  protected setModelTier(event: Event): void {
    this.modelTier.set((event.target as HTMLSelectElement).value as ModelTier | 'all');
  }
}
