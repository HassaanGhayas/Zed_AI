import React from 'react';
import { Key } from 'lucide-react';
import { Logo } from '../ui/Logo';

interface LandingFooterProps {
  onOpenKeyModal: () => void;
}

/**
 * Minimal, honest footer: no blog/careers/privacy columns, since none of
 * those pages exist for this project — a fake link is worse than no link.
 */
export const LandingFooter: React.FC<LandingFooterProps> = ({ onOpenKeyModal }) => {
  return (
    <footer className="border-t border-line-soft bg-raised/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-ember-700 to-ember-500 flex items-center justify-center flex-shrink-0">
            <Logo className="w-4 h-4 text-ember-50" />
          </div>
          <div>
            <p className="font-display font-bold text-sm text-ink">Studify AI</p>
            <p className="text-xs text-ink-faint">Socratic Video Tutor &amp; Note Synthesizer</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenKeyModal}
          className="flex items-center gap-1.5 min-h-[44px] px-3 text-xs sm:text-sm font-medium text-ink-muted hover:text-ink transition-colors cursor-pointer"
        >
          <Key className="w-3.5 h-3.5" aria-hidden="true" />
          Manage API Key
        </button>
      </div>
    </footer>
  );
};
