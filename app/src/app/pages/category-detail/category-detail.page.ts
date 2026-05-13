import { Component, computed, effect, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import {
  CATEGORY_BY_ID, PATTERNS, RADAR, radarRingOf,
  type Pattern, type RadarRingId,
} from '../../../data';

@Component({
  selector: 'app-category-detail',
  imports: [RouterLink],
  templateUrl: './category-detail.page.html',
})
export class CategoryDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly title = inject(Title);

  private readonly id = toSignal(this.route.paramMap, { requireSync: true });

  protected readonly category = computed(() => {
    const id = this.id().get('id');
    return id ? CATEGORY_BY_ID.get(id) ?? null : null;
  });

  protected readonly patterns = computed(() => {
    const c = this.category();
    return c ? PATTERNS.filter(p => p.category === c.id) : [];
  });

  protected ringOf(p: Pattern): RadarRingId {
    return radarRingOf(p);
  }
  protected ringLabel(id: RadarRingId): string {
    return RADAR.rings.find(r => r.id === id)?.label ?? id;
  }

  constructor() {
    effect(() => {
      const c = this.category();
      if (c) this.title.setTitle(`${c.name} · ai-patterns.dev`);
    });
  }
}
