import React, { useEffect, useRef, useState } from 'react';

const TAGLINE =
  'Watching feels like learning. Explaining proves it. Studify AI holds the video until you can say the idea in your own words.';

const WORDS = TAGLINE.split(' ');

/**
 * Large type moment: every word starts muted and lights up on its own, in
 * reading order, as it crosses a trigger line 40% up from the viewport bottom.
 */
export const TaglineReveal: React.FC = () => {
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const [lit, setLit] = useState<boolean[]>(() => WORDS.map(() => false));

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setLit(WORDS.map(() => true));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const hits = entries.filter((e) => e.isIntersecting);
        if (!hits.length) return;
        setLit((prev) => {
          const next = prev.slice();
          for (const e of hits) {
            next[Number((e.target as HTMLElement).dataset.i)] = true;
            io.unobserve(e.target);
          }
          return next;
        });
      },
      { rootMargin: '0px 0px -40% 0px' },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <section className="max-w-5xl mx-auto px-4 py-24 sm:py-32" aria-label="Why Studify AI">
      <p className="max-w-[680px] mx-auto font-display text-4xl sm:text-5xl font-bold text-ink text-balance">
        {WORDS.map((word, i) => (
          <React.Fragment key={i}>
            <span
              ref={(el) => {
                refs.current[i] = el;
              }}
              data-i={i}
              data-in={lit[i]}
              className="tagline-word"
            >
              {word}
            </span>
            {i < WORDS.length - 1 ? ' ' : null}
          </React.Fragment>
        ))}
      </p>
    </section>
  );
};
