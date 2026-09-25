import { useId, useMemo, useRef, useState } from "react";
import { Check, FileQuestion, Lightbulb, LoaderCircle, MessageCircleQuestion, NotebookPen, X } from "lucide-react";
import { CONFIDENCE_LEVELS, normalizeQuizState, quizMissDrafts, quizSummary } from "../lib/tutorQuiz.js";
import { withoutCitationLabels } from "../lib/tutorFollowUps.js";
import "../tutor-quiz.css";

// The quiz and answer-check views (TFEAT-01) load when the conversation
// first needs them, off the offline shell, like interview practice. The
// tutor keeps the quiz state and the requests; `cite(text, className)`
// renders one model field with its citations, as the tutor renders
// structured results.

const optionLetter = (index) => String.fromCharCode(65 + index);

/**
 * An interactive quiz (TFEAT-01). What the learner chose, how sure they were
 * and what they checked live in the tutor's per-tab quiz state, so leaving
 * #/ai keeps them. Once every question is checked the score is shown and
 * announced once; misses can be explained, saved to the mistake notebook or
 * turned into a new quiz.
 */
export const QuizResult = ({
  quiz,
  message,
  cite,
  quizState,
  onQuizStateChange,
  onAnnounce,
  explanations = {},
  explainUnavailable = "",
  requestBusy = false,
  onExplainMistake,
  onShowExplanation,
  onSaveMisses,
  onWeakSpotQuiz,
}) => {
  const messageId = message.id;
  const { citationSources } = message;
  const state = useMemo(() => normalizeQuizState(quizState), [quizState]);
  const { answers, checked, confidence } = state;
  const explainReasonId = useId();
  const summaryTitleId = useId();
  const [saveStatus, setSaveStatus] = useState({ status: "idle", message: "" });
  // "Check answer" is replaced by its feedback; focus follows it there.
  const focusFeedbackRef = useRef("");
  const summary = quizSummary(quiz, state);
  const disputed = new Set(Object.entries(explanations).filter(([, explanation]) => explanation.disputed).map(([questionId]) => questionId));
  const documentIds = citationSources.map((source) => source.original?.documentId || source.original?.id || "");
  const unsaved = quizMissDrafts(quiz, state, { documentIds, disputed });
  const savable = summary.misses.filter(({ question }) => !disputed.has(question.id));
  const allSaved = savable.length > 0 && unsaved.length === 0;
  const change = (updater) => onQuizStateChange?.(messageId, updater);
  const check = (question) => {
    focusFeedbackRef.current = question.id;
    const next = { ...state, checked: { ...state.checked, [question.id]: true } };
    const after = quizSummary(quiz, next);
    const announceNow = after.complete && !state.summaryAnnounced;
    change((current) => ({ ...current, checked: { ...current.checked, [question.id]: true }, summaryAnnounced: current.summaryAnnounced || announceNow }));
    // The score is announced once, through the tutor's one status region.
    if (announceNow) onAnnounce?.(`Quiz complete: ${after.correct} of ${after.total} correct.${after.confidentMisses ? ` You were certain about ${after.confidentMisses} of the answers you missed.` : ""}`);
  };
  const saveMisses = async () => {
    if (!onSaveMisses || saveStatus.status === "saving") return;
    if (!unsaved.length) {
      setSaveStatus({ status: "saved", message: "These misses are already in your mistake notebook." });
      return;
    }
    setSaveStatus({ status: "saving", message: "Saving your misses…" });
    try {
      const result = await onSaveMisses(unsaved.map(({ questionId: _questionId, ...draft }) => draft));
      const added = Number.isSafeInteger(result?.added) ? result.added : unsaved.length;
      const merged = Number.isSafeInteger(result?.merged) ? result.merged : 0;
      change((current) => ({ ...current, saved: { ...current.saved, ...Object.fromEntries(unsaved.map((draft) => [draft.questionId, true])) } }));
      const noun = (count) => `${count} miss${count === 1 ? "" : "es"}`;
      setSaveStatus({
        status: "saved",
        message: added && merged
          ? `Saved ${noun(added)} to your mistake notebook. ${merged === 1 ? "One was" : `${merged} were`} already there, so ${merged === 1 ? "its count" : "their counts"} went up.`
          : added
            ? `Saved ${noun(added)} to your mistake notebook. Correct ${added === 1 ? "it" : "them"} in Review.`
            : `${merged === 1 ? "This miss was" : "These misses were"} already in your mistake notebook, so ${merged === 1 ? "its count" : "their counts"} went up.`,
      });
    } catch (error) {
      const reason = error instanceof Error && error.message ? ` ${error.message.replace(/\.?$/, ".")}` : "";
      setSaveStatus({ status: "error", message: `Your misses were not saved.${reason} Try again.` });
    }
  };
  return (
    <div className="ai-tutor__quiz">
      <div className="ai-tutor__result-title"><FileQuestion size={20} aria-hidden="true" /><div><h4>{quiz.title}</h4><p>{cite(quiz.instructions)}</p></div></div>
      {quiz.questions.map((question, questionIndex) => {
        const chosen = answers[question.id];
        const revealed = checked[question.id];
        const correct = chosen === question.correctIndex;
        const answerLetter = optionLetter(question.correctIndex);
        const sure = confidence[question.id] || "";
        const explanation = explanations[question.id];
        return (
          <fieldset className="ai-tutor__quiz-question" key={question.id}>
            <legend><span className="ai-tutor__quiz-number">{questionIndex + 1}</span>{cite(question.prompt, "ai-tutor__quiz-prompt")}</legend>
            <span className="ai-tutor__difficulty-tag">{question.difficulty}</span>
            <div className="ai-tutor__quiz-options">
              {question.options.map((option, optionIndex) => {
                const isCorrect = revealed && optionIndex === question.correctIndex;
                const isIncorrect = revealed && optionIndex === chosen && !correct;
                return (
                  <label className={`${isCorrect ? "is-correct" : ""} ${isIncorrect ? "is-incorrect" : ""}`} key={`${question.id}-${optionIndex}`}>
                    <input
                      type="radio"
                      name={`quiz-${messageId}-${question.id}`}
                      checked={chosen === optionIndex}
                      disabled={revealed}
                      onChange={() => change((current) => ({ ...current, answers: { ...current.answers, [question.id]: optionIndex } }))}
                    />
                    <span className="ai-tutor__quiz-option-text">
                      <span className="ai-tutor__option-letter">{optionLetter(optionIndex)}.</span> {cite(option)}
                      {(isCorrect || isIncorrect) && <span className={`ai-tutor__option-mark ${isCorrect ? "is-correct" : "is-incorrect"}`}>{isCorrect ? <Check size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}<span>{isCorrect ? (optionIndex === chosen ? "Your answer · correct" : "Correct answer") : "Your answer · incorrect"}</span></span>}
                    </span>
                  </label>
                );
              })}
            </div>
            {!revealed && Number.isSafeInteger(chosen) && (
              <fieldset className="ai-tutor__confidence">
                <legend>How sure are you?</legend>
                <div>
                  {CONFIDENCE_LEVELS.map((level) => (
                    <label className={sure === level.id ? "is-active" : ""} key={level.id}>
                      <input type="radio" name={`quiz-${messageId}-${question.id}-confidence`} value={level.id} checked={sure === level.id} onChange={() => change((current) => ({ ...current, confidence: { ...current.confidence, [question.id]: level.id } }))} />
                      <span>{level.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {!revealed ? (
              <button className="ai-tutor__button ai-tutor__button--secondary" type="button" disabled={!Number.isSafeInteger(chosen)} onClick={() => check(question)}>Check answer</button>
            ) : (
              <div
                className={correct ? "ai-tutor__quiz-feedback is-correct" : "ai-tutor__quiz-feedback is-incorrect"}
                tabIndex={-1}
                ref={(node) => {
                  if (!node || focusFeedbackRef.current !== question.id) return;
                  focusFeedbackRef.current = "";
                  node.focus({ preventScroll: true });
                }}
              >
                <strong>{correct ? `Correct — ${answerLetter} is right.` : `Not quite — the correct answer is ${answerLetter}.`}</strong>
                {!correct && sure === "certain" && <p className="ai-tutor__confident-miss">You were certain. A confident miss is the most useful one to fix.</p>}
                <p>{cite(question.explanation)}</p>
                {!correct && explanation?.disputed && <p className="ai-tutor__quiz-dispute">{state.saved[question.id]
                  ? "The answer check disagreed with this key. This miss was saved to your mistake notebook before the check; check the sources before trusting either."
                  : "The answer check disagreed with this key, so it is not saved as a mistake. Check the sources before trusting either."}</p>}
                {!correct && onExplainMistake && (explanation?.answerId ? (
                  <button className="ai-tutor__button ai-tutor__button--secondary" type="button" onClick={() => onShowExplanation?.(explanation.answerId)}>See the explanation</button>
                ) : (
                  <div className="ai-tutor__explain-mistake">
                    <button className="ai-tutor__button ai-tutor__button--secondary" type="button" disabled={requestBusy || Boolean(explainUnavailable)} aria-describedby={explainUnavailable ? explainReasonId : undefined} onClick={() => onExplainMistake(message, question, chosen)}>{explanation?.pending ? <><LoaderCircle className="ai-tutor__spin" size={16} aria-hidden="true" /> Checking your answer…</> : "Explain my mistake"}</button>
                    {explainUnavailable && <small id={explainReasonId}>{explainUnavailable}</small>}
                  </div>
                ))}
              </div>
            )}
          </fieldset>
        );
      })}
      {summary.complete && (
        <section className="ai-tutor__quiz-summary" aria-labelledby={summaryTitleId}>
          <h5 id={summaryTitleId}>{summary.correct} of {summary.total} correct</h5>
          <p>{!summary.misses.length
            ? "Every answer was right."
            : summary.confidentMisses
              ? `You were certain about ${summary.confidentMisses === 1 ? "one answer" : `${summary.confidentMisses} answers`} you missed. Review ${summary.confidentMisses === 1 ? "it" : "those"} first.`
              : `Review the ${summary.misses.length === 1 ? "one" : summary.misses.length} you missed while ${summary.misses.length === 1 ? "it is" : "they are"} fresh.`}</p>
          {summary.misses.length > 0 && (
            <ul className="ai-tutor__quiz-misses">
              {summary.misses.map((miss) => <li key={miss.question.id}><span>Question {miss.index + 1}</span>{miss.confidence === "certain" && <span className="ai-tutor__confident-badge">You were certain</span>}</li>)}
            </ul>
          )}
          {summary.misses.length > 0 && (
            <div className="ai-tutor__quiz-summary-actions">
              {onSaveMisses && savable.length > 0 && <button className="ai-tutor__button ai-tutor__button--secondary" type="button" aria-disabled={allSaved || saveStatus.status === "saving" || undefined} onClick={saveMisses}>{saveStatus.status === "saving" ? <LoaderCircle className="ai-tutor__spin" size={16} aria-hidden="true" /> : allSaved ? <Check size={16} aria-hidden="true" /> : <NotebookPen size={16} aria-hidden="true" />} {allSaved ? "Saved for review" : "Save misses for review"}</button>}
              {onWeakSpotQuiz && <button className="ai-tutor__button ai-tutor__button--secondary" type="button" disabled={requestBusy} onClick={() => onWeakSpotQuiz(message, summary.misses)}><FileQuestion size={16} aria-hidden="true" /> New quiz on my weak spots</button>}
            </div>
          )}
          {saveStatus.message && <p className={`ai-tutor__draft-status is-${saveStatus.status}`} role="status">{saveStatus.message}</p>}
        </section>
      )}
    </div>
  );
};

/**
 * "Explain my mistake" (TFEAT-01): the answer check for one keyed quiz miss.
 * Its score and strengths are not shown (correctness is already known), and
 * the quiz key stays visible above it. A check that sides with the learner
 * says so instead of overruling the key.
 */
export const FeedbackResult = ({ feedback, message, question, cite, onAnswerCheck }) => {
  const evidence = message.citationSources[0];
  return (
    <div className="ai-tutor__feedback">
      <div className="ai-tutor__result-title"><Lightbulb size={20} aria-hidden="true" /><div><h4>Why that answer missed</h4>{question && <p>{withoutCitationLabels(question.prompt)}</p>}</div></div>
      {feedback.correct === true && <p className="ai-tutor__feedback-dispute">The tutor&rsquo;s second look disagrees with the quiz key. {evidence ? <>Check {cite(`[S${evidence.citationNumber}]`)} before trusting either answer.</> : "Check the lesson before trusting either answer."}</p>}
      <section><h5>Why</h5><p>{cite(feedback.feedback)}</p></section>
      {feedback.gaps.length > 0 && <section><h5>What was missing</h5><ul>{feedback.gaps.map((gap, index) => <li key={`${index}-${gap}`}>{cite(gap)}</li>)}</ul></section>}
      <section><h5>Correct reasoning</h5><p>{cite(feedback.improvedAnswer)}</p></section>
      {feedback.nextQuestion && (
        <section className="ai-tutor__feedback-check">
          <h5>Check yourself</h5>
          <p>{cite(feedback.nextQuestion)}</p>
          {onAnswerCheck && <button className="ai-tutor__button ai-tutor__button--secondary" type="button" onClick={() => onAnswerCheck(message, feedback.nextQuestion)}><MessageCircleQuestion size={16} aria-hidden="true" /> Answer this</button>}
        </section>
      )}
    </div>
  );
};

