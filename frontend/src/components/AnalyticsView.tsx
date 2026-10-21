import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Brain,
  Clock,
  Download,
  LogIn,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Minus,
  AlertTriangle,
  Gauge,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { exportAnalytics, fetchAnalyticsSummary, isForbiddenError, requestInsight } from '../lib/api';
import { fetchMonthlyTarget, saveMonthlyTarget } from '../lib/cloudSync';
import {
  DASH,
  buildCurveData,
  consistencyPct,
  domainTone,
  formatDueDate,
  formatHours,
  formatPercent,
  formatSignedDelta,
  isEmptySummary,
  MAX_TARGET_HOURS,
  MIN_TARGET_HOURS,
  parseTargetHours,
  toPercent,
  trendOf,
  velocityTrend,
  type Trend,
} from '../lib/analyticsFormat';
import type { AnalyticsSummary, InsightResponse } from '../types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { SkeletonLine } from './ui/Skeleton';
import { ReviewQueue } from './ReviewQueue';
import { ProgressBar } from './ui/ProgressBar';
import { RollingNumber } from './ui/RollingNumber';
import { SegmentedControl } from './ui/SegmentedControl';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

type SummaryState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: AnalyticsSummary };

interface AnalyticsViewProps {
  onClose: () => void;
}

/** Full-page learning analytics dashboard (signed-in only). Reached from the Navbar; no router. */
export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ onClose }) => {
  const { enabled, user, loading: authLoading, signInWithGoogle } = useAuth();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!enabled) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-16 z-30 overflow-y-auto bg-surface"
      role="region"
      aria-labelledby="analytics-title"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-6">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onClose}
              aria-label="Back to study session"
              className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-ink-faint hover:text-ink hover:bg-sunken border border-line cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h1 id="analytics-title" className="font-display text-xl sm:text-2xl font-bold text-ink tracking-tight">
                Learning Analytics
              </h1>
              <p className="text-xs text-ink-faint">Retention, pace and weak spots across all your sessions</p>
            </div>
          </div>
        </div>

        {authLoading ? (
          <LoadingGrid />
        ) : !user ? (
          <SignedOutPrompt onSignIn={() => void signInWithGoogle()} />
        ) : (
          <AnalyticsBody key={user.id} />
        )}
      </div>
    </div>
  );
};

const SignedOutPrompt: React.FC<{ onSignIn: () => void }> = ({ onSignIn }) => (
  <Card radius="lg" className="p-6 sm:p-10 text-center max-w-xl mx-auto space-y-4">
    <div className="mx-auto w-12 h-12 rounded-lg bg-accent/10 border border-accent/30 text-accent flex items-center justify-center">
      <BarChart3 className="w-6 h-6" aria-hidden="true" />
    </div>
    <h2 className="text-lg font-semibold text-ink">Sign in to see your analytics</h2>
    <p className="text-sm text-ink-muted leading-relaxed">
      Analytics track your retention across sessions, so they need an account. Your answers stay private to you.
    </p>
    <Button type="button" onClick={onSignIn}>
      <LogIn className="w-4 h-4" aria-hidden="true" /> Sign in with Google
    </Button>
  </Card>
);

const LoadingGrid: React.FC = () => (
  <div role="status" aria-busy="true" className="space-y-4">
    <span className="sr-only">Loading analytics</span>
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} radius="lg" className="p-5 space-y-3">
          <SkeletonLine className="w-1/3" />
          <SkeletonLine className="w-1/2 h-8" />
          <SkeletonLine className="w-2/3" />
        </Card>
      ))}
    </div>
    <Card radius="lg" className="p-5 space-y-3">
      <SkeletonLine className="w-1/4" />
      <SkeletonLine className="w-full h-48" />
    </Card>
  </div>
);

const AnalyticsBody: React.FC = () => {
  const [days, setDays] = useState<Range>(30);
  return (
    <>
      <Toolbar days={days} onDays={setDays} />
      {/* Re-keyed per range so each range starts in its own loading state. */}
      <AnalyticsData key={days} days={days} />
    </>
  );
};

const AnalyticsData: React.FC<{ days: Range }> = ({ days }) => {
  const [state, setState] = useState<SummaryState>({ kind: 'loading' });
  const reqId = useRef(0);

  const apply = useCallback((id: number, p: Promise<AnalyticsSummary>, silent: boolean) => {
    p.then((data) => {
      if (id === reqId.current) setState({ kind: 'ready', data });
    }).catch((err: unknown) => {
      if (id !== reqId.current) return;
      // A failed silent refresh keeps the data already on screen.
      setState((prev) =>
        silent && prev.kind === 'ready'
          ? prev
          : { kind: 'error', message: err instanceof Error ? err.message : 'Could not load analytics.' }
      );
    });
  }, []);

  // Event-driven loads (Retry button, post-review refresh).
  const load = useCallback(
    (silent: boolean) => {
      const id = ++reqId.current;
      if (!silent) setState({ kind: 'loading' });
      apply(id, fetchAnalyticsSummary(days), silent);
    },
    [apply, days]
  );

  // Initial load for this range (state already starts as 'loading').
  useEffect(() => {
    let alive = true;
    fetchAnalyticsSummary(days)
      .then((data) => {
        if (alive) setState({ kind: 'ready', data });
      })
      .catch((err: unknown) => {
        if (alive) setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not load analytics.' });
      });
    return () => {
      alive = false; // drop the in-flight response after unmount / range change
    };
  }, [days]);

  const refreshSilently = useCallback(() => load(true), [load]);

  return (
    <>
      {state.kind === 'loading' && <LoadingGrid />}
      {state.kind === 'error' && (
        <Card radius="lg" className="p-6 flex flex-col sm:flex-row sm:items-center gap-3 border-danger/30">
          <div role="alert" className="flex items-start gap-2 flex-1 text-sm text-danger">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>{state.message}</span>
          </div>
          <Button type="button" variant="secondary" onClick={() => load(false)}>
            <RefreshCw className="w-4 h-4" aria-hidden="true" /> Retry
          </Button>
        </Card>
      )}
      {state.kind === 'ready' && (
        <Dashboard summary={state.data} days={days} onRefresh={refreshSilently} />
      )}
    </>
  );
};

const Toolbar: React.FC<{ days: Range; onDays: (d: Range) => void }> = ({ days, onDays }) => {
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (format: 'csv' | 'pdf') => {
    setBusy(format);
    setError(null);
    try {
      await exportAnalytics(format, days);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not export ${format.toUpperCase()}.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <SegmentedControl options={RANGES} value={days} onChange={onDays} label="Time range" renderLabel={(r) => `${r} days`} />
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" loading={busy === 'csv'} disabled={busy !== null} onClick={() => void run('csv')}>
            <Download className="w-4 h-4" aria-hidden="true" /> CSV
          </Button>
          <Button type="button" variant="secondary" loading={busy === 'pdf'} disabled={busy !== null} onClick={() => void run('pdf')}>
            <Download className="w-4 h-4" aria-hidden="true" /> PDF
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
};

const TrendChip: React.FC<{ trend: Trend; good?: boolean; children: React.ReactNode }> = ({ trend, good, children }) => {
  const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const positive = good ?? trend === 'up';
  const tone =
    trend === 'none' || trend === 'flat'
      ? 'text-ink-faint'
      : positive
        ? 'text-success'
        : 'text-danger';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${tone}`}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {children}
    </span>
  );
};

const MetricCard: React.FC<{
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, icon, children }) => (
  <Card radius="lg" className="p-5 flex flex-col gap-2 min-w-0">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-bold uppercase tracking-wider text-ink-faint">{label}</h3>
      <span className="text-accent" aria-hidden="true">{icon}</span>
    </div>
    {children}
  </Card>
);

const BigValue: React.FC<{ value: number | null; decimals?: number; suffix?: string; unit?: string }> = ({
  value,
  decimals = 0,
  suffix = '',
  unit,
}) => (
  <p className="font-display text-3xl sm:text-4xl font-bold text-ink tracking-tight">
    <RollingNumber value={value} decimals={decimals} suffix={suffix} placeholder={DASH} />
    {unit && value !== null && <span className="text-sm font-sans font-medium text-ink-faint ml-1.5">{unit}</span>}
  </p>
);

const Dashboard: React.FC<{ summary: AnalyticsSummary; days: Range; onRefresh: () => void }> = ({
  summary,
  days,
  onRefresh,
}) => {
  const empty = isEmptySummary(summary);

  return (
    <div className="space-y-6">
      {empty ? (
        <Card radius="lg" className="p-8 text-center space-y-2">
          <BarChart3 className="w-8 h-8 mx-auto text-ink-faint" aria-hidden="true" />
          <h2 className="text-base font-semibold text-ink">No analytics yet</h2>
          <p className="text-sm text-ink-muted">
            Answer a few checkpoints while watching a lecture to see your retention, pace and weak spots here.
          </p>
        </Card>
      ) : (
        <>
          <MetricCards summary={summary} days={days} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2 min-w-0">
              <DecayCurve curve={summary.curve} days={days} />
            </div>
            <DomainMastery domains={summary.domains} />
          </div>
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <InsightCard key={days} days={days} disabled={empty} />
        <div className="space-y-6 min-w-0">
          <Card radius="lg" className="p-5">
            <ReviewQueue variant="panel" onReviewed={onRefresh} />
          </Card>
          <TargetSetting onSaved={onRefresh} />
        </div>
      </div>
    </div>
  );
};

const MetricCards: React.FC<{ summary: AnalyticsSummary; days: number }> = ({ summary, days }) => {
  const { retention, velocity, consistency, decay } = summary;
  const vTrend = velocityTrend(velocity.delta_pct);
  const pct = consistencyPct(consistency);
  const retentionTrend = trendOf(retention.delta);
  const sec = velocity.median_seconds_per_concept;
  const minutes = typeof sec === 'number' && Number.isFinite(sec) && sec >= 0 ? sec / 60 : null;
  const h = consistency.hours;
  const hours = typeof h === 'number' && Number.isFinite(h) && h >= 0 ? h : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <MetricCard label="Retention" icon={<Brain className="w-4 h-4" />}>
        <BigValue value={toPercent(retention.value)} suffix="%" />
        <p className="flex items-center gap-1.5 flex-wrap">
          <TrendChip trend={retentionTrend}>{formatSignedDelta(retention.delta, '%')}</TrendChip>
          <span className="text-xs text-ink-faint">vs previous {days} days</span>
        </p>
        <p className="text-xs text-ink-faint" title="Average score on your final answers">
          Average score on your final answers
        </p>
      </MetricCard>

      <MetricCard label="Recall Velocity" icon={<Gauge className="w-4 h-4" />}>
        <BigValue value={minutes} decimals={minutes !== null && minutes < 10 ? 1 : 0} unit="min / concept" />
        <p className="flex items-center gap-1.5 flex-wrap">
          {vTrend ? (
            <TrendChip trend={vTrend.label === 'No change' ? 'flat' : vTrend.good ? 'down' : 'up'} good={vTrend.good}>
              {vTrend.label}
            </TrendChip>
          ) : (
            <span className="text-xs text-ink-faint">{DASH}</span>
          )}
          <span className="text-xs text-ink-faint">
            {velocity.fastest_domain ? `Fastest: ${velocity.fastest_domain}` : 'Median time per concept'}
          </span>
        </p>
      </MetricCard>

      <MetricCard label="Study Consistency" icon={<Clock className="w-4 h-4" />}>
        <BigValue value={hours} decimals={hours !== null && hours < 10 ? 1 : 0} unit={`of ${formatHours(consistency.target_hours)} h target`} />
        <ProgressBar value={pct} label="Study hours toward monthly target" />
        <p className="text-xs text-ink-faint">
          {Math.round(pct)}% of target
          {typeof consistency.delta_hours === 'number' && Number.isFinite(consistency.delta_hours)
            ? ` · ${formatSignedDelta(consistency.delta_hours, ' h')} vs previous`
            : ''}
        </p>
      </MetricCard>

      <MetricCard label="Decay Vulnerability" icon={<AlertTriangle className="w-4 h-4" />}>
        <BigValue value={decay.at_risk_count ?? 0} unit="concepts at risk" />
        <p className="text-xs text-ink-faint">
          <span className={decay.overdue_count > 0 ? 'text-warning font-semibold' : ''}>{decay.overdue_count ?? 0} overdue</span>
        </p>
        {decay.top_at_risk.length > 0 && (
          <ul className="mt-1 space-y-1.5" aria-label="Most at-risk concepts">
            {decay.top_at_risk.slice(0, 3).map((c) => (
              <li key={c.concept_key} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-ink-muted" title={c.label}>{c.label}</span>
                <span className="flex-shrink-0 font-semibold text-danger">{formatPercent(c.predicted_recall)}</span>
              </li>
            ))}
          </ul>
        )}
      </MetricCard>
    </div>
  );
};

const DecayCurve: React.FC<{ curve: AnalyticsSummary['curve']; days: number }> = ({ curve, days }) => {
  const [showTable, setShowTable] = useState(false);
  const data = buildCurveData(curve);
  const hasNatural = data.some((d) => d.natural !== null);
  const usable = data.filter((d) => d.recall !== null || (hasNatural && d.natural !== null));
  const reviews = data.filter((d) => d.reviewLabel !== null && d.recall !== null);

  return (
    <Card radius="lg" className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-ink">Memory decay curve</h2>
          <Badge tone="accent">Projected</Badge>
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-expanded={showTable}
          aria-controls="decay-data-table"
          className="text-xs font-semibold text-ink-faint hover:text-ink px-2 min-h-[44px] cursor-pointer"
        >
          {showTable ? 'Hide data table' : 'Show data table'}
        </button>
      </div>
      <p className="text-xs text-ink-faint">
        {hasNatural
          ? `Projected recall over the next ${days} days with your reviews, against natural forgetting without them.`
          : `Projected recall over the next ${days} days with your reviews.`}
      </p>

      {usable.length < 2 ? (
        <p className="text-sm text-ink-muted py-8 text-center">No review data in the last 4 weeks yet. Review a few concepts to see your projected curve.</p>
      ) : (
        <div
          className="h-56 sm:h-72 w-full"
          role="img"
          aria-label={`Projected recall curve over ${days} days with ${reviews.length} review${reviews.length === 1 ? '' : 's'}. A data table is available.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={usable} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--color-line-soft)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fill: 'var(--color-ink-faint)', fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-line)' }}
                tickFormatter={(d: number) => `D${d}`}
                minTickGap={16}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: 'var(--color-ink-faint)', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${v}%`}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-raised)',
                  border: '1px solid var(--color-line)',
                  borderRadius: 10,
                  fontSize: 12,
                  color: 'var(--color-ink)',
                }}
                labelFormatter={(d) => `Day ${String(d)}`}
                formatter={(v, name) => [typeof v === 'number' ? `${Math.round(v)}%` : DASH, String(name)]}
              />
              {hasNatural && (
                <Line
                  type="monotone"
                  dataKey="natural"
                  name="Natural decay"
                  stroke="var(--color-ink-faint)"
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
              <Line
                type="monotone"
                dataKey="recall"
                name="Projected recall"
                stroke="var(--color-accent)"
                strokeWidth={2.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              {reviews.map((r) => (
                <ReferenceDot
                  key={r.day}
                  x={r.day}
                  y={r.recall as number}
                  r={5}
                  fill="var(--color-success)"
                  stroke="var(--color-raised)"
                  strokeWidth={2}
                  ifOverflow="visible"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint" aria-label="Chart legend">
        <li className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-accent inline-block" aria-hidden="true" /> Projected recall (with reviews)
        </li>
        {hasNatural && (
          <li className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-ink-faint inline-block" aria-hidden="true" /> Natural decay
          </li>
        )}
        <li className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-success inline-block" aria-hidden="true" /> Review
        </li>
      </ul>

      {curve.note && (
        <p className="text-xs text-ink-faint leading-relaxed" data-testid="curve-note">
          {curve.note}
        </p>
      )}

      <div id="decay-data-table" className={showTable ? 'overflow-x-auto max-h-64 overflow-y-auto' : 'sr-only'}>
        <table className="w-full text-xs text-left">
          <caption className="sr-only">Projected recall and natural decay by day</caption>
          <thead>
            <tr className="text-ink-faint border-b border-line-soft">
              <th scope="col" className="py-1.5 pr-3 font-semibold">Day</th>
              <th scope="col" className="py-1.5 pr-3 font-semibold">Projected recall</th>
              {hasNatural && <th scope="col" className="py-1.5 pr-3 font-semibold">Natural decay</th>}
              <th scope="col" className="py-1.5 font-semibold">Review</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day} className="border-b border-line-soft/60 text-ink-muted">
                <th scope="row" className="py-1.5 pr-3 font-medium">{d.day}</th>
                <td className="py-1.5 pr-3">{d.recall === null ? DASH : `${Math.round(d.recall)}%`}</td>
                {hasNatural && <td className="py-1.5 pr-3">{d.natural === null ? DASH : `${Math.round(d.natural)}%`}</td>}
                <td className="py-1.5">{d.reviewLabel ?? DASH}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

const DomainMastery: React.FC<{ domains: AnalyticsSummary['domains'] }> = ({ domains }) => (
  <Card radius="lg" className="p-5 space-y-4 min-w-0">
    <h2 className="text-sm font-bold text-ink">Domain mastery</h2>
    {domains.length === 0 ? (
      <p className="text-sm text-ink-muted">No domains tracked yet.</p>
    ) : (
      <ul className="space-y-4">
        {domains.map((d) => {
          const pct = toPercent(d.mastery) ?? 0;
          return (
            <li key={d.domain} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-ink truncate">{d.domain}</span>
                <Badge tone={domainTone(d.status)} className="flex-shrink-0">{d.status}</Badge>
              </div>
              <ProgressBar
                value={pct}
                label={`${d.domain} mastery`}
                fillClassName={
                  domainTone(d.status) === 'success'
                    ? 'bg-success'
                    : domainTone(d.status) === 'danger'
                      ? 'bg-danger'
                      : domainTone(d.status) === 'warning'
                        ? 'bg-warning'
                        : 'bg-accent'
                }
              />
              <p className="text-xs text-ink-faint">
                {Math.round(pct)}% &middot; {d.concepts_tracked} concept{d.concepts_tracked === 1 ? '' : 's'}
                {d.note ? ` · ${d.note}` : ''}
              </p>
            </li>
          );
        })}
      </ul>
    )}
  </Card>
);

const InsightCard: React.FC<{ days: number; disabled: boolean }> = ({ days, disabled }) => {
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'unavailable' } | { kind: 'ready'; data: InsightResponse }
  >({ kind: 'idle' });

  // (Re-keyed by range in the parent, so a new range starts from a clean state.)
  const ask = async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', data: await requestInsight(days) });
    } catch (err) {
      setState(
        isForbiddenError(err)
          ? { kind: 'unavailable' }
          : { kind: 'error', message: err instanceof Error ? err.message : 'Could not generate an insight.' }
      );
    }
  };

  return (
    <Card radius="lg" className="p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent" aria-hidden="true" />
        <h2 className="text-sm font-bold text-ink">AI tutor insight</h2>
      </div>
      <div aria-live="polite" className="text-sm text-ink-muted leading-relaxed">
        {state.kind === 'idle' && (
          <p>{disabled ? 'Answer a few checkpoints first, then ask for a personalised read-out.' : 'Get a short, personalised read-out of your last ' + days + ' days.'}</p>
        )}
        {state.kind === 'loading' && (
          <div className="space-y-2" role="status" aria-busy="true">
            <span className="sr-only">Generating insight</span>
            <SkeletonLine className="w-full" />
            <SkeletonLine className="w-5/6" />
          </div>
        )}
        {state.kind === 'error' && <p role="alert" className="text-danger">{state.message}</p>}
        {state.kind === 'unavailable' && (
          <p role="status" className="text-ink-faint">AI insights are not available for guest sessions. Sign in with Google to use them.</p>
        )}
        {state.kind === 'ready' && (
          <>
            <p className="whitespace-pre-line text-ink">{state.data.insight}</p>
            <p className="text-xs text-ink-faint mt-2">
              Generated {formatDueDate(state.data.generated_at)}
            </p>
          </>
        )}
      </div>
      <Button type="button" onClick={() => void ask()} loading={state.kind === 'loading'} disabled={disabled}>
        <Sparkles className="w-4 h-4" aria-hidden="true" />
        {state.kind === 'ready' ? 'Refresh insight' : 'Ask AI Tutor Insight'}
      </Button>
    </Card>
  );
};

const TargetSetting: React.FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchMonthlyTarget().then((t) => {
      if (alive && t !== null) setValue(String(t));
    });
    return () => {
      alive = false;
    };
  }, []);

  // The summary's target is window-scaled, so only the saved monthly value is shown here.
  const shown = value;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const hours = parseTargetHours(shown);
    if (hours === null) {
      setMsg({ ok: false, text: `Enter a target between ${MIN_TARGET_HOURS} and ${MAX_TARGET_HOURS} hours.` });
      return;
    }
    setBusy(true);
    setMsg(null);
    const ok = await saveMonthlyTarget(hours);
    setBusy(false);
    if (ok) {
      setValue(String(hours));
      setMsg({ ok: true, text: 'Target saved.' });
      onSaved();
    } else {
      setMsg({ ok: false, text: 'Could not save your target. Try again.' });
    }
  };

  return (
    <Card radius="lg" className="p-5">
      <form onSubmit={save} className="space-y-2">
        <label htmlFor="monthly-target" className="text-sm font-bold text-ink block">
          Monthly study target (hours)
        </label>
        <div className="flex items-center gap-2">
          <input
            id="monthly-target"
            type="number"
            inputMode="numeric"
            min={MIN_TARGET_HOURS}
            max={MAX_TARGET_HOURS}
            step={1}
            value={shown}
            onChange={(e) => {
              setValue(e.target.value);
            }}
            className="w-28 px-3 py-2 min-h-[44px] bg-sunken border border-line rounded-md text-ink text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <Button type="submit" variant="secondary" loading={busy}>
            Save
          </Button>
        </div>
        {msg && (
          <p role="status" className={`text-xs ${msg.ok ? 'text-success' : 'text-danger'}`}>
            {msg.text}
          </p>
        )}
      </form>
    </Card>
  );
};
