import React, { useState } from 'react';
import {
  Brain,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ArrowRight,
  Loader2,
  Sparkles,
  FileCheck,
  Lightbulb
} from 'lucide-react';
import type { Segment, Question, AnswerEvaluation } from '../types';
import { evaluateAnswer } from '../lib/api';

interface SocraticQuizProps {
  videoId: string;
  activeSegment: Segment;
  activeQuestionIndex: number;
  isPausedForQuiz: boolean;
  isLastSegment: boolean;
  isLastQuestion: boolean;
  onQuestionCompleted: (userAnswer: string, aiFeedback: string, attempts: number) => void;
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
  const [showHint, setShowHint] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Reset state when question changes
  React.useEffect(() => {
    setUserAnswer('');
    setEvaluationResult(null);
    setAttemptCount(1);
    setShowHint(false);
    setErrorMessage('');
  }, [activeSegment.segment_id, activeQuestionIndex]);

  if (!currentQuestion) {
    return (
      <div className="p-6 text-center text-ink-faint bg-raised border border-line-soft rounded-2xl">
        No active recall questions found for this segment.
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      });

      setEvaluationResult(res);

      if (res.is_correct) {
        onQuestionCompleted(userAnswer.trim(), res.feedback, attemptCount);
      } else {
        setAttemptCount((prev) => prev + 1);
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
              Question {activeQuestionIndex + 1} of {activeSegment.questions.length} • Attempt #{attemptCount}
            </p>
          </div>
        </div>

        {isPausedForQuiz && (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-warning/10 text-warning border border-warning/25 animate-pulse">
            Video Paused
          </span>
        )}
      </div>

      {/* Question Prompt Card */}
      <div className="p-4 rounded-xl bg-sunken/70 border border-line-soft/90 mb-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-ember-400 mb-1">
          Conceptual Question
        </p>
        <p className="text-base text-ink font-medium leading-relaxed">
          {currentQuestion.prompt}
        </p>
      </div>

      {/* Hints Accordion */}
      {currentQuestion.hints && currentQuestion.hints.length > 0 && !evaluationResult?.is_correct && (
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

      {/* Misconception / Clarification Alert */}
      {evaluationResult && !evaluationResult.is_correct && (
        <div className="p-4 rounded-xl bg-warning/10 border border-warning/30 text-warning mb-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm flex-1">
              <span className="font-bold text-warning block mb-1">
                Conceptual Refinement:
              </span>
              <p className="leading-relaxed text-ink-muted">
                {evaluationResult.feedback}
              </p>
              {evaluationResult.follow_up_prompt && (
                <div className="mt-2.5 pt-2 border-t border-warning/20 flex items-start gap-1.5 text-warning/95 font-medium">
                  <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span><strong>Focus on:</strong> {evaluationResult.follow_up_prompt}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Correct Celebration Alert */}
      {evaluationResult && evaluationResult.is_correct && (
        <div className="p-4 rounded-xl bg-success/10 border border-success/30 text-success mb-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0 mt-0.5" />
            <div className="text-xs sm:text-sm">
              <span className="font-bold text-success block mb-1">
                Excellent Understanding!
              </span>
              <p className="leading-relaxed text-ink-muted">
                {evaluationResult.feedback}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Answer Form or Next Action Button */}
      {!evaluationResult?.is_correct ? (
        <form onSubmit={handleSubmit} className="flex flex-col flex-1">
          <div className="flex-1 mb-3">
            <label className="block text-xs font-semibold text-ink-faint mb-2">
              Explain in your own words:
            </label>
            <textarea
              rows={4}
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              disabled={isEvaluating}
              placeholder="Type your explanation here. Focus on the core mechanism or cause..."
              className="w-full p-3.5 bg-sunken border border-line/80 rounded-xl text-ink text-sm placeholder-ink-faint/70 focus:outline-none focus:ring-2 focus:ring-ember-500 focus:border-transparent transition-all resize-none disabled:opacity-50"
            />
          </div>

          {errorMessage && (
            <p className="text-xs text-danger mb-3 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> {errorMessage}</p>
          )}

          <button
            type="submit"
            disabled={isEvaluating || !userAnswer.trim()}
            className="w-full py-3 bg-gradient-to-r from-ember-600 to-ember-500 hover:from-ember-500 hover:to-ember-400 text-on-accent font-semibold rounded-xl shadow-lg shadow-ember-500/20 flex items-center justify-center gap-2 text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {isEvaluating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Evaluating Concept...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Submit & Validate</span>
              </>
            )}
          </button>
        </form>
      ) : (
        <div className="mt-auto pt-3">
          <button
            type="button"
            onClick={handleNextAction}
            className="w-full py-3.5 bg-success hover:bg-success/90 text-on-success font-semibold rounded-xl shadow-lg shadow-success/25 flex items-center justify-center gap-2 text-sm transition-all cursor-pointer"
          >
            {isLastQuestion && isLastSegment ? (
              <>
                <FileCheck className="w-4 h-4" />
                <span>All Topics Mastered! View Notes & Export PDF</span>
              </>
            ) : isLastQuestion ? (
              <>
                <span>Proceed to Next Chapter</span>
                <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              <>
                <span>Next Question</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
