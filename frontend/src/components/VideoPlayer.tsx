import React, { useEffect, useRef, useState } from 'react';
import { Pause, RotateCcw } from 'lucide-react';
import type { Segment } from '../types';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

interface VideoPlayerProps {
  videoId: string;
  activeSegment: Segment;
  isPausedForQuiz: boolean;
  onBoundaryReached: () => void;
  onPlayerReady?: () => void;
  seekTime?: number | null;
  onRewatchSegment?: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoId,
  activeSegment,
  isPausedForQuiz,
  onBoundaryReached,
  onPlayerReady,
  seekTime,
  onRewatchSegment,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [apiLoaded, setApiLoaded] = useState<boolean>(false);

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

  // Enforce auto-pause boundary check loop
  useEffect(() => {
    const interval = setInterval(() => {
      if (!playerRef.current || !playerRef.current.getCurrentTime) return;

      try {
        const time = playerRef.current.getCurrentTime();
        setCurrentTime(time);

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

  const handleResumePlayback = () => {
    if (onRewatchSegment) {
      onRewatchSegment();
    }
    if (playerRef.current?.playVideo) {
      playerRef.current.playVideo();
    }
  };

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
    <div className="flex flex-col bg-raised border border-line-soft rounded-2xl overflow-hidden shadow-2xl">
      {/* Video Viewport */}
      <div className="relative aspect-video w-full bg-black">
        <div ref={containerRef} className="w-full h-full" />

        {/* Boundary Pause Overlay */}
        {isPausedForQuiz && (
          <div className="absolute inset-0 bg-surface/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-20 animate-in fade-in duration-200">
            <div className="w-14 h-14 rounded-2xl bg-ember-500/10 border border-ember-500/30 text-ember-400 flex items-center justify-center mb-3 shadow-lg shadow-ember-500/20">
              <Pause className="w-7 h-7" />
            </div>
            <h3 className="font-display text-xl font-bold text-ink mb-1">
              Segment Concluded: Active Recall Check
            </h3>
            <p className="text-sm text-ink-muted max-w-md mb-4 leading-relaxed">
              The video is paused so you can reflect and test your understanding of{' '}
              <span className="text-ember-300 font-medium">"{activeSegment.title}"</span>.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={handleReplaySegment}
                className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-xl bg-accent hover:bg-accent-hover text-on-accent shadow-lg shadow-ember-600/25 transition-all cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Re-watch This Segment</span>
              </button>
              <button
                onClick={handleResumePlayback}
                className="flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold rounded-xl bg-cosmos-800 hover:bg-cosmos-700 text-ink-muted border border-line transition-all cursor-pointer"
              >
                <span>Dismiss Overlay</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Segment Status & Scrubber Bar */}
      <div className="p-4 border-t border-line-soft bg-raised/90">
        <div className="flex items-center justify-between text-xs text-ink-faint mb-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink truncate max-w-xs sm:max-w-md">
              {activeSegment.title}
            </span>
            <span className="px-2 py-0.5 rounded bg-cosmos-800 text-ink-muted font-mono text-[11px]">
              {formatSeconds(activeSegment.start_time)} - {formatSeconds(activeSegment.end_time)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono">{formatSeconds(currentTime)}</span>
            <button
              onClick={handleReplaySegment}
              title="Rewind to start of segment"
              className="p-1 hover:text-ink rounded hover:bg-cosmos-800 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
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
    </div>
  );
};
