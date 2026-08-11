import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { PATTERN_BY_ID, patternAbstractionOf, type Pattern } from '../data';

describe('patternAbstractionOf', () => {
  it('defaults legacy records to pattern and preserves explicit values', () => {
    expect(patternAbstractionOf({} as Pattern)).toBe('pattern');
    expect(patternAbstractionOf({ abstraction: 'recipe' } as Pattern)).toBe('recipe');
  });
});

describe('catalog data', () => {
  it('contains the four boundary, interface, trace and proof patterns', () => {
    const expected = new Map([
      ['untrusted-content-boundary', 'P-51'],
      ['agent-computer-interface', 'P-52'],
      ['run-trace-evidence-envelope-replay', 'P-53'],
      ['reproduce-patch-prove', 'P-54'],
    ]);

    for (const [id, num] of expected) {
      expect(PATTERN_BY_ID.get(id)?.num).toBe(num);
    }
    expect(patternAbstractionOf(PATTERN_BY_ID.get('reproduce-patch-prove')!)).toBe('recipe');
  });
});

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the site brand', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.brand .wm')?.textContent).toContain('ai-patterns.dev');
  });
});
