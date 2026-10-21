import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LazyMotion, domAnimation } from 'motion/react';
import { RollingNumber } from './RollingNumber';
import { formatCounter } from './rollingNumberFormat';

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<LazyMotion features={domAnimation}>{node}</LazyMotion>);

describe('formatCounter', () => {
  it('formats the final value with decimals and suffix', () => {
    expect(formatCounter(72.4, 0, '%', '—')).toBe('72%');
    expect(formatCounter(3.25, 1, '', '—')).toBe('3.3');
  });
  it('returns the placeholder for null / non-finite', () => {
    expect(formatCounter(null, 0, '%', '—')).toBe('—');
    expect(formatCounter(Number.NaN, 0, '', '—')).toBe('—');
  });
});

describe('RollingNumber', () => {
  it('snaps straight to the final value when instant (reduced motion path)', () => {
    expect(render(<RollingNumber value={72} suffix="%" instant />)).toBe('72%');
  });
  it('renders the placeholder for null with no animated node', () => {
    expect(render(<RollingNumber value={null} />)).toBe('—');
  });
  it('exposes the final value to screen readers and hides the ticking text', () => {
    const html = render(<RollingNumber value={42} />);
    expect(html).toContain('<span class="sr-only">42</span>');
    expect(html).toContain('aria-hidden="true"');
  });
});
