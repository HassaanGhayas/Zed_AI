import React, { useState } from 'react';
import { Sparkles, Key, Video, FileText, CheckCircle2 } from 'lucide-react';

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

  const handleSaveKey = () => {
    if (apiKeyInput.trim()) {
      localStorage.setItem('gemini_api_key', apiKeyInput.trim());
    } else {
      localStorage.removeItem('gemini_api_key');
    }
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      setIsKeyModalOpen(false);
    }, 900);
  };

  return (
    <>
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-white tracking-tight">MindFlow AI</span>
                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Active Recall
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Socratic Video Tutor & Note Synthesizer
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {canViewNotes && onOpenNotes && (
              <button
                onClick={onOpenNotes}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-300 bg-blue-950/60 border border-blue-800/60 rounded-lg hover:bg-blue-900/50 transition-all shadow-sm"
              >
                <FileText className="w-4 h-4 text-blue-400" />
                <span>Study Notes</span>
              </button>
            )}

            {hasActiveSession && (
              <button
                onClick={onReset}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700 rounded-lg border border-slate-700/60 transition-all"
              >
                <Video className="w-4 h-4 text-slate-400" />
                <span>New Video</span>
              </button>
            )}

            <button
              onClick={() => setIsKeyModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-400 hover:text-slate-200 bg-slate-800/40 hover:bg-slate-800/80 rounded-lg border border-slate-700/50 transition-all"
              title="Configure Gemini API Key"
            >
              <Key className="w-4 h-4 text-amber-400" />
              <span className="hidden md:inline">API Key</span>
            </button>
          </div>
        </div>
      </header>

      {/* API Key Modal */}
      {isKeyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Key className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Google Gemini API Key</h3>
                <p className="text-xs text-slate-400">Optional: overrides default backend key</p>
              </div>
            </div>

            <p className="text-sm text-slate-300 mb-4 leading-relaxed">
              You can provide your own Gemini API key for high-speed custom model inference, or leave blank to use the server default.
            </p>

            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-5"
            />

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsKeyModalOpen(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveKey}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-lg shadow-blue-500/25 transition-all"
              >
                {savedSuccess ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" />
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
