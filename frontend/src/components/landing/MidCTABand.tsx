import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '../ui/Button';

interface MidCTABandProps {
  onCtaClick: () => void;
}

/** Full-bleed raised band with a solid accent CTA. */
export const MidCTABand: React.FC<MidCTABandProps> = ({ onCtaClick }) => {
  return (
    <section className="full-bleed bg-raised border-y border-line-soft py-14 sm:py-20 px-4 text-center">
      <h2 className="font-display text-2xl sm:text-4xl font-bold text-ink mb-3 max-w-2xl mx-auto">
        See it on your own lecture
      </h2>
      <p className="text-ink-muted max-w-xl mx-auto mb-7 text-sm sm:text-base">
        Paste any public YouTube lecture above and watch it turn into chapters and checkpoints in seconds.
      </p>
      <Button type="button" variant="primary" onClick={onCtaClick} className="gap-2 px-6 py-3 sm:text-base">
        <span>Try a lecture now</span>
        <ArrowRight className="w-4 h-4" />
      </Button>
    </section>
  );
};
