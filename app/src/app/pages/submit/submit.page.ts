import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CATEGORIES } from '../../../data';

@Component({
  selector: 'app-submit',
  imports: [RouterLink],
  templateUrl: './submit.page.html',
})
export class SubmitPage {
  protected readonly categories = CATEGORIES;
  protected readonly submitted = signal(false);

  protected onSubmit(event: SubmitEvent) {
    event.preventDefault();
    this.submitted.set(true);
  }
}
