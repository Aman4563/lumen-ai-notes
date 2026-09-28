import { useEffect, useRef, useState } from "react";
import { Archive, Bookmark, Brain, BrainCircuit, CheckCircle2, ChevronRight, Copy, Download, FileEdit, FilePlus2, Flame, Highlighter, NotebookPen, Pin, RotateCcw, Search, Trash2, Upload, X } from "lucide-react";
import { DocumentCard } from "./DocumentCard.jsx";
import { UndoStrip, withUndoSlot } from "./UndoStrip.jsx";
import { useCommitOnHide } from "../hooks/useCommitOnHide.js";

// The study notebook. It left the startup bundle for its budget (issue #95)
// and is an install-tier route screen, so it opens offline after one visit.

/**
 * Clipping comments keep keystrokes local and commit after a short pause, on
 * blur, on unmount, and before the page hides (REV-19): a profile write per
 * keystroke re-rendered the whole app and could drop keys or hit React's
 * update-depth limit.
 */
function ClippingNoteField({ clip, onCommit }) {
  const [value, setValue] = useState(clip.note || "");
  const focusedRef = useRef(false);
  const draftRef = useRef(null);
  const timerRef = useRef(0);
  const commitRef = useRef(null);
  commitRef.current = () => {
    window.clearTimeout(timerRef.current);
    if (draftRef.current === null) return;
    const next = draftRef.current;
    draftRef.current = null;
    if (next !== (clip.note || "")) onCommit(clip.id, next);
  };
  useCommitOnHide(commitRef);
  useEffect(() => {
    if (!focusedRef.current && draftRef.current === null) setValue(clip.note || "");
  }, [clip.note]);
  useEffect(() => () => commitRef.current(), []);
  return <textarea value={value} maxLength={4_000} onFocus={() => { focusedRef.current = true; }} onChange={(event) => { setValue(event.target.value); draftRef.current = event.target.value; window.clearTimeout(timerRef.current); timerRef.current = window.setTimeout(() => commitRef.current(), 600); }} onBlur={() => { focusedRef.current = false; commitRef.current(); }} placeholder="Add why this matters, a question, or an interview connection…" aria-label="Comment on this clipping" />;
}

export default function NotebookView({ profile, allDocuments, customDocuments, onOpen, onUpload, onCreate, onDeleteCustom, onDuplicateCustom, onDeleteClipping, onRestoreClipping, onUpdateClipping, onCopyClipping, onCreateReview, onCopyAnnotation, onExportAnnotations, onDeleteAnnotation, onRestoreTrash, onDeleteTrash, onManageCustom, onOpenReview, onBatchOrganize, onBatchDelete, onRunLinkAudit, collections: appCollections }) {
  const [notebookQuery, setNotebookQuery] = useState("");
  const [annotationPurpose, setAnnotationPurpose] = useState("all");
  const annotated = Object.entries(profile.personalNotes).filter(([, note]) => note.trim()).map(([id, note]) => ({ doc: allDocuments.find((item) => item.id === id), note })).filter((item) => item.doc);
  const edited = Object.keys(profile.edits).map((id) => allDocuments.find((item) => item.id === id)).filter(Boolean);
  const bookmarked = profile.bookmarks.map((id) => allDocuments.find((item) => item.id === id)).filter(Boolean);
  const normalizedQuery = notebookQuery.trim().toLocaleLowerCase();
  const matches = (...values) => !normalizedQuery || values.some((value) => String(value || "").toLocaleLowerCase().includes(normalizedQuery));
  const [collectionFilter, setCollectionFilter] = useState("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [linkReport, setLinkReport] = useState(null);
  const [removedClipping, setRemovedClipping] = useState(null);
  const clippingSectionRef = useRef(null);
  const removeClipping = (clip) => {
    const index = profile.clippings.findIndex((entry) => entry.id === clip.id);
    onDeleteClipping(clip.id);
    setRemovedClipping(onRestoreClipping ? { clip, index } : null);
  };
  const undoRemoveClipping = () => {
    if (!removedClipping) return;
    const { clip, index } = removedClipping;
    onRestoreClipping(clip, index);
    setRemovedClipping(null);
    // Focus the restored card, or the notebook search when a changed search
    // now hides it, so focus never drops to the page body.
    requestAnimationFrame(() => ([...(clippingSectionRef.current?.querySelectorAll(".clipping-card") || [])].find((card) => card.dataset.clippingId === clip.id)?.querySelector('button[aria-label="Delete clipping"]') || document.querySelector(".notebook-search input"))?.focus());
  };
  const toggleDocSelection = (id) => setSelectedDocIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const collections = profile.collections || [];
  const countFor = (filterId) => customDocuments.filter((doc) => (filterId === "archived" ? doc.archived : !doc.archived && (filterId === "all" || (doc.collectionId || "") === filterId))).length;
  const visibleCustom = customDocuments
    .filter((doc) => (collectionFilter === "archived" ? doc.archived : !doc.archived && (collectionFilter === "all" || (doc.collectionId || "") === collectionFilter)))
    .filter((doc) => matches(doc.title, doc.tags?.join(" "), doc.raw))
    .sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)));
  const visibleAnnotated = annotated.filter(({ doc, note }) => matches(doc.title, doc.partTitle, note));
  const visibleClippings = profile.clippings.filter((clip) => { const doc = allDocuments.find((item) => item.id === clip.documentId); return matches(doc?.title, clip.text, clip.note); });
  const visibleAnnotations = profile.annotations.filter((annotation) => { const doc = allDocuments.find((item) => item.id === annotation.documentId); return (annotationPurpose === "all" || annotation.purpose === annotationPurpose) && matches(doc?.title, annotation.quote, annotation.comment, annotation.tags?.join(" "), annotation.purpose); });
  const visibleBookmarked = bookmarked.filter((doc) => matches(doc.title, doc.partTitle, doc.description));
  const visibleMistakes = normalizedQuery ? (profile.mistakes || []).filter((mistake) => matches(mistake.prompt, mistake.expected, mistake.correction, (mistake.tags || []).join(" "))) : [];
  const visibleCount = visibleCustom.length + visibleAnnotated.length + visibleClippings.length + visibleAnnotations.length + visibleBookmarked.length + visibleMistakes.length;
  const uploadRef = useRef(null);
  return (
    <div className="page notebook-page">
      <header className="page-title">
        <div><span className="eyebrow">Your work</span><h1>Study notebook</h1><p>Private notes, edits, uploads, and saved lectures live on this device.</p></div>
        <div className="notebook-actions">
          <input ref={uploadRef} type="file" accept=".md,.markdown,.txt,.html,.htm,.epub,text/markdown,text/plain,text/html,application/epub+zip" multiple hidden onChange={onUpload} />
          <button className="button secondary" onClick={() => uploadRef.current?.click()} type="button"><Upload size={17} /> Upload</button>
          <button className="button primary" onClick={onCreate} type="button"><FilePlus2 size={17} /> New note</button>
        </div>
      </header>

      <div className="notebook-summary">
        <div><Bookmark size={20} /><strong>{bookmarked.length}</strong><span>Bookmarks</span></div>
        <div><NotebookPen size={20} /><strong>{annotated.length}</strong><span>Personal notes</span></div>
        <div><FileEdit size={20} /><strong>{edited.length}</strong><span>Edited copies</span></div>
        <div><Upload size={20} /><strong>{customDocuments.length}</strong><span>Uploads</span></div>
        <div><Highlighter size={20} /><strong>{profile.clippings.length}</strong><span>Clippings</span></div>
        <div><Highlighter size={20} /><strong>{profile.annotations.length}</strong><span>Highlights</span></div>
      </div>

      <div className="notebook-search"><Search size={18} /><input value={notebookQuery} onChange={(event) => setNotebookQuery(event.target.value)} placeholder="Search notes, clippings, bookmarks, uploads, and mistakes…" aria-label="Search notebook" />{notebookQuery && <button onClick={() => setNotebookQuery("")} aria-label="Clear notebook search" type="button"><X size={16} /></button>}</div>

      {(customDocuments.length > 0) && <section className="notebook-section"><div className="section-heading"><div><span className="eyebrow">Created and uploaded</span><h2>My lectures</h2></div><div className="notebook-heading-actions"><button className="button ghost" onClick={async () => { const report = await onRunLinkAudit(); if (report) setLinkReport(report); }} type="button"><Search size={15} /> Check links</button><button className={selectMode ? "button secondary" : "button ghost"} onClick={() => { setSelectMode((value) => !value); setSelectedDocIds([]); }} aria-pressed={selectMode} type="button"><CheckCircle2 size={15} /> {selectMode ? "Done selecting" : "Select"}</button></div></div>
      {linkReport && <div className={linkReport.findings.length ? "link-report has-findings" : "link-report"} role="status">{linkReport.findings.length === 0 ? `Checked ${linkReport.scanned} document${linkReport.scanned === 1 ? "" : "s"} — every internal link opens.` : <>
        <strong>{linkReport.findings.length} broken link{linkReport.findings.length === 1 ? "" : "s"} across {linkReport.scanned} scanned document{linkReport.scanned === 1 ? "" : "s"}:</strong>
        <ul>{linkReport.findings.slice(0, 12).map((finding, index) => <li key={index}><button className="text-button" onClick={() => onOpen(finding.documentId)} type="button">{allDocuments.find((item) => item.id === finding.documentId)?.title || finding.documentId.split("/").at(-1)}</button> → <code>{finding.href}</code> <small>({finding.kind.replace(/-/g, " ")})</small></li>)}</ul>
      </>}<button className="icon-button small" onClick={() => setLinkReport(null)} aria-label="Dismiss link report" type="button"><X size={14} /></button></div>}
      {selectMode && selectedDocIds.length > 0 && <div className="batch-toolbar" role="toolbar" aria-label="Batch actions"><strong>{selectedDocIds.length} selected</strong><label>Collection<select className="ui-select ui-select--sm" defaultValue="" onChange={(event) => { if (event.target.value !== "") { onBatchOrganize(selectedDocIds, { collectionId: event.target.value === "__none__" ? "" : event.target.value }); setSelectedDocIds([]); setSelectMode(false); event.target.value = ""; } }} aria-label="Assign selection to a collection"><option value="" disabled>Assign…</option><option value="__none__">No collection</option>{(appCollections || []).map((collection) => <option value={collection.id} key={collection.id}>{collection.name}</option>)}</select></label><button className="button ghost" onClick={() => { onBatchOrganize(selectedDocIds, { archived: collectionFilter !== "archived" }); setSelectedDocIds([]); setSelectMode(false); }} type="button"><Archive size={15} /> {collectionFilter === "archived" ? "Unarchive" : "Archive"}</button><button className="button ghost danger-text" onClick={() => { onBatchDelete(selectedDocIds); setSelectedDocIds([]); setSelectMode(false); }} type="button"><Trash2 size={15} /> Trash</button></div>}{(collections.length > 0 || customDocuments.some((doc) => doc.archived)) && <div className="collection-chips" role="radiogroup" aria-label="Filter by collection"><button role="radio" aria-checked={collectionFilter === "all"} className={collectionFilter === "all" ? "active" : ""} onClick={() => setCollectionFilter("all")} type="button">All ({countFor("all")})</button>{collections.map((collection) => <button role="radio" aria-checked={collectionFilter === collection.id} className={collectionFilter === collection.id ? "active" : ""} onClick={() => setCollectionFilter(collection.id)} key={collection.id} type="button">{collection.name} ({countFor(collection.id)})</button>)}{customDocuments.some((doc) => doc.archived) && <button role="radio" aria-checked={collectionFilter === "archived"} className={collectionFilter === "archived" ? "active archived-chip" : "archived-chip"} onClick={() => setCollectionFilter("archived")} type="button">Archived ({countFor("archived")})</button>}</div>}{visibleCustom.length ? <div className="document-list">{visibleCustom.map((doc) => <div className={selectMode && selectedDocIds.includes(doc.id) ? "notebook-document-row is-selected" : "notebook-document-row"} key={doc.id}>{selectMode && <label className="batch-check"><input type="checkbox" checked={selectedDocIds.includes(doc.id)} onChange={() => toggleDocSelection(doc.id)} aria-label={`Select ${doc.title}`} /></label>}{doc.pinned && <Pin size={13} className="pinned-marker" aria-label="Pinned" />}<DocumentCard doc={doc} profile={profile} onOpen={onOpen} compact /><div className="notebook-row-actions"><button className="icon-button" onClick={() => onManageCustom(doc.id)} aria-label={`Organize ${doc.title}`} title="Organize (rename, tags, collection, pin, archive)" type="button"><FileEdit size={17} /></button><button className="icon-button" onClick={() => onDuplicateCustom(doc.id)} aria-label={`Duplicate ${doc.title}`} title="Duplicate" type="button"><Copy size={17} /></button><button className="icon-button danger" onClick={() => onDeleteCustom(doc.id)} aria-label={`Delete ${doc.title}`} title="Delete" type="button"><Trash2 size={17} /></button></div></div>)}</div> : <div className="empty-state compact"><Search size={22} /><h2>Nothing in this view</h2><p>Choose another collection or clear the notebook search.</p></div>}</section>}
      {visibleAnnotated.length > 0 && <section className="notebook-section"><div className="section-heading"><div><span className="eyebrow">Captured ideas</span><h2>Personal notes</h2></div></div><div className="note-grid">{visibleAnnotated.map(({ doc, note }) => <button className="note-card" onClick={() => onOpen(doc.id)} key={doc.id} type="button"><span>{doc.partTitle}</span><strong>{doc.title}</strong><p>{note}</p><ChevronRight size={18} /></button>)}</div></section>}
      {(visibleClippings.length > 0 || removedClipping) && <section ref={clippingSectionRef} className="notebook-section"><div className="section-heading"><div><span className="eyebrow">Saved excerpts</span><h2>Clippings</h2></div></div><div className="clipping-grid">{withUndoSlot(visibleClippings.map((clip) => { const doc = allDocuments.find((item) => item.id === clip.documentId); const linked = profile.reviewItems.some((item) => item.sourceClippingId === clip.id); const aiOrigin = clip.origin === "ai-tutor"; return <article className={`clipping-card${aiOrigin ? " clipping-card--ai" : ""}`} data-clipping-id={clip.id} key={clip.id}>{aiOrigin ? <BrainCircuit size={18} /> : <Highlighter size={18} />}{aiOrigin && <span className="clipping-origin" title="Generated by the AI tutor and saved by you; verify before relying on it">{clip.title || "AI tutor answer"} · AI draft</span>}<blockquote>{clip.text}</blockquote><ClippingNoteField clip={clip} onCommit={onUpdateClipping} /><div>{doc || !aiOrigin ? <button className="text-button" onClick={() => doc && onOpen(doc.id)} disabled={!doc} type="button">{doc?.title || "Missing document"}</button> : <span className="clipping-no-source">No linked lecture</span>}<span className="clipping-actions"><button className="icon-button small" onClick={() => onCreateReview(clip)} aria-label={linked ? "Create another review card from clipping" : "Create review card from clipping"} title="Create review card" type="button"><Brain size={15} /></button><button className="icon-button small" onClick={() => onCopyClipping(clip)} aria-label="Copy clipping" title="Copy" type="button"><Copy size={15} /></button><button className="icon-button small danger" onClick={() => removeClipping(clip)} aria-label="Delete clipping" title="Delete" type="button"><Trash2 size={15} /></button></span></div></article>; }), removedClipping ? (() => { const position = new Map(profile.clippings.map((clip, index) => [clip.id, index])); return visibleClippings.map((clip) => position.get(clip.id)); })() : [], removedClipping?.index ?? 0, removedClipping && <UndoStrip key={`undo-${removedClipping.clip.id}`} message={`Clipping deleted: “${removedClipping.clip.text.slice(0, 60)}${removedClipping.clip.text.length > 60 ? "…" : ""}”`} onUndo={undoRemoveClipping} onExpire={() => setRemovedClipping(null)} />)}</div></section>}
      {profile.annotations.length > 0 && <section className="notebook-section"><div className="section-heading annotation-section-heading"><div><span className="eyebrow">Source anchored</span><h2>Highlights</h2></div><div className="annotation-heading-actions"><label>Purpose<select className="ui-select" value={annotationPurpose} onChange={(event) => setAnnotationPurpose(event.target.value)}><option value="all">All</option><option value="important">Important</option><option value="definition">Definitions</option><option value="question">Questions</option><option value="interview">Interview</option></select></label><button className="button ghost" onClick={() => onExportAnnotations(visibleAnnotations)} aria-label="Export the listed highlights as Markdown" type="button"><Download size={15} /> Export</button></div></div>{visibleAnnotations.length ? <div className="notebook-annotation-grid">{visibleAnnotations.map((annotation) => { const doc = allDocuments.find((item) => item.id === annotation.documentId); return <article className={`notebook-annotation-card ${annotation.color}`} key={annotation.id}><span className="annotation-purpose">{annotation.purpose}</span><blockquote>{annotation.quote}</blockquote>{annotation.comment && <p>{annotation.comment}</p>}{annotation.tags?.length > 0 && <div className="annotation-tags">{annotation.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}<div><button className="text-button" onClick={() => doc && onOpen(doc.id)} disabled={!doc} type="button">{doc?.title || "Missing document"}</button><span className="clipping-actions"><button className="icon-button small" onClick={() => onCreateReview(annotation)} aria-label="Create review card from highlight" title="Create review card" type="button"><Brain size={15} /></button><button className="icon-button small" onClick={() => onCopyAnnotation(annotation)} aria-label="Copy highlight" title="Copy" type="button"><Copy size={15} /></button><button className="icon-button small danger" onClick={() => onDeleteAnnotation(annotation.id)} aria-label="Delete highlight" title="Delete" type="button"><Trash2 size={15} /></button></span></div></article>; })}</div> : <div className="empty-state compact"><Search size={24} /><h2>No matching highlights</h2><p>Choose another purpose or clear the notebook search.</p></div>}</section>}
      {normalizedQuery && visibleMistakes.length > 0 && <section className="notebook-section notebook-mistakes" aria-label="Matching mistakes"><div className="section-heading"><div><span className="eyebrow">From your error log</span><h2>Mistakes</h2></div><button className="text-button" onClick={onOpenReview} type="button">Review center <ChevronRight size={16} /></button></div><div className="notebook-mistake-list">{visibleMistakes.slice(0, 6).map((mistake) => <button className="notebook-mistake-row" onClick={onOpenReview} key={mistake.id} type="button"><Flame size={15} /><span className="notebook-mistake-copy"><strong>{mistake.prompt}</strong><small>{mistake.correctedAt ? "Corrected" : `Open · ×${mistake.occurrences || 1}`}{mistake.correction ? ` — ${mistake.correction}` : ""}</small></span></button>)}</div></section>}
      {visibleBookmarked.length > 0 && <section className="notebook-section"><div className="section-heading"><div><span className="eyebrow">Saved</span><h2>Bookmarks</h2></div></div><div className="document-list">{visibleBookmarked.map((doc) => <DocumentCard key={doc.id} doc={doc} profile={profile} onOpen={onOpen} compact />)}</div></section>}
      {(profile.trash || []).length > 0 && <section className="notebook-section notebook-trash" aria-label="Trash"><div className="section-heading"><div><span className="eyebrow">Recoverable for 30 days</span><h2>Trash</h2></div></div><div className="trash-list">{profile.trash.map((entry) => {
        const deletedAt = Date.parse(entry.deletedAt);
        const daysLeft = Number.isFinite(deletedAt) ? Math.max(0, 30 - Math.floor((Date.now() - deletedAt) / 86_400_000)) : 0;
        return <article className="trash-row" key={entry.id}><Trash2 size={16} /><div className="trash-copy"><strong>{entry.title}</strong><span>Deleted {new Date(entry.deletedAt).toLocaleDateString()} · {daysLeft} day{daysLeft === 1 ? "" : "s"} left{entry.tags?.length ? ` · ${entry.tags.join(", ")}` : ""}</span></div><div className="trash-actions"><button className="button ghost" onClick={() => onRestoreTrash(entry.id)} type="button"><RotateCcw size={15} /> Restore</button><button className="icon-button danger" onClick={() => onDeleteTrash(entry.id)} aria-label={`Delete ${entry.title} forever`} title="Delete forever" type="button"><X size={16} /></button></div></article>;
      })}</div></section>}
      {normalizedQuery && !visibleCount && <div className="empty-state"><Search size={30} /><h2>No notebook match</h2><p>Try a document title, a phrase from a clipping, a tag, or words from your own annotation.</p><button className="button secondary" onClick={() => setNotebookQuery("")} type="button">Clear search</button></div>}
      {!customDocuments.length && !annotated.length && !bookmarked.length && !profile.clippings.length && !profile.annotations.length && <div className="empty-state notebook-empty"><NotebookPen size={34} /><h2>Your notebook is ready</h2><p>Bookmark a lecture, highlight or clip an excerpt, write a personal note, edit a local copy, or upload your own Markdown.</p><button className="button primary" onClick={onCreate} type="button">Create first note</button></div>}
    </div>
  );
}
