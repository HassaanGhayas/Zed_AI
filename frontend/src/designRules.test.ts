import { describe, it, expect } from 'vitest';
// Vite-native file scan (no node typings / new deps): every source file as raw text.
const raw = import.meta.glob(['/src/**/*.{ts,tsx,css}', '!/src/**/*.test.*'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const files = Object.entries(raw).map(([path, text]) => ({
  rel: path.replace(/^\/src\//, ''),
  text,
}));


function offenders(re: RegExp, skip?: (rel: string) => boolean): string[] {
  const hits: string[] = [];
  for (const f of files) {
    if (skip?.(f.rel)) continue;
    f.text.split('\n').forEach((line: string, i: number) => {
      if (re.test(line)) hits.push(`${f.rel}:${i + 1}`);
    });
  }
  return hits;
}

describe('design rules', () => {
  it('scans a non-trivial set of source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('no transition-all', () => {
    expect(offenders(/transition-all/)).toEqual([]);
  });

  it('no backdrop-blur', () => {
    expect(offenders(/backdrop-blur/)).toEqual([]);
  });

  it('no animate-pulse outside ui/Skeleton.tsx', () => {
    expect(offenders(/animate-pulse/, (rel) => rel === 'components/ui/Skeleton.tsx')).toEqual([]);
  });

  it('no infinite keyframe animations in index.css', () => {
    const css = files.find((f) => f.rel === 'index.css')!;
    const hits: string[] = [];
    css.text.split('\n').forEach((line: string, i: number) => {
      if (/\binfinite\b/.test(line)) hits.push(`index.css:${i + 1}`);
    });
    expect(hits).toEqual([]);
  });

  describe('ui primitives (src/components/ui)', () => {
    const outsideUi = (rel: string) => !rel.startsWith('components/ui/');

    it('no rounded-xl/2xl/3xl', () => {
      expect(offenders(/\brounded-(xl|2xl|3xl)\b/, outsideUi)).toEqual([]);
    });

    it('no bare rounded', () => {
      expect(offenders(/\brounded\b(?![-\w])/, outsideUi)).toEqual([]);
    });

    it('no arbitrary text sizes', () => {
      expect(offenders(/text-\[/, outsideUi)).toEqual([]);
    });

    it('no shadow-lg/xl/2xl', () => {
      expect(offenders(/\bshadow-(lg|xl|2xl)\b/, outsideUi)).toEqual([]);
    });

    it('no bg-gradient', () => {
      expect(offenders(/bg-gradient/, outsideUi)).toEqual([]);
    });

    it('no important (!) Tailwind modifiers', () => {
      expect(offenders(/[\s"'`:]!-?[a-z]+-|[\w\]/)]!(?=[\s"'`]|$)/, outsideUi)).toEqual([]);
    });
  });

  describe('quiz and player (Task 8 scope)', () => {
    const scope = [
      'components/SocraticQuiz.tsx',
      'components/VideoPlayer.tsx',
      'components/SegmentNav.tsx',
      'components/AiTutorPanel.tsx',
    ];
    const outsideScope = (rel: string) => !scope.includes(rel);

    it('no text-[10px] / text-[11px]', () => {
      expect(offenders(/text-\[1[01]px\]/, outsideScope)).toEqual([]);
    });

    it('no rounded-xl/2xl/3xl', () => {
      expect(offenders(/\brounded-(xl|2xl|3xl)\b/, outsideScope)).toEqual([]);
    });

    it('no bare rounded', () => {
      expect(offenders(/\brounded\b(?![-\w])/, outsideScope)).toEqual([]);
    });

    it('no raw bg-white / bg-black / text-red- classes', () => {
      expect(offenders(/\bbg-(white|black)\b|\btext-red-/, outsideScope)).toEqual([]);
    });

    it('no rgba(', () => {
      expect(offenders(/rgba\(/, outsideScope)).toEqual([]);
    });

    // Important modifier in a class string: `!bg-x`, `px-2.5!`, plus bare utilities
    // (`!absolute`, `flex!`) from a word list so JS (`!x`, `!==`) and prose ("Finished!") pass.
    const IMPORTANT_CLASS =
      /[\s"'`:]!-?[a-z]+-|-[\w.\]/%)]+!(?=[\s"'`]|$)|(?:^|[\s"'`:])(?:!(?:absolute|relative|fixed|sticky|static|hidden|block|inline|flex|grid|contents|border|rounded|shadow|truncate|italic|underline|uppercase|visible|invisible|grow|shrink|transition)|(?:absolute|relative|fixed|sticky|static|hidden|block|inline|flex|grid|contents|border|rounded|shadow|truncate|italic|underline|uppercase|visible|invisible|grow|shrink|transition)!)(?=[\s"'`]|$)/;

    it('important-modifier regex flags class strings and ignores JS/prose', () => {
      for (const bad of ['className="!absolute z-10"', 'className="p-2 !hidden"', 'className="flex! gap-2"', 'cn("px-2.5! py-1")', '`a ${x} !bg-red`', 'x disabled:opacity-40!"', 'className="!border-0"']) {
        expect(IMPORTANT_CLASS.test(bad), bad).toBe(true);
      }
      for (const ok of ['if (!x) return', 'a !== b', 'cond && !foo && bar', 'All Topics Finished! View Notes', "'Excellent Understanding!'", 'const f = !isOpen;']) {
        expect(IMPORTANT_CLASS.test(ok), ok).toBe(false);
      }
    });

    it('no important (!) Tailwind modifiers', () => {
      expect(offenders(IMPORTANT_CLASS, outsideScope)).toEqual([]);
    });
  });

  describe('landing, notes, progress (Task 9 scope)', () => {
    const scope9 = (rel: string) =>
      rel === 'components/VideoInput.tsx' ||
      rel === 'components/NotesModal.tsx' ||
      rel === 'components/ProgressView.tsx' ||
      rel === 'components/ErrorBoundary.tsx' ||
      (rel.startsWith('components/landing/') && rel.endsWith('.tsx'));
    const outside9 = (rel: string) => !scope9(rel);
    const IMPORTANT_CLASS_9 =
      /[\s"'`:]!-?[a-z]+-|-[\w.\]/%)]+!(?=[\s"'`]|$)|(?:^|[\s"'`:])(?:!(?:absolute|relative|fixed|sticky|static|hidden|block|inline|flex|grid|contents|border|rounded|shadow|truncate|italic|underline|uppercase|visible|invisible|grow|shrink|transition)|(?:absolute|relative|fixed|sticky|static|hidden|block|inline|flex|grid|contents|border|rounded|shadow|truncate|italic|underline|uppercase|visible|invisible|grow|shrink|transition)!)(?=[\s"'`]|$)/;

    it('scope matches files', () => {
      expect(files.filter((f) => scope9(f.rel)).length).toBeGreaterThanOrEqual(12);
    });
    it('no text-[10px] / text-[11px]', () => {
      expect(offenders(/text-\[1[01]px\]/, outside9)).toEqual([]);
    });
    it('no rounded-xl/2xl/3xl', () => {
      expect(offenders(/\brounded-(xl|2xl|3xl)\b/, outside9)).toEqual([]);
    });
    it('no bare rounded', () => {
      expect(offenders(/\brounded\b(?![-\w])/, outside9)).toEqual([]);
    });
    it('no raw bg-white / bg-black / text-red- classes', () => {
      expect(offenders(/\bbg-(white|black)\b|\btext-red-/, outside9)).toEqual([]);
    });
    it('no rgba(', () => {
      expect(offenders(/rgba\(/, outside9)).toEqual([]);
    });
    it('no important (!) Tailwind modifiers', () => {
      expect(offenders(IMPORTANT_CLASS_9, outside9)).toEqual([]);
    });
    it('no bg-gradient', () => {
      expect(offenders(/bg-gradient/, outside9)).toEqual([]);
    });
    it('no ember-/cosmos- ramp classes', () => {
      expect(offenders(/\b(ember|cosmos)-\d/, outside9)).toEqual([]);
    });
  });

  describe('navbar, theme toggle, cloud library (Task 10 scope)', () => {
    const scope10 = (rel: string) =>
      rel === 'components/Navbar.tsx' ||
      rel === 'components/ThemeToggle.tsx' ||
      rel === 'components/CloudLibrary.tsx';
    const outside10 = (rel: string) => !scope10(rel);
    const IMPORTANT_CLASS_10 =
      /[\s"'`:]!-?[a-z]+-|-[\w.\]/%)]+!(?=[\s"'`]|$)|(?:^|[\s"'`:])(?:!(?:absolute|relative|fixed|sticky|static|hidden|block|inline|flex|grid|contents|border|rounded|shadow|truncate|italic|underline|uppercase|visible|invisible|grow|shrink|transition)|(?:absolute|relative|fixed|sticky|static|hidden|block|inline|flex|grid|contents|border|rounded|shadow|truncate|italic|underline|uppercase|visible|invisible|grow|shrink|transition)!)(?=[\s"'`]|$)/;

    it('scope matches files', () => {
      expect(files.filter((f) => scope10(f.rel)).length).toBe(3);
    });
    it('no text-[10px] / text-[11px]', () => {
      expect(offenders(/text-\[1[01]px\]/, outside10)).toEqual([]);
    });
    it('no rounded-xl/2xl/3xl', () => {
      expect(offenders(/\brounded-(xl|2xl|3xl)\b/, outside10)).toEqual([]);
    });
    it('no bare rounded', () => {
      expect(offenders(/\brounded\b(?![-\w])/, outside10)).toEqual([]);
    });
    it('no shadow-lg/xl/2xl', () => {
      expect(offenders(/\bshadow-(lg|xl|2xl)\b/, outside10)).toEqual([]);
    });
    it('no raw bg-white / bg-black / text-red- classes', () => {
      expect(offenders(/\bbg-(white|black)\b|\btext-red-/, outside10)).toEqual([]);
    });
    it('no rgba(', () => {
      expect(offenders(/rgba\(/, outside10)).toEqual([]);
    });
    it('no important (!) Tailwind modifiers', () => {
      expect(offenders(IMPORTANT_CLASS_10, outside10)).toEqual([]);
    });
    it('no bg-gradient', () => {
      expect(offenders(/bg-gradient/, outside10)).toEqual([]);
    });
    it('no ember-/cosmos- classes', () => {
      expect(offenders(/\b(ember|cosmos)-/, outside10)).toEqual([]);
    });
    it('no dark: classes', () => {
      expect(offenders(/\bdark:/, outside10)).toEqual([]);
    });
  });

  describe('review (Task 11 scope)', () => {
    const scope11 = (rel: string) =>
      rel === 'components/ReviewQueue.tsx' ||
      rel === 'components/ReviewModal.tsx';
    const outside11 = (rel: string) => !scope11(rel);
    const IMPORTANT_CLASS_11 =
      /[\s"'`:]!-?[a-z]+-|-[\w.\]/%)]+!(?=[\s"'`]|$)|(?:^|[\s"'`:])(?:!(?:absolute|relative|fixed|sticky|static|hidden|block|inline|flex|grid|contents|border|rounded|shadow|truncate|italic|underline|uppercase|visible|invisible|grow|shrink|transition)|(?:absolute|relative|fixed|sticky|static|hidden|block|inline|flex|grid|contents|border|rounded|shadow|truncate|italic|underline|uppercase|visible|invisible|grow|shrink|transition)!)(?=[\s"'`]|$)/;

    it('scope matches files', () => {
      expect(files.filter((f) => scope11(f.rel)).length).toBe(2);
    });
    it('no text-[10px] / text-[11px]', () => {
      expect(offenders(/text-\[1[01]px\]/, outside11)).toEqual([]);
    });
    it('no rounded-xl/2xl/3xl', () => {
      expect(offenders(/rounded-(xl|2xl|3xl)/, outside11)).toEqual([]);
    });
    it('no bare rounded', () => {
      expect(offenders(/rounded(?![-\w])/, outside11)).toEqual([]);
    });
    it('no shadow-lg/xl/2xl', () => {
      expect(offenders(/shadow-(lg|xl|2xl)/, outside11)).toEqual([]);
    });
    it('no raw bg-white / bg-black / text-red- classes', () => {
      expect(offenders(/bg-(white|black)|text-red-/, outside11)).toEqual([]);
    });
    it('no rgba(', () => {
      expect(offenders(/rgba\(/, outside11)).toEqual([]);
    });
    it('no important (!) Tailwind modifiers', () => {
      expect(offenders(IMPORTANT_CLASS_11, outside11)).toEqual([]);
    });
    it('no bg-gradient', () => {
      expect(offenders(/bg-gradient/, outside11)).toEqual([]);
    });
    it('no ember-/cosmos- classes', () => {
      expect(offenders(/(ember|cosmos)-/, outside11)).toEqual([]);
    });
    it('no dark: classes', () => {
      expect(offenders(/dark:/, outside11)).toEqual([]);
    });
  });

  describe('whole source (Task 12 final gates)', () => {
    // Not Tailwind classes: a local variable named `rounded`.
    const skipFormat = (rel: string) => rel === 'lib/analyticsFormat.ts';
    const IMPORTANT_CLASS_ALL =
      /[\s"'`:]!-?[a-z]+-|-[\w.\]/%)]+!(?=[\s"'`]|$)|(?:^|[\s"'`:])(?:!(?:absolute|relative|fixed|sticky|static|hidden|block|inline|flex|grid|contents|border|rounded|shadow|truncate|italic|underline|uppercase|visible|invisible|grow|shrink|transition)|(?:absolute|relative|fixed|sticky|static|hidden|block|inline|flex|grid|contents|border|rounded|shadow|truncate|italic|underline|uppercase|visible|invisible|grow|shrink|transition)!)(?=[\s"'`]|$)/;

    it('no text-[10px] / text-[11px]', () => {
      expect(offenders(/text-\[1[01]px\]/)).toEqual([]);
    });
    it('no rounded-xl/2xl/3xl', () => {
      expect(offenders(/rounded-(xl|2xl|3xl)/)).toEqual([]);
    });
    it('no bare rounded', () => {
      expect(offenders(/rounded(?![-\w])/, skipFormat)).toEqual([]);
    });
    it('no important (!) Tailwind modifiers', () => {
      expect(offenders(IMPORTANT_CLASS_ALL)).toEqual([]);
    });
    it('no bg-gradient', () => {
      expect(offenders(/bg-gradient/)).toEqual([]);
    });
    it('no ember-/cosmos- classes or tokens', () => {
      expect(offenders(/(ember|cosmos)-\d/)).toEqual([]);
    });
    it('no dark: variants', () => {
      expect(offenders(/dark:/)).toEqual([]);
    });
    it('no shadow-lg/xl/2xl', () => {
      expect(offenders(/shadow-(lg|xl|2xl)/)).toEqual([]);
    });
  });
});
