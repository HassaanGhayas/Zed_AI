import React, { useState, useEffect } from 'react';
import {
  Download,
  Copy,
  Check,
  X,
  Loader2,
  BookOpen,
  AlertCircle,
  ExternalLink
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

  const formatSeconds = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Group the Q&A history by segment (in segment order) for the rendered view
  const qaByTitle = new Map<string, QAHistoryItem[]>();
  for (const item of qaHistory) {
    const arr = qaByTitle.get(item.segment_title) ?? [];
    arr.push(item);
    qaByTitle.set(item.segment_title, arr);
  }
  const segmentsWithQa = segments
    .map((seg) => ({ seg, items: qaByTitle.get(seg.title) ?? [] }))
    .filter((g) => g.items.length > 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 sm:p-6 animate-in fade-in duration-150">
      <div className="bg-raised border border-line-soft rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-line-soft flex items-center justify-between bg-raised/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-ember-500/10 border border-ember-500/25 text-ember-400 flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-base sm:text-lg font-bold text-ink">
                  Personalized Study Notes
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-ember-500/10 text-ember-300 border border-ember-500/25">
                  AI Synthesized
                </span>
              </div>
              <p className="text-xs text-ink-faint truncate max-w-sm sm:max-w-md">
                {videoTitle}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-ink-faint hover:text-ink hover:bg-sunken transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 text-left">
          {error ? (
            <div className="p-4 rounded-xl bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Source video link */}
              <a
                href={`https://www.youtube.com/watch?v=${videoId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-ink-faint hover:text-ember-300 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Source video on YouTube</span>
              </a>

              {/* Per-segment Q&A cards */}
              {segmentsWithQa.map(({ seg, items }) => (
                <section key={seg.segment_id} className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-ink truncate">{seg.title}</h4>
                    <span className="px-2 py-0.5 rounded bg-sunken text-ink-muted font-mono text-[11px] flex-shrink-0">
                      {formatSeconds(seg.start_time)} - {formatSeconds(seg.end_time)}
                    </span>
                  </div>
                  {items.map((item, i) => (
                    <div
                      key={`${seg.segment_id}-${i}`}
                      className="rounded-2xl border border-line-soft bg-sunken/40 p-4 space-y-3"
                    >
                      <div>
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-ember-500/10 text-ember-300 border border-ember-500/25 mb-1.5">
                          Q{i + 1}
                        </span>
                        <p className="text-sm text-ink leading-relaxed">{item.question}</p>
                      </div>
                      <div className="border-t border-line-soft pt-3">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-success/10 text-success border border-success/25 mb-1.5">
                          A{i + 1}
                        </span>
                        <p className="text-sm text-ink-muted leading-relaxed">
                          {item.user_final_answer}
                        </p>
                      </div>
                    </div>
                  ))}
                </section>
              ))}

              {qaHistory.length === 0 && (
                <p className="text-sm text-ink-faint text-center py-10">
                  No active-recall questions were completed in this session.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-line-soft bg-raised/90 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-ink-faint">
            {qaHistory.length} active recall response(s) integrated
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleCopyMarkdown}
              disabled={isLoading || !markdownNotes}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl bg-sunken hover:bg-line-soft text-ink-muted hover:text-ink border border-line transition-all cursor-pointer disabled:opacity-40"
            >
              {isCopied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-success" />
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
              className="flex items-center gap-2 px-5 py-2 text-xs font-semibold rounded-xl bg-accent hover:bg-accent-hover text-on-accent shadow-lg shadow-ember-500/25 transition-all cursor-pointer disabled:opacity-40"
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
