import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDueQueue, formatErrorDetail, setAuthToken, setTokenRefresher } from './api';

describe('formatErrorDetail', () => {
  it('returns string detail as-is', () => {
    expect(formatErrorDetail({ detail: 'bad' }, 'fb')).toBe('bad');
  });

  it('formats FastAPI 422 arrays readably', () => {
    const body = {
      detail: [
        { type: 'missing', loc: ['body', 'url'], msg: 'Field required' },
        { loc: ['body', 'segments', 0, 'title'], msg: 'Input should be a valid string' },
      ],
    };
    const out = formatErrorDetail(body, 'fb');
    expect(out).toBe('url: Field required; segments.0.title: Input should be a valid string');
    expect(out).not.toContain('[object Object]');
  });

  it('never yields [object Object] for object detail', () => {
    expect(formatErrorDetail({ detail: { foo: 1 } }, 'fb')).toBe('{"foo":1}');
    expect(formatErrorDetail({ detail: { message: 'm' } }, 'fb')).toBe('m');
  });

  it('falls back when no detail', () => {
    expect(formatErrorDetail(null, 'fb')).toBe('fb');
    expect(formatErrorDetail({}, 'fb')).toBe('fb');
  });
});

describe('analytics 401 refresh-and-retry', () => {
  const ok = () => new Response(JSON.stringify({ total_due: 0, items: [] }), { status: 200 });
  const unauthorized = () => new Response(JSON.stringify({ detail: 'Authentication required' }), { status: 401 });

  afterEach(() => {
    vi.unstubAllGlobals();
    setAuthToken(null);
    setTokenRefresher(null);
  });

  it('refreshes the token once and retries with the new bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);
    setAuthToken('stale');
    const refresher = vi.fn().mockResolvedValue('fresh');
    setTokenRefresher(refresher);

    const res = await fetchDueQueue(5);

    expect(res.total_due).toBe(0);
    expect(refresher).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>;
    expect(secondHeaders.Authorization).toBe('Bearer fresh');
  });

  it('shares one refresh between concurrent 401s', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(unauthorized())
      .mockImplementation(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    setAuthToken('stale');
    const refresher = vi.fn().mockResolvedValue('fresh');
    setTokenRefresher(refresher);

    await Promise.all([fetchDueQueue(5), fetchDueQueue(5)]);

    expect(refresher).toHaveBeenCalledTimes(1);
  });

  it('does not loop: a second 401 after refresh surfaces as an error', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => unauthorized());
    vi.stubGlobal('fetch', fetchMock);
    setAuthToken('stale');
    setTokenRefresher(vi.fn().mockResolvedValue('fresh'));

    await expect(fetchDueQueue(5)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns the 401 untouched when no refresher is registered', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => unauthorized());
    vi.stubGlobal('fetch', fetchMock);
    setAuthToken('stale');

    await expect(fetchDueQueue(5)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
