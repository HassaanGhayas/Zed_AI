import React, { useState, useEffect } from 'react';
import {
  Download,
  Copy,
  Check,
  X,
  Loader2,
  BookOpen
} from 'lucide-react';
import type { QAHistoryItem, Segment } from '../types';
import { generateNotes, downloadNotesPdf } from '../lib/api';

interface NotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoTitle: string;
  videoId: string;
  segments: Segment[];
  qaHistory: QAHistoryItem[];
}

export const NotesModal: React.FC<NotesModalProps> = ({
  isOpen,
  onClose,
  videoTitle,
  videoId,
  segments,
  qaHistory,
}) => {
  const [markdownNotes, setMarkdownNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen && !markdownNotes) {
      loadNotes();
    }
  }, [isOpen]);

  const loadNotes = async () => {
    setIsLoading(true);
    setError('');
    try {
      const notes = await generateNotes({
        video_title: videoTitle,
        video_id: videoId,
        segments: segments,
        qa_history: qaHistory,
      });
      setMarkdownNotes(notes);
    } catch (err: any) {
      setError(err.message || 'Failed to generate study notes');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!markdownNotes) return;
    setIsDownloading(true);
    try {
      await downloadNotesPdf(videoTitle, markdownNotes);
    } catch (err: any) {
      setError(err.message || 'Failed to download PDF');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(markdownNotes);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 sm:p-6 animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-white">
                  Personalized Study Notes
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  AI Synthesized
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate max-w-sm sm:max-w-md">
                {videoTitle}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 text-left">
          {isLoading ? (
            <div className="py-20 flex flex-col items-center justify-center text-center">
              <Loader2 className="w-8 h-8 text-purple-400 animate-spin mb-4" />
              <h4 className="text-base font-semibold text-white mb-1">
                Synthesizing Notes & Verifications...
              </h4>
              <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                Merging the core video concepts with your personal explanations and resolved misconceptions.
              </p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
              ⚠️ {error}
            </div>
          ) : (
            <div className="prose prose-invert prose-slate max-w-none text-slate-300 text-sm leading-relaxed space-y-4">
              <pre className="whitespace-pre-wrap font-sans bg-slate-950/60 p-5 rounded-2xl border border-slate-800 text-slate-200 text-sm leading-relaxed">
                {markdownNotes}
              </pre>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/90 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-400">
            {qaHistory.length} active recall response(s) integrated
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleCopyMarkdown}
              disabled={isLoading || !markdownNotes}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all cursor-pointer disabled:opacity-40"
            >
              {isCopied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Markdown</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownloadPdf}
              disabled={isLoading || !markdownNotes || isDownloading}
              className="flex items-center gap-2 px-5 py-2 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/25 transition-all cursor-pointer disabled:opacity-40"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Generating PDF...</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Notes as PDF</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
