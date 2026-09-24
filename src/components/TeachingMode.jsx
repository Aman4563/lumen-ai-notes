import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock3, Eye, EyeOff, Expand, Minus, Minimize2, Pause, Play, Plus, Printer, RotateCcw, Square } from "lucide-react";
import { splitTeachingSections } from "../lib/markdown";
import { plainTextFromMarkdown } from "../lib/content";
import { useMermaidDiagrams } from "../lib/useMermaidDiagrams.js";
import { renderReaderMarkdown, useRenderedMarkdown } from "../lib/useRenderedMarkdown.js";
import { useModalDialog } from "../hooks/useModalDialog.js";

const TEACHING_BACKGROUND = [".app-sidebar", ".app-topbar", ".bottom-nav", ".reader-view > :not(.teach-mode)"];

export default function TeachingMode({ title, source, onClose, speech }) {
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

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - timerStarted) / 1_000)), 1_000);
    return () => clearInterval(timer);
  }, [timerStarted]);

  // Inert background, Exit-first focus, Tab wrap over the controls that are
  // actually rendered (phone hides some), Escape, and focus restore.
  useModalDialog(true, rootRef, {
    onClose: close,
    background: TEACHING_BACKGROUND,
    initialFocus: (root) => root.querySelector('button[aria-label="Exit teaching mode"]'),
  });

  useEffect(() => {
    const handleKey = (event) => {
      // Arrow keys belong to the section picker and to focused scrollers
      // (wide code, tables, diagrams) rather than to section navigation.
      if (event.target.closest?.("select, input, textarea, pre, .table-scroll, .diagram-shell")) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") move(1);
      else if (event.key === "ArrowLeft" || event.key === "PageUp") move(-1);
      else if (event.key === " " && event.target === document.body) {
        event.preventDefault();
        if (speech.status === "speaking" || speech.status === "paused") speech.togglePause();
        else speech.speak(plainTextFromMarkdown(current.markdown), { label: `Teaching section ${index + 1}` });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [current.markdown, index, move, speech]);

  const canFullscreen = Boolean(document.documentElement.requestFullscreen);

  return (
    <div ref={rootRef} className="teach-mode" role="dialog" aria-modal="true" aria-label={`Teaching mode: ${title}`}>
      <header className="teach-header">
        <div>
          <span className="eyebrow">Teaching mode · {index + 1} of {sections.length}</span>
          <strong>{title}</strong>
        </div>
        <div className="teach-header-actions"><span className="teach-timer" aria-label={`Teaching time ${Math.floor(elapsed / 60)} minutes ${elapsed % 60} seconds`}><Clock3 size={14} aria-hidden="true" /> {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span><select value={index} onChange={(event) => { speech.stop(); setIndex(Number(event.target.value)); }} aria-label="Jump to teaching section">{sections.map((section, sectionIndex) => <option value={sectionIndex} key={`${section.title}-${sectionIndex}`}>{sectionIndex + 1}. {section.title}</option>)}</select><button className="icon-button inverse" onClick={printDocument} aria-label="Print or save as PDF" title="Print all sections / save as PDF" type="button"><Printer size={19} /></button>{canFullscreen && <button className="icon-button inverse" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} aria-label="Enter fullscreen" type="button"><Expand size={19} /></button>}<button className="icon-button inverse" onClick={close} aria-label="Exit teaching mode" type="button"><Minimize2 size={21} /></button></div>
      </header>
      <main className="teach-stage" onTouchStart={(event) => { touchStartRef.current = event.touches[0]?.clientX; }} onTouchEnd={(event) => { const start = touchStartRef.current; const end = event.changedTouches[0]?.clientX; if (Number.isFinite(start) && Number.isFinite(end) && Math.abs(end - start) > 55) move(end < start ? 1 : -1); touchStartRef.current = null; }}>
        <div className="teach-card">
          <div className="teach-section-label">Section {String(index + 1).padStart(2, "0")} · {current.title}</div>
          {concealed ? <div className="teach-recall"><EyeOff size={34} /><span className="eyebrow">Active recall</span><h2>{current.title}</h2><p>Explain this section from memory. State the intuition, important formula or mechanism, trade-offs, and one production failure mode.</p><button className="button primary" onClick={() => setConcealed(false)} type="button"><Eye size={18} /> Reveal section</button></div> : <article ref={articleRef} className="markdown-body teaching-markdown" style={{ fontSize: `${20 * fontScale}px` }} dangerouslySetInnerHTML={currentMarkup} />}
        </div>
      </main>
      <footer className="teach-footer">
        <div className="teach-presenter-tools" role="toolbar" aria-label="Presenter tools"><button onClick={() => setFontScale((value) => Math.max(0.75, Number((value - 0.1).toFixed(2))))} disabled={fontScale <= 0.75} aria-label="Decrease teaching text size" title="Smaller text" type="button"><Minus size={17} /></button><button onClick={() => setFontScale((value) => Math.min(1.5, Number((value + 0.1).toFixed(2))))} disabled={fontScale >= 1.5} aria-label="Increase teaching text size" title="Larger text" type="button"><Plus size={17} /></button><button className={concealed ? "active" : ""} onClick={() => setConcealed((value) => !value)} aria-label={concealed ? "Reveal teaching content" : "Hide teaching content for recall"} title="Toggle active recall" type="button">{concealed ? <Eye size={17} /> : <EyeOff size={17} />}</button><button onClick={() => { setTimerStarted(Date.now()); setElapsed(0); }} aria-label="Reset teaching timer" title="Reset timer" type="button"><RotateCcw size={17} /></button></div>
        <div className="teach-controls">
        <button className="round-control" onClick={() => move(-1)} disabled={index === 0} aria-label="Previous section" type="button">
          <ChevronLeft size={24} />
        </button>
        {speech.status === "speaking" || speech.status === "paused" ? (
          <>
            <button className="round-control primary" onClick={speech.togglePause} aria-label={speech.status === "paused" ? "Resume" : "Pause"} type="button">
              {speech.status === "paused" ? <Play size={24} fill="currentColor" /> : <Pause size={24} fill="currentColor" />}
            </button>
            <button className="round-control" onClick={speech.stop} aria-label="Stop narration" type="button"><Square size={20} fill="currentColor" /></button>
          </>
        ) : (
          <button className="round-control primary" onClick={() => speech.speak(plainTextFromMarkdown(current.markdown), { label: `Teaching section ${index + 1}` })} aria-label="Narrate this section" type="button">
            <Play size={24} fill="currentColor" />
          </button>
        )}
        <button className="round-control" onClick={() => move(1)} disabled={index === sections.length - 1} aria-label="Next section" type="button">
          <ChevronRight size={24} />
        </button>
        </div>
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
