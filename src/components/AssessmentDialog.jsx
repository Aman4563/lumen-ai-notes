import { useEffect, useRef, useState } from "react";
import { BookOpen, CheckCircle2, ChevronRight, ClipboardCheck, Eye, RotateCcw, X } from "lucide-react";
import { gradeAssessmentAnswer, recommendationForAssessment, scoreAssessment } from "../lib/assessment.js";

const FOCUSABLE = "button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])";

/**
 * Readiness-check flow (ASSESS-001/002): intro with evidence, one question at
 * a time (choice / cloze / reveal-then-self-grade), then a result screen with
 * per-category scoring and an advisory recommendation. Every answer with less
 * than full credit is reported to the caller as mistake drafts on finish.
 */
export default function AssessmentDialog({ assessment, onFinish, onClose, onOpenSource }) {
  const [stage, setStage] = useState("intro");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [clozeInputs, setClozeInputs] = useState([]);
  const [choicePick, setChoicePick] = useState("");
  const [numericInput, setNumericInput] = useState("");
  const [revealed, setRevealed] = useState(false);
  const dialogRef = useRef(null);
  const finishedRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector(FOCUSABLE)?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll(FOCUSABLE) || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const target = previous;
      requestAnimationFrame(() => {
        if (target?.isConnected && !target.closest?.("[inert]")) target.focus?.();
      });
    };
  }, []);

  if (!assessment?.ok) return null;
  const { questions, evidence, kind } = assessment;
  const question = questions[index];

  const record = (response, credit) => {
    const nextAnswers = [...answers, { questionId: question.id, response, credit }];
    setAnswers(nextAnswers);
    setChoicePick("");
    setNumericInput("");
    setClozeInputs([]);
    setRevealed(false);
    if (index + 1 < questions.length) {
      setIndex(index + 1);
    } else {
      setStage("result");
      if (!finishedRef.current) {
        finishedRef.current = true;
        onFinish(nextAnswers);
      }
    }
  };

  const submitChoice = () => {
    if (!choicePick) return;
    const graded = gradeAssessmentAnswer(question, choicePick);
    record(choicePick, graded.credit);
  };

  const submitNumeric = () => {
    if (!numericInput.trim()) return;
    const graded = gradeAssessmentAnswer(question, numericInput);
    record(numericInput.trim(), graded.credit);
  };

  const retry = () => {
    // Same frozen questions, a fresh attempt; each finish records separately.
    finishedRef.current = false;
    setAnswers([]);
    setIndex(0);
    setChoicePick("");
    setNumericInput("");
    setClozeInputs([]);
    setRevealed(false);
    setStage("question");
  };

  const submitCloze = () => {
    const responses = question.answerKey.map((_, blankIndex) => clozeInputs[blankIndex] || "");
    const graded = gradeAssessmentAnswer(question, responses);
    record(responses, graded.credit);
  };

  const score = stage === "result" ? scoreAssessment(questions, answers) : null;
  const recommendation = score ? recommendationForAssessment(score.percent, evidence) : null;
  const missedCount = score ? score.missed.length : 0;

  return (
    <div className="modal-layer assessment-layer">
      <button className="modal-scrim" onClick={onClose} aria-label="Close readiness check" type="button" />
      <section ref={dialogRef} className="create-note-dialog assessment-dialog" role="dialog" aria-modal="true" aria-labelledby="assessment-title">
        <button className="icon-button review-dialog-close" onClick={onClose} aria-label="Close readiness check" type="button"><X size={19} /></button>
        <div className="dialog-icon"><ClipboardCheck size={22} /></div>
        <span className="eyebrow">{kind === "mastery" ? "Mastery check" : "Readiness check"} · {evidence.partTitle}</span>

        {stage === "intro" && (
          <>
            <h2 id="assessment-title">Check your readiness</h2>
            <p>{questions.length} questions built from your own review cards in this Part, weakest first. Missed answers land in your mistake notebook; the result is advice, never a gate.</p>
            <dl className="assessment-evidence"><div><dt>Read</dt><dd>{evidence.readPercent}%</dd></div><div><dt>Cards</dt><dd>{evidence.activeCards}</dd></div><div><dt>Open mistakes</dt><dd>{evidence.openMistakes}</dd></div></dl>
            <div className="modal-actions"><button className="button ghost" onClick={onClose} type="button">Not now</button><button className="button primary" onClick={() => setStage("question")} type="button">Start <ChevronRight size={16} /></button></div>
          </>
        )}

        {stage === "question" && question && (
          <>
            <h2 id="assessment-title">Question {index + 1} of {questions.length}</h2>
            <p className="assessment-prompt">{question.type === "cloze" ? question.prompt.replace(/\{\{[^{}]+\}\}/g, "＿＿＿") : question.prompt}</p>

            {question.type === "choice" && (
              <div className="assessment-options" role="radiogroup" aria-label="Answer options">
                {question.options.map((option) => (
                  <button key={option} role="radio" aria-checked={choicePick === option} className={choicePick === option ? "assessment-option active" : "assessment-option"} onClick={() => setChoicePick(option)} type="button">{option}</button>
                ))}
                <button className="button primary" onClick={submitChoice} disabled={!choicePick} type="button">Submit answer</button>
              </div>
            )}

            {question.type === "numeric" && (
              <div className="assessment-numeric">
                <label><span>Your answer (a number)</span><input className="text-input" inputMode="decimal" value={numericInput} onChange={(event) => setNumericInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitNumeric(); }} autoComplete="off" /></label>
                <button className="button primary" onClick={submitNumeric} disabled={!numericInput.trim()} type="button">Submit answer</button>
              </div>
            )}

            {question.type === "cloze" && (
              <div className="assessment-cloze">
                {question.answerKey.map((_, blankIndex) => (
                  <label key={blankIndex}><span>Blank {blankIndex + 1}</span><input className="text-input" value={clozeInputs[blankIndex] || ""} onChange={(event) => setClozeInputs((current) => { const next = [...current]; next[blankIndex] = event.target.value; return next; })} autoComplete="off" /></label>
                ))}
                <button className="button primary" onClick={submitCloze} disabled={!clozeInputs.some((value) => value?.trim())} type="button">Submit answer</button>
              </div>
            )}

            {question.type === "self" && !revealed && (
              <div className="assessment-self">
                <p className="microcopy">Answer out loud or on paper, then reveal the expected answer and grade yourself honestly.</p>
                <button className="button primary" onClick={() => setRevealed(true)} type="button"><Eye size={17} /> Reveal expected answer</button>
              </div>
            )}
            {question.type === "self" && revealed && (
              <div className="assessment-self">
                <blockquote className="assessment-expected">{question.answerKey}</blockquote>
                <div className="assessment-rubric" role="radiogroup" aria-label="Self grade">
                  <button onClick={() => record("self-graded", 0)} type="button">Wrong</button>
                  <button onClick={() => record("self-graded", 0.5)} type="button">Partly right</button>
                  <button onClick={() => record("self-graded", 1)} type="button">Right</button>
                </div>
              </div>
            )}
          </>
        )}

        {stage === "result" && score && (
          <>
            <h2 id="assessment-title">{score.percent}% · {recommendation.action === "skip" ? "Ready to move ahead" : recommendation.action === "review" ? "Solid, with gaps" : "Needs focused study"}</h2>
            <p>{recommendation.reason} {recommendation.nextAction}</p>
            <dl className="assessment-evidence">
              {Object.entries(score.byCategory).map(([category, entry]) => (
                <div key={category}><dt>{category.replace("-", " ")}</dt><dd>{Math.round((entry.credit / entry.total) * 100)}%</dd></div>
              ))}
            </dl>
            {missedCount > 0 && <p className="microcopy"><CheckCircle2 size={14} /> {missedCount} miss{missedCount === 1 ? "" : "es"} added to your mistake notebook for corrective review.</p>}
            {missedCount > 0 && (
              <div className="assessment-missed" aria-label="Missed questions and their source lectures">
                {score.missed.map((questionId) => {
                  const missedQuestion = questions.find((entry) => entry.id === questionId);
                  if (!missedQuestion?.documentId) return null;
                  return <button key={questionId} className="text-button assessment-missed-link" onClick={() => onOpenSource?.(missedQuestion.documentId)} type="button"><BookOpen size={14} /> {missedQuestion.prompt.length > 70 ? `${missedQuestion.prompt.slice(0, 70)}…` : missedQuestion.prompt}</button>;
                })}
              </div>
            )}
            <div className="modal-actions"><button className="button ghost" onClick={retry} type="button"><RotateCcw size={16} /> Retry this check</button><button className="button primary" onClick={onClose} type="button">Done</button></div>
          </>
        )}
      </section>
    </div>
  );
}
