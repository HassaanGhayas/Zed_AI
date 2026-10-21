import type { AnalyticsSummary, DomainStatus } from '../types';

/** Placeholder for any value the backend reports as null: never a fabricated number. */
export const DASH = '—';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Normalises a recall/retention value to 0-100. The API contract is ambiguous
 * between a 0-1 fraction and a 0-100 percent; fractions in (0, 1] are scaled.
 */
export function toPercent(v: number | null | undefined): number | null {
  if (!isNum(v)) return null;
  const pct = v > 0 && v <= 1 ? v * 100 : v;
  return Math.min(100, Math.max(0, pct));
}

export function formatPercent(v: number | null | undefined, digits = 0): string {
  const p = toPercent(v);
  return p === null ? DASH : `${p.toFixed(digits)}%`;
}

/** "+4.2%" / "-1%" / dash. `unit` distinguishes percent from percentage points in the label. */
export function formatSignedDelta(v: number | null | undefined, unit = '%', digits = 1): string {
  if (!isNum(v)) return DASH;
  const rounded = Number(v.toFixed(digits));
  if (rounded === 0) return `0${unit}`;
  return `${rounded > 0 ? '+' : '-'}${Math.abs(rounded)}${unit}`;
}

/** Seconds-per-concept as "X.X min" (dash when unknown). */
export function formatMinutesPerConcept(seconds: number | null | undefined): string {
  if (!isNum(seconds) || seconds < 0) return DASH;
  const min = seconds / 60;
  return `${min < 10 ? min.toFixed(1) : Math.round(min)}`;
}

export function formatHours(h: number | null | undefined): string {
  if (!isNum(h) || h < 0) return DASH;
  return h < 10 ? h.toFixed(1) : String(Math.round(h));
}

export type Trend = 'up' | 'down' | 'flat' | 'none';

export function trendOf(delta: number | null | undefined): Trend {
  if (!isNum(delta)) return 'none';
  if (Math.abs(delta) < 0.05) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

/** Progress-bar fill 0-100; derived from hours/target when pct is unusable. */
export function consistencyPct(c: AnalyticsSummary['consistency']): number {
  if (isNum(c.pct)) return Math.min(100, Math.max(0, c.pct));
  if (isNum(c.hours) && isNum(c.target_hours) && c.target_hours > 0) {
    return Math.min(100, Math.max(0, (c.hours / c.target_hours) * 100));
  }
  return 0;
}

/** Velocity delta: negative means fewer seconds per concept, i.e. faster. */
export function velocityTrend(deltaPct: number | null | undefined): { label: string; good: boolean } | null {
  if (!isNum(deltaPct)) return null;
  const r = Math.round(Math.abs(deltaPct));
  if (r === 0) return { label: 'No change', good: true };
  return deltaPct < 0 ? { label: `${r}% faster`, good: true } : { label: `${r}% slower`, good: false };
}

export interface CurvePoint {
  day: number;
  recall: number | null;
  natural: number | null;
  /** Set only on days that had a review (drives the spike markers). */
  reviewLabel: string | null;
}

/**
 * Zips the curve arrays defensively: the shortest of `days` wins and unusable
 * numbers become null (gaps), never zero.
 */
export function buildCurveData(curve: AnalyticsSummary['curve'] | null | undefined): CurvePoint[] {
  if (!curve || !Array.isArray(curve.days)) return [];
  const recall = Array.isArray(curve.recall) ? curve.recall : [];
  const natural = Array.isArray(curve.natural) ? curve.natural : [];
  const scale = (v: unknown): number | null => (isNum(v) ? v : null); // contract: already 0-100
  const labels = new Map<number, string>();
  for (const r of curve.reviews ?? []) {
    if (r && isNum(r.day) && typeof r.label === 'string') labels.set(r.day, r.label);
  }
  return curve.days
    .filter(isNum)
    .map((day, i) => ({
      day,
      recall: scale(recall[i]),
      natural: scale(natural[i]),
      reviewLabel: labels.get(day) ?? null,
    }));
}

/** True when there is nothing to chart or total (no attempts yet). */
export function isEmptySummary(s: AnalyticsSummary): boolean {
  return !s.totals || (s.totals.attempts ?? 0) === 0;
}

export const DOMAIN_TONE: Record<DomainStatus, 'success' | 'accent' | 'warning' | 'danger'> = {
  Mastered: 'success',
  Advanced: 'accent',
  'In Review': 'warning',
  'Action Needed': 'danger',
};

export function domainTone(status: string): 'success' | 'accent' | 'warning' | 'danger' | 'neutral' {
  return (DOMAIN_TONE as Record<string, 'success' | 'accent' | 'warning' | 'danger'>)[status] ?? 'neutral';
}

export function formatDueDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return DASH;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const MIN_TARGET_HOURS = 1;
/** Matches the DB constraint (hours in a 31-day month). */
export const MAX_TARGET_HOURS = 744;

/** Parses the monthly-target input: rounded to a whole hour and clamped to 1..744; null when not a number. */
export function parseTargetHours(raw: string): number | null {
  const n = Number(raw.trim());
  if (!raw.trim() || !Number.isFinite(n)) return null;
  return Math.min(MAX_TARGET_HOURS, Math.max(MIN_TARGET_HOURS, Math.round(n)));
}
