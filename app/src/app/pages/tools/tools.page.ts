import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TOOLS, TOOL_KINDS, PATTERN_BY_ID, type Tool, type ToolKind } from '../../../data';

interface ToolGroup {
  kind: ToolKind;
  tools: Tool[];
}

@Component({
  selector: 'app-tools',
  imports: [RouterLink],
  templateUrl: './tools.page.html',
})
export class ToolsPage {
  protected readonly groups: ToolGroup[] = TOOL_KINDS
    .map(kind => ({ kind, tools: TOOLS.filter(t => t.kind === kind.id) }))
    .filter(g => g.tools.length > 0);

  protected patternTitle(id: string): string {
    return PATTERN_BY_ID.get(id)?.title ?? id;
  }
  protected patternNum(id: string): string {
    return PATTERN_BY_ID.get(id)?.num ?? '';
  }
}
