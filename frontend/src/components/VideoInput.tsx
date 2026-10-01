import React, { useState, useImperativeHandle, forwardRef } from 'react';
import { ArrowRight, Loader2, BookOpen, Brain, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from './ui/Button';
import { Logo } from './ui/Logo';
import { SkeletonBlock, SkeletonLine } from './ui/Skeleton';
import { LottiePlayer } from './ui/LottiePlayer';
import { PRESET_VIDEOS } from '../lib/presetVideos';
import pulseRingAnimation from '../assets/lottie/pulse-ring.json';

interface VideoInputProps {
  onProcess: (url: string) => Promise<void>;
  isLoading: boolean;
  loadingStep: string;
  /** Surfaces a failure from the parent's retryable `processVideo` call. */
  error?: string | null;
  /** Re-attempts the last `processVideo` call with the same URL. */
  onRetry?: () => void;
}

export interface VideoInputHandle {
  /** Lets sibling landing sections (e.g. the creator strip) drive the same
   * preset-select behavior without duplicating the URL-input state here. */
  selectPreset: (presetUrl: string) => void;
}

export const VideoInput = forwardRef<VideoInputHandle, VideoInputProps>(({
  onProcess,
  isLoading,
  loadingStep,
  error: processError = null,
  onRetry,
}, ref) => {
  const [url, setUrl] = useState('');
  const [validationError, setValidationError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setValidationError('Please paste a valid YouTube URL');
      return;
    }
    setValidationError('');
    try {
      await onProcess(url.trim());
    } catch {
      // Failure state is owned by the parent's retryable action and surfaced
      // below via `processError`/`onRetry`.
    }
  };

  const handleSelectPreset = (presetUrl: string) => {
    setUrl(presetUrl);
    setValidationError('');
  };

  useImperativeHandle(ref, () => ({
    selectPreset: handleSelectPreset,
  }));

  const displayError = validationError || processError;

  return (
    <div id="hero" className="relative max-w-3xl mx-auto py-8 sm:py-12 px-0 sm:px-4 text-center">
      {/* Ambient drifting glow — purely decorative, frozen under prefers-reduced-motion */}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="animate-drift absolute -top-24 left-1/4 w-72 h-72 rounded-full bg-ember-500/15 blur-3xl" />
        <div className="animate-drift-slow absolute top-10 right-0 w-80 h-80 rounded-full bg-cosmos-400/10 blur-3xl" />
      </div>

      {/* Hero Badge — the owl mark gets a subtle radar-ping halo */}
      <div
        className="animate-in fade-in slide-in-from-bottom-2 relative inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-ember-500/10 border border-ember-500/25 text-ember-300 text-xs font-medium mb-6"
        style={{ animationDuration: '400ms' }}
      >
        <div className="absolute -left-3 -top-3 w-10 h-10 pointer-events-none" aria-hidden="true">
          <LottiePlayer animationData={pulseRingAnimation} className="w-full h-full" />
        </div>
        <Logo className="w-3.5 h-3.5" />
        <span>Active recall, not passive watching</span>
      </div>

      <h1
        className="animate-in fade-in slide-in-from-bottom-2 font-display text-4xl sm:text-5xl font-extrabold tracking-tight text-ink mb-4 leading-tight"
        style={{ animationDuration: '500ms', animationDelay: '80ms' }}
      >
        Any lecture on YouTube, <br className="hidden sm:inline" />
        <span className="animate-headline-shimmer bg-gradient-to-r from-ember-300 via-ember-400 to-ember-500 bg-clip-text text-transparent">
          taught the Socratic way
        </span>
      </h1>

      <p
        className="animate-in fade-in slide-in-from-bottom-2 text-base sm:text-lg text-ink-muted max-w-2xl mx-auto mb-8 leading-relaxed"
        style={{ animationDuration: '500ms', animationDelay: '160ms' }}
      >
        The video pauses at every key idea and won't let you skip ahead until you can explain it. Get it wrong, and it pinpoints exactly where your understanding broke — then asks again.
      </p>

      {/* Input Box */}
      <form
        onSubmit={handleSubmit}
        className="animate-in fade-in slide-in-from-bottom-2 relative max-w-2xl mx-auto mb-6"
        style={{ animationDuration: '500ms', animationDelay: '240ms' }}
      >
        <label htmlFor="youtube-url-input" className="sr-only">
          YouTube Video URL
        </label>
        <div className="flex items-center bg-raised/90 border border-line hover:border-cosmos-600 focus-within:border-ember-500 rounded-2xl p-1.5 sm:p-2 shadow-xl focus-within:ring-4 focus-within:ring-ember-500/20 transition-all">
          <div className="pl-3 pr-2 text-ember-500 flex items-center justify-center flex-shrink-0 pointer-events-none" aria-hidden="true">
            <svg className="w-6 h-6 fill-current text-ember-500" viewBox="0 0 24 24">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
          </div>
          <input
            id="youtube-url-input"
            type="text"
            autoComplete="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isLoading}
            aria-describedby={displayError ? 'youtube-url-error' : undefined}
            placeholder="Paste any public YouTube video link..."
            className="flex-1 min-w-0 bg-transparent px-2 py-2.5 text-ink placeholder-ink-faint text-sm sm:text-base focus:outline-none disabled:opacity-50"
          />
          <Button
            type="submit"
            variant="primary"
            loading={isLoading}
            className={`flex-shrink-0 px-3.5! sm:px-5! py-2.5! gap-1.5 sm:gap-2 text-xs! sm:text-sm! shadow-md! shadow-ember-500/0! disabled:opacity-50! ${
              isLoading ? '' : 'animate-cta-breathe'
            }`}
          >
            {isLoading ? (
              <span>Analyzing</span>
            ) : (
              <>
                <span>Start Tutor</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
      </form>

      {/* Loading Progress State */}
      {isLoading && (
        <div role="status" aria-live="polite" className="max-w-md mx-auto p-4 rounded-xl bg-raised/80 border border-line-soft text-left mb-6 shadow-xl animate-in fade-in duration-200 space-y-3">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-ember-400 animate-spin flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-ink">{loadingStep || 'Processing video...'}</p>
              <p className="text-xs text-ink-faint">Extracting subtitles & structuring Socratic recall chapters</p>
            </div>
          </div>
          {/* Content-shaped placeholder for the incoming video/chapter card */}
          <div className="flex items-center gap-3 pt-1">
            <SkeletonBlock className="w-20 h-14 flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonLine className="w-3/4" />
              <SkeletonLine className="w-1/2" />
            </div>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {displayError && (
        <div id="youtube-url-error" role="alert" aria-live="polite" className="max-w-md mx-auto p-3.5 rounded-xl bg-danger/10 border border-danger/30 text-danger text-sm mb-6 text-left flex items-start gap-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span className="flex-1">{displayError}</span>
          {processError && onRetry && (
            <Button
              type="button"
              variant="danger"
              onClick={onRetry}
              className="flex-shrink-0 px-3! py-1.5! min-h-[36px]! text-xs!"
            >
              Retry
            </Button>
          )}
        </div>
      )}

      {/* Preset Suggestions */}
      <div className="pt-4 border-t border-line-soft">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint mb-3">
          Or try one of these educational classics:
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {PRESET_VIDEOS.map((preset, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelectPreset(preset.url)}
              disabled={isLoading}
              className="group flex items-center gap-2 px-3 py-2 min-h-[44px] max-w-full rounded-xl bg-raised border border-line-soft hover:border-ember-500/50 hover:bg-sunken hover:-translate-y-0.5 transition-all text-left text-xs cursor-pointer"
            >
              <span className="px-1.5 py-0.5 rounded bg-ember-500/10 text-ember-300 font-medium flex-shrink-0">
                {preset.tag}
              </span>
              <span className="text-ink-muted group-hover:text-ink transition-colors truncate min-w-0 flex-1 max-w-[200px] sm:max-w-xs">
                {preset.title}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Feature Highlights Grid */}
      <h2 className="sr-only">Key Learning Features</h2>
      <div className="grid sm:grid-cols-3 gap-5 mt-14 text-left">
        <div
          className="animate-in fade-in slide-in-from-bottom-4 p-5 rounded-2xl bg-raised/50 border border-line-soft hover:border-ember-500/30 hover:-translate-y-1 transition-all"
          style={{ animationDuration: '500ms', animationDelay: '320ms' }}
        >
          <div className="w-9 h-9 rounded-xl bg-ember-500/10 text-ember-400 flex items-center justify-center mb-3">
            <BookOpen className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-ink text-sm mb-1">Topic-Based Segments</h3>
          <p className="text-xs text-ink-faint leading-relaxed">
            Long lectures are sliced into bite-sized chapters. The player automatically pauses at the boundary.
          </p>
        </div>

        <div
          className="animate-in fade-in slide-in-from-bottom-4 p-5 rounded-2xl bg-raised/50 border border-line-soft hover:border-ember-500/30 hover:-translate-y-1 transition-all"
          style={{ animationDuration: '500ms', animationDelay: '390ms' }}
        >
          <div className="w-9 h-9 rounded-xl bg-ember-500/10 text-ember-400 flex items-center justify-center mb-3">
            <Brain className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-ink text-sm mb-1">Misconception Diagnosis</h3>
          <p className="text-xs text-ink-faint leading-relaxed">
            Wrong answers aren't penalizing. AI explains what you missed, references the video, and re-asks the question.
          </p>
        </div>

        <div
          className="animate-in fade-in slide-in-from-bottom-4 p-5 rounded-2xl bg-raised/50 border border-line-soft hover:border-ember-500/30 hover:-translate-y-1 transition-all"
          style={{ animationDuration: '500ms', animationDelay: '460ms' }}
        >
          <div className="w-9 h-9 rounded-xl bg-ember-500/10 text-ember-400 flex items-center justify-center mb-3">
            <CheckCircle className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-ink text-sm mb-1">Personalized PDF Notes</h3>
          <p className="text-xs text-ink-faint leading-relaxed">
            Download professional notes synthesized from the video merged with your own verified explanations.
          </p>
        </div>
      </div>
    </div>
  );
});
VideoInput.displayName = 'VideoInput';
