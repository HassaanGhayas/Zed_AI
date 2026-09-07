import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, RotateCcw, Maximize, Minimize, ChevronDown, ScanEye, X, Loader2 } from 'lucide-react';
import type { Segment, FrameExplanation } from '../types';
import { explainFrame, visualAvailability, frameUrl } from '../lib/api';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

interface VideoPlayerProps {
  videoId: string;
  activeSegment: Segment;
  segments?: Segment[];
  isPausedForQuiz: boolean;
  onBoundaryReached: () => void;
  onPlayerReady?: () => void;
  seekTime?: number | null;
  onRewatchSegment?: () => void;
  quizOverlay?: React.ReactNode;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoId,
  activeSegment,
  segments,
  isPausedForQuiz,
  onBoundaryReached,
  onPlayerReady,
  seekTime,
  onRewatchSegment,
  quizOverlay,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  // After a segment switch or external seek, getCurrentTime() keeps reporting the
  // OLD position for a few ticks. Boundary logic on that stale time would instantly
  // re-fire (flow-through bounce), so boundary checks pause until settled.
  const settleUntilRef = useRef(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [apiLoaded, setApiLoaded] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  // Gemini-vision "Explain this screen" — only shown when the backend reports the
  // media toolchain is available, so the UI hides cleanly where it's unsupported.
  const [visualEnabled, setVisualEnabled] = useState<boolean>(false);
  const [explain, setExplain] = useState<{
    open: boolean;
    loading: boolean;
    error: string | null;
    data: FrameExplanation | null;
    timestamp: number;
  }>({ open: false, loading: false, error: null, data: null, timestamp: 0 });

  // Load YouTube IFrame API script once
  useEffect(() => {
    if (window.YT && window.YT.Player) {
      setApiLoaded(true);
      return;
    }

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
      setApiLoaded(true);
    };
  }, []);

  // Initialize YT Player
  useEffect(() => {
    if (!apiLoaded || !containerRef.current) return;

    // Destroy existing player if any
    if (playerRef.current) {
      try {
        playerRef.current.destroy();
      } catch (e) {
        // ignore
      }
    }

    const playerId = `yt-player-${videoId}`;
    const playerEl = document.createElement('div');
    playerEl.id = playerId;
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(playerEl);

    playerRef.current = new window.YT.Player(playerId, {
      videoId: videoId,
      playerVars: {
        autoplay: 1,
        modestbranding: 1,
        rel: 0,
        fs: 0, // disable YT native fullscreen — our shell is the fullscreen element
        start: Math.floor(activeSegment.start_time),
      },
      events: {
        onReady: () => {
          if (onPlayerReady) onPlayerReady();
        },
        onStateChange: () => {
          // YT.PlayerState: 1 = PLAYING, 2 = PAUSED
        },
      },
    });

    return () => {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch (e) {}
      }
    };
  }, [apiLoaded, videoId]);

  // Handle external seek requests
  useEffect(() => {
    if (seekTime !== undefined && seekTime !== null && playerRef.current?.seekTo) {
      playerRef.current.seekTo(seekTime, true);
      playerRef.current.playVideo();
    }
  }, [seekTime]);

  // Re-arm the settle window on every segment switch or external seek
  useEffect(() => {
    settleUntilRef.current = Date.now() + 750;
  }, [activeSegment.segment_id, seekTime]);

  // Enforce auto-pause boundary check loop
  useEffect(() => {
    const interval = setInterval(() => {
      if (!playerRef.current || !playerRef.current.getCurrentTime) return;

      try {
        const time = playerRef.current.getCurrentTime();
        setCurrentTime(time);

        // Track total duration so segment markers can be positioned by percentage
        const d = playerRef.current.getDuration?.();
        if (d) setDuration((prev) => (prev === d ? prev : d));

        // Ignore boundary logic while the player settles after a switch/seek
        if (Date.now() < settleUntilRef.current) return;

        // Check if playback reached or passed segment boundary
        if (time >= activeSegment.end_time && !isPausedForQuiz) {
          playerRef.current.pauseVideo();
          onBoundaryReached();
        }

        // If in quiz mode and user tries to seek past boundary, clamp back
        if (isPausedForQuiz && time > activeSegment.end_time + 1) {
          playerRef.current.seekTo(activeSegment.end_time, true);
          playerRef.current.pauseVideo();
        }
      } catch (e) {
        // player might not be fully initialized
      }
    }, 250);

    return () => clearInterval(interval);
  }, [activeSegment, isPausedForQuiz, onBoundaryReached]);

  const handleReplaySegment = () => {
    if (onRewatchSegment) {
      onRewatchSegment();
    }
    if (playerRef.current?.seekTo) {
      playerRef.current.seekTo(activeSegment.start_time, true);
      playerRef.current.playVideo();
    }
  };

  // Track fullscreen state on our shell so we can adapt layout
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      shellRef.current?.requestFullscreen?.();
    }
  };

  // Ask the backend once whether frame extraction + Gemini vision are available.
  useEffect(() => {
    let alive = true;
    visualAvailability()
      .then((a) => {
        if (alive) setVisualEnabled(!!a.enabled);
      })
      .catch(() => {
        if (alive) setVisualEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const closeExplain = useCallback(() => {
    setExplain((s) => ({ ...s, open: false }));
  }, []);

  // Close visual explanation on Escape
  useEffect(() => {
    if (!explain.open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeExplain();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [explain.open, closeExplain]);

  // Capture the current playback position, pause, and ask Gemini to explain the frame.
  const handleExplainScreen = useCallback(() => {
    if (!playerRef.current?.getCurrentTime) return;
    let t = 0;
    try {
      t = playerRef.current.getCurrentTime();
    } catch {
      return;
    }
    try {
      playerRef.current.pauseVideo?.();
    } catch {
      // ignore — player may still be initializing
    }
    setExplain({ open: true, loading: true, error: null, data: null, timestamp: t });
    explainFrame({
      video_id: videoId,
      timestamp: t,
      segment_title: activeSegment.title,
      segment_summary: activeSegment.summary,
    })
      .then((data) =>
        setExplain({ open: true, loading: false, error: null, data, timestamp: t })
      )
      .catch((err) =>
        setExplain({
          open: true,
          loading: false,
          error: err?.message || 'Visual explanation failed.',
          data: null,
          timestamp: t,
        })
      );
  }, [videoId, activeSegment.title, activeSegment.summary]);

  // "More below" affordance for the scrollbar-less Q&A overlay: a fade + chevron
  // that hides at the scroll bottom and never shows when everything fits.
  const overlayScrollRef = useRef<HTMLDivElement>(null);
  const overlayContentRef = useRef<HTMLDivElement>(null);
  const [showMoreHint, setShowMoreHint] = useState(false);

  const updateMoreHint = useCallback(() => {
    const el = overlayScrollRef.current;
    if (!el) {
      setShowMoreHint(false);
      return;
    }
    const overflow = el.scrollHeight - el.clientHeight;
    setShowMoreHint(overflow > 24 && el.scrollTop < overflow - 8);
  }, []);

  useEffect(() => {
    if (!isPausedForQuiz) return;
    const raf = requestAnimationFrame(updateMoreHint);
    // Content height changes (hints, feedback) must re-evaluate the hint too
    const ro = new ResizeObserver(updateMoreHint);
    if (overlayContentRef.current) ro.observe(overlayContentRef.current);
    window.addEventListener('resize', updateMoreHint);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', updateMoreHint);
    };
  }, [isPausedForQuiz, updateMoreHint]);

  const formatSeconds = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const progressPercent = Math.min(
    100,
    Math.max(
      0,
      ((currentTime - activeSegment.start_time) /
        Math.max(1, activeSegment.end_time - activeSegment.start_time)) *
        100
    )
  );

  return (
    <div ref={shellRef} id="player-shell" className="group relative flex flex-col bg-raised border border-line-soft rounded-2xl overflow-hidden shadow-2xl">
      {/* Video Viewport */}
      <div className={`relative w-full bg-black ${isFullscreen ? 'flex-1 min-h-0' : 'aspect-video'}`}>
        <div ref={containerRef} className="yt-embed w-full h-full" />
        {/* Hover-revealed exit fullscreen button — mid-right edge, the one zone
            YouTube's own hover bars (top title row, bottom controls) never occupy. */}
        {isFullscreen && !isPausedForQuiz && (
          <button
            onClick={toggleFullscreen}
            title="Exit full screen"
            className="absolute top-1/2 -translate-y-1/2 right-3 z-30 p-2 rounded-lg bg-black/60 text-white/90 hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          >
            <Minimize className="w-4 h-4" />
          </button>
        )}

        {/* Our own segment rail — the robust alternative to overlaying YouTube's
            cross-origin seek bar: segment blocks, boundary notches, ember playhead,
            per-segment tooltips and click-to-seek. Always visible, incl. fullscreen. */}
        {duration > 0 && (segments ?? []).length > 0 && (
          <div
            className="group absolute inset-x-0 bottom-0 z-20 h-3 flex items-end cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
              playerRef.current?.seekTo?.(pct * duration, true);
            }}
          >
            <div className="relative w-full h-1.5 group-hover:h-2.5 transition-all bg-white/20">
              {/* played fill */}
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-ember-600 to-ember-400 pointer-events-none"
                style={{ width: `${Math.min(100, (currentTime / duration) * 100)}%` }}
              />
              {/* segment boundary notches */}
              {(segments ?? [])
                .filter((s) => s.start_time > 0.5)
                .map((s) => (
                  <div
                    key={s.segment_id}
                    className="absolute inset-y-0 w-[2px] bg-black/70 pointer-events-none"
                    style={{ left: `${(s.start_time / duration) * 100}%` }}
                  />
                ))}
              {/* playhead */}
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-ember-300 shadow-[0_0_6px_rgba(255,81,0,0.8)] pointer-events-none"
                style={{ left: `${Math.min(100, (currentTime / duration) * 100)}%` }}
              />
              {/* per-segment hover tooltips */}
              {(segments ?? []).map((s) => (
                <div
                  key={`tip-${s.segment_id}`}
                  title={s.title}
                  className="absolute inset-y-0"
                  style={{
                    left: `${(s.start_time / duration) * 100}%`,
                    width: `${((s.end_time - s.start_time) / duration) * 100}%`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Q&A overlay — renders inside the fullscreen shell so it appears ON TOP of
          the video without ever exiting fullscreen. */}
      {isPausedForQuiz && (
        <div className="absolute inset-0 z-50">
          <div
            ref={overlayScrollRef}
            onScroll={updateMoreHint}
            className="no-scrollbar absolute inset-0 overflow-y-auto bg-surface/95 backdrop-blur-md animate-in fade-in duration-200"
          >
            <div ref={overlayContentRef} className="min-h-full flex flex-col gap-3 p-4 sm:p-6 pb-16 max-w-3xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs min-w-0">
                <Pause className="w-4 h-4 text-ember-400 flex-shrink-0" />
                <span className="font-semibold text-ink flex-shrink-0">Paused for Active Recall</span>
                <span className="hidden sm:inline text-ink-faint truncate">• {activeSegment.title}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {visualEnabled && (
                  <button
                    onClick={handleExplainScreen}
                    aria-label="Explain what is on screen"
                    className="flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] text-xs font-semibold rounded-lg bg-sunken hover:bg-line-soft text-ink-muted border border-line transition-all cursor-pointer"
                  >
                    <ScanEye className="w-4 h-4" />
                    <span>Explain screen</span>
                  </button>
                )}
                <button
                  onClick={handleReplaySegment}
                  aria-label="Re-watch this segment"
                  className="flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] text-xs font-semibold rounded-lg bg-sunken hover:bg-line-soft text-ink-muted border border-line transition-all cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Re-watch Segment</span>
                </button>
                {/* Two-way fullscreen toggle — re-entering from the question works
                    because this click supplies the gesture requestFullscreen() needs. */}
                <button
                  onClick={toggleFullscreen}
                  title={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
                  aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
                  className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-sunken hover:bg-line-soft text-ink-muted border border-line transition-all cursor-pointer"
                >
                  {isFullscreen ? (
                    <Minimize className="w-4 h-4" />
                  ) : (
                    <Maximize className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
            <div className="flex-1 flex flex-col">{quizOverlay}</div>
            </div>
          </div>
          {/* Fade + chevron cue; pointer-events-none so it never blocks the quiz */}
          {showMoreHint && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-center h-16 pb-2 bg-gradient-to-t from-surface via-surface/60 to-transparent">
              <ChevronDown className="w-4 h-4 text-ink-faint animate-bounce" />
            </div>
          )}
        </div>
      )}

      {/* Gemini-vision explanation panel — sits above the quiz overlay (z-60) and
          inside the fullscreen shell so it never forces an exit from fullscreen. */}
      {explain.open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="visual-explanation-title"
          className="absolute inset-0 z-[60]"
        >
          <div className="no-scrollbar absolute inset-0 overflow-y-auto bg-surface/95 backdrop-blur-md animate-in fade-in duration-200">
            <div className="min-h-full flex flex-col gap-4 p-4 sm:p-6 max-w-3xl mx-auto">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs min-w-0">
                  <ScanEye className="w-4 h-4 text-ember-400 flex-shrink-0" />
                  <span id="visual-explanation-title" className="font-semibold text-ink flex-shrink-0">Visual Explanation</span>
                  <span className="hidden sm:inline text-ink-faint font-mono">
                    @ {formatSeconds(explain.timestamp)}
                  </span>
                </div>
                <button
                  onClick={closeExplain}
                  title="Close visual explanation"
                  aria-label="Close visual explanation"
                  className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-sunken hover:bg-line-soft text-ink-muted border border-line transition-all cursor-pointer flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {explain.loading && (
                <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 text-sm text-ink-muted py-10">
                  <Loader2 className="w-4 h-4 animate-spin text-ember-400" />
                  Analyzing the current frame…
                </div>
              )}

              {!explain.loading && explain.error && (
                <div className="text-sm text-ink-muted bg-sunken border border-line rounded-xl p-4">
                  {explain.error}
                </div>
              )}

              {!explain.loading && explain.data && (
                <div className="flex flex-col gap-4">
                  <img
                    src={frameUrl(videoId, explain.timestamp)}
                    alt={`Video frame at ${formatSeconds(explain.timestamp)}`}
                    className="w-full max-h-72 object-contain rounded-xl border border-line-soft bg-black"
                  />
                  <p className="text-sm leading-relaxed text-ink">{explain.data.explanation}</p>

                  {explain.data.key_concept && (
                    <div className="text-xs">
                      <span className="font-semibold text-ink-muted">Key concept: </span>
                      <span className="text-ink">{explain.data.key_concept}</span>
                    </div>
                  )}

                  {explain.data.on_screen_text && (
                    <div>
                      <div className="text-xs font-semibold text-ink-muted mb-1">On-screen text</div>
                      <div className="text-xs font-mono bg-sunken border border-line rounded-lg p-3 whitespace-pre-wrap text-ink">
                        {explain.data.on_screen_text}
                      </div>
                    </div>
                  )}

                  {explain.data.diagram_description && (
                    <div>
                      <div className="text-xs font-semibold text-ink-muted mb-1">Diagram</div>
                      <p className="text-sm text-ink">{explain.data.diagram_description}</p>
                    </div>
                  )}

                  {explain.data.equations && explain.data.equations.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-ink-muted mb-1">Equations</div>
                      <div className="flex flex-col gap-2">
                        {explain.data.equations.map((eq, i) => (
                          <div key={i} className="bg-sunken border border-line rounded-lg p-3">
                            <div className="font-mono text-sm text-ink whitespace-pre-wrap">{eq.latex}</div>
                            {eq.description && (
                              <div className="text-xs text-ink-muted mt-1">{eq.description}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Segment Status & Scrubber Bar (hidden in fullscreen so the video owns the screen) */}
      {!isFullscreen && (
      <div className="p-4 border-t border-line-soft bg-raised/90">
        <div className="flex items-center justify-between text-xs text-ink-faint mb-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink truncate max-w-xs sm:max-w-md">
              {activeSegment.title}
            </span>
            <span className="px-2 py-0.5 rounded bg-sunken text-ink-muted font-mono text-[11px]">
              {formatSeconds(activeSegment.start_time)} - {formatSeconds(activeSegment.end_time)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono">{formatSeconds(currentTime)}</span>
            {visualEnabled && (
              <button
                onClick={handleExplainScreen}
                title="Explain what's on screen"
                aria-label="Explain what's on screen"
                className="flex items-center gap-1 px-3 py-2 min-h-[44px] rounded-lg hover:bg-sunken text-ink-faint hover:text-ink transition-colors cursor-pointer"
              >
                <ScanEye className="w-4 h-4" />
                <span className="hidden sm:inline text-[11px] font-semibold">Explain screen</span>
              </button>
            )}
            <button
              onClick={handleReplaySegment}
              title="Rewind to start of segment"
              aria-label="Rewind to start of segment"
              className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center hover:text-ink rounded-lg hover:bg-sunken transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
              aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
              className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center hover:text-ink rounded-lg hover:bg-sunken transition-colors cursor-pointer"
            >
              <Maximize className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Progress Bar for Segment */}
        <div className="w-full h-1.5 bg-cosmos-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-200 ${
              isPausedForQuiz
                ? 'bg-warning'
                : 'bg-gradient-to-r from-ember-600 to-ember-500 shadow-[0_0_10px_rgba(255,81,0,0.45)]'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
      )}
    </div>
  );
};
