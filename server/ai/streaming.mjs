export const AI_STREAM_PROTOCOL = "lumen.ai.ndjson.v1";

const TASK_APPROACH = Object.freeze({
  tutor: "Teach the concept directly, check understanding, and suggest one useful next action.",
  explain: "Build the explanation from intuition through mechanics, examples, failure modes, and practical takeaways.",
  socratic: "Identify the key idea and guide discovery with one focused question at a time.",
  quiz: "Select source-supported learning objectives, test misconceptions, and validate every keyed answer.",
  flashcards: "Extract atomic source-supported facts and turn them into unambiguous active-recall prompts.",
  interview: "Probe assumptions, trade-offs, production failure handling, and measurement at the requested level.",
  summarize: "Extract the core ideas, assumptions, formulas, pitfalls, and a compact recall checklist.",
  study_plan: "Order prerequisites and practice into measurable milestones with evidence of mastery.",
  answer_feedback: "Compare the answer with the available evidence, identify gaps, and give a stronger answer.",
});

/**
 * A disclosure-safe answer approach for a learner-facing toggle.
 *
 * This is deterministic orchestration metadata, not provider `thinking`, hidden
 * chain-of-thought, or a claim about steps the model privately performed.
 */
export const createAnswerApproach = (request) => {
  const steps = [];
  if (request.context) {
    steps.push("Locate the claims in the supplied library context that directly address the question.");
  } else {
    steps.push("Establish the definitions and assumptions needed to answer without inventing source support.");
  }
  if (request.conversationSummary) {
    steps.push("Use the compacted older conversation only as untrusted continuity context, alongside the recent full turns.");
  }
  if (request.webSearch) {
    steps.push("Use the approved self-hosted web search for current facts, retain usable sources, and flag evidence gaps.");
  }
  steps.push(TASK_APPROACH[request.task] || TASK_APPROACH.tutor);
  steps.push(`Present a clear ${request.difficulty}-level answer and distinguish sourced claims from general explanation.`);
  return Object.freeze({
    summary: request.webSearch
      ? "Ground in the available learning material, verify current claims with approved web evidence, then synthesize the answer."
      : request.context
        ? "Ground the answer in the available learning material, then explain it at the requested depth."
        : "Answer from established knowledge at the requested depth and state any evidence limitations.",
    steps: Object.freeze(steps),
  });
};

const writeWithDrain = async (response, line, { signal, timeoutMs }) => {
  if (signal?.aborted || response.destroyed || response.writableEnded) {
    throw Object.assign(new Error("AI stream client disconnected"), { code: "STREAM_DISCONNECTED" });
  }
  let accepted;
  try {
    accepted = response.write(line);
  } catch (error) {
    throw Object.assign(new Error("AI stream write failed", { cause: error }), { code: "STREAM_WRITE_FAILED" });
  }
  if (accepted) return;

  await new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      response.off("drain", onDrain);
      response.off("error", onError);
      response.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = (action, value) => {
      cleanup();
      action(value);
    };
    const onDrain = () => settle(resolve);
    const onError = (error) => settle(reject, Object.assign(new Error("AI stream write failed", { cause: error }), { code: "STREAM_WRITE_FAILED" }));
    const onClose = () => settle(reject, Object.assign(new Error("AI stream client disconnected"), { code: "STREAM_DISCONNECTED" }));
    const onAbort = () => onClose();
    response.once("drain", onDrain);
    response.once("error", onError);
    response.once("close", onClose);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      settle(reject, Object.assign(new Error("AI stream client remained backpressured for too long"), { code: "STREAM_BACKPRESSURE_TIMEOUT" }));
    }, timeoutMs);
    timer.unref?.();
  });
};

/**
 * Serializes NDJSON writes and bounds total bytes. Awaiting `write` propagates
 * HTTP backpressure all the way to the Ollama response reader.
 */
export const createNdjsonWriter = (response, {
  signal,
  maximumBytes,
  backpressureTimeoutMs,
} = {}) => {
  const encoder = new TextEncoder();
  let bytesWritten = 0;
  let closed = false;
  let queue = Promise.resolve();

  const write = (event) => {
    const operation = queue.then(async () => {
      if (closed) throw Object.assign(new Error("AI stream is already closed"), { code: "STREAM_CLOSED" });
      const line = `${JSON.stringify(event)}\n`;
      const lineBytes = encoder.encode(line).byteLength;
      if (bytesWritten + lineBytes > maximumBytes) {
        throw Object.assign(new Error("AI stream exceeded the configured response limit"), { code: "STREAM_TOO_LARGE" });
      }
      await writeWithDrain(response, line, { signal, timeoutMs: backpressureTimeoutMs });
      bytesWritten += lineBytes;
    });
    // Keep the internal queue usable only for observing the original failure;
    // all later writes still fail through the explicit `closed` state set by
    // the caller when it terminates the connection.
    queue = operation.catch(() => {});
    return operation;
  };

  return Object.freeze({
    write,
    close() { closed = true; },
    get bytesWritten() { return bytesWritten; },
  });
};
