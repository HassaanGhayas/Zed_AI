import React, { useCallback, useState } from 'react';
import {
  Brain,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  Loader2,
  Sparkles,
  FileCheck,
  Lightbulb,
  Mic,
  Volume2,
  VolumeX,
  AudioLines,
  AlertTriangle,
  Flame,
} from 'lucide-react';
import type { Segment, Question, AnswerEvaluation, AttemptHistoryItem } from '../types';
import { evaluateAnswer, transcribeAudio } from '../lib/api';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';

interface SocraticQuizProps {
  videoId: string;
  activeSegment: Segment;
  activeQuestionIndex: number;
  isPausedForQuiz: boolean;
  isLastSegment: boolean;
  isLastQuestion: boolean;
  onQuestionCompleted: (
    userAnswer: string,
    aiFeedback: string,
    attempts: number,
    needsReview?: boolean,
    score?: number,
    understood?: string[],
    missing?: string[],
    misconceptions?: string[]
  ) => void;
  onProceedToNextTopic: () => void;
  onOpenNotes: () => void;
}

export const SocraticQuiz: React.FC<SocraticQuizProps> = ({
  videoId,
  activeSegment,
  activeQuestionIndex,
  isPausedForQuiz,
  isLastSegment,
  isLastQuestion,
  onQuestionCompleted,
  onProceedToNextTopic,
  onOpenNotes,
}) => {
  const currentQuestion: Question | undefined =
    activeSegment.questions[activeQuestionIndex] || activeSegment.questions[0];

  const [userAnswer, setUserAnswer] = useState('');
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationResult, setEvaluationResult] = useState<AnswerEvaluation | null>(null);
  const [attemptCount, setAttemptCount] = useState(1);
  const [attemptHistory, setAttemptHistory] = useState<AttemptHistoryItem[]>([]);
  const [activeGuidedPrompt, setActiveGuidedPrompt] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Voice: narrate the question aloud (TTS) + dictate the answer (STT)
  const tts = useSpeechSynthesis();
  const appendTranscript = useCallback((text: string) => {
    setUserAnswer((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
  }, []);
  const transcribeClip = useCallback((blob: Blob) => transcribeAudio(blob), []);
  const stt = useSpeechRecognition(appendTranscript, transcribeClip);

  const [autoRead, setAutoRead] = useState(() => {
    try {
      return localStorage.getItem('mindflow-auto-read') !== '0';
    } catch {
      return true;
    }
  });
  const toggleAutoRead = () => {
    const next = !autoRead;
    setAutoRead(next);
    if (!next) tts.cancel();
    try {
      localStorage.setItem('mindflow-auto-read', next ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  };
  // Silence narration while the mic is live so the TTS audio isn't transcribed
  const handleMicToggle = () => {
    if (!stt.isListening) tts.cancel();
    stt.toggle();
  };

  // Reset state when question changes
  React.useEffect(() => {
    setUserAnswer('');
    setEvaluationResult(null);
    setAttemptCount(1);
    setAttemptHistory([]);
    setActiveGuidedPrompt(null);
    setShowHint(false);
    setErrorMessage('');
    stt.stop();
  }, [activeSegment.segment_id, activeQuestionIndex]);

  // Auto-narrate each new question or retry prompt when enabled
  const promptToSpeak = activeGuidedPrompt || currentQuestion?.prompt;
  React.useEffect(() => {
    if (!autoRead || !promptToSpeak) return;
    tts.speak(promptToSpeak);
    return () => tts.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSegment.segment_id, activeQuestionIndex, activeGuidedPrompt, autoRead]);

  if (!currentQuestion) {
    return (
      <div className="p-6 text-center text-ink-faint bg-raised border border-line-soft rounded-2xl">
        No active recall questions found for this segment.
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    stt.stop();
    tts.cancel();
    if (!userAnswer.trim()) {
      setErrorMessage('Please type your explanation before submitting.');
      return;
    }

    setErrorMessage('');
    setIsEvaluating(true);

    try {
      const res = await evaluateAnswer({
        video_id: videoId,
        segment_id: activeSegment.segment_id,
        question_id: currentQuestion.id,
        question_prompt: currentQuestion.prompt,
        expected_concept: currentQuestion.expected_concept,
        segment_summary: activeSegment.summary,
        segment_transcript: activeSegment.summary,
        user_answer: userAnswer.trim(),
        attempt_count: attemptCount,
        attempt_history: attemptHistory,
        current_question_prompt: activeGuidedPrompt || currentQuestion.prompt,
      });

      setEvaluationResult(res);

      const newHistoryItem: AttemptHistoryItem = {
        attempt_number: attemptCount,
        student_answer: userAnswer.trim(),
        verdict: res.status,
        score: res.score,
        feedback: res.feedback,
        understood_concepts: res.understood_concepts,
        missing_concepts: res.missing_concepts,
        misconceptions: res.misconceptions,
      };
      setAttemptHistory((prev) => [...prev, newHistoryItem]);

      if (res.is_correct) {
        onQuestionCompleted(
          userAnswer.trim(),
          res.feedback,
          attemptCount,
          false,
          res.score,
          res.understood_concepts,
          res.missing_concepts,
          res.misconceptions
        );
      } else if (res.can_advance || attemptCount >= 3 || res.needs_review) {
        // Strict 3-attempt ceiling: student fails 3 attempts -> marked Needs Review
        onQuestionCompleted(
          userAnswer.trim(),
          res.feedback,
          attemptCount,
          true,
          res.score,
          res.understood_concepts,
          res.missing_concepts,
          res.misconceptions
        );
      } else {
        // Increment attempt and configure dynamic retry question
        setAttemptCount((prev) => prev + 1);
        if (res.retry_question) {
          setActiveGuidedPrompt(res.retry_question);
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error communicating with evaluation service.');
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleNextAction = () => {
    if (isLastQuestion && isLastSegment) {
      onOpenNotes();
    } else if (isLastQuestion) {
      onProceedToNextTopic();
    } else {
      // Advance to next question in same segment
      onProceedToNextTopic();
    }
  };

  const canAdvance = evaluationResult
    ? evaluationResult.is_correct || evaluationResult.can_advance || attemptCount >= 3 || evaluationResult.needs_review
    : false;

  return (
    <div className="bg-raised border border-line-soft rounded-2xl p-5 sm:p-6 shadow-2xl flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 mb-4 border-b border-line-soft">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-ember-500/10 border border-ember-500/25 text-ember-400 flex items-center justify-center">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink">Active Recall Check</h3>
            <p className="text-[11px] text-ink-faint">
              Question {activeQuestionIndex + 1} of {activeSegment.questions.length} • Attempt #{attemptCount} of 3
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {evaluationResult?.score !== undefined && (
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                evaluationResult.is_correct
                  ? 'bg-success/10 text-success border-success/30'
                  : evaluationResult.score >= 50
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
              }`}
            >
              Score: {evaluationResult.score}/100
            </span>
          )}

          {isPausedForQuiz && (
            <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-warning/10 text-warning border border-warning/25 animate-pulse">
              Video Paused
            </span>
          )}
        </div>
      </div>

      {/* Active Question Prompt Card (Original or Guided Follow-Up) */}
      <div className="p-4 rounded-xl bg-sunken/70 border border-line-soft/90 mb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-ember-400">
              {activeGuidedPrompt ? `Guided Follow-Up (Attempt #${attemptCount})` : 'Conceptual Question'}
            </p>
            {activeGuidedPrompt && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/25">
                Misconception Focus
              </span>
            )}
          </div>
          {tts.supported && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleAutoRead}
                title={autoRead ? 'Auto-read questions: on' : 'Auto-read questions: off'}
                aria-label={autoRead ? 'Disable auto-reading questions' : 'Enable auto-reading questions'}
                aria-pressed={autoRead}
                className={`p-2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border transition-colors cursor-pointer ${
                  autoRead
                    ? 'bg-ember-500/10 border-ember-500/25 text-ember-400'
                    : 'bg-transparent border-line-soft text-ink-faint hover:text-ink-muted'
                }`}
              >
                <AudioLines className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => tts.toggle(promptToSpeak)}
                title={tts.isSpeaking ? 'Stop reading aloud' : 'Read question aloud'}
                aria-label={tts.isSpeaking ? 'Stop reading question aloud' : 'Read question aloud'}
                aria-pressed={tts.isSpeaking}
                className={`p-2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border transition-colors cursor-pointer ${
                  tts.isSpeaking
                    ? 'bg-ember-500/10 border-ember-500/25 text-ember-400 animate-pulse'
                    : 'bg-transparent border-line-soft text-ink-faint hover:text-ink-muted'
                }`}
              >
                {tts.isSpeaking ? (
                  <VolumeX className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
            </div>
          )}
        </div>
        <p className="text-base text-ink font-medium leading-relaxed">
          {promptToSpeak}
        </p>
      </div>

      {/* Hints Accordion */}
      {currentQuestion.hints && currentQuestion.hints.length > 0 && !canAdvance && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowHint(!showHint)}
            className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-warning transition-colors"
          >
            <HelpCircle className="w-3.5 h-3.5 text-warning/80" />
            <span>{showHint ? 'Hide Hint' : 'Need a thinking nudge? (Show Hint)'}</span>
          </button>
          {showHint && (
            <div className="mt-2 p-3 rounded-lg bg-warning/5 border border-warning/20 text-warning/90 text-xs leading-relaxed animate-in fade-in duration-150 flex items-start gap-2">
              <Lightbulb className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{currentQuestion.hints.join(' ')}</span>
            </div>
          )}
        </div>
      )}

      {/* Evaluation Feedback & Conceptual Guidance */}
      {evaluationResult && (
        <div className="space-y-3 mb-4">
          {/* Main Feedback Box */}
          <div
            role="alert"
            aria-live="polite"
            className={`p-4 rounded-xl border animate-in fade-in duration-150 ${
              evaluationResult.is_correct
                ? 'bg-success/10 border-success/30 text-success'
                : evaluationResult.needs_review
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                : 'bg-warning/10 border-warning/30 text-warning'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {evaluationResult.is_correct ? (
                <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
              ) : evaluationResult.needs_review ? (
                <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
              )}
              <div className="text-xs sm:text-sm flex-1">
                <span className="font-bold block mb-1">
                  {evaluationResult.is_correct
                    ? 'Excellent Understanding!'
                    : evaluationResult.needs_review
                    ? 'Checkpoint Complete (Flagged for Review)'
                    : 'Conceptual Refinement:'}
                </span>
                <p className="leading-relaxed text-ink-muted">
                  {evaluationResult.feedback}
                </p>
                {evaluationResult.retry_question && !canAdvance && (
                  <div className="mt-2.5 pt-2 border-t border-warning/20 flex items-start gap-1.5 text-warning/95 font-medium">
                    <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <span><strong>Next focus:</strong> {evaluationResult.retry_question}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Concept Breakdown Chips */}
          <div className="p-3.5 rounded-xl bg-sunken/50 border border-line-soft/80 space-y-2.5">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
              Concept Breakdown
            </h4>

            {/* Understood Concepts */}
            {evaluationResult.understood_concepts?.length > 0 && (
              <div>
                <span className="text-[11px] font-semibold text-success block mb-1.5 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Understood Well:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {evaluationResult.understood_concepts.map((c, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-md text-xs font-medium bg-success/15 border border-success/30 text-success flex items-center gap-1"
                    >
                      <span>✓</span> {c}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Misconceptions Identified */}
            {evaluationResult.misconceptions?.length > 0 && (
              <div>
                <span className="text-[11px] font-semibold text-rose-400 block mb-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Learning Point / Misconception:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {evaluationResult.misconceptions.map((m, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-md text-xs font-medium bg-rose-500/15 border border-rose-500/30 text-rose-300 flex items-center gap-1"
                    >
                      <span>•</span> {m}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Missing Concepts */}
            {evaluationResult.missing_concepts?.length > 0 && (
              <div>
                <span className="text-[11px] font-semibold text-amber-400 block mb-1.5 flex items-center gap-1">
                  <Flame className="w-3.5 h-3.5" /> Next Detail to Consider:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {evaluationResult.missing_concepts.map((m, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-md text-xs font-medium bg-amber-500/15 border border-amber-500/30 text-amber-300 flex items-center gap-1"
                    >
                      <span>•</span> {m}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Answer Form (if still retrying) or Proceed Action Button (if correct or max attempts reached) */}
      {!canAdvance ? (
        <form onSubmit={handleSubmit} className="flex flex-col flex-1">
          <div className="flex-1 mb-3">
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="socratic-answer-textarea" className="block text-xs font-semibold text-ink-faint">
                {activeGuidedPrompt ? 'Your revised explanation:' : 'Explain in your own words:'}
              </label>
              {stt.supported && (
                <button
                  type="button"
                  onClick={handleMicToggle}
                  disabled={isEvaluating || stt.isTranscribing}
                  aria-pressed={stt.isListening}
                  aria-label={stt.isListening ? 'Stop voice recording' : 'Answer by voice'}
                  className={`flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-full text-xs font-semibold border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    stt.isListening
                      ? 'bg-danger/10 border-danger/30 text-danger animate-pulse'
                      : 'bg-sunken border-line-soft text-ink-faint hover:text-ink-muted'
                  }`}
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>
                    {stt.isTranscribing
                      ? 'Transcribing…'
                      : stt.isListening
                        ? stt.mode === 'record'
                          ? 'Recording… tap to stop'
                          : 'Listening… tap to stop'
                        : 'Answer by voice'}
                  </span>
                </button>
              )}
            </div>
            <textarea
              id="socratic-answer-textarea"
              rows={4}
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              disabled={isEvaluating}
              aria-describedby={errorMessage ? 'socratic-answer-error' : undefined}
              placeholder={
                activeGuidedPrompt
                  ? 'Apply the tutor feedback above and give it another shot...'
                  : 'Type your explanation here — or tap the mic and say it. Focus on the core mechanism or cause...'
              }
              className="w-full p-3.5 bg-sunken border border-line/80 rounded-xl text-ink text-sm placeholder-ink-faint focus:outline-none focus:ring-2 focus:ring-ember-500 focus:border-transparent transition-all resize-none disabled:opacity-50"
            />
            {(stt.isListening || stt.isTranscribing) && (
              <p className="mt-1.5 text-[11px] italic text-ink-faint flex items-center gap-1.5" role="status" aria-live="polite">
                <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse flex-shrink-0" />
                {stt.isTranscribing
                  ? 'Transcribing your answer…'
                  : stt.mode === 'record'
                    ? 'Recording — tap stop when you’re done speaking.'
                    : stt.interimText
                      ? `Hearing: “${stt.interimText}”`
                      : 'Listening — speak your explanation…'}
              </p>
            )}
            {stt.error && (
              <p className="mt-1.5 text-xs text-danger flex items-center gap-1" role="alert">
                <AlertCircle className="w-3.5 h-3.5" /> {stt.error}
              </p>
            )}
          </div>

          {errorMessage && (
            <p id="socratic-answer-error" role="alert" className="text-xs text-danger mb-3 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> {errorMessage}</p>
          )}

          <button
            type="submit"
            disabled={isEvaluating || !userAnswer.trim()}
            className="w-full py-3 min-h-[44px] bg-gradient-to-r from-ember-500 to-ember-400 hover:from-ember-400 hover:to-ember-300 text-on-accent font-semibold rounded-xl shadow-lg shadow-ember-500/20 flex items-center justify-center gap-2 text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {isEvaluating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Evaluating Concept...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>{attemptCount > 1 ? `Submit Retry #${attemptCount}` : 'Submit & Validate'}</span>
              </>
            )}
          </button>
        </form>
      ) : (
        <div className="mt-auto pt-3">
          <button
            type="button"
            onClick={handleNextAction}
            className={`w-full py-3.5 font-semibold rounded-xl shadow-lg flex items-center justify-center gap-2 text-sm transition-all cursor-pointer ${
              evaluationResult?.needs_review
                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/25'
                : 'bg-success hover:bg-success/90 text-on-success shadow-success/25'
            }`}
          >
            {isLastQuestion && isLastSegment ? (
              <>
                <FileCheck className="w-4 h-4" />
                <span>All Topics Finished! View Notes & Progress</span>
              </>
            ) : isLastQuestion ? (
              <>
                <span>
                  {evaluationResult?.needs_review
                    ? 'Advance to Next Chapter (Flagged for Review)'
                    : 'Proceed to Next Chapter'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              <>
                <span>
                  {evaluationResult?.needs_review
                    ? 'Next Question (Flagged for Review)'
                    : 'Next Question'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
