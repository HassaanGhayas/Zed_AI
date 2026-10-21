import { describe, expect, it } from 'vitest';
import {
  DASH,
  buildCurveData,
  consistencyPct,
  formatHours,
  formatMinutesPerConcept,
  formatPercent,
  formatSignedDelta,
  isEmptySummary,
  parseTargetHours,
  toPercent,
  trendOf,
  velocityTrend,
} from './analyticsFormat';
import type { AnalyticsSummary } from '../types';

describe('null handling shows a dash, never a number', () => {
  it('formatters', () => {
    expect(formatPercent(null)).toBe(DASH);
    expect(formatPercent(undefined)).toBe(DASH);
    expect(formatPercent(Number.NaN)).toBe(DASH);
    expect(formatSignedDelta(null)).toBe(DASH);
    expect(formatMinutesPerConcept(null)).toBe(DASH);
    expect(formatHours(null)).toBe(DASH);
    expect(velocityTrend(null)).toBeNull();
    expect(trendOf(null)).toBe('none');
  });
});

describe('formatting', () => {
  it('percent accepts 0-100 or 0-1 and clamps', () => {
    expect(toPercent(82)).toBe(82);
    expect(toPercent(0.82)).toBeCloseTo(82);
    expect(toPercent(0)).toBe(0);
    expect(toPercent(140)).toBe(100);
    expect(formatPercent(87.4)).toBe('87%');
  });

  it('signed delta', () => {
    expect(formatSignedDelta(4.24)).toBe('+4.2%');
    expect(formatSignedDelta(-1, '%')).toBe('-1%');
    expect(formatSignedDelta(0.01)).toBe('0%');
    expect(formatSignedDelta(2, ' h')).toBe('+2 h');
  });

  it('minutes per concept and hours', () => {
    expect(formatMinutesPerConcept(150)).toBe('2.5');
    expect(formatMinutesPerConcept(900)).toBe('15');
    expect(formatMinutesPerConcept(-3)).toBe(DASH);
    expect(formatHours(4.25)).toBe('4.3');
    expect(formatHours(0)).toBe('0.0');
  });

  it('velocity trend: fewer seconds is faster', () => {
    expect(velocityTrend(-12.4)).toEqual({ label: '12% faster', good: true });
    expect(velocityTrend(8)).toEqual({ label: '8% slower', good: false });
    expect(velocityTrend(0)).toEqual({ label: 'No change', good: true });
  });

  it('consistency bar clamps and falls back to hours/target', () => {
    const base = { hours: 5, target_hours: 20, pct: 25, delta_hours: null };
    expect(consistencyPct(base)).toBe(25);
    expect(consistencyPct({ ...base, pct: 180 })).toBe(100);
    expect(consistencyPct({ ...base, pct: Number.NaN })).toBe(25);
    expect(consistencyPct({ ...base, pct: Number.NaN, target_hours: 0 })).toBe(0);
  });

  it('parseTargetHours validates range', () => {
    expect(parseTargetHours('20')).toBe(20);
    expect(parseTargetHours(' 12.54 ')).toBe(13);
    expect(parseTargetHours('')).toBeNull();
    expect(parseTargetHours('0')).toBe(1);
    expect(parseTargetHours('-5')).toBe(1);
    expect(parseTargetHours('301')).toBe(301);
    expect(parseTargetHours('9999')).toBe(744);
    expect(parseTargetHours('abc')).toBeNull();
  });
});

describe('buildCurveData', () => {
  it('zips series, maps review labels and leaves gaps as null', () => {
    const pts = buildCurveData({
      days: [0, 1, 2],
      recall: [100, 90, 95],
      natural: [100, 80],
      reviews: [{ day: 2, label: 'Review: Entropy' }],
    });
    expect(pts).toEqual([
      { day: 0, recall: 100, natural: 100, reviewLabel: null },
      { day: 1, recall: 90, natural: 80, reviewLabel: null },
      { day: 2, recall: 95, natural: null, reviewLabel: 'Review: Entropy' },
    ]);
  });

  it('empty arrays give no points; garbage values become null', () => {
    expect(buildCurveData({ days: [], recall: [], natural: [], reviews: [] })).toEqual([]);
    expect(buildCurveData(null)).toEqual([]);
    const bad = buildCurveData({ days: [0], recall: ['x' as unknown as number], natural: [], reviews: [] });
    expect(bad[0].recall).toBeNull();
  });
});

describe('isEmptySummary', () => {
  it('is empty when there are no attempts', () => {
    expect(isEmptySummary({ totals: { attempts: 0, concepts: 0 } } as AnalyticsSummary)).toBe(true);
    expect(isEmptySummary({ totals: { attempts: 3, concepts: 2 } } as AnalyticsSummary)).toBe(false);
  });
});
