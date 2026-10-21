import React from 'react';
import { Button } from '../ui/Button';

interface FinalCTABandProps {
  onCtaClick: () => void;
}

/** Simpler, text-only final band — mirrors the reference's closing CTA before the footer. */
export const FinalCTABand: React.FC<FinalCTABandProps> = ({ onCtaClick }) => {
  return (
    <section className="full-bleed bg-sunken border-y border-line-soft py-14 sm:py-16 px-4 text-center">
      <h2 className="font-display text-xl sm:text-2xl font-bold text-ink mb-5">
        Stop watching lectures passively. Start studying them.
      </h2>
      <Button type="button" variant="primary" onClick={onCtaClick} className="px-6 py-3 sm:text-base">
        Start a session
      </Button>
    </section>
  );
};
