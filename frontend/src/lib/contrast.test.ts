import { describe, it, expect } from 'vitest';

// Vite-native raw import (same approach as src/designRules.test.ts; no node typings).
const css = Object.values(
  import.meta.glob('/src/index.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)[0];

function block(selectorRe: RegExp): string {
  const m = selectorRe.exec(css);
  if (!m) throw new Error(`block not found: ${selectorRe}`);
  const start = css.indexOf('{', m.index) + 1;
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

function vars(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const darkVars = vars(block(/@theme\s*\{/));
const lightVars = { ...darkVars, ...vars(block(/\[data-theme="light"\]\s*\{/)) };

function resolve(table: Record<string, string>, name: string, depth = 0): string {
  const v = table[name];
  if (v === undefined) throw new Error(`token --${name} missing`);
  const ref = /^var\(--([\w-]+)\)$/.exec(v);
  if (ref && depth < 10) return resolve(table, ref[1], depth + 1);
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`token --${name} is not a #rrggbb hex: ${v}`);
  return v;
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const pairs: Array<[fg: string, bg: string, min: number]> = [
  ['ink', 'surface', 7],
  ['ink', 'raised', 7],
  ['ink-muted', 'surface', 7],
  ['ink-faint', 'surface', 4.5],
  ['accent', 'surface', 4.5],
  ['on-accent', 'accent', 4.5],
  ['success', 'surface', 4.5],
  ['warning', 'surface', 4.5],
  ['danger', 'surface', 4.5],
];

const themes: Array<[string, Record<string, string>]> = [
  ['dark', darkVars],
  ['light', lightVars],
];

describe('palette contrast (WCAG)', () => {
  for (const [theme, table] of themes) {
    for (const [fg, bg, min] of pairs) {
      it(`${theme}: ${fg} on ${bg} >= ${min}`, () => {
        const r = ratio(resolve(table, `color-${fg}`), resolve(table, `color-${bg}`));
        expect(r).toBeGreaterThanOrEqual(min);
      });
    }
  }

  it('dark surface uses the mandated base hex', () => {
    expect(resolve(darkVars, 'color-surface').toLowerCase()).toBe('#1a1816');
  });

  it('light surface uses the mandated base hex', () => {
    expect(resolve(lightVars, 'color-surface').toLowerCase()).toBe('#f4f0e8');
  });
});
