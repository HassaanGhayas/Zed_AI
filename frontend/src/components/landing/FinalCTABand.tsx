import React from 'react';

interface FinalCTABandProps {
  onCtaClick: () => void;
}

/** Simpler, text-only final band — mirrors the reference's closing CTA before the footer. */
export const FinalCTABand: React.FC<FinalCTABandProps> = ({ onCtaClick }) => {
  return (
    <section className="full-bleed bg-gradient-to-br from-ember-700 to-ember-600 py-14 sm:py-16 px-4 text-center">
      <h2 className="font-display text-xl sm:text-2xl font-bold text-ember-50 mb-5">
        Stop watching lectures passively. Start studying them.
      </h2>
      <button
        type="button"
        onClick={onCtaClick}
        className="inline-flex items-center justify-center min-h-[44px] px-6 py-3 rounded-xl text-sm sm:text-base font-semibold bg-surface text-accent hover:bg-ember-50 shadow-lg transition-colors cursor-pointer"
      >
        Start a session
      </button>
    </section>
  );
};
