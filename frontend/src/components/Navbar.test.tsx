import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The vitest env has no DOM, so the account menu cannot be clicked open. Force the
// first `useState(false)` of a render (Navbar's `menuOpen`) to start open instead.
const forced = vi.hoisted(() => ({ menuOpen: false }));
vi.mock('react', async (orig) => {
  const actual = await orig<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useState: ((init: unknown) => {
      if (forced.menuOpen && init === false) {
        forced.menuOpen = false;
        return [true, () => {}];
      }
      return actual.useState(init as never);
    }) as unknown as typeof actual.useState,
  };
});

const auth = vi.hoisted(() => ({
  value: {
    enabled: false,
    user: null as unknown,
    loading: false,
    signInWithGoogle: async () => {},
    signOut: async () => {},
  },
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth.value }));
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: () => {} }) }));
vi.mock('../lib/api', () => ({
  getStoredGeminiKey: () => 'key',
  setStoredGeminiKey: () => {},
  deleteMyCloudData: async () => {},
}));
vi.mock('../lib/cloudSync', () => ({ pauseSync: () => {}, resumeSync: () => {}, settlePushes: async () => {} }));
vi.mock('./ReviewModal', () => ({ ReviewModal: () => null }));

import { Navbar } from './Navbar';

const render = () =>
  renderToStaticMarkup(
    <Navbar
      hasActiveSession={false}
      onReset={vi.fn()}
      isKeyModalOpen={false}
      onOpenKeyModal={vi.fn()}
      onCloseKeyModal={vi.fn()}
    />
  );

beforeEach(() => {
  forced.menuOpen = false;
  auth.value = { ...auth.value, enabled: false, user: null, loading: false };
});

const DISPLAY = ['inline-flex', 'flex', 'block', 'inline-block', 'inline', 'grid', 'inline-grid'];

describe('Navbar', () => {
  it('auth disabled: renders theme and API key controls, no Sign in, no account menu', () => {
    const html = render();
    expect(html).toContain('Switch to dark mode');
    expect(html).toContain('Manage Gemini API Key');
    expect(html).not.toContain('Sign in');
    expect(html).not.toContain('Account menu');
    expect(html).not.toContain('role="menu"'); // menu is closed
    expect(html).toContain('More options'); // sm-only overflow trigger (theme + API key) is intended with auth off
  });

  it('auth enabled and signed out: renders Sign in, no account menu', () => {
    auth.value = { ...auth.value, enabled: true };
    const html = render();
    expect(html).toContain('Sign in');
    expect(html).not.toContain('Account menu');
    expect(html).not.toContain('role="menu"');
  });

  it('auth enabled and signed in: opening the account menu shows Review weak spots and Sign out', () => {
    auth.value = { ...auth.value, enabled: true, user: { email: 'a@b.co', user_metadata: { full_name: 'Ada' } } };
    forced.menuOpen = true;
    const html = render();
    expect(html).toContain('Account menu');
    expect(html).toContain('Review weak spots');
    expect(html).toContain('Sign out');
    expect(html).toContain('role="menu"');
  });

  it('responsive hiding: no element combines `hidden` with an unprefixed display utility (it would lose by CSS order)', () => {
    auth.value = { ...auth.value, enabled: true, user: { email: 'a@b.co', user_metadata: {} } };
    forced.menuOpen = true;
    const html = render();
    const bad = [...html.matchAll(/class="([^"]*)"/g)]
      .map((m) => m[1].split(/\s+/))
      .filter((t) => t.includes('hidden') && t.some((c) => DISPLAY.includes(c)));
    expect(bad).toEqual([]);
  });
});
