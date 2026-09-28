import { BookOpen, Check, ChevronRight, LibraryBig } from "lucide-react";

// Shared by Home, the Library and the lazily loaded Notebook. The startup
// bundle keeps it; a lazy screen imports it rather than App.jsx.

/**
 * Wraps matched search terms in <mark> for highlighted snippets (SEARCH-001).
 * Short terms only mark at a word start, mirroring the search rule, so "rag"
 * never lights up inside "storage".
 */
export function HighlightedText({ text, terms }) {
  const value = String(text || "");
  const cleaned = [...new Set((terms || []).filter((term) => term && term.length > 1))].sort((left, right) => right.length - left.length).slice(0, 12);
  if (!cleaned.length) return value;
  const pattern = new RegExp(cleaned.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "giu");
  const parts = [];
  let last = 0;
  for (const match of value.matchAll(pattern)) {
    if (match[0].length <= 4 && /[\p{L}\p{N}]/u.test(value[match.index - 1] || "")) continue;
    if (match.index > last) parts.push(value.slice(last, match.index));
    parts.push(<mark key={match.index}>{match[0]}</mark>);
    last = match.index + match[0].length;
  }
  if (!parts.length) return value;
  if (last < value.length) parts.push(value.slice(last));
  return parts;
}

export function DocumentCard({ doc, profile, onOpen, compact = false }) {
  const progress = profile.progress[doc.id] || 0;
  const percent = Math.round(progress * 100);
  const done = progress >= 0.96;
  const highlight = doc.matchedTerms?.length ? doc.matchedTerms : null;
  return (
    <button className={compact ? "document-card compact" : "document-card"} onClick={() => onOpen(doc.id)} type="button">
      <div className="document-card-icon" aria-hidden="true">{done ? <Check size={19} /> : doc.isIndex ? <LibraryBig size={19} /> : <BookOpen size={19} />}</div>
      <div className="document-card-copy">
        <span>{doc.source === "custom" ? "My note" : doc.partNumber > 0 ? `Part ${doc.partNumber}` : "Guide"} · {doc.minutes} min{done ? <b className="document-card-state is-done"> · Done</b> : percent > 0 ? <b className="document-card-state"> · {percent}% read</b> : null}</span>
        <strong>{highlight ? <HighlightedText text={doc.title} terms={highlight} /> : doc.title}</strong>
        {!compact && <p>{highlight ? <HighlightedText text={doc.description} terms={highlight} /> : doc.description}</p>}
        {progress > 0 && <div className="mini-progress" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>}
      </div>
      <ChevronRight size={19} aria-hidden="true" />
    </button>
  );
}
