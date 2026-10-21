import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Logo } from './Logo';

describe('Logo', () => {
  it('Logo renders an svg with viewBox "0 0 24 24" and aria-hidden', () => {
    const html = renderToStaticMarkup(<Logo />);
    expect(html).toContain('<svg');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('currentColor');
  });

  it('Logo applies a custom className', () => {
    const html = renderToStaticMarkup(<Logo className="w-3.5 h-3.5 text-accent" />);
    expect(html).toContain('class="w-3.5 h-3.5 text-accent"');
  });

  it('Logo contains no owl geometry', () => {
    const html = renderToStaticMarkup(<Logo />);
    expect(html).not.toContain('<circle');
    expect(html).not.toContain('<line');
  });
});
