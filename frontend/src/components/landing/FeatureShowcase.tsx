import React from 'react';
import { CheckCircle2, Lock, PlayCircle, Brain, AlertTriangle } from 'lucide-react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { LottiePlayer } from '../ui/LottiePlayer';
import checkPopAnimation from '../../assets/lottie/check-pop.json';

/**
 * Two alternating feature rows, echoing the reference layout's
 * image-left/text-right rhythm. In place of real product screenshots (which
 * don't exist to capture yet) or fabricated ones, each row renders a small
 * stylized mockup built from the app's own tokens/components — illustrative,
 * not a doctored screenshot.
 */
export const FeatureShowcase: React.FC = () => {
  return (
    <section className="max-w-6xl mx-auto px-4 py-14 sm:py-20 space-y-16 sm:space-y-24">
      <h2 className="sr-only">How Studify AI studies with you</h2>

      {/* Row 1: chapters mockup — image left, text right */}
      <div className="grid md:grid-cols-2 gap-8 md:gap-14 items-center">
        <div
          className="order-2 md:order-1 animate-in fade-in slide-in-from-bottom-4"
          style={{ animationDuration: '500ms' }}
        >
          <Card radius="lg" className="p-4 sm:p-5 shadow-xl space-y-2.5">
            {[
              { title: 'Intro & motivation', state: 'done' as const },
              { title: 'Core mechanism', state: 'active' as const },
              { title: 'Worked example', state: 'locked' as const },
            ].map((row) => (
              <div
                key={row.title}
                className={`flex items-center gap-3 p-3 rounded-xl border ${
                  row.state === 'active'
                    ? 'bg-ember-500/10 border-ember-500/30'
                    : 'bg-sunken/50 border-line-soft'
                }`}
              >
                {row.state === 'done' && (
                  <span className="relative w-4 h-4 flex-shrink-0">
                    <LottiePlayer animationData={checkPopAnimation} loop={false} className="absolute -inset-2.5" />
                    <CheckCircle2 className="relative w-4 h-4 text-success" />
                  </span>
                )}
                {row.state === 'active' && <PlayCircle className="w-4 h-4 text-ember-400 flex-shrink-0 animate-pulse" />}
                {row.state === 'locked' && <Lock className="w-4 h-4 text-ink-faint flex-shrink-0" />}
                <span className={`text-sm font-medium flex-1 ${row.state === 'locked' ? 'text-ink-faint' : 'text-ink'}`}>
                  {row.title}
                </span>
              </div>
            ))}
          </Card>
        </div>
        <div className="order-1 md:order-2 text-center md:text-left">
          <h3 className="font-display text-2xl sm:text-3xl font-bold text-ink mb-3">
            Chapters that pace the lecture for you
          </h3>
          <p className="text-ink-muted leading-relaxed">
            Every lecture is split into 3–6 topic chapters. The player pauses at each
            boundary, and the next one stays locked until you've shown you understood
            the current one — not just watched it.
          </p>
        </div>
      </div>

      {/* Row 2: Q&A mockup — text left, image right */}
      <div className="grid md:grid-cols-2 gap-8 md:gap-14 items-center">
        <div className="text-center md:text-left">
          <h3 className="font-display text-2xl sm:text-3xl font-bold text-ink mb-3">
            Diagnoses the misconception, not just the miss
          </h3>
          <p className="text-ink-muted leading-relaxed">
            A wrong answer doesn't just get marked wrong. It gets evaluated against
            what the lecture actually said, pinpointed to where your understanding
            broke, and re-asked — so the chapter unlocks because you earned it.
          </p>
        </div>
        <div className="animate-in fade-in slide-in-from-bottom-4" style={{ animationDuration: '500ms' }}>
          <Card radius="lg" className="p-4 sm:p-5 shadow-xl space-y-3">
            <p className="text-sm font-semibold text-ink">
              Why does increasing the learning rate too much hurt training?
            </p>
            <div className="h-9 rounded-lg bg-sunken border border-line-soft" aria-hidden="true" />
            <div className="flex items-center gap-2">
              <Badge tone="warning">
                <AlertTriangle className="w-3 h-3" />
                Misconception
              </Badge>
              <Brain className="w-4 h-4 text-ink-faint" />
              <span className="text-xs text-ink-faint">Re-asking with a hint...</span>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
};
