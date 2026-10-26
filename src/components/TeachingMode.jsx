import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock3, Eye, EyeOff, Expand, Minus, Minimize2, Pause, Play, Plus, Printer, RotateCcw, Square } from "lucide-react";
import { splitTeachingSections } from "../lib/markdown";
import { LINK_NOTICES, linkTarget, teachingSlideForAnchor } from "../lib/links.js";
import { scrollBehavior } from "../lib/motion.js";
import { buildSpeechUnits } from "../lib/speechContent.js";
import { useMermaidDiagrams } from "../lib/useMermaidDiagrams.js";
import { renderReaderMarkdown, useRenderedMarkdown } from "../lib/useRenderedMarkdown.js";
import { useModalDialog } from "../hooks/useModalDialog.js";

const TEACHING_BACKGROUND = [".app-sidebar", ".app-topbar", ".bottom-nav", ".reader-view > :not(.teach-mode)"];
// How a slide's code and tables are read when the Reader passes no choice
// (settings.narrationCode and settings.narrationTables).
const DEFAULT_NARRATION = Object.freeze({ code: "announce", tables: "rows" });

export default function TeachingMode({ title, source, documentId, onClose, onOpenDocument, onNotify, speech, narration = DEFAULT_NARRATION }) {
  const sections = useMemo(() => splitTeachingSections(source), [source]);
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [timerStarted, setTimerStarted] = useState(() => Date.now());
  const [concealed, setConcealed] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [printReady, setPrintReady] = useState(false);
  const articleRef = useRef(null);
  const rootRef = useRef(null);
  const touchStartRef = useRef(null);
  const current = sections[index] || { title, markdown: source };
  const currentHtml = useRenderedMarkdown(current.markdown);
  const currentMarkup = useMemo(() => ({ __html: currentHtml }), [currentHtml]);
  useMermaidDiagrams(articleRef, { contentKey: currentHtml, enabled: !concealed, theme: "dark" });

  // PDF export (TEACH-001): render every section into a print-only document
  // and hand off to the browser's print-to-PDF. The container mounts only for
  // the print pass so 20+ rendered sections never weigh on teaching itself.
  const printDocument = () => {
    setPrintReady(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.print();
      setPrintReady(false);
    }));
  };

  const move = useCallback((direction) => {
    speech.stop();
    setConcealed(false);
    setIndex((value) => Math.max(0, Math.min(sections.length - 1, value + direction)));
  }, [sections.length, speech]);

  const close = useCallback(() => {
    speech.stop();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    onClose();
  }, [onClose, speech]);

  // A link to a heading in this lecture shows its slide and focuses the
  // heading. Each jump is a new object, so a jump within the slide already
  // shown, where the index stays put, still runs the effect.
  const [jump, setJump] = useState(null);
  const jumpedToRef = useRef(null);
  useEffect(() => {
    const article = articleRef.current;
    if (!jump || !article) return;
    // The ordinal counts the slide's source headings. A slide split inside a
    // code fence can render fewer, so the jump falls back to its first, or
    // to the slide itself, and still lands on the right slide.
    const headings = article.querySelectorAll("h2, h3");
    const heading = headings[jump.ordinal] || headings[0] || article;
    heading.setAttribute("tabindex", "-1");
    heading.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    heading.focus({ preventScroll: true });
    jumpedToRef.current = heading;
  }, [jump]);
  const jumpToHeading = (anchor) => {
    const target = teachingSlideForAnchor(sections, anchor);
    if (!target) {
      onNotify?.(LINK_NOTICES.missingSection, "warning");
      return;
    }
    speech.stop();
    setConcealed(false);
    setIndex(target.index);
    setJump(target);
  };

  // A slide's links stay in the app: followed by the browser, a fragment
  // would replace the hash route and a relative URL would leave the app.
  const followLink = (event) => {
    const link = event.target.closest("a[href]");
    if (!link) return;
    const target = linkTarget(documentId, link.getAttribute("href"));
    // A link with a scheme is the browser's to follow (web links open a new tab).
    if (!target) return;
    event.preventDefault();
    if (target.notADocument) onNotify?.(LINK_NOTICES.notADocument, "warning");
    else if (target.documentId && (target.documentId !== documentId || !target.anchor)) {
      // The lecture opens in the Reader, so Teaching Mode ends first. The
      // parent must open it only after this dialog has unmounted, as the
      // Reader's openAfterTeaching does: opened while the dialog's inert
      // background is still applied, focus ends on the Teach button
      // (workflow case "Teaching (h)").
      close();
      onOpenDocument(target.documentId, { anchor: target.anchor });
    } else jumpToHeading(target.anchor);
  };

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - timerStarted) / 1_000)), 1_000);
    return () => clearInterval(timer);
  }, [timerStarted]);

  // Inert background, focus on the narration control (so Space narrates, as
  // a presenter expects), Tab wrap over the controls that are actually
  // rendered (phone hides some), Escape, and focus restore. The control's
  // name changes with its state, so it is found by a stable attribute.
  useModalDialog(true, rootRef, {
    onClose: close,
    background: TEACHING_BACKGROUND,
    initialFocus: (root) => root.querySelector("[data-teach-narrate]"),
  });

  // One persistent control narrates, pauses and resumes (issue #97, NM3):
  // swapping elements dropped focus, and Space on a focused button then did
  // nothing, or on Exit left Teaching Mode. On a failed sentence it is Retry,
  // which replays that sentence.
  const narrateRef = useRef(null);
  const narrating = speech.status === "speaking" || speech.status === "paused" || speech.canRetry;
  const message = speech.notice && speech.notice.code !== "sleep-ended" ? speech.notice : null;
  const narrate = () => {
    if (narrating) {
      speech.togglePause();
      return;
    }
    // The slide is read as the Reader reads a lecture: sentence by sentence,
    // its formulas, tables, code and diagrams as the learner's settings say.
    // Hidden for recall, the slide is not on the page, so its markup is read
    // from an inert template (it loads no images and runs nothing).
    let root = articleRef.current;
    if (concealed || !root) {
      const template = document.createElement("template");
      template.innerHTML = renderReaderMarkdown(current.markdown);
      root = template.content;
    }
    const units = buildSpeechUnits(root, narration);
    speech.speak(units.length ? units : "", { label: `Teaching section ${index + 1}` });
  };
  // Stop leaves once narration ends (tapped or finished); focus that was on
  // it returns to the narration control. A stable callback, so re-renders
  // (the timer ticks every second) do not detach it.
  const stopButtonRef = useRef(null);
  const trackStopButton = useCallback((node) => {
    if (node) stopButtonRef.current = node;
    else if (stopButtonRef.current === document.activeElement) queueMicrotask(() => narrateRef.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    const handleKey = (event) => {
      // Arrow keys belong to the section picker and to focused scrollers
      // (wide code, tables, diagrams) rather than to section navigation.
      if (event.target.closest?.("select, input, textarea, pre, .table-scroll, .diagram-shell")) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") move(1);
      else if (event.key === "ArrowLeft" || event.key === "PageUp") move(-1);
      else if (event.key === " " && (event.target === document.body || event.target === jumpedToRef.current)) {
        // After a tap on the slide focus is on the page, and after a link jump
        // on the heading. Neither is a control, so Space still narrates.
        event.preventDefault();
        narrate();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  const canFullscreen = Boolean(document.documentElement.requestFullscreen);

  return (
    <div ref={rootRef} className="teach-mode" role="dialog" aria-modal="true" aria-label={`Teaching mode: ${title}`}>
      <header className="teach-header">
        <div>
          <span className="eyebrow">Teaching mode · {index + 1} of {sections.length}</span>
          <strong>{title}</strong>
        </div>
        <div className="teach-header-actions"><span className="teach-timer" aria-label={`Teaching time ${Math.floor(elapsed / 60)} minutes ${elapsed % 60} seconds`}><Clock3 size={14} aria-hidden="true" /> {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span><select className="ui-select" value={index} onChange={(event) => { speech.stop(); setIndex(Number(event.target.value)); }} aria-label="Jump to teaching section">{sections.map((section, sectionIndex) => <option value={sectionIndex} key={`${section.title}-${sectionIndex}`}>{sectionIndex + 1}. {section.title}</option>)}</select><button className="icon-button inverse" onClick={printDocument} aria-label="Print or save as PDF" title="Print all sections / save as PDF" type="button"><Printer size={19} /></button>{canFullscreen && <button className="icon-button inverse" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} aria-label="Enter fullscreen" type="button"><Expand size={19} /></button>}<button className="icon-button inverse" onClick={close} aria-label="Exit teaching mode" type="button"><Minimize2 size={21} /></button></div>
      </header>
      <div className="teach-stage" onTouchStart={(event) => { touchStartRef.current = event.touches[0]?.clientX; }} onTouchEnd={(event) => { const start = touchStartRef.current; const end = event.changedTouches[0]?.clientX; if (Number.isFinite(start) && Number.isFinite(end) && Math.abs(end - start) > 55) move(end < start ? 1 : -1); touchStartRef.current = null; }}>
        <div className="teach-card">
          <div className="teach-section-label">Section {String(index + 1).padStart(2, "0")} · {current.title}</div>
          {concealed ? <div className="teach-recall"><EyeOff size={34} /><span className="eyebrow">Active recall</span><h2>{current.title}</h2><p>Explain this section from memory. State the intuition, important formula or mechanism, trade-offs, and one production failure mode.</p><button className="button primary" onClick={() => setConcealed(false)} type="button"><Eye size={18} /> Reveal section</button></div> : <article ref={articleRef} className="markdown-body teaching-markdown" style={{ fontSize: `${20 * fontScale}px` }} onClick={followLink} dangerouslySetInnerHTML={currentMarkup} />}
        </div>
      </div>
      <footer className="teach-footer">
        <div className="teach-presenter-tools" role="toolbar" aria-label="Presenter tools"><button onClick={() => setFontScale((value) => Math.max(0.75, Number((value - 0.1).toFixed(2))))} disabled={fontScale <= 0.75} aria-label="Decrease teaching text size" title="Smaller text" type="button"><Minus size={17} /></button><button onClick={() => setFontScale((value) => Math.min(1.5, Number((value + 0.1).toFixed(2))))} disabled={fontScale >= 1.5} aria-label="Increase teaching text size" title="Larger text" type="button"><Plus size={17} /></button><button className={concealed ? "active" : ""} onClick={() => setConcealed((value) => !value)} aria-label={concealed ? "Reveal teaching content" : "Hide teaching content for recall"} title="Toggle active recall" type="button">{concealed ? <Eye size={17} /> : <EyeOff size={17} />}</button><button onClick={() => { setTimerStarted(Date.now()); setElapsed(0); }} aria-label="Reset teaching timer" title="Reset timer" type="button"><RotateCcw size={17} /></button></div>
        <div className="teach-controls">
        <button className="round-control" onClick={() => move(-1)} disabled={index === 0} aria-label="Previous section" type="button">
          <ChevronLeft size={24} />
        </button>
        <button ref={narrateRef} className="round-control primary" onClick={narrate} aria-label={speech.status === "speaking" ? "Pause narration" : speech.canRetry ? "Retry narration" : narrating ? "Resume narration" : "Narrate this section"} data-teach-narrate="" type="button">
          {speech.status === "speaking" ? <Pause size={24} fill="currentColor" /> : speech.canRetry ? <RotateCcw size={22} /> : <Play size={24} fill="currentColor" />}
        </button>
        {narrating && <button ref={trackStopButton} className="round-control" onClick={speech.stop} aria-label="Stop narration" type="button"><Square size={20} fill="currentColor" /></button>}
        <button className="round-control" onClick={() => move(1)} disabled={index === sections.length - 1} aria-label="Next section" type="button">
          <ChevronRight size={24} />
        </button>
        </div>
        {/* The player is under the slide, so a narration message shows here;
            NarrationAnnouncer (App) reads it (issue #97). */}
        {message && <p className="teach-narration-message">{message.message}</p>}
        <div className="teach-section-progress" role="progressbar" aria-label="Teaching progress" aria-valuemin={1} aria-valuemax={sections.length} aria-valuenow={index + 1} aria-valuetext={`Section ${index + 1} of ${sections.length}`}><span style={{ width: `${((index + 1) / sections.length) * 100}%` }} /></div>
      </footer>
      {printReady && (
        <div className="teach-print-document">
          <h1>{title}</h1>
          {sections.map((section, sectionIndex) => (
            <section key={`${section.title}-${sectionIndex}`}>
              <h2>{sectionIndex + 1}. {section.title}</h2>
              <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderReaderMarkdown(section.markdown) }} />
            </section>
          ))}
          <p className="teach-print-footer">Teaching outline exported from Lumen AI Notes.</p>
        </div>
      )}
    </div>
  );
}
