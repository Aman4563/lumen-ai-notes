import assert from "node:assert/strict";
import test from "node:test";

import { assessmentMissesRequest, mistakeTutorRequest } from "./tutorBridge.js";

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
  assert.equal(request.prompt, "Work through this mistake with me, one question at a time. Start by asking what I think went wrong, and do not give me the answer straight away.\n\nQuestion: Why does lasso produce sparse weights?\nExpected answer: The L1 penalty has corners at zero.\nMy answer: Because it squares the weights.");
  const long = mistakeTutorRequest({ prompt: "p".repeat(2_000), expected: "e".repeat(4_000), response: "r".repeat(4_000) });
  for (const field of ["Question: ", "Expected answer: ", "My answer: "]) {
    const line = long.prompt.split("\n").find((entry) => entry.startsWith(field));
    assert.equal(line.length - field.length, 600, `${field.trim()} was not clipped to 600 characters`);
  }
  assert.ok(long.prompt.length < 2_100, `a mistake prompt of ${long.prompt.length} characters is not bounded`);
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
  assert.match(request.prompt, /^Explain the questions I missed in my readiness check for Classical Supervised Learning:/);
  assert.equal((request.prompt.match(/^\d\. /gm) || []).length, 5, "more than five misses were listed");
  assert.equal(request.prompt.includes("self-graded"), false);
  assert.ok(request.prompt.length < 1_800, `the misses prompt is ${request.prompt.length} characters`);
  assert.equal(assessmentMissesRequest([]), null);
});
