import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  PATTERNS, CATEGORIES, CATEGORY_BY_ID, RADAR, radarRingOf,
  type Category, type Pattern, type RadarRingId,
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

  protected readonly groups = computed<Group[]>(() => {
    const f = this.filter();
    const cats = f === 'all' ? CATEGORIES : CATEGORIES.filter(c => c.id === f);
    return cats.map(category => ({
      category,
      patterns: PATTERNS.filter(p => p.category === category.id),
    }));
  });

  protected count(catId: string): number {
    return PATTERNS.filter(p => p.category === catId).length;
  }

  protected ringOf(p: Pattern): RadarRingId {
    return radarRingOf(p);
  }
  protected ringLabel(id: RadarRingId): string {
    return RADAR.rings.find(r => r.id === id)?.label ?? id;
  }

  protected setFilter(event: Event) {
    this.filter.set((event.target as HTMLSelectElement).value);
  }
}
