import { useEffect, useRef, useState } from "react";
import { Highlighter, X } from "lucide-react";
import { useModalDialog } from "../hooks/useModalDialog.js";

const COLORS = [
  { id: "gold", label: "Gold" },
  { id: "coral", label: "Coral" },
  { id: "teal", label: "Teal" },
  { id: "violet", label: "Violet" },
];

const PURPOSES = [
  { id: "important", label: "Important" },
  { id: "definition", label: "Definition" },
  { id: "question", label: "Question" },
  { id: "interview", label: "Interview" },
];

const ANNOTATION_BACKGROUND = [".app-sidebar", ".app-topbar", ".bottom-nav", ".reader-view > :not(.annotation-dialog-layer)"];

export default function AnnotationDialog({ draft, onClose, onSave }) {
  const [color, setColor] = useState("gold");
  const [purpose, setPurpose] = useState("important");
  const [comment, setComment] = useState("");
  const [tags, setTags] = useState("");
  const dialogRef = useRef(null);

  // Only a different draft resets form fields. Background app updates often
  // pass a new onClose callback while the learner is still typing.
  useEffect(() => {
    if (!draft) return;
    setColor(draft.color || "gold");
    setPurpose(draft.purpose || "important");
    setComment(draft.comment || "");
    setTags((draft.tags || []).join(", "));
  }, [draft]);

  useModalDialog(Boolean(draft), dialogRef, { onClose, background: ANNOTATION_BACKGROUND });

  if (!draft) return null;
  const submit = (event) => {
    event.preventDefault();
    onSave({ ...draft, color, purpose, comment: comment.trim(), tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) });
  };

  // ARIA allows role=dialog on a div, not on a form; the form inside keeps
  // native submit behavior.
  return <div className="modal-layer annotation-dialog-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close highlight editor" tabIndex={-1} type="button" /><div ref={dialogRef} className="annotation-dialog-frame" role="dialog" aria-modal="true" aria-labelledby="annotation-dialog-title"><form className="annotation-dialog" onSubmit={submit}><button className="icon-button annotation-dialog-close" onClick={onClose} aria-label="Close highlight editor" type="button"><X size={19} /></button><div className="dialog-icon"><Highlighter size={22} /></div><span className="eyebrow">Source-anchored note</span><h2 id="annotation-dialog-title">{draft.id ? "Edit highlight" : "Save highlight"}</h2><blockquote>{draft.quote}</blockquote><fieldset><legend>Color</legend><div className="annotation-color-options">{COLORS.map((item) => <button className={`${item.id} ${color === item.id ? "active" : ""}`} onClick={() => setColor(item.id)} aria-pressed={color === item.id} key={item.id} type="button"><span />{item.label}</button>)}</div></fieldset><label><span>Purpose</span><select value={purpose} onChange={(event) => setPurpose(event.target.value)}>{PURPOSES.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><label><span>Comment <small>optional</small></span><textarea value={comment} maxLength={4_000} onChange={(event) => setComment(event.target.value)} placeholder="Why it matters, what is unclear, or how it appears in interviews…" /></label><label><span>Tags <small>optional, comma separated</small></span><input className="text-input" value={tags} maxLength={500} onChange={(event) => setTags(event.target.value)} placeholder="optimization, interview, revisit" /></label><div className="modal-actions"><button className="button ghost" onClick={onClose} type="button">Cancel</button><button className="button primary" type="submit">{draft.id ? "Save changes" : "Create highlight"}</button></div></form></div></div>;
}
