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
});
