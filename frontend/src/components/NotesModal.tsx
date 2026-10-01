import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Download,
  Copy,
  Check,
  X,
  Loader2,
  BookOpen,
  AlertCircle,
  ExternalLink,
  Sparkles,
  AlertTriangle,
  FileText,
  ListChecks,
} from 'lucide-react';
import type { QAHistoryItem, Segment } from '../types';
import { generateNotes, downloadNotesPdf } from '../lib/api';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { SkeletonLine } from './ui/Skeleton';
import { useRetryableAsync } from '../hooks/useRetryableAsync';

interface NotesModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoTitle: string;
  videoId: string;
  segments: Segment[];
  qaHistory: QAHistoryItem[];
}

interface ParsedCheckpoint {
  question: string;
  status: 'mastered' | 'needs_review' | '';
  explanation: string;
}

interface ParsedSection {
  title: string;
  isRevisit?: boolean;
  revisitItems?: string[];
  checkpoints: ParsedCheckpoint[];
  extraLines: string[];
}

export const NotesModal: React.FC<NotesModalProps> = ({
  isOpen,
  onClose,
  videoTitle,
  videoId,
  segments,
  qaHistory,
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [activeTab, setActiveTab] = useState<'synthesized' | 'raw' | 'markdown'>('synthesized');

  // Wrapped with useRetryableAsync so a notes-generation failure is caught and
  // exposed as a retryable error state, with a Retry button in the error banner.
  const generateNotesAction = useCallback(
    () =>
      generateNotes({
        video_title: videoTitle,
        video_id: videoId,
        segments,
        qa_history: qaHistory,
      }),
    [videoTitle, videoId, segments, qaHistory]
  );

  const {
    data: markdownNotes,
    error: notesError,
    isLoading,
    run: runGenerateNotes,
    retry: retryGenerateNotes,
  } = useRetryableAsync(generateNotesAction);

  useEffect(() => {
    if (isOpen && !markdownNotes) {
      runGenerateNotes().catch(() => {
        // Captured by useRetryableAsync and surfaced via `notesError`/retry.
      });
    }
    // Only re-check when the modal opens; `markdownNotes`/`runGenerateNotes`
    // intentionally excluded so a successful load doesn't re-trigger itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleDownloadPdf = async () => {
    if (!markdownNotes) return;
    setIsDownloading(true);
    setDownloadError('');
    try {
      const keyframes = segments
        .filter((s) => s.keyframe_url || s.visual?.has_visual_content)
        .map((s) => ({
          title: s.title,
          timestamp: s.keyframe_time ?? (s.start_time + s.end_time) / 2,
          caption: s.visual?.key_concept || s.visual?.diagram_description || '',
        }));
      await downloadNotesPdf(videoTitle, markdownNotes, { videoId, keyframes });
    } catch (err: any) {
      setDownloadError(err.message || 'Failed to download PDF');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopyMarkdown = () => {
    if (!markdownNotes) return;
    navigator.clipboard.writeText(markdownNotes);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 1500);
  };

  // Group the Q&A history by segment for the raw log view
  const qaByTitle = useMemo(() => {
    const map = new Map<string, QAHistoryItem[]>();
    for (const item of qaHistory) {
      const arr = map.get(item.segment_title) ?? [];
      arr.push(item);
      map.set(item.segment_title, arr);
    }
    return map;
  }, [qaHistory]);

  const segmentsWithQa = useMemo(() => {
    return segments
      .map((seg) => ({ seg, items: qaByTitle.get(seg.title) ?? [] }))
      .filter((g) => g.items.length > 0);
  }, [segments, qaByTitle]);

  // Parse synthesized markdown notes into structured visual blocks
  const parsedSections = useMemo<ParsedSection[]>(() => {
    if (!markdownNotes) return [];

    const sections: ParsedSection[] = [];
    let currentSection: ParsedSection | null = null;
    let currentCheckpoint: ParsedCheckpoint | null = null;

    const lines = markdownNotes.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw) continue;

      // Check for Concepts to Revisit
      if (raw.toLowerCase().startsWith('## concepts to revisit')) {
        if (currentCheckpoint && currentSection) {
          currentSection.checkpoints.push(currentCheckpoint);
          currentCheckpoint = null;
        }
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          title: 'Concepts to Revisit',
          isRevisit: true,
          revisitItems: [],
          checkpoints: [],
          extraLines: [],
        };
        continue;
      }

      // Check for Section Heading: ## Topic (strip timestamps)
      if (raw.startsWith('## ')) {
        if (currentCheckpoint && currentSection) {
          currentSection.checkpoints.push(currentCheckpoint);
          currentCheckpoint = null;
        }
        if (currentSection) {
          sections.push(currentSection);
        }
        const headingText = raw.slice(3).trim();
        const title = headingText.replace(/\s*\(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\)/, '').trim();

        currentSection = {
          title,
          checkpoints: [],
          extraLines: [],
        };
        continue;
      }

      // Check for Revisit bullet points under revisit section
      if (currentSection?.isRevisit) {
        if (raw.startsWith('- ') || raw.startsWith('* ')) {
          currentSection.revisitItems?.push(raw.slice(2).trim());
        } else {
          currentSection.extraLines.push(raw);
        }
        continue;
      }

      // Check for Question Heading: ### [Question] (no checkpoint labels, no timestamps)
      if (raw.startsWith('### ')) {
        if (currentCheckpoint && currentSection) {
          currentSection.checkpoints.push(currentCheckpoint);
        }
        const subRaw = raw.slice(4).trim();
        let cleanQ = subRaw.replace(/\s*\(\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\)/, '').trim();
        cleanQ = cleanQ.replace(/\s*\((?:Mastered|Needs\s*Review)\)/i, '').trim();
        cleanQ = cleanQ.replace(/^Checkpoint\s*\d*:\s*/i, '').trim();

        currentCheckpoint = {
          question: cleanQ,
          status: '',
          explanation: '',
        };
        continue;
      }

      // Student Answer line: **Answer:** ...
      const expMatch = raw.match(/^\*\*(?:Answer|Your\s+Answer|Your\s+Explanation|Your\s+Articulation|Articulation\s*(?:Concept)?|Explanation):?\*\*\s*(.*)$/i);
      if (expMatch && currentCheckpoint) {
        currentCheckpoint.explanation = expMatch[1].trim();
        continue;
      }

      // Validated concepts and tutor insights must NOT appear in notes
      if (/^\*\*(?:Validated\s+Concepts|Key\s+Concepts\s+Validated):?/i.test(raw)) {
        continue;
      }
      if (/^\*\*(?:Tutor\s+Insight|Tutor\s+Takeaway|Tutor\s+Feedback):?/i.test(raw)) {
        continue;
      }

      // Unparsed line
      if (currentSection) {
        currentSection.extraLines.push(raw);
      }
    }

    if (currentCheckpoint && currentSection) {
      currentSection.checkpoints.push(currentCheckpoint);
    }
    if (currentSection) {
      sections.push(currentSection);
    }

    return sections;
  }, [markdownNotes]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      titleId="notes-modal-title"
      className="sm:rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden"
      overlayClassName="!bg-black/80 !backdrop-blur-md !p-3 sm:!p-6 overflow-x-hidden"
    >
        {/* Modal Header */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-line-soft flex items-center justify-between gap-2.5 bg-raised/90">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-ember-500/10 border border-ember-500/25 text-ember-400 flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <h3 id="notes-modal-title" className="font-display text-xs sm:text-lg font-bold text-ink truncate">
                  Personalized Study Notes
                </h3>
                <span className="hidden min-[380px]:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-semibold bg-ember-500/10 text-ember-300 border border-ember-500/25 flex-shrink-0">
                  <Sparkles className="w-3 h-3" />
                  AI Synthesized & Grammar Refined
                </span>
              </div>
              <p className="text-xs text-ink-faint truncate max-w-xs sm:max-w-md">
                {videoTitle}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close notes modal"
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-ink-faint hover:text-ink hover:bg-sunken transition-colors cursor-pointer flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* View Mode Navigation Tabs */}
        <div className="px-4 sm:px-6 pt-3 pb-2 border-b border-line-soft bg-sunken/30 flex items-center justify-between gap-3 flex-wrap">
          <div role="tablist" aria-label="Notes view mode" className="flex items-center gap-1.5 bg-sunken/60 p-1 rounded-xl border border-line-soft text-xs font-medium">
            <button
              id="notes-tab-synthesized"
              role="tab"
              aria-selected={activeTab === 'synthesized'}
              aria-controls="notes-tabpanel"
              onClick={() => setActiveTab('synthesized')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeTab === 'synthesized'
                  ? 'bg-raised text-ink shadow-sm font-semibold'
                  : 'text-ink-faint hover:text-ink'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-ember-400" />
              <span>Synthesized Notes</span>
            </button>
            <button
              id="notes-tab-raw"
              role="tab"
              aria-selected={activeTab === 'raw'}
              aria-controls="notes-tabpanel"
              onClick={() => setActiveTab('raw')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeTab === 'raw'
                  ? 'bg-raised text-ink shadow-sm font-semibold'
                  : 'text-ink-faint hover:text-ink'
              }`}
            >
              <ListChecks className="w-3.5 h-3.5" />
              <span>Question History</span>
            </button>
            <button
              id="notes-tab-markdown"
              role="tab"
              aria-selected={activeTab === 'markdown'}
              aria-controls="notes-tabpanel"
              onClick={() => setActiveTab('markdown')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeTab === 'markdown'
                  ? 'bg-raised text-ink shadow-sm font-semibold'
                  : 'text-ink-faint hover:text-ink'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Markdown</span>
            </button>
          </div>

          <a
            href={`https://www.youtube.com/watch?v=${videoId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ember-400 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            <span>YouTube Lecture</span>
          </a>
        </div>

        {/* Modal Body */}
        <div
          id="notes-tabpanel"
          role="tabpanel"
          aria-labelledby={`notes-tab-${activeTab}`}
          className="flex-1 overflow-y-auto p-4 sm:p-6 text-left"
        >
          {isLoading ? (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 rounded-xl bg-ember-500/10 border border-ember-500/25 flex items-center justify-center text-ember-400">
                    <Sparkles className="w-5 h-5 animate-pulse" />
                  </div>
                  <Loader2 className="w-4 h-4 text-ember-400 animate-spin absolute -top-1 -right-1" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-ink">
                    Auditing Grammar &amp; Synthesizing Notes...
                  </h4>
                  <p className="text-xs text-ink-faint leading-relaxed">
                    Refining your explanations and structuring pedagogical takeaways.
                  </p>
                </div>
              </div>
              {/* Document-shaped placeholder: a few paragraph-like rows */}
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-2.5">
                  <SkeletonLine className="w-1/3" />
                  <SkeletonLine className="w-full" />
                  <SkeletonLine className="w-5/6" />
                  <SkeletonLine className="w-2/3" />
                </div>
              ))}
            </div>
          ) : notesError ? (
            <div className="p-4 rounded-xl bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="flex-1">{notesError}</span>
              <Button
                type="button"
                variant="danger"
                onClick={() => retryGenerateNotes()?.catch(() => {})}
                className="flex-shrink-0 px-3! py-1.5! min-h-[36px]! text-xs!"
              >
                Retry
              </Button>
            </div>
          ) : activeTab === 'synthesized' ? (
            <div className="space-y-6">
              {parsedSections.length === 0 ? (
                <div className="text-center py-12 flex flex-col items-center gap-2 text-ink-faint">
                  <ListChecks className="w-8 h-8 text-ink-faint/60" />
                  <p className="text-sm">No active recall checkpoints were synthesized for this video.</p>
                  <p className="text-xs text-ink-faint/80">Answer a few checkpoint questions while watching to generate synthesized notes.</p>
                </div>
              ) : (
                parsedSections.map((section, sIdx) => {
                  if (section.isRevisit) {
                    return (
                      <div
                        key={`sec-${sIdx}`}
                        className="rounded-2xl border border-warning/40 bg-warning/10 p-4 sm:p-5 space-y-3"
                      >
                        <div className="flex items-center gap-2 text-warning font-bold text-sm">
                          <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />
                          <span>Concepts to Revisit Before Your Exam</span>
                        </div>
                        <p className="text-xs text-ink-muted leading-relaxed">
                          These concepts encountered difficulties during active recall. Review before tests:
                        </p>
                        <ul className="space-y-1.5 pl-2">
                          {section.revisitItems?.map((item, rIdx) => (
                            <li key={rIdx} className="text-xs text-ink flex items-start gap-2">
                              <span className="text-warning font-bold">•</span>
                              <span dangerouslySetInnerHTML={{ __html: item.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') }} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  }

                  return (
                    <section key={`sec-${sIdx}`} className="space-y-3">
                      {/* Section Title Header */}
                      <div className="border-l-4 border-ember-500 pl-3 py-0.5">
                        <h4 className="text-sm sm:text-base font-bold text-ink">{section.title}</h4>
                      </div>

                      {/* Question Cards */}
                      {section.checkpoints.map((cp, cIdx) => (
                        <div
                          key={`cp-${sIdx}-${cIdx}`}
                          className="rounded-2xl border border-line-soft bg-raised shadow-sm overflow-hidden divide-y divide-line-soft"
                        >
                          {/* Question Header (no Checkpoint label, just the question) */}
                          <div className="p-3 sm:p-4 bg-sunken/40">
                            <h5 className="text-xs sm:text-sm font-semibold text-ink leading-relaxed">
                              {cp.question}
                            </h5>
                          </div>

                          {/* Student Answer */}
                          {cp.explanation && (
                            <div className="p-3 sm:p-4 bg-raised space-y-1.5">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-ember-400">
                                <Sparkles className="w-3.5 h-3.5 text-ember-400" />
                                <span>Answer</span>
                              </div>
                              <p className="text-xs sm:text-sm text-ink leading-relaxed bg-sunken/20 p-2.5 rounded-xl border border-line-soft">
                                {cp.explanation}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}

                      {/* Fallback for extra unparsed markdown lines in section */}
                      {section.extraLines.length > 0 && (
                        <div className="text-xs text-ink-faint space-y-1 pl-2">
                          {section.extraLines.map((line, lIdx) => (
                            <p key={lIdx} dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') }} />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })
              )}
            </div>
          ) : activeTab === 'raw' ? (
            <div className="space-y-6">
              <div className="p-3 rounded-xl bg-sunken/40 border border-line-soft text-xs text-ink-muted">
                Showing questions and answers recorded during your video study session.
              </div>

              {segmentsWithQa.map(({ seg, items }) => (
                <section key={seg.segment_id} className="space-y-3">
                  <div className="border-l-4 border-line-soft pl-3">
                    <h4 className="text-sm font-bold text-ink truncate">{seg.title}</h4>
                  </div>
                  {items.map((item, i) => (
                    <div
                      key={`${seg.segment_id}-${i}`}
                      className="rounded-2xl border border-line-soft bg-sunken/40 p-4 space-y-3"
                    >
                      <div>
                        <p className="text-sm font-semibold text-ink leading-relaxed">{item.question}</p>
                      </div>
                      <div className="border-t border-line-soft pt-3 space-y-1">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-success/10 text-success border border-success/25">
                          Answer
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
                <div className="text-center py-10 flex flex-col items-center gap-2 text-ink-faint">
                  <BookOpen className="w-8 h-8 text-ink-faint/60" />
                  <p className="text-sm">No questions were completed in this session.</p>
                  <p className="text-xs text-ink-faint/80">Watch the video and answer checkpoint questions to build your question history.</p>
                </div>
              )}
            </div>
          ) : (
            <div>
              <pre className="whitespace-pre-wrap font-mono bg-sunken/60 p-4 sm:p-5 rounded-2xl border border-line-soft text-ink-muted text-xs leading-relaxed overflow-x-auto">
                {markdownNotes || 'Generating notes...'}
              </pre>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-4 sm:px-6 py-3.5 border-t border-line-soft bg-raised/90 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-ink-faint flex items-center gap-2">
            <span>{qaHistory.length} question(s) synthesized</span>
            {downloadError && (
              <span role="alert" className="text-danger flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                {downloadError}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5">
            <button
              onClick={handleCopyMarkdown}
              disabled={isLoading || !markdownNotes}
              className="flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] text-xs font-medium rounded-xl bg-sunken hover:bg-line-soft text-ink-muted hover:text-ink border border-line transition-all cursor-pointer disabled:opacity-40"
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
              className="flex items-center gap-2 px-5 py-2 min-h-[44px] text-xs font-semibold rounded-xl bg-accent hover:bg-accent-hover text-on-accent shadow-lg shadow-ember-500/25 transition-all cursor-pointer disabled:opacity-40"
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
    </Modal>
  );
};
