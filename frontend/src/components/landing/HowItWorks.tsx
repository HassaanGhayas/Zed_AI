import React from 'react';
import { Link2, MessageCircleQuestion, FileDown } from 'lucide-react';
import { Card } from '../ui/Card';
import { Reveal } from './Reveal';

const STEPS = [
  {
    icon: Link2,
    title: 'Paste a lecture link',
    body: 'Drop in any public YouTube lecture. Studify AI reads the transcript and splits it into 3–6 chapters.',
  },
  {
    icon: MessageCircleQuestion,
    title: 'Explain it at each pause',
    body: 'The video stops at the end of every chapter. Answer in your own words to unlock the next one.',
  },
  {
    icon: FileDown,
    title: 'Export your notes',
    body: 'Download a PDF that merges the lecture with the explanations you got right.',
  },
] as const;

export const HowItWorks: React.FC = () => (
  <section className="max-w-5xl mx-auto px-4 py-14 sm:py-20" aria-labelledby="how-it-works-heading">
    <h2 id="how-it-works-heading" className="text-center font-display text-2xl sm:text-3xl font-bold text-ink mb-10 text-balance">
      From link to notes in three steps
    </h2>
    <ol className="grid sm:grid-cols-3 gap-5">
      {STEPS.map((step, idx) => (
        <li key={step.title}>
          <Reveal delay={idx * 100} className="h-full">
            <Card radius="lg" className="h-full p-6 hover:border-accent/30 hover:-translate-y-1 transition-[border-color,transform] duration-200">
              <div className="flex items-center gap-3 mb-3">
                <span className="w-9 h-9 rounded-md bg-accent/10 text-accent flex items-center justify-center" aria-hidden="true">
                  <step.icon className="w-5 h-5" />
                </span>
                <span className="text-sm font-semibold text-ink-faint">Step {idx + 1}</span>
              </div>
              <h3 className="font-display text-lg font-bold text-ink mb-1.5">{step.title}</h3>
              <p className="text-sm text-ink-muted text-pretty">{step.body}</p>
            </Card>
          </Reveal>
        </li>
      ))}
    </ol>
  </section>
);
