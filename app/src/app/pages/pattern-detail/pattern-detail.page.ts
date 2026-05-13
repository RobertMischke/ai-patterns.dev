import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title, Meta } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  PATTERNS, PATTERN_BY_ID, CATEGORY_BY_ID, TOOLS, SOURCES, CONCEPTS,
  RADAR, radarRingOf, type Pattern, type RadarRingId,
} from '../../../data';
import { TechRadar } from '../../components/tech-radar/tech-radar';

interface ResearchOpinion {
  stance: 'supports' | 'challenges' | 'mixed' | 'unknown';
  summary: string;
  points: Array<{ text: string; severity?: string; source_id?: string }>;
}
interface ResearchList {
  summary: string;
  items: Array<{ text: string; ref_type?: string; ref_id?: string; url?: string }>;
}
interface ResearchBundle {
  critique?: ResearchOpinion;
  counterArguments?: ResearchOpinion;
  tools?: ResearchList;
  extensions?: ResearchList;
  sources?: ResearchList;
}

@Component({
  selector: 'app-pattern-detail',
  imports: [RouterLink, TechRadar],
  templateUrl: './pattern-detail.page.html',
})
export class PatternDetailPage {
  protected readonly allPatterns = PATTERNS;

  protected readonly ring = computed<RadarRingId | null>(() => {
    const p = this.pattern();
    return p ? radarRingOf(p) : null;
  });

  protected readonly ringLabel = computed(() => {
    const id = this.ring();
    return id ? RADAR.rings.find(r => r.id === id)?.label ?? id : '';
  });

  protected readonly ringHint = computed(() => {
    const id = this.ring();
    return id ? RADAR.rings.find(r => r.id === id)?.hint ?? '' : '';
  });
  private readonly route = inject(ActivatedRoute);
  private readonly http  = inject(HttpClient);
  private readonly title = inject(Title);
  private readonly meta  = inject(Meta);

  private readonly id = toSignal(this.route.paramMap, { requireSync: true });

  protected readonly pattern = computed<Pattern | null>(() => {
    const id = this.id().get('id');
    return id ? PATTERN_BY_ID.get(id) ?? null : null;
  });

  protected readonly category = computed(() => {
    const p = this.pattern();
    return p ? CATEGORY_BY_ID.get(p.category) ?? null : null;
  });

  protected readonly relatedTools = computed(() => {
    const p = this.pattern();
    return p ? TOOLS.filter(t => t.patterns.includes(p.id)) : [];
  });

  protected readonly relatedSources = computed(() => {
    const p = this.pattern();
    return p ? SOURCES.filter(s => s.patterns.includes(p.id)) : [];
  });

  protected readonly relatedConcepts = computed(() => {
    const p = this.pattern();
    return p ? CONCEPTS.filter(c => c.patterns.includes(p.id)) : [];
  });

  protected readonly siblings = computed(() => {
    const p = this.pattern();
    if (!p) return { prev: null, next: null };
    const idx = PATTERNS.findIndex(x => x.id === p.id);
    const prev = PATTERNS[(idx - 1 + PATTERNS.length) % PATTERNS.length];
    const next = PATTERNS[(idx + 1) % PATTERNS.length];
    return { prev, next };
  });

  protected research: ResearchBundle | null = null;

  async ngOnInit() {
    const p = this.pattern();
    if (!p) return;

    this.title.setTitle(`${p.title} · ai-patterns.dev`);
    this.meta.updateTag({ name: 'description', content: p.one_liner });
    this.meta.updateTag({ property: 'og:title', content: p.title });
    this.meta.updateTag({ property: 'og:description', content: p.one_liner });

    const base = `/data/patterns/${p.id}/research`;
    const [critique, counterArguments, tools, extensions, sources] = await Promise.all([
      this.loadJson<ResearchOpinion>(`${base}/critique.json`),
      this.loadJson<ResearchOpinion>(`${base}/counter-arguments.json`),
      this.loadJson<ResearchList>(`${base}/tools.json`),
      this.loadJson<ResearchList>(`${base}/extensions.json`),
      this.loadJson<ResearchList>(`${base}/sources.json`),
    ]);
    this.research = { critique, counterArguments, tools, extensions, sources };
  }

  private async loadJson<T>(url: string): Promise<T | undefined> {
    try {
      return await firstValueFrom(this.http.get<T>(url));
    } catch {
      return undefined;
    }
  }

  protected hasContent(r: ResearchOpinion | ResearchList | undefined): boolean {
    if (!r) return false;
    if ('points' in r) return r.summary.length > 0 || r.points.length > 0;
    if ('items'  in r) return r.summary.length > 0 || r.items.length > 0;
    return false;
  }
}
