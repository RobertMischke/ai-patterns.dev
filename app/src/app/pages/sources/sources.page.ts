import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SOURCES, PATTERN_BY_ID } from '../../../data';

@Component({
  selector: 'app-sources',
  imports: [RouterLink],
  templateUrl: './sources.page.html',
})
export class SourcesPage {
  protected readonly sources = SOURCES;

  protected patternTitle(id: string): string {
    return PATTERN_BY_ID.get(id)?.title ?? id;
  }
  protected patternNum(id: string): string {
    return PATTERN_BY_ID.get(id)?.num ?? '';
  }
}
