/**
 * Worksheet labs (LAB-001/002 slice, issue #10): authored practice with
 * inline datasets, deterministic self-check literals, a reveal step, and
 * honest self-grading. Deliberately NO code-execution runtime this campaign —
 * an isolated WASM runner (Pyodide/sql.js behind the WebLLM-style consented
 * download pattern) is the documented follow-up. Misses flow into the
 * mistake notebook through the caller's onLogMistake.
 */
export const LABS_FORMAT = "lumen.labs.v1";
export const LAB_KINDS = Object.freeze(["python", "sql", "debugging", "metrics"]);

const text = (value, maximum) => String(value ?? "").trim().slice(0, maximum);

export const normalizeLabBank = (bank) => {
  if (!bank || bank.format !== LABS_FORMAT || !Array.isArray(bank.labs)) return { labs: [] };
  const labs = bank.labs
    .filter((lab) => lab
      && typeof lab.id === "string"
      && LAB_KINDS.includes(lab.kind)
      && typeof lab.prompt === "string" && lab.prompt.trim()
      && Array.isArray(lab.tasks) && lab.tasks.length > 0)
    .map((lab) => ({
      id: text(lab.id, 80),
      title: text(lab.title, 160),
      kind: lab.kind,
      documentId: text(lab.documentId, 500),
      prompt: text(lab.prompt, 3_000),
      dataset: text(lab.dataset, 4_000),
      tasks: lab.tasks
        .filter((task) => task && typeof task.id === "string" && task.selfCheck && typeof task.selfCheck.expected === "string")
        .slice(0, 4)
        .map((task) => ({
          id: text(task.id, 80),
          instruction: text(task.instruction, 1_000),
          selfCheck: {
            question: text(task.selfCheck.question, 500),
            expected: text(task.selfCheck.expected, 500),
            explanation: text(task.selfCheck.explanation, 1_000),
          },
        })),
      solution: text(lab.solution, 4_000),
      complexityNote: text(lab.complexityNote, 500),
      estimatedMinutes: Math.max(5, Math.min(60, Math.round(Number(lab.estimatedMinutes) || 15))),
    }))
    .filter((lab) => lab.tasks.length > 0);
  return { labs };
};

/**
 * Tolerant literal compare: whitespace, case, trailing zeros after a decimal
 * point, and surrounding quotes never fail an otherwise-correct answer.
 */
export const checkLabAnswer = (expected, response) => {
  const canonical = (value) => {
    let out = String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ").replace(/^["']|["']$/g, "");
    if (/^-?\d+(\.\d+)?$/.test(out)) out = String(Number(out));
    return out;
  };
  return canonical(expected) === canonical(response);
};

export const labMistakeDraft = (lab, task, response) => ({
  prompt: `${lab.title} — ${task.instruction}`,
  expected: `${task.selfCheck.expected}${task.selfCheck.explanation ? ` — ${task.selfCheck.explanation}` : ""}`,
  response: text(response, 2_000),
  category: "code",
  documentId: lab.documentId,
  tags: ["lab", lab.kind],
});
