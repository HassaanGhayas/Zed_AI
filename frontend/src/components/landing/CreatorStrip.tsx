import React from 'react';

interface CreatorStripItem {
  label: string;
  url?: string;
}

interface CreatorStripProps {
  heading: string;
  items: CreatorStripItem[];
  footnote?: string;
  /** Omitted for the decorative (topic-tag) pass — only the creator-name pass is clickable. */
  onSelect?: (url: string) => void;
}

/**
 * Honest substitute for a customer-logo wall: this project has no companies
 * to name-drop, so it surfaces the real creator channels (or topic tags) the
 * curated presets already come from, as plain text — no fabricated logo marks.
 */
export const CreatorStrip: React.FC<CreatorStripProps> = ({ heading, items, footnote, onSelect }) => {
  return (
    <section className="max-w-5xl mx-auto px-4 py-10 sm:py-14 text-center animate-in fade-in slide-in-from-bottom-2" style={{ animationDuration: '500ms' }}>
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint mb-5 sm:mb-6">
        {heading}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 sm:gap-x-10">
        {items.map((item) =>
          item.url && onSelect ? (
            <button
              key={item.label}
              type="button"
              onClick={() => onSelect(item.url!)}
              className="min-h-[44px] px-1 font-display text-base sm:text-lg font-semibold text-ink-muted hover:text-accent hover:scale-105 active:scale-100 transition-[color,transform] duration-150 cursor-pointer underline decoration-transparent hover:decoration-ember-500/50 underline-offset-4"
            >
              {item.label}
            </button>
          ) : (
            <span key={item.label} className="font-display text-sm sm:text-base font-semibold text-ink-faint">
              {item.label}
            </span>
          )
        )}
      </div>
      {footnote && <p className="mt-4 sm:mt-5 text-xs text-ink-faint">{footnote}</p>}
    </section>
  );
};
