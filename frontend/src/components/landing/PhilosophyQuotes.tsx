import React from 'react';
import { Quote } from 'lucide-react';
import { Card } from '../ui/Card';

/**
 * Sits in the reference layout's testimonial slot, but with no real users to
 * quote, this states the product's own design principles instead of
 * inventing a person to attribute them to — honest in the same visual rhythm.
 */
const PRINCIPLES = [
  "Right answers aren't the goal. Being able to explain why is.",
  "A wrong answer is information, not a dead end — it points at exactly what to re-teach.",
] as const;

export const PhilosophyQuotes: React.FC = () => {
  return (
    <section className="max-w-5xl mx-auto px-4 py-14 sm:py-20">
      <h2 className="text-center font-display text-2xl sm:text-3xl font-bold text-ink mb-10">
        Built on the Socratic method
      </h2>
      <div className="grid sm:grid-cols-2 gap-5">
        {PRINCIPLES.map((text, idx) => (
          <Card
            key={text}
            radius="lg"
            className="p-6 animate-in fade-in slide-in-from-bottom-4 hover:border-ember-500/30 hover:-translate-y-1 transition-[border-color,transform] duration-200"
            style={{ animationDuration: '500ms', animationDelay: `${idx * 100}ms` }}
          >
            <Quote className="w-6 h-6 text-ember-400/60 mb-3" aria-hidden="true" />
            <p className="text-ink font-display text-lg leading-relaxed">{text}</p>
          </Card>
        ))}
      </div>
    </section>
  );
};
