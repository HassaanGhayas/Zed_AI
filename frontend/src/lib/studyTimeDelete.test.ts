import { beforeEach, describe, expect, it, vi } from 'vitest';

const postMock = vi.hoisted(() => vi.fn());
vi.mock('./api', async () => ({
  ...(await vi.importActual<typeof import('./api')>('./api')),
  postStudyTime: postMock,
}));
vi.mock('./supabase', () => ({ supabase: {}, isSupabaseEnabled: true }));

import { pauseSync, setCloudUser, settlePushes } from './cloudSync';
import { flushStudyTime, setStudyActivity } from './studyTime';

describe('delete flow awaits the study-time flush', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));
    postMock.mockReset();
    setCloudUser(null);
    setCloudUser('u1');
  });

  it('settlePushes waits for an in-flight study-time post, and later chunks are not sent after pause', async () => {
    let release!: () => void;
    postMock.mockImplementationOnce(() => new Promise<void>((r) => (release = r))).mockResolvedValue({});
    setStudyActivity('review', true);
    vi.advanceTimersByTime(7300_000); // 3 chunks: 3600, 3600, 100
    setStudyActivity('review', false);
    const flushing = flushStudyTime();
    await Promise.resolve();
    await Promise.resolve();
    expect(postMock).toHaveBeenCalledTimes(1);

    pauseSync();
    let settled = false;
    const settling = settlePushes().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);
    release();
    await Promise.all([flushing, settling]);
    expect(settled).toBe(true);
    expect(postMock).toHaveBeenCalledTimes(1); // remaining chunks refused after pause
  });
});
