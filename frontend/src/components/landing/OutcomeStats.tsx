import React from 'react';
import { Card } from '../ui/Card';

/**
 * Stat-tile substitute for the reference's "Archive of progress" chart
 * cards. No usage/rating numbers exist to report honestly, so every figure
 * here is a real, verifiable product mechanic instead of an invented metric.
 */
const STATS = [
  { value: '3–6', label: 'Chapters per lecture' },
  { value: '1–2', label: 'Recall questions per chapter' },
  { value: '100%', label: 'Public YouTube videos supported' },
] as const;

export const OutcomeStats: React.FC = () => {
  return (
    <section className="max-w-5xl mx-auto px-4 py-14 sm:py-20">
      <h2 className="sr-only">What every lecture gets</h2>
      <div className="grid sm:grid-cols-3 gap-5">
        {STATS.map((stat, idx) => (
          <Card
            key={stat.label}
            radius="lg"
            className="p-6 text-center animate-in fade-in slide-in-from-bottom-4 hover:border-ember-500/30 hover:-translate-y-1 transition-[border-color,transform] duration-200"
            style={{ animationDuration: '500ms', animationDelay: `${idx * 80}ms` }}
          >
            <p className="font-display text-4xl font-extrabold text-accent mb-1.5">{stat.value}</p>
            <p className="text-sm text-ink-muted">{stat.label}</p>
          </Card>
        ))}
      </div>
    </section>
  );
};
