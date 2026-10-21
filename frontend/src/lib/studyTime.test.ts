import { beforeEach, describe, expect, it, vi } from 'vitest';

const postMock = vi.hoisted(() => vi.fn());
const syncActive = vi.hoisted(() => ({ value: true }));
vi.mock('./api', async () => ({
  ...(await vi.importActual<typeof import('./api')>('./api')),
  postStudyTime: postMock,
}));
vi.mock('./cloudSync', () => ({
  isSyncActive: () => syncActive.value,
  isAnalyticsAvailable: () => true,
  markAnalyticsForbidden: () => {},
  trackCloudWrite: <T,>(p: Promise<T>) => p,
}));
vi.mock('./supabase', () => ({ isSupabaseEnabled: true, supabase: {} }));

import {
  IDLE_TIMEOUT_MS,
  noteStudyActivity,
  StudyTimeAccumulator,
  chunkSeconds,
  flushStudyTime,
  localDayString,
  setStudyActivity,
} from './studyTime';

describe('StudyTimeAccumulator', () => {
  it('counts only while a source is active and the document is visible', () => {
    const a = new StudyTimeAccumulator(true);
    a.setSource('video', true, 0);
    expect(a.peekSeconds(10_000)).toBe(10);
    a.setVisible(false, 10_000);
    expect(a.peekSeconds(60_000)).toBe(10);
    a.setVisible(true, 60_000);
    a.setSource('video', false, 65_000);
    expect(a.takeSeconds(120_000)).toBe(15);
    expect(a.takeSeconds(130_000)).toBe(0);
  });

  it('does not double count overlapping sources', () => {
    const a = new StudyTimeAccumulator(true);
    a.setSource('video', true, 0);
    a.setSource('quiz', true, 4_000);
    a.setSource('video', false, 6_000);
    a.setSource('quiz', false, 10_000);
    expect(a.takeSeconds(20_000)).toBe(10);
  });

  it('carries the sub-second remainder and supports restore', () => {
    const a = new StudyTimeAccumulator(true);
    a.setSource('review', true, 0);
    expect(a.takeSeconds(2_700)).toBe(2);
    expect(a.takeSeconds(3_400)).toBe(1);
    a.restoreSeconds(5);
    expect(a.takeSeconds(3_400)).toBe(5);
  });

  it('counts nothing when never active or hidden throughout', () => {
    const a = new StudyTimeAccumulator(false);
    a.setSource('quiz', true, 0);
    expect(a.takeSeconds(30_000)).toBe(0);
    expect(new StudyTimeAccumulator(true).takeSeconds(30_000)).toBe(0);
  });

  it('reset drops accrued time', () => {
    const a = new StudyTimeAccumulator(true);
    a.setSource('video', true, 0);
    a.reset(9_000);
    expect(a.takeSeconds(10_000)).toBe(1);
  });
});

describe('chunkSeconds / localDayString', () => {
  it('splits into <= 3600 chunks and drops non-positive', () => {
    expect(chunkSeconds(0)).toEqual([]);
    expect(chunkSeconds(-5)).toEqual([]);
    expect(chunkSeconds(90)).toEqual([90]);
    expect(chunkSeconds(7300)).toEqual([3600, 3600, 100]);
  });

  it('formats a local YYYY-MM-DD', () => {
    expect(localDayString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('flushStudyTime', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));
    postMock.mockReset();
    postMock.mockResolvedValue({ day: '2026-06-01', seconds: 1 });
    syncActive.value = true;
    setStudyActivity('video', false);
    setStudyActivity('quiz', false);
    await flushStudyTime(); // drain leftovers from earlier tests
    postMock.mockClear();
  });

  it('posts accrued whole seconds with the local day', async () => {
    setStudyActivity('quiz', true);
    vi.advanceTimersByTime(45_000);
    await flushStudyTime({ keepalive: true });
    expect(postMock).toHaveBeenCalledWith(45, '2026-06-01', { keepalive: true });
    setStudyActivity('quiz', false);
  });

  it('discards time when sync is paused / signed out, never uploading it later', async () => {
    syncActive.value = false;
    setStudyActivity('quiz', true);
    vi.advanceTimersByTime(40_000);
    await flushStudyTime();
    expect(postMock).not.toHaveBeenCalled();
    syncActive.value = true;
    vi.advanceTimersByTime(5_000);
    await flushStudyTime();
    expect(postMock).toHaveBeenCalledWith(5, '2026-06-01', {});
    setStudyActivity('quiz', false);
  });

  it('restores seconds when the upload fails so they retry', async () => {
    setStudyActivity('video', true);
    vi.advanceTimersByTime(20_000);
    postMock.mockRejectedValueOnce(new Error('offline'));
    await flushStudyTime();
    setStudyActivity('video', false);
    await flushStudyTime();
    expect(postMock).toHaveBeenLastCalledWith(20, '2026-06-01', {});
  });
});


describe('idle detection', () => {
  it('video and quiz stop counting 5 minutes after the last activity', () => {
    const a = new StudyTimeAccumulator(true);
    a.setSource('video', true, 0);
    expect(a.peekSeconds(IDLE_TIMEOUT_MS)).toBe(300);
    expect(a.peekSeconds(IDLE_TIMEOUT_MS + 600_000)).toBe(300);
  });

  it('resumes on activity and counts from that moment', () => {
    const a = new StudyTimeAccumulator(true);
    a.setSource('quiz', true, 0);
    a.noteActivity(IDLE_TIMEOUT_MS + 100_000); // idle from 300s to 400s: not counted
    expect(a.peekSeconds(IDLE_TIMEOUT_MS + 130_000)).toBe(300 + 30);
  });

  it('activity inside the window pushes the deadline out', () => {
    const a = new StudyTimeAccumulator(true);
    a.setSource('video', true, 0);
    a.noteActivity(200_000);
    expect(a.peekSeconds(200_000 + IDLE_TIMEOUT_MS + 999_000)).toBe(200 + 300);
  });

  it('the review source is not idle-limited', () => {
    const a = new StudyTimeAccumulator(true);
    a.setSource('review', true, 0);
    expect(a.peekSeconds(IDLE_TIMEOUT_MS * 3)).toBe(900);
  });
});

describe('idle detection through the singleton (fake timers)', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));
    postMock.mockReset();
    postMock.mockResolvedValue({ day: '2026-06-01', seconds: 1 });
    syncActive.value = true;
    setStudyActivity('video', false);
    setStudyActivity('quiz', false);
    await flushStudyTime();
    postMock.mockClear();
  });

  it('stops after 5 idle minutes and resumes on noteStudyActivity', async () => {
    setStudyActivity('video', true);
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 120_000);
    noteStudyActivity();
    vi.advanceTimersByTime(20_000);
    await flushStudyTime();
    expect(postMock).toHaveBeenCalledWith(320, '2026-06-01', {});
    setStudyActivity('video', false);
  });

  it('keeps counting while activity keeps arriving', async () => {
    setStudyActivity('quiz', true);
    for (let i = 0; i < 12; i++) {
      vi.advanceTimersByTime(120_000);
      noteStudyActivity();
    }
    await flushStudyTime();
    expect(postMock).toHaveBeenCalledWith(1440, '2026-06-01', {});
    setStudyActivity('quiz', false);
  });
});
