/**
 * Structured interview tracks (INTERVIEW-001, issue #10): a versioned
 * authored bank (src/data/interviewTracks.v1.json) of per-track questions
 * with round types, seniority, duration, and rubric bullets, feeding the
 * existing timed InterviewRound through the same card shape it already
 * consumes — extended backward-compatibly with per-card timing, rubric, and
 * mistake-category fields.
 */
export const INTERVIEW_TRACKS_FORMAT = "lumen.interview.tracks.v1";
export const ROUND_TYPES = Object.freeze([
  { id: "rapid-fundamentals", label: "Rapid fundamentals" },
  { id: "coding", label: "Coding" },
  { id: "debugging", label: "Debugging" },
  { id: "model-design", label: "Model design" },
  { id: "production-incident", label: "Production incident" },
  { id: "system-design", label: "System design" },
]);
const ROUND_TYPE_IDS = new Set(ROUND_TYPES.map((entry) => entry.id));
const SENIORITIES = new Set(["junior", "mid", "senior", "staff"]);

const clamp = (value, minimum, maximum, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
};
const text = (value, maximum) => String(value ?? "").trim().slice(0, maximum);

/** Bank validation: malformed entries drop rather than crash a round. */
export const normalizeTrackBank = (bank) => {
  if (!bank || bank.format !== INTERVIEW_TRACKS_FORMAT || !Array.isArray(bank.tracks) || !Array.isArray(bank.questions)) {
    return { tracks: [], questions: [] };
  }
  const tracks = bank.tracks
    .filter((track) => track && typeof track.id === "string" && typeof track.label === "string")
    .map((track) => ({
      id: text(track.id, 40),
      label: text(track.label, 80),
      seeded: track.seeded !== false,
      description: text(track.description, 300),
    }));
  const trackIds = new Set(tracks.map((track) => track.id));
  const questions = bank.questions
    .filter((question) => question
      && typeof question.id === "string"
      && typeof question.prompt === "string" && question.prompt.trim()
      && typeof question.modelAnswer === "string" && question.modelAnswer.trim()
      && Array.isArray(question.trackIds) && question.trackIds.some((id) => trackIds.has(id))
      && ROUND_TYPE_IDS.has(question.roundType))
    .map((question) => ({
      id: text(question.id, 80),
      trackIds: question.trackIds.filter((id) => trackIds.has(id)),
      roundType: question.roundType,
      prompt: text(question.prompt, 2_000),
      modelAnswer: text(question.modelAnswer, 3_600),
      concepts: (Array.isArray(question.concepts) ? question.concepts : []).map((concept) => text(concept, 60)).filter(Boolean).slice(0, 4),
      seniority: SENIORITIES.has(question.seniority) ? question.seniority : "mid",
      expectedMinutes: Math.round(clamp(question.expectedMinutes, 1, 10, 3)),
      rubric: (Array.isArray(question.rubric) ? question.rubric : []).map((bullet) => text(bullet, 200)).filter(Boolean).slice(0, 6),
      documentId: text(question.documentId, 500),
      followUps: (Array.isArray(question.followUps) ? question.followUps : []).map((entry) => text(entry, 300)).filter(Boolean).slice(0, 3),
    }));
  return { tracks, questions };
};

export const answerSecondsFor = (question) => Math.max(60, Math.min(300, (question.expectedMinutes || 3) * 60));

/**
 * Builds a deterministic track round in the InterviewRound card shape.
 * Questions the learner has missed before (open mistakes fingerprinting the
 * question id) come first, then seniority ascent, then id order.
 */
export const buildTrackRound = (bank, { trackId, roundType = "", limit = 6 } = {}, mistakes = []) => {
  const { tracks, questions } = normalizeTrackBank(bank);
  const track = tracks.find((entry) => entry.id === trackId && entry.seeded);
  if (!track) return { ok: false, reason: "This track has no authored questions yet.", cards: [] };
  const missedIds = new Set((mistakes || [])
    .filter((mistake) => !mistake.correctedAt && (mistake.tags || []).includes("interview-track"))
    .map((mistake) => mistake.reviewItemId));
  const seniorityRank = { junior: 0, mid: 1, senior: 2, staff: 3 };
  const pool = questions
    .filter((question) => question.trackIds.includes(trackId) && (!roundType || question.roundType === roundType))
    .sort((left, right) => Number(missedIds.has(right.id)) - Number(missedIds.has(left.id))
      || seniorityRank[left.seniority] - seniorityRank[right.seniority]
      || left.id.localeCompare(right.id))
    .slice(0, Math.max(1, Math.min(limit, 12)));
  if (!pool.length) return { ok: false, reason: "No authored questions match this track and round type yet.", cards: [] };
  return {
    ok: true,
    reason: "",
    track,
    cards: pool.map((question) => ({
      id: question.id,
      type: "production-scenario",
      front: `**${ROUND_TYPES.find((entry) => entry.id === question.roundType)?.label || "Interview"} · ${question.seniority}**\n\n${question.prompt}`,
      back: `${question.modelAnswer}\n\n**Rubric**\n${question.rubric.map((bullet) => `- ${bullet}`).join("\n")}${question.followUps.length ? `\n\n**Follow-ups**\n${question.followUps.map((entry) => `- ${entry}`).join("\n")}` : ""}`,
      tags: ["interview-track", trackId, question.roundType],
      answerSeconds: answerSecondsFor(question),
      mistakeCategory: question.roundType === "system-design" || question.roundType === "production-incident" ? "system-design" : question.roundType === "coding" || question.roundType === "debugging" ? "code" : "interview",
      documentId: question.documentId,
    })),
  };
};

/** Coverage summary for audits and the tracker. */
export const trackCoverage = (bank) => {
  const { tracks, questions } = normalizeTrackBank(bank);
  return tracks.map((track) => ({
    id: track.id,
    label: track.label,
    seeded: track.seeded,
    questionCount: questions.filter((question) => question.trackIds.includes(track.id)).length,
    roundTypes: [...new Set(questions.filter((question) => question.trackIds.includes(track.id)).map((question) => question.roundType))].sort(),
  }));
};
