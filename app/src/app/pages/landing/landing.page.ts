import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PATTERNS, CATEGORIES, type Category, type Pattern } from '../../../data';

interface CategoryRow {
  category: Category;
  patterns: Pattern[];
}

@Component({
  selector: 'app-landing',
  imports: [RouterLink],
  templateUrl: './landing.page.html',
})
export class LandingPage {
  protected readonly patternCount  = PATTERNS.length;
  protected readonly categoryCount = CATEGORIES.length;

  protected readonly rows: CategoryRow[] = CATEGORIES.map(c => ({
    category: c,
    patterns: PATTERNS.filter(p => p.category === c.id),
  }));
}
