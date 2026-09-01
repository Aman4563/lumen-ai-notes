import assert from "node:assert/strict";
import test from "node:test";

import { assertAiRequestFits, fitAiRequestContext } from "./aiRequestBudget.js";

const profileLimits = Object.freeze({ fast: 9_340, balanced: 8_440, deep: 7_040 });
const outputTokens = Object.freeze({ fast: 900, balanced: 1_800, deep: 3_200 });
const difficultText = `校准 🧭 "quoted" C:\\\\models\n${"evidence ".repeat(2_000)}`;
const history = [
  { role: "user", content: "Earlier question 🤔 with a \\\\ path" },
  { role: "assistant", content: "Earlier answer: \"calibration\" means empirical frequency." },
];
const summary = "Older conversation memory: 校准, reliability, and escaped \\\\ examples.";

const fit = ({ profile, sourceText = difficultText, webSearch = false }) => fitAiRequestContext({
  maximumBytes: profileLimits[profile],
  maximumContextCharacters: 16_000,
  buildContext: (budget) => sourceText.slice(0, budget),
  buildPayload: (context) => ({
    task: "explain",
    prompt: "Explain calibration and cite [S1].",
    context,
    documentTitle: "校准 / Calibration",
    difficulty: "intermediate",
    history,
    conversationSummary: summary,
    responseFormat: "markdown",
    responseProfile: profile,
    maxOutputTokens: outputTokens[profile],
    webSearch,
  }),
});

test("fits canonical retrieval payloads with history, summary, envelope, and difficult UTF-8 for every profile", () => {
  for (const profile of Object.keys(profileLimits)) {
    const fitted = fit({ profile, webSearch: true });
    assert.equal(assertAiRequestFits(fitted), true, `${profile} payload did not fit`);
    assert.ok(fitted.context.length > 0, `${profile} discarded all retrieved evidence`);
    assert.equal(fitted.payload.history, history);
    assert.equal(fitted.payload.conversationSummary, summary);
    assert.equal(fitted.payload.responseProfile, profile);
    assert.equal(fitted.payload.responseFormat, "markdown");
    assert.equal(fitted.payload.webSearch, true);
  }
});

test("no-match and retrieval-unavailable fallback branches still produce exact fitted bodies", () => {
  const noMatch = fit({ profile: "balanced", sourceText: "", webSearch: true });
  const fallback = fit({ profile: "balanced", sourceText: difficultText, webSearch: false });
  assert.equal(assertAiRequestFits(noMatch), true);
  assert.equal(noMatch.payload.context, "");
  assert.equal(noMatch.payload.webSearch, true);
  assert.equal(assertAiRequestFits(fallback), true);
  assert.equal(fallback.payload.webSearch, false);
});

test("retrying an unchanged fitted request preserves the exact payload and bytes", () => {
  const first = fit({ profile: "deep", webSearch: true });
  const retry = structuredClone(first.payload);
  assert.deepEqual(retry, first.payload);
  assert.equal(new TextEncoder().encode(JSON.stringify(retry)).byteLength, first.bytes);
  assert.equal(assertAiRequestFits(first), true);
});

