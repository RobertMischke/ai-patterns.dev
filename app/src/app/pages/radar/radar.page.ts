import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PATTERNS, CATEGORIES, RADAR, radarRingOf, type Pattern, type RadarRingId } from '../../../data';
import { TechRadar } from '../../components/tech-radar/tech-radar';

interface Ring {
  id:    RadarRingId;
  label: string;
  hint:  string;
  color: string;
  patterns: Pattern[];
}

@Component({
  selector: 'app-radar',
  imports: [RouterLink, TechRadar],
  templateUrl: './radar.page.html',
})
export class RadarPage {
  protected readonly all = PATTERNS;
  protected readonly rings: Ring[] = RADAR.rings.map(r => ({
    ...r,
    patterns: PATTERNS.filter(p => radarRingOf(p) === r.id),
  }));

  protected categoryName(catId: string): string {
    return CATEGORIES.find(c => c.id === catId)?.name ?? catId;
  }
}
