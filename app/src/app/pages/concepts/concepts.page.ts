import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CONCEPTS, PATTERN_BY_ID } from '../../../data';

@Component({
  selector: 'app-concepts',
  imports: [RouterLink],
  templateUrl: './concepts.page.html',
})
export class ConceptsPage {
  protected readonly concepts = CONCEPTS.slice().sort((a, b) => a.term.localeCompare(b.term));

  protected patternTitle(id: string): string {
    return PATTERN_BY_ID.get(id)?.title ?? id;
  }

  protected patternNum(id: string): string {
    return PATTERN_BY_ID.get(id)?.num ?? '';
  }
}
