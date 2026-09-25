import { useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ClipboardCheck, FileQuestion, LoaderCircle, MessageCircleQuestion, NotebookPen } from "lucide-react";
import { scrollBehavior } from "../lib/motion.js";
import { practiceQuestionCard } from "../lib/tutorInterview.js";
import { practiceGradingPrompt } from "../lib/tutorPractice.js";
import { fitTutorRequest, tutorRequestIssue, tutorRequestLimits } from "../lib/tutorRequest.js";
import "../tutor-practice.css";

// Interview practice (TFEAT-06) loads with the authored bank, only when the
// tutor is in Interview mode or shows graded practice: the offline shell
// keeps none of it. The tutor owns the practice state (per-tab session
// storage) and sends the grading request; these views do the rest.
export { createPracticeKit } from "../lib/tutorInterview.js";

const GRADING_MODE = Object.freeze({ task: "answer_feedback", structured: true });
// Every way a long answer can crowd the rubric out of the request.
const CROWDED = new Set(["prompt-too-long", "source-clipped", "context-too-small", "request-too-large"]);

const addTo = (list, id) => [...list.filter((item) => item !== id), id];

/**
 * Interview practice feedback (TFEAT-06). The authored rubric is the
 * checklist the learner ticks; the model's gaps and credit sit beside it,
 * its score is never shown, and the reference answer stays behind a button.
 * The learner, not the model, decides whether the question goes to the
 * mistake notebook. `cite(text)` renders one model field with its
 * citations, as the tutor renders structured results.
 */
export const RubricFeedback = ({ feedback, question, messageId, answer = "", trackId = "", kit, practice, updatePractice, onSaveMistakes, onFollowUp, cite }) => {
  const [showReference, setShowReference] = useState(false);
  const [status, setStatus] = useState({ status: "idle", message: "" });
  const referenceId = useId();
  const ticks = practice?.ticks[messageId] || [];
  const outcome = practice?.outcomes[messageId] || "";
  const onTick = (index, checked) => updatePractice((current) => {
    const points = new Set(current.ticks[messageId] || []);
    if (checked) points.add(index);
    else points.delete(index);
    return { ...current, ticks: { ...current.ticks, [messageId]: [...points].sort((left, right) => left - right) } };
  });
  // "Missed points" files the question the way a timed track round does.
  const onOutcome = onSaveMistakes && kit && question ? async (next) => {
    const result = next === "missed"
      ? await onSaveMistakes([kit.missDraft(question, { answer, trackId: question.trackIds.includes(trackId) ? trackId : question.trackIds[0] })])
      : null;
    updatePractice((current) => ({ ...current, outcomes: { ...current.outcomes, [messageId]: next } }));
    return result;
  } : undefined;
  const ticked = new Set(ticks);
  const allTicked = Boolean(question?.rubric.length) && question.rubric.every((_, index) => ticked.has(index));
  const decided = outcome || (status.status === "saving" ? "saving" : "");
  const choose = async (next) => {
    if (decided || !onOutcome) return;
    setStatus({ status: "saving", message: next === "missed" ? "Logging this question…" : "" });
    try {
      const result = await onOutcome(next);
      setStatus({
        status: "saved",
        message: next === "covered"
          ? "Marked as covered."
          : result?.merged ? "This question was already in your mistake notebook, so its count went up." : "Logged to your mistake notebook. It comes first in your next interview round.",
      });
    } catch (error) {
      const reason = error instanceof Error && error.message ? ` ${error.message.replace(/\.?$/, ".")}` : "";
      setStatus({ status: "error", message: `This question was not logged.${reason} Try again.` });
    }
  };
  const decidedMessage = status.message || (outcome === "missed" ? "Logged to your mistake notebook." : outcome === "covered" ? "Marked as covered." : "");
  return (
    <div className="ai-tutor__rubric-result">
      <div className="ai-tutor__result-title"><ClipboardCheck size={20} aria-hidden="true" /><div><h4>Interview practice feedback</h4>{question && <p>{question.prompt}</p>}</div></div>
      <p className="ai-tutor__rubric-caption">AI feedback can be generous; trust the rubric.</p>
      {question ? (
        <fieldset className="ai-tutor__rubric">
          <legend>Rubric</legend>
          <p>Tick each point your answer covered.</p>
          {question.rubric.map((bullet, index) => (
            <label key={`${index}-${bullet}`}>
              <input type="checkbox" checked={ticked.has(index)} onChange={(event) => onTick?.(index, event.target.checked)} />
              <span>{bullet}</span>
            </label>
          ))}
        </fieldset>
      ) : <p className="ai-tutor__muted">The rubric for this question is not in this version of Lumen.</p>}
      {feedback.gaps.length > 0 && <section><h5>You may have missed</h5><ul>{feedback.gaps.map((gap, index) => <li key={`${index}-${gap}`}>{cite(gap)}</li>)}</ul></section>}
      {feedback.strengths.length > 0 && <section><h5>What you covered</h5><ul>{feedback.strengths.map((item, index) => <li key={`${index}-${item}`}>{cite(item)}</li>)}</ul></section>}
      <section><h5>Feedback</h5><p>{cite(feedback.feedback)}</p></section>
      <button className="ai-tutor__text-button ai-tutor__rubric-toggle" type="button" aria-expanded={showReference} aria-controls={referenceId} onClick={() => setShowReference((open) => !open)}>{showReference ? "Hide reference answer" : "Show reference answer"}<ChevronDown size={16} aria-hidden="true" /></button>
      <div id={referenceId} className="ai-tutor__rubric-reference" hidden={!showReference}>
        {showReference && <>
          {question && <section><h5>Reference answer</h5><p>{question.modelAnswer}</p></section>}
          <section><h5>A stronger version of your answer</h5><p>{cite(feedback.improvedAnswer)}</p></section>
        </>}
      </div>
      {question?.followUps.length > 0 && onFollowUp && (
        <section className="ai-tutor__rubric-next">
          <h5>Next question</h5>
          <ul>{question.followUps.map((followUp) => (
            <li key={followUp}><p>{followUp}</p><button className="ai-tutor__button ai-tutor__button--secondary" type="button" onClick={() => onFollowUp(followUp)}><MessageCircleQuestion size={16} aria-hidden="true" /> Answer this</button></li>
          ))}</ul>
        </section>
      )}
      {question && onOutcome && (
        <div className="ai-tutor__rubric-outcome" role="group" aria-label="How did your answer do?">
          <button className={`ai-tutor__button ${allTicked ? "ai-tutor__button--secondary" : "ai-tutor__button--primary"}`} type="button" aria-disabled={Boolean(decided) || undefined} onClick={() => choose("missed")}>{outcome === "missed" ? <Check size={16} aria-hidden="true" /> : <NotebookPen size={16} aria-hidden="true" />} Missed points, log to mistake notebook</button>
          <button className={`ai-tutor__button ${allTicked ? "ai-tutor__button--primary" : "ai-tutor__button--secondary"}`} type="button" aria-disabled={Boolean(decided) || undefined} onClick={() => choose("covered")}>{outcome === "covered" ? <Check size={16} aria-hidden="true" /> : null} Covered it</button>
        </div>
      )}
      {decidedMessage && <p className={`ai-tutor__draft-status is-${status.status === "error" ? "error" : "saved"}`} role="status">{decidedMessage}</p>}
    </div>
  );
};

/**
 * Practise an authored interview question (TFEAT-06): pick a track, get the
 * next question (ones missed before come first), answer it here and grade it
 * against its rubric. Only the question is on the page before grading. The
 * answer's own request is fitted as Grade will fit it, so an answer that
 * would crowd out any of the rubric is stopped here with the reason.
 *
 * `blocked` is why the tutor cannot grade at all right now; `onGrade(
 * { prompt, reference })` sends the request; `onQuestion` runs when a new
 * question is shown.
 */
export const InterviewPractice = ({ kit, practice, updatePractice, mistakes = [], request, citationNumberFor, blocked = "", busy, onGrade, onQuestion }) => {
  const titleId = useId();
  const promptId = useId();
  const answerId = useId();
  const counterId = useId();
  const reasonId = useId();
  const headingRef = useRef(null);
  const tracks = kit.tracks;
  const trackId = tracks.some((track) => track.id === practice.trackId) ? practice.trackId : tracks[0]?.id || "";
  const question = kit.questions.get(practice.questionId) || null;
  const answer = practice.answer;
  const grading = busy && Boolean(practice.pendingId);
  const { config, responseProfile, difficulty } = request;
  const { promptLimit } = tutorRequestLimits(config, responseProfile);
  const answerLimit = question ? Math.max(0, promptLimit - practiceGradingPrompt(question, "").length) : 0;
  const reference = useMemo(() => (question ? kit.reference(question) : null), [kit, question]);
  const issue = useMemo(() => {
    if (!reference || !answer.trim()) return "";
    const prompt = practiceGradingPrompt(question, answer);
    const sources = [{ ...reference, citationNumber: citationNumberFor(reference.id) }];
    const fitted = fitTutorRequest({ mode: GRADING_MODE, prompt, sources, difficulty, responseProfile, config });
    return tutorRequestIssue({ prompt, promptLimit, fitted, sources, requireAllSources: true, requireWholeSources: true });
  }, [answer, citationNumberFor, config, difficulty, promptLimit, question, reference, responseProfile]);
  const reason = !question ? "" : blocked || (CROWDED.has(issue) ? "Shorten your answer so the rubric can be included." : "");
  const card = question ? practiceQuestionCard(question) : null;
  const ready = Boolean(card && answer.trim() && !reason && !busy);
  // The new question takes focus so it is read; the answer box is next.
  const next = (skip) => {
    if (busy) return;
    const chosen = kit.next({ trackId, mistakes, practiced: practice.practiced, skip: skip ? practice.questionId : "" });
    if (!chosen) return;
    onQuestion?.();
    updatePractice((current) => ({
      ...current,
      trackId,
      questionId: chosen.id,
      answer: "",
      pendingId: "",
      practiced: skip && current.questionId ? addTo(current.practiced, current.questionId) : current.practiced,
    }));
    window.setTimeout(() => {
      const heading = headingRef.current;
      if (!heading?.isConnected) return;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
    }, 0);
  };
  return (
    <section className="ai-tutor__practice" aria-labelledby={titleId}>
      <div className="ai-tutor__practice-head">
        <h3 id={titleId} ref={headingRef} tabIndex={-1}>{card ? "Practice question" : "Practice an authored question"}</h3>
        <label className="ai-tutor__practice-track"><span>Track</span><select value={trackId} disabled={busy} onChange={(event) => updatePractice((current) => ({ ...current, trackId: event.target.value }))}>{tracks.map((track) => <option value={track.id} key={track.id}>{track.label}</option>)}</select></label>
      </div>
      {!card ? (
        <>
          <p className="ai-tutor__practice-intro">Questions from Lumen&rsquo;s interview tracks, graded against their authored rubrics. Questions you missed before come first.</p>
          <button className="ai-tutor__button ai-tutor__button--primary" type="button" disabled={busy} onClick={() => next(false)}><FileQuestion size={16} aria-hidden="true" /> Next question</button>
        </>
      ) : (
        <>
          <p className="ai-tutor__practice-meta">{card.meta}</p>
          <p className="ai-tutor__practice-prompt" id={promptId}>{card.prompt}</p>
          <label className="ai-tutor__practice-label" htmlFor={answerId}>Your answer</label>
          <textarea id={answerId} value={answer} maxLength={answerLimit} rows={5} disabled={grading} aria-describedby={`${promptId} ${counterId}${reason ? ` ${reasonId}` : ""}`} placeholder="Answer as you would in the interview…" onChange={(event) => updatePractice((current) => ({ ...current, answer: event.target.value }))} />
          <div className="ai-tutor__practice-actions">
            <button className="ai-tutor__button ai-tutor__button--primary" type="button" disabled={!ready} onClick={() => onGrade({ prompt: practiceGradingPrompt(question, answer), reference })}>{grading ? <><LoaderCircle className="ai-tutor__spin" size={16} aria-hidden="true" /> Grading…</> : <><ClipboardCheck size={16} aria-hidden="true" /> Grade against rubric</>}</button>
            <button className="ai-tutor__button ai-tutor__button--secondary" type="button" disabled={busy} onClick={() => next(true)}>Skip question</button>
            <span className="ai-tutor__character-count" id={counterId}>{answer.trim().length.toLocaleString()} / {answerLimit.toLocaleString()}<span className="visually-hidden"> characters</span></span>
          </div>
          {reason && <p className="ai-tutor__practice-reason" id={reasonId}>{reason}</p>}
        </>
      )}
    </section>
  );
};
