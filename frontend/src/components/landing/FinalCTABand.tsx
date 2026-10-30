import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '../ui/Button';

interface FinalCTABandProps {
  onCtaClick: () => void;
}

/** Closing band: same promise and same button label as the hero, plus the risk reversal. */
export const FinalCTABand: React.FC<FinalCTABandProps> = ({ onCtaClick }) => {
  return (
    <section className="full-bleed bg-sunken border-y border-line-soft py-14 sm:py-16 px-4 text-center">
      <h2 className="font-display text-xl sm:text-2xl font-bold text-ink mb-5 max-w-[680px] mx-auto text-balance">
        Stop watching lectures passively. Start studying them.
      </h2>
      <Button type="button" variant="primary" onClick={onCtaClick} className="gap-2 px-6 py-3 sm:text-base">
        <span>Quiz me on this lecture</span>
        <ArrowRight className="w-4 h-4" aria-hidden="true" />
      </Button>
      <p className="mt-4 text-xs text-ink-faint">
        No account needed. Your sessions stay in your browser unless you sign in.
      </p>
    </section>
  );
};
