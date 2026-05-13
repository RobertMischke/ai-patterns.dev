import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CATEGORIES, PATTERNS } from '../../../data';

@Component({
  selector: 'app-categories-list',
  imports: [RouterLink],
  templateUrl: './categories-list.page.html',
})
export class CategoriesListPage {
  protected readonly cards = CATEGORIES.map(c => ({
    ...c,
    patternCount: PATTERNS.filter(p => p.category === c.id).length,
  }));
}
