import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { renderPhoneTutorInlineMarkdown } from "../lib/phoneTutorMarkdown.js";
import { useTutorMath } from "../hooks/useTutorMath.js";
import "../phone-tutor-results.css";

// On-device Lite's quiz, flashcard and study-plan views. The tutor loads
// them with the model, or when a structured mode is used, off the offline
// shell: route screens have a fixed install budget, and like the model's
// runtime they are cached for offline use once loaded (#94).

/**
 * Renders a structured string field (quiz option, card side, plan step) as
 * sanitized inline Markdown: KaTeX math, emphasis, code spans, and the same
 * navigable [S#]/[W#] citation controls the prose surface produces.
 */
const InlineFieldCitations = ({ text, sources = [], citations = [], onNavigateSource }) => {
  const math = useTutorMath();
  const markup = useMemo(() => ({ __html: renderPhoneTutorInlineMarkdown(text, sources, citations) }), [citations, math, sources, text]); // eslint-disable-line react-hooks/exhaustive-deps
  const handleClick = (event) => {
    const citationButton = event.target.closest?.("[data-ai-citation]");
    if (!citationButton) return;
    // A citation inside a quiz option label must not also pick that option.
    event.preventDefault();
    const requested = Number(citationButton.dataset.aiCitation?.match(/^S(\d+)$/)?.[1]);
    const source = Number.isSafeInteger(requested)
      ? sources.find((candidate, index) => (Number.isSafeInteger(candidate?.citationNumber) ? candidate.citationNumber : index + 1) === requested)
      : null;
    if (source) onNavigateSource?.(source.original || source, { sourceId: source.id, anchor: source.anchor });
  };
  // renderPhoneTutorInlineMarkdown shows model-authored HTML as text, then sanitizes with DOMPurify.
  return <span className="phone-tutor__inline-md" onClick={handleClick} dangerouslySetInnerHTML={markup} />;
};

export const QuizResult = ({ quiz, messageId, sources = [], citations = [], onNavigateSource }) => {
  const [answers, setAnswers] = useState({});
  const [revealed, setRevealed] = useState({});
  // "Check answer" is replaced by its feedback; focus follows it there.
  const focusFeedbackRef = useRef("");
  const cite = (text) => <InlineFieldCitations text={text} sources={sources} citations={citations} onNavigateSource={onNavigateSource} />;
  return (
    <div className="phone-tutor__quiz">
      <h4>{quiz.title}</h4><p>{cite(quiz.instructions)}</p>
      {quiz.questions.map((question, questionIndex) => (
        <fieldset key={question.id}>
          <legend><span className="phone-tutor__quiz-number">{questionIndex + 1}.</span> {cite(question.prompt)}</legend>
          {question.options.map((option, optionIndex) => {
            const checked = answers[question.id] === optionIndex;
            const open = revealed[question.id];
            const correct = optionIndex === question.correctIndex;
            const mark = open && correct ? (checked ? "Your answer · correct" : "Correct answer") : open && checked ? "Your answer · incorrect" : "";
            return <label className={open && correct ? "is-correct" : open && checked ? "is-incorrect" : ""} key={`${question.id}-${optionIndex}`}><input type="radio" name={`${messageId}-${question.id}`} checked={checked} disabled={open} onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))} /><span><strong>{String.fromCharCode(65 + optionIndex)}.</strong> {cite(option)}{mark && <small className="phone-tutor__option-mark">{mark}</small>}</span></label>;
          })}
          {!revealed[question.id] ? <button type="button" disabled={!Number.isSafeInteger(answers[question.id])} onClick={() => { focusFeedbackRef.current = question.id; setRevealed((current) => ({ ...current, [question.id]: true })); }}>Check answer</button> : <div className="phone-tutor__quiz-feedback" tabIndex={-1} ref={(node) => { if (node && focusFeedbackRef.current === question.id) { focusFeedbackRef.current = ""; node.focus({ preventScroll: true }); } }}><strong>{answers[question.id] === question.correctIndex ? `Correct — ${String.fromCharCode(65 + question.correctIndex)} is right.` : `Not quite — the correct answer is ${String.fromCharCode(65 + question.correctIndex)}.`}</strong><p>{cite(question.explanation)}</p></div>}
        </fieldset>
      ))}
    </div>
  );
};

export const FlashcardResult = ({ cards, message, onCreateFlashcardDrafts, onNavigateSource }) => {
  const [selected, setSelected] = useState(() => cards.map((_, index) => index));
  const [revealed, setRevealed] = useState({});
  const [saveState, setSaveState] = useState({ status: "idle", message: "" });
  const save = async () => {
    if (!onCreateFlashcardDrafts || !selected.length || ["saving", "saved", "exists"].includes(saveState.status)) return;
    const chosen = selected.map((index) => cards[index]);
    setSaveState({ status: "saving", message: "Adding selected cards…" });
    try {
      const result = await onCreateFlashcardDrafts(chosen, {
        mode: "on-device-flashcards",
        sourceIds: message.sources.map((source) => source.documentId || source.id).filter(Boolean),
        webCitationStyle: "explicit-w",
        webSources: message.citations.map(({ index, title, url }) => ({ index, title, url })),
      });
      const added = Number.isSafeInteger(result?.added) ? result.added : chosen.length;
      const skipped = Number.isSafeInteger(result?.skipped) ? result.skipped : 0;
      if (!added && skipped) setSaveState({ status: "exists", message: "Already in Review: these cards are in your deck." });
      else setSaveState({ status: "saved", message: `${added} card${added === 1 ? "" : "s"} added to review${skipped ? `; ${skipped} already in Review` : ""}.` });
    } catch (error) {
      setSaveState({ status: "error", message: `Cards were not saved.${error instanceof Error && error.message ? ` ${error.message.replace(/\.?$/, ".")}` : ""} Your selection is still available to retry.` });
    }
  };
  const changeSelection = (update) => {
    setSelected(update);
    setSaveState((current) => current.status === "saving" ? current : { status: "idle", message: "" });
  };
  return (
    <div className="phone-tutor__flashcards">
      <div className="phone-tutor__flashcard-head"><strong>{selected.length}/{cards.length} selected</strong><button type="button" onClick={() => changeSelection(selected.length === cards.length ? [] : cards.map((_, index) => index))}>{selected.length === cards.length ? "Clear" : "Select all"}</button></div>
      {cards.map((card, index) => <article key={`${message.id}-card-${index}`}>
        <label><input type="checkbox" checked={selected.includes(index)} onChange={() => changeSelection((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index])} /><span>Select card {index + 1}</span></label>
        <small>Prompt</small><p><InlineFieldCitations text={card.front} sources={message.sources} citations={message.citations} onNavigateSource={onNavigateSource} /></p>
        <button type="button" aria-expanded={Boolean(revealed[index])} onClick={() => setRevealed((current) => ({ ...current, [index]: !current[index] }))}>{revealed[index] ? "Hide answer" : "Reveal answer"}<ChevronDown size={15} aria-hidden="true" /></button>
        {revealed[index] && <div className="phone-tutor__card-answer"><small>Answer</small><p><InlineFieldCitations text={card.back} sources={message.sources} citations={message.citations} onNavigateSource={onNavigateSource} /></p>{card.hint && <p><strong>Hint:</strong> <InlineFieldCitations text={card.hint} sources={message.sources} citations={message.citations} onNavigateSource={onNavigateSource} /></p>}</div>}
        {card.tags.length > 0 && <div className="phone-tutor__tags">{card.tags.map((tag, tagIndex) => <span key={`${tagIndex}-${tag}`}>{tag}</span>)}</div>}
      </article>)}
      {onCreateFlashcardDrafts && <button className="phone-tutor__primary" type="button" disabled={!selected.length} aria-disabled={["saving", "saved", "exists"].includes(saveState.status) || undefined} onClick={save}><Check size={16} aria-hidden="true" /> {saveState.status === "saved" ? "Added to Review" : saveState.status === "exists" ? "Already in Review" : "Add selected to review"}</button>}
      {saveState.message && <p className={`phone-tutor__save-status is-${saveState.status}`} role="status">{saveState.message}</p>}
    </div>
  );
};

export const StudyPlanResult = ({ plan, sources = [], citations = [], onNavigateSource }) => {
  const cite = (text) => <InlineFieldCitations text={text} sources={sources} citations={citations} onNavigateSource={onNavigateSource} />;
  return <div className="phone-tutor__plan"><h4>{plan.title}</h4><p>{cite(plan.goal)}</p><ol>{plan.milestones.map((milestone, index) => <li key={`${index}-${milestone.title}`}><h5>{cite(milestone.title)}</h5><small>{milestone.estimatedMinutes} minutes</small><p>{cite(milestone.outcome)}</p><ul>{milestone.activities.map((activity, activityIndex) => <li key={`${activityIndex}-${activity}`}>{cite(activity)}</li>)}</ul><p><strong>Evidence:</strong> {cite(milestone.evidenceOfMastery)}</p></li>)}</ol>{plan.cautions.length > 0 && <div className="phone-tutor__cautions"><strong>Watch for</strong><ul>{plan.cautions.map((caution, index) => <li key={`${index}-${caution}`}>{cite(caution)}</li>)}</ul></div>}</div>;
};
