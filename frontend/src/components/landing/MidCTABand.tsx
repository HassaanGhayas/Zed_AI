import React from 'react';
import { ArrowRight } from 'lucide-react';

interface MidCTABandProps {
  onCtaClick: () => void;
}

/** Full-bleed ember band, mirroring the reference's orange CTA sections. */
export const MidCTABand: React.FC<MidCTABandProps> = ({ onCtaClick }) => {
  return (
    <section className="full-bleed bg-gradient-to-br from-ember-600 to-ember-500 py-14 sm:py-20 px-4 text-center">
      <h2 className="font-display text-2xl sm:text-4xl font-bold text-ember-50 mb-3 max-w-2xl mx-auto">
        See it on your own lecture
      </h2>
      <p className="text-ember-100/90 max-w-xl mx-auto mb-7 text-sm sm:text-base">
        Paste any public YouTube lecture above and watch it turn into chapters and checkpoints in seconds.
      </p>
      <button
        type="button"
        onClick={onCtaClick}
        className="inline-flex items-center justify-center gap-2 min-h-[44px] px-6 py-3 rounded-xl text-sm sm:text-base font-semibold bg-surface text-accent hover:bg-ember-50 shadow-lg transition-colors cursor-pointer"
      >
        <span>Try a lecture now</span>
        <ArrowRight className="w-4 h-4" />
      </button>
    </section>
  );
};
