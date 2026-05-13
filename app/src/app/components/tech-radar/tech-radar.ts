import { Component, computed, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { inject } from '@angular/core';
import {
  PATTERNS, CATEGORIES, RADAR, radarRingOf,
  type Pattern, type RadarRingId,
} from '../../../data';

interface Dot {
  id:    string;
  num:   string;
  title: string;
  one:   string;
  ring:  RadarRingId;
  cat:   string;
  catName: string;
  x:     number;
  y:     number;
  isHL:  boolean;
}

interface SectorLabel {
  short: string;
  x:     number;
  y:     number;
  anchor: 'start' | 'middle' | 'end';
}

interface RingLabel {
  label: string;
  color: string;
  y:     number;
}

interface Sector {
  x2: number;
  y2: number;
}

/* djb2 hash so a pattern's position within its sector cell is stable. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const RING_IDS: RadarRingId[] = ['adopt', 'trial', 'assess', 'hold'];

@Component({
  selector: 'app-tech-radar',
  templateUrl: './tech-radar.html',
})
export class TechRadar {
  private readonly router = inject(Router);

  readonly patterns    = input<readonly Pattern[]>(PATTERNS);
  readonly highlightId = input<string | null>(null);
  readonly size        = input<number>(520);
  readonly showLabels  = input<boolean>(true);

  protected readonly geometry = computed(() => {
    const cats     = CATEGORIES;
    const PAD      = this.showLabels() ? 110 : 16;
    const size     = this.size();
    const total    = size + PAD * 2;
    const cx       = total / 2;
    const cy       = total / 2;
    const maxR     = size * 0.48;
    const ringR    = RING_IDS.map((_, i) => maxR * ((i + 1) / RING_IDS.length));

    const sectorCount = cats.length;
    const sectorAngle = (Math.PI * 2) / sectorCount;

    const sectors: Sector[] = Array.from({ length: sectorCount }, (_, i) => {
      const a = i * sectorAngle - Math.PI / 2;
      return { x2: cx + Math.cos(a) * maxR, y2: cy + Math.sin(a) * maxR };
    });

    const ringLabels: RingLabel[] = this.showLabels()
      ? ringR.map((r, i) => ({
          label: RADAR.rings[i].label,
          color: RADAR.rings[i].color,
          y:     cy - (i === 0 ? r / 2 : (ringR[i - 1] + r) / 2),
        }))
      : [];

    const sectorLabels: SectorLabel[] = this.showLabels()
      ? cats.map((c, i) => {
          const a = i * sectorAngle - Math.PI / 2 + sectorAngle / 2;
          const r = maxR + 16;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          const anchor: SectorLabel['anchor'] =
            Math.cos(a) > 0.1 ? 'start' : Math.cos(a) < -0.1 ? 'end' : 'middle';
          const short = RADAR.sector_short[c.id] ?? c.name;
          return { short, x, y, anchor };
        })
      : [];

    const hl = this.highlightId();
    const dots: Dot[] = this.patterns().map(p => {
      const ringIdx = RING_IDS.indexOf(radarRingOf(p));
      const sIdx    = cats.findIndex(c => c.id === p.category);
      if (ringIdx < 0 || sIdx < 0) return null;
      const h    = hash(p.id);
      const a0   = sIdx * sectorAngle - Math.PI / 2;
      const aPad = sectorAngle * 0.08;
      const ang  = a0 + aPad + ((h % 1000) / 1000) * (sectorAngle - 2 * aPad);
      const r0   = ringIdx === 0 ? 0 : ringR[ringIdx - 1];
      const r1   = ringR[ringIdx];
      const rPad = (r1 - r0) * 0.15;
      const rad  = r0 + rPad + (((h >> 10) % 1000) / 1000) * (r1 - r0 - 2 * rPad);
      return {
        id:      p.id,
        num:     p.num,
        title:   p.title,
        one:     p.one_liner,
        ring:    radarRingOf(p),
        cat:     p.category,
        catName: CATEGORIES.find(c => c.id === p.category)?.name ?? p.category,
        x:       cx + Math.cos(ang) * rad,
        y:       cy + Math.sin(ang) * rad,
        isHL:    p.id === hl,
      };
    }).filter((d): d is Dot => d !== null);

    return { total, cx, cy, ringR, sectors, ringLabels, sectorLabels, dots };
  });

  protected readonly hover = signal<{ d: Dot; px: number; py: number } | null>(null);

  protected onMove(event: MouseEvent, d: Dot) {
    const svg = (event.currentTarget as Element).closest('svg');
    const wrap = (event.currentTarget as Element).closest('.radar-wrap');
    if (!svg || !wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    this.hover.set({ d, px: event.clientX - wrapRect.left, py: event.clientY - wrapRect.top });
  }

  protected onLeave() { this.hover.set(null); }

  protected go(d: Dot, event: Event) {
    event.preventDefault();
    this.router.navigate(['/patterns', d.id]);
  }

  protected ringHint(ring: RadarRingId): string {
    return RADAR.rings.find(r => r.id === ring)?.hint ?? '';
  }
  protected ringLabel(ring: RadarRingId): string {
    return RADAR.rings.find(r => r.id === ring)?.label ?? ring;
  }
}
