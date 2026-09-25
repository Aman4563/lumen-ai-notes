import assert from "node:assert/strict";
import test from "node:test";

import { TUTOR_BRIDGE_PROMPT_CHARS, assessmentMissesRequest, mistakeTutorRequest } from "./tutorBridge.js";

test("a mistake opens as a Socratic walk-through with clipped fields", () => {
  const request = mistakeTutorRequest({
    prompt: "Why does lasso produce  sparse\nweights?",
    expected: "The L1 penalty has corners at zero.",
    response: "Because it squares the weights.",
    documentId: "notes/part-05/lasso.md",
  });
  assert.equal(request.modeId, "socratic");
  assert.equal(request.origin, "mistake notebook");
  assert.equal(request.documentId, "notes/part-05/lasso.md");
  assert.equal(request.label, "Why does lasso produce sparse weights?");
  assert.equal(request.retrievalQuery, "Why does lasso produce sparse weights? The L1 penalty has corners at zero.", "the search words were not the mistake's topic");
  assert.equal(request.prompt, "Work through this mistake with me, one question at a time. Start by asking what I think went wrong, and do not give me the answer straight away.\n\nQuestion: Why does lasso produce sparse weights?\nExpected answer: The L1 penalty has corners at zero.\nMy answer: Because it squares the weights.");
  // Every field is clipped to 600 characters, and the whole question fits
  // On-device Lite's 1,800-character box: the learner's answer gives way
  // first, and nothing is cut off mid-line by the engine.
  const long = mistakeTutorRequest({ prompt: "p".repeat(2_000), expected: "e".repeat(4_000), response: "r".repeat(4_000) });
  const fieldLength = (prompt, field) => {
    const line = prompt.split("\n").find((entry) => entry.startsWith(field));
    return line.length - field.length;
  };
  assert.equal(TUTOR_BRIDGE_PROMPT_CHARS, 1_800);
  assert.ok(long.prompt.length <= TUTOR_BRIDGE_PROMPT_CHARS, `a mistake prompt of ${long.prompt.length} characters does not fit On-device Lite`);
  assert.deepEqual(["Question: ", "Expected answer: ", "My answer: "].map((field) => fieldLength(long.prompt, field)), [600, 600, 360], "the fields did not give way answer-first");
  assert.match(long.prompt, /\nMy answer: r+…$/, "the learner's answer was not the clipped last line");
  const words = (label) => Array.from({ length: 120 }, (_, index) => `${label}${index}`).join(" ");
  const wordy = mistakeTutorRequest({ prompt: `Why ${words("lasso")}?`, expected: words("corner"), response: words("square") });
  assert.ok(wordy.prompt.length <= TUTOR_BRIDGE_PROMPT_CHARS);
  for (const field of ["Question: ", "Expected answer: ", "My answer: "]) assert.ok(fieldLength(wordy.prompt, field) <= 600, `${field.trim()} was over 600 characters`);
  const recalled = mistakeTutorRequest({ prompt: "Define {{bias}} here.", expected: "bias", response: "" });
  assert.equal(recalled.prompt.includes("My answer"), false, "an empty answer was sent as a line");
  assert.match(recalled.prompt, /Question: Define ___ here\./, "a cloze blank gave its answer away");
});

test("readiness-check misses open as one Explain question", () => {
  const drafts = Array.from({ length: 7 }, (_, index) => ({ prompt: `Question ${index + 1} ${"x".repeat(400)}`, expected: `Key ${index + 1}`, response: index === 1 ? "self-graded" : `Mine ${index + 1}`, documentId: index ? `doc-${index}` : "" }));
  const request = assessmentMissesRequest(drafts, { partTitle: "Classical Supervised Learning" });
  assert.equal(request.modeId, "explain");
  assert.equal(request.origin, "readiness check");
  assert.equal(request.documentId, "doc-1", "the first missed question with a lesson was not the hint");
  assert.ok(request.retrievalQuery.startsWith("Question 1 ") && request.retrievalQuery.length <= 300, "the search words were not the missed questions");
  assert.equal(/Explain|readiness/.test(request.retrievalQuery), false);
  assert.match(request.prompt, /^Explain the questions I missed in my readiness check for Classical Supervised Learning:/);
  assert.equal((request.prompt.match(/^\d\. /gm) || []).length, 5, "more than five misses were listed");
  assert.equal(request.prompt.includes("self-graded"), false);
  assert.ok(request.prompt.length < 1_800, `the misses prompt is ${request.prompt.length} characters`);
  // Long questions, keys and answers still fit On-device Lite, all five kept.
  const long = assessmentMissesRequest(Array.from({ length: 5 }, (_, index) => ({ prompt: `Q${index} ${"q".repeat(600)}`, expected: "e".repeat(600), response: "r".repeat(600) })), { partTitle: "p".repeat(300) });
  assert.ok(long.prompt.length <= TUTOR_BRIDGE_PROMPT_CHARS, `a long misses prompt is ${long.prompt.length} characters`);
  assert.equal((long.prompt.match(/^\d\. /gm) || []).length, 5, "a long check lost some of its misses");
  assert.equal((long.prompt.match(/^ {3}I answered: /gm) || []).length, 5, "a long check lost the learner's answers");
  assert.equal(assessmentMissesRequest([]), null);
});
