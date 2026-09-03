import React, { useState } from 'react';
import { ArrowRight, Loader2, Sparkles, BookOpen, Brain, CheckCircle, AlertCircle } from 'lucide-react';

interface VideoInputProps {
  onProcess: (url: string) => Promise<void>;
  isLoading: boolean;
  loadingStep: string;
}

const PRESET_VIDEOS = [
  {
    title: "But what is a neural network? (3Blue1Brown)",
    url: "https://www.youtube.com/watch?v=aircAruvnKk",
    tag: "Machine Learning"
  },
  {
    title: "How Computers Compute (CrashCourse)",
    url: "https://www.youtube.com/watch?v=1S0aBV-Waeo",
    tag: "Computer Science"
  },
  {
    title: "The Simple Solution to Traffic (CGP Grey)",
    url: "https://www.youtube.com/watch?v=iHzzSaoMx3E",
    tag: "Systems & Logic"
  }
];

export const VideoInput: React.FC<VideoInputProps> = ({
  onProcess,
  isLoading,
  loadingStep
}) => {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      setError('Please paste a valid YouTube URL');
      return;
    }
    setError('');
    try {
      await onProcess(url.trim());
    } catch (err: any) {
      setError(err.message || 'Failed to process this video.');
    }
  };

  const handleSelectPreset = (presetUrl: string) => {
    setUrl(presetUrl);
    setError('');
  };

  return (
    <div className="max-w-3xl mx-auto py-12 px-4 text-center">
      {/* Hero Badge */}
      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-ember-500/10 border border-ember-500/25 text-ember-300 text-xs font-medium mb-6">
        <Sparkles className="w-3.5 h-3.5" />
        <span>Active Recall + Socratic AI Video Tutor</span>
      </div>

      <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight text-ink mb-4 leading-tight">
        Master Any Topic with <br className="hidden sm:inline" />
        <span className="bg-gradient-to-r from-ember-300 via-ember-400 to-ember-500 bg-clip-text text-transparent">
          Interactive Video Quizzing
        </span>
      </h1>

      <p className="text-base sm:text-lg text-ink-muted max-w-2xl mx-auto mb-8 leading-relaxed">
        Watch educational videos in targeted segments. The video auto-pauses at key concept boundaries so AI tests your understanding, corrects misconceptions, and compiles personalized notes.
      </p>

      {/* Input Box */}
      <form onSubmit={handleSubmit} className="relative max-w-2xl mx-auto mb-6">
        <div className="relative flex items-center">
          <div className="absolute left-4 text-ember-500 flex items-center justify-center">
            <svg className="w-6 h-6 fill-current text-ember-500" viewBox="0 0 24 24">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
          </div>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isLoading}
            placeholder="Paste any public YouTube video link..."
            className="w-full pl-13 pr-32 py-4 bg-raised/90 border border-line hover:border-cosmos-600 focus:border-ember-500 rounded-2xl text-ink placeholder-ink-faint/70 text-base shadow-xl focus:outline-none focus:ring-4 focus:ring-ember-500/20 transition-all disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading}
            className="absolute right-2 top-2 bottom-2 px-5 bg-gradient-to-r from-ember-500 to-ember-400 hover:from-ember-400 hover:to-ember-300 text-on-accent font-semibold rounded-xl shadow-md flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Analyzing</span>
              </>
            ) : (
              <>
                <span>Start Tutor</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </form>

      {/* Loading Progress State */}
      {isLoading && (
        <div className="max-w-md mx-auto p-4 rounded-xl bg-raised/80 border border-line-soft text-left mb-6 shadow-xl animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-ember-400 animate-spin flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-ink">{loadingStep || 'Processing video...'}</p>
              <p className="text-xs text-ink-faint">Extracting subtitles & structuring Socratic recall chapters</p>
            </div>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="max-w-md mx-auto p-3.5 rounded-xl bg-danger/10 border border-danger/30 text-danger text-sm mb-6 text-left flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Preset Suggestions */}
      <div className="pt-4 border-t border-line-soft">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint mb-3">
          Or try one of these educational classics:
        </p>
        <div className="flex flex-wrap justify-center gap-2.5">
          {PRESET_VIDEOS.map((preset, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelectPreset(preset.url)}
              disabled={isLoading}
              className="group flex items-center gap-2 px-3 py-2 rounded-xl bg-raised border border-line-soft hover:border-ember-500/50 hover:bg-cosmos-800/80 transition-all text-left text-xs"
            >
              <span className="px-1.5 py-0.5 rounded bg-ember-500/10 text-ember-300 font-medium">
                {preset.tag}
              </span>
              <span className="text-ink-muted group-hover:text-ink transition-colors truncate max-w-xs">
                {preset.title}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Feature Highlights Grid */}
      <div className="grid sm:grid-cols-3 gap-5 mt-14 text-left">
        <div className="p-5 rounded-2xl bg-raised/50 border border-line-soft">
          <div className="w-9 h-9 rounded-xl bg-ember-500/10 text-ember-400 flex items-center justify-center mb-3">
            <BookOpen className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-ink text-sm mb-1">Topic-Based Segments</h3>
          <p className="text-xs text-ink-faint leading-relaxed">
            Long lectures are sliced into bite-sized chapters. The player automatically pauses at the boundary.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-raised/50 border border-line-soft">
          <div className="w-9 h-9 rounded-xl bg-ember-500/10 text-ember-400 flex items-center justify-center mb-3">
            <Brain className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-ink text-sm mb-1">Misconception Diagnosis</h3>
          <p className="text-xs text-ink-faint leading-relaxed">
            Wrong answers aren't penalizing. AI explains what you missed, references the video, and re-asks the question.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-raised/50 border border-line-soft">
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
};
