import React, { useState } from 'react';
import { Sparkles, Key, Video, FileText, CheckCircle2, X } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

interface NavbarProps {
  hasActiveSession: boolean;
  onReset: () => void;
  onOpenNotes?: () => void;
  canViewNotes?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  hasActiveSession,
  onReset,
  onOpenNotes,
  canViewNotes
}) => {
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(
    localStorage.getItem('gemini_api_key') || ''
  );
  const [savedSuccess, setSavedSuccess] = useState(false);
  // One-time onboarding nudge: without a key the app runs on built-in fallbacks,
  // which first-time users otherwise mistake for the real product.
  const [showKeyHint, setShowKeyHint] = useState(() => {
    try {
      return (
        !localStorage.getItem('gemini_api_key') &&
        localStorage.getItem('mindflow-key-hint-dismissed') !== '1'
      );
    } catch {
      return false;
    }
  });

  const dismissKeyHint = () => {
    setShowKeyHint(false);
    try {
      localStorage.setItem('mindflow-key-hint-dismissed', '1');
    } catch {
      // ignore
    }
  };

  const handleSaveKey = () => {
    if (apiKeyInput.trim()) {
      localStorage.setItem('gemini_api_key', apiKeyInput.trim());
      setShowKeyHint(false);
    } else {
      localStorage.removeItem('gemini_api_key');
    }
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      setIsKeyModalOpen(false);
    }, 900);
  };

  // Close modal on Escape
  React.useEffect(() => {
    if (!isKeyModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsKeyModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isKeyModalOpen]);

  return (
    <>
      <header className="border-b border-line-soft bg-raised/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-ember-700 to-ember-500 flex items-center justify-center shadow-lg shadow-ember-500/30 flex-shrink-0">
              <Sparkles className="w-5 h-5 text-ember-50" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-display font-bold text-base sm:text-lg text-ink tracking-tight truncate">MindFlow AI</span>
                <span className="hidden min-[480px]:inline-block px-2 py-0.5 text-xs font-semibold rounded-full bg-ember-500/10 text-ember-300 border border-ember-500/25 flex-shrink-0">
                  Active Recall
                </span>
              </div>
              <p className="text-xs text-ink-faint hidden sm:block truncate">
                Socratic Video Tutor & Note Synthesizer
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5 flex-shrink-0">
            <ThemeToggle />
            {canViewNotes && onOpenNotes && (
              <button
                onClick={onOpenNotes}
                aria-label="View study notes"
                className="flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-2 min-h-[44px] text-xs sm:text-sm font-medium text-ember-200 bg-ember-900/40 border border-ember-700/50 rounded-lg hover:bg-ember-900/60 transition-all shadow-sm cursor-pointer"
              >
                <FileText className="w-4 h-4 text-ember-400 flex-shrink-0" />
                <span className="hidden sm:inline">Study Notes</span>
              </button>
            )}

            {hasActiveSession && (
              <button
                onClick={onReset}
                aria-label="Start new video session"
                className="flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-2 min-h-[44px] text-xs sm:text-sm font-medium text-ink-muted hover:text-ink bg-sunken hover:bg-line-soft rounded-lg border border-line/60 transition-all cursor-pointer"
              >
                <Video className="w-4 h-4 text-ink-faint flex-shrink-0" />
                <span className="hidden sm:inline">New Video</span>
              </button>
            )}

            <button
              onClick={() => setIsKeyModalOpen(true)}
              className="flex items-center justify-center gap-1.5 px-2.5 sm:px-3 py-2 min-h-[44px] text-xs sm:text-sm font-medium text-ink-faint hover:text-ink-muted bg-sunken/60 hover:bg-sunken rounded-lg border border-line/50 transition-all cursor-pointer"
              title="Configure Gemini API Key"
              aria-label="Configure Gemini API Key"
            >
              <Key className="w-4 h-4 text-warning flex-shrink-0" />
              <span className="hidden md:inline">API Key</span>
            </button>
          </div>
        </div>
      </header>

      {/* One-time Gemini-key onboarding hint */}
      {showKeyHint && (
        <div className="bg-warning/10 border-b border-warning/25" role="region" aria-label="API key onboarding notice">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2 flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <Key className="w-4 h-4 text-warning flex-shrink-0" />
            <p className="text-xs text-ink-muted flex-1 min-w-[160px]">
              No Gemini API key set — MindFlow is running on built-in fallbacks.
              Add a free key for full AI chaptering, answer evaluation & visual insights.
            </p>
            <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto sm:ml-0">
              <button
                onClick={() => setIsKeyModalOpen(true)}
                className="px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-semibold bg-warning/15 text-warning border border-warning/30 hover:bg-warning/25 transition-all cursor-pointer"
              >
                Add key
              </button>
              <button
                onClick={dismissKeyHint}
                aria-label="Dismiss API key hint"
                className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-ink-faint hover:text-ink-muted hover:bg-sunken transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* API Key Modal */}
      {isKeyModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="api-key-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150"
        >
          <div className="bg-raised border border-line-soft rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-warning/10 text-warning border border-warning/25">
                <Key className="w-5 h-5" />
              </div>
              <div>
                <h3 id="api-key-modal-title" className="text-lg font-semibold text-ink">Google Gemini API Key</h3>
                <p className="text-xs text-ink-faint">Optional: overrides default backend key</p>
              </div>
            </div>

            <p className="text-sm text-ink-muted mb-4 leading-relaxed">
              You can provide your own Gemini API key for high-speed custom model inference, or leave blank to use the server default.
            </p>

            <label htmlFor="gemini-api-key-input" className="sr-only">
              Google Gemini API Key
            </label>
            <input
              id="gemini-api-key-input"
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full px-4 py-3 bg-sunken border border-line rounded-xl text-ink placeholder-ink-faint text-sm focus:outline-none focus:ring-2 focus:ring-ember-500 mb-5"
            />

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsKeyModalOpen(false)}
                className="px-4 py-2.5 min-h-[44px] text-sm text-ink-faint hover:text-ink-muted rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveKey}
                className="flex items-center gap-2 px-5 py-2.5 min-h-[44px] text-sm font-semibold bg-accent hover:bg-accent-hover text-on-accent rounded-xl shadow-lg shadow-ember-500/25 transition-all cursor-pointer"
              >
                {savedSuccess ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-on-accent" />
                    <span>Saved!</span>
                  </>
                ) : (
                  <span>Save Key</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
