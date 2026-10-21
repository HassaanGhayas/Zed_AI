/**
 * Pure decision logic for the checkpoint lock, extracted from VideoPlayer's
 * polling loop. The "keep paused while quiz is open and player is playing"
 * check depends on live player state and stays in the component.
 */
export interface BoundaryInput {
  time: number;
  segmentEnd: number;
  duration: number | undefined;
  settled: boolean;
  isPausedForQuiz: boolean;
  isSegmentResolved: boolean;
}

export interface BoundaryDecision {
  effectiveEnd: number;
  pause: boolean;
  seekTo: number | null;
  fireBoundary: boolean;
}

export function evaluateBoundary(input: BoundaryInput): BoundaryDecision {
  const { time, segmentEnd, duration, settled, isPausedForQuiz, isSegmentResolved } = input;

  // Transcript-derived end times can overshoot the real video; clamp against the
  // player's duration, with a small tolerance since getCurrentTime() often stalls
  // a few hundred ms short of the duration when the video finishes.
  const effectiveEnd = duration
    ? Math.min(segmentEnd, Math.max(0, duration - 0.5))
    : segmentEnd;

  const decision: BoundaryDecision = { effectiveEnd, pause: false, seekTo: null, fireBoundary: false };

  // Ignore boundary logic while the player settles after a switch/seek.
  if (!settled) return decision;

  // Fail closed: an unreadable clock while locked must not let playback run on.
  if (!Number.isFinite(time)) {
    if (!isSegmentResolved) decision.pause = true;
    return decision;
  }

  if (time >= effectiveEnd && !isPausedForQuiz) {
    decision.pause = true;
    decision.fireBoundary = true;
    if (!isSegmentResolved && time > effectiveEnd + 0.5) {
      decision.seekTo = effectiveEnd;
    }
  }

  if (isPausedForQuiz && time > effectiveEnd + 0.5) {
    decision.seekTo = effectiveEnd;
    decision.pause = true;
  }

  return decision;
}
