/**
 * Staged progress for a grounded tutor answer (TVU-18): Finding passages,
 * an optional web search, Drafting, Checking citations, Done. Grounded prose
 * is held back until its citations are checked, so for 20-50 seconds these
 * steps are the whole waiting state. They follow the request's own phases:
 * the browser's library retrieval, then the server's stream phase events
 * (preparing, searching, generating, validating).
 */

const RANK = Object.freeze({ retrieving: 0, searching: 1, drafting: 2, checking: 3, done: 4 });

/** Maps a client or server phase onto a step rank's name. */
export const progressPhase = (phase) => {
  if (phase === "retrieving" || phase === "searching" || phase === "done") return phase;
  if (phase === "validating" || phase === "checking") return "checking";
  // preparing, generating and anything new are part of drafting.
  return "drafting";
};

const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Steps for the answer in progress, each { id, label, state } with state
 * "done", "active", "pending" or "skipped". Empty for a request that uses
 * neither the library nor the web.
 *
 * sourceMode: "library-first" | "current" | "choose" | "none"
 * passages: attached passages once known (null while retrieving)
 * web: the request may search the web; searched: a search phase was seen
 */
export const tutorProgressSteps = ({ sourceMode, phase, passages = null, web = false, searched = false, structured = false } = {}) => {
  if (!sourceMode || (sourceMode === "none" && !web && !searched)) return [];
  const current = progressPhase(phase);
  const rank = RANK[current];
  const stateFor = (step) => (step < rank ? "done" : step === rank ? "active" : "pending");
  const steps = [];
  if (sourceMode === "library-first") {
    const count = Number.isSafeInteger(passages) ? passages : null;
    steps.push({
      id: "find",
      label: rank === 0 ? "Finding passages" : count === null ? "Passages ready" : count > 0 ? `Found ${plural(count, "passage")}` : "No matching passage",
      state: stateFor(0),
    });
  } else if (sourceMode !== "none") {
    const count = Number.isSafeInteger(passages) ? passages : 0;
    steps.push({ id: "find", label: `Using ${plural(count, "source")}`, state: "done" });
  }
  if (web || searched || current === "searching") {
    steps.push({
      id: "web",
      label: "Searching the web",
      state: current === "searching" ? "active" : searched ? "done" : rank > RANK.drafting ? "skipped" : "pending",
    });
  }
  steps.push({ id: "draft", label: structured ? "Building the result" : "Drafting the answer", state: stateFor(RANK.drafting) });
  steps.push({ id: "check", label: structured ? "Checking the result" : "Checking citations", state: stateFor(RANK.checking) });
  steps.push({ id: "done", label: "Done", state: stateFor(RANK.done) });
  return steps;
};

/**
 * One polite announcement per step change, never per second: the step now
 * running, preceded by what retrieval found when drafting begins.
 */
export const progressAnnouncement = (steps) => {
  const active = steps.find((step) => step.state === "active");
  if (!active || active.id === "done") return "";
  const found = steps.find((step) => step.id === "find" && step.state === "done");
  return active.id === "draft" && found ? `${found.label}. ${active.label}…` : `${active.label}…`;
};
