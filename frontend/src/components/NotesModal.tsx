import React, { useState, useEffect, useMemo } from 'react';
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
  CheckCircle2,
  AlertTriangle,
  FileText,
  ListChecks,
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

interface ParsedCheckpoint {
  question: string;
  status: 'mastered' | 'needs_review' | '';
  explanation: string;
  validatedConcepts: string[];
  tutorInsight: string;
}

interface ParsedSection {
  title: string;
  timeRange: string;
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
  const [markdownNotes, setMarkdownNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'synthesized' | 'raw' | 'markdown'>('synthesized');

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
      const keyframes = segments
        .filter((s) => s.keyframe_url || s.visual?.has_visual_content)
        .map((s) => ({
          title: s.title,
          timestamp: s.keyframe_time ?? (s.start_time + s.end_time) / 2,
          caption: s.visual?.key_concept || s.visual?.diagram_description || '',
        }));
      await downloadNotesPdf(videoTitle, markdownNotes, { videoId, keyframes });
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
          timeRange: '',
          isRevisit: true,
          revisitItems: [],
          checkpoints: [],
          extraLines: [],
        };
        continue;
      }

      // Check for Section Heading: ## Topic (mm:ss - mm:ss)
      if (raw.startsWith('## ')) {
        if (currentCheckpoint && currentSection) {
          currentSection.checkpoints.push(currentCheckpoint);
          currentCheckpoint = null;
        }
        if (currentSection) {
          sections.push(currentSection);
        }
        const headingText = raw.slice(3).trim();
        const timeMatch = headingText.match(/\((?:(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}))\)/);
        const timeRange = timeMatch ? `${timeMatch[1]} - ${timeMatch[2]}` : '';
        const title = headingText.replace(/\s*\(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\)/, '').trim();

        currentSection = {
          title,
          timeRange,
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

      // Check for Checkpoint Heading: ### Checkpoint N: Question (Status)
      if (raw.startsWith('### ')) {
        if (currentCheckpoint && currentSection) {
          currentSection.checkpoints.push(currentCheckpoint);
        }
        const subRaw = raw.slice(4).trim();
        let status: 'mastered' | 'needs_review' | '' = '';
        let cleanQ = subRaw;
        if (/mastered/i.test(subRaw)) {
          status = 'mastered';
          cleanQ = subRaw.replace(/\s*\(Mastered\)/i, '').trim();
        } else if (/needs\s*review/i.test(subRaw)) {
          status = 'needs_review';
          cleanQ = subRaw.replace(/\s*\(Needs\s*Review\)/i, '').trim();
        }
        cleanQ = cleanQ.replace(/^Checkpoint\s*\d+:\s*/i, '').trim();

        currentCheckpoint = {
          question: cleanQ,
          status,
          explanation: '',
          validatedConcepts: [],
          tutorInsight: '',
        };
        continue;
      }

      // Student Explanation line
      const expMatch = raw.match(/^\*\*(?:Your\s+Explanation|Your\s+Articulation|Explanation):?\*\*\s*(.*)$/i);
      if (expMatch && currentCheckpoint) {
        currentCheckpoint.explanation = expMatch[1].trim();
        continue;
      }

      // Validated Concepts line
      const valMatch = raw.match(/^\*\*(?:Validated\s+Concepts|Key\s+Concepts\s+Validated):?\*\*\s*(.*)$/i);
      if (valMatch && currentCheckpoint) {
        const items = valMatch[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        currentCheckpoint.validatedConcepts = items;
        continue;
      }

      // Tutor Insight line
      const insMatch = raw.match(/^\*\*(?:Tutor\s+Insight|Tutor\s+Takeaway|Tutor\s+Feedback):?\*\*\s*(.*)$/i);
      if (insMatch && currentCheckpoint) {
        currentCheckpoint.tutorInsight = insMatch[1].trim();
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

  // Close modal on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="notes-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6 overflow-x-hidden animate-in fade-in duration-150"
    >
      <div className="bg-raised border border-line-soft rounded-2xl sm:rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
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
          <div className="flex items-center gap-1.5 bg-sunken/60 p-1 rounded-xl border border-line-soft text-xs font-medium">
            <button
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
              onClick={() => setActiveTab('raw')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeTab === 'raw'
                  ? 'bg-raised text-ink shadow-sm font-semibold'
                  : 'text-ink-faint hover:text-ink'
              }`}
            >
              <ListChecks className="w-3.5 h-3.5" />
              <span>Checkpoint History</span>
            </button>
            <button
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
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 text-left">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center text-center space-y-4 animate-in fade-in duration-300">
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl bg-ember-500/10 border border-ember-500/25 flex items-center justify-center text-ember-400">
                  <Sparkles className="w-7 h-7 animate-pulse" />
                </div>
                <Loader2 className="w-5 h-5 text-ember-400 animate-spin absolute -top-1 -right-1" />
              </div>
              <div className="space-y-1.5 max-w-sm">
                <h4 className="text-base font-bold text-ink">
                  Auditing Grammar &amp; Synthesizing Notes...
                </h4>
                <p className="text-xs text-ink-faint leading-relaxed">
                  Refining your explanations, checking grammar and spelling typos, and structuring pedagogical takeaways.
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-danger/10 border border-danger/30 text-danger text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : activeTab === 'synthesized' ? (
            <div className="space-y-6">
              {parsedSections.length === 0 ? (
                <div className="text-center py-12 text-ink-faint text-sm">
                  No active recall checkpoints were synthesized for this video.
                </div>
              ) : (
                parsedSections.map((section, sIdx) => {
                  if (section.isRevisit) {
                    return (
                      <div
                        key={`sec-${sIdx}`}
                        className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 sm:p-5 space-y-3"
                      >
                        <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
                          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                          <span>Concepts to Revisit Before Your Exam</span>
                        </div>
                        <p className="text-xs text-ink-muted leading-relaxed">
                          These concepts encountered difficulties during active recall. Review before tests:
                        </p>
                        <ul className="space-y-1.5 pl-2">
                          {section.revisitItems?.map((item, rIdx) => (
                            <li key={rIdx} className="text-xs text-ink flex items-start gap-2">
                              <span className="text-amber-400 font-bold">•</span>
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
                      <div className="flex items-center justify-between gap-2 border-l-4 border-ember-500 pl-3 py-0.5">
                        <h4 className="text-sm sm:text-base font-bold text-ink">{section.title}</h4>
                        {section.timeRange && (
                          <span className="px-2 py-0.5 rounded bg-sunken text-ink-muted font-mono text-[11px] flex-shrink-0">
                            {section.timeRange}
                          </span>
                        )}
                      </div>

                      {/* Checkpoint Cards */}
                      {section.checkpoints.map((cp, cIdx) => (
                        <div
                          key={`cp-${sIdx}-${cIdx}`}
                          className="rounded-2xl border border-line-soft bg-raised shadow-sm overflow-hidden divide-y divide-line-soft"
                        >
                          {/* Checkpoint Question Header */}
                          <div className="p-3 sm:p-4 bg-sunken/40 flex items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-ember-500/10 text-ember-300 border border-ember-500/25">
                                  Checkpoint {cIdx + 1}
                                </span>
                                {cp.status === 'mastered' && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-success/10 text-success border border-success/25">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Mastered
                                  </span>
                                )}
                                {cp.status === 'needs_review' && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/25">
                                    <AlertTriangle className="w-3 h-3" />
                                    Needs Review
                                  </span>
                                )}
                              </div>
                              <p className="text-xs sm:text-sm font-medium text-ink leading-relaxed">
                                {cp.question}
                              </p>
                            </div>
                          </div>

                          {/* Student's Grammar-Refined Articulation */}
                          {cp.explanation && (
                            <div className="p-3 sm:p-4 bg-raised space-y-1.5">
                              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ember-400">
                                <Sparkles className="w-3.5 h-3.5 text-ember-400" />
                                <span>Your Articulation (Grammar Refined)</span>
                              </div>
                              <p className="text-xs sm:text-sm text-ink leading-relaxed bg-sunken/20 p-2.5 rounded-xl border border-line-soft">
                                {cp.explanation}
                              </p>
                            </div>
                          )}

                          {/* Validated Concepts Chips */}
                          {cp.validatedConcepts.length > 0 && (
                            <div className="px-3 sm:px-4 py-2.5 bg-success/5 flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] font-bold text-success flex items-center gap-1 mr-1">
                                <Check className="w-3 h-3" />
                                Validated:
                              </span>
                              {cp.validatedConcepts.map((vConcept, vIdx) => (
                                <span
                                  key={vIdx}
                                  className="px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-medium bg-success/15 text-success border border-success/25"
                                >
                                  {vConcept}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Tutor Insight */}
                          {cp.tutorInsight && (
                            <div className="p-3 sm:p-4 bg-ember-500/5 space-y-1 border-t border-line-soft">
                              <span className="text-[11px] font-semibold text-ember-400 block">
                                💡 Tutor Insight:
                              </span>
                              <p className="text-xs text-ink-muted leading-relaxed italic">
                                {cp.tutorInsight}
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
                Showing the raw checkpoint attempts recorded during your video study session.
              </div>

              {segmentsWithQa.map(({ seg, items }) => (
                <section key={seg.segment_id} className="space-y-3">
                  <div className="flex items-center justify-between gap-2 border-l-4 border-line-soft pl-3">
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
                          Checkpoint {i + 1}
                        </span>
                        <p className="text-sm text-ink leading-relaxed">{item.question}</p>
                      </div>
                      <div className="border-t border-line-soft pt-3 space-y-1">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-success/10 text-success border border-success/25">
                          Raw Answer
                        </span>
                        <p className="text-sm text-ink-muted leading-relaxed">
                          {item.user_final_answer}
                        </p>
                      </div>
                      {item.ai_feedback && (
                        <div className="text-xs text-ink-faint border-t border-line-soft pt-2">
                          <b>Tutor Feedback:</b> {item.ai_feedback}
                        </div>
                      )}
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
          <div className="text-xs text-ink-faint">
            {qaHistory.length} active recall checkpoint(s) synthesized
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
      </div>
    </div>
  );
};
