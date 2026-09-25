import assert from "node:assert/strict";
import test from "node:test";

import { progressAnnouncement, progressPhase, tutorProgressSteps } from "./tutorProgress.js";

const summary = (steps) => steps.map((step) => `${step.id}:${step.state}`).join(" ");

test("a Library-first answer moves from finding passages to checking citations", () => {
  const finding = tutorProgressSteps({ sourceMode: "library-first", phase: "retrieving" });
  assert.equal(summary(finding), "find:active draft:pending check:pending done:pending");
  assert.equal(finding[0].label, "Finding passages");

  const drafting = tutorProgressSteps({ sourceMode: "library-first", phase: "generating", passages: 8 });
  assert.equal(summary(drafting), "find:done draft:active check:pending done:pending");
  assert.equal(drafting[0].label, "Found 8 passages");
  assert.equal(progressAnnouncement(drafting), "Found 8 passages. Drafting the answer…");

  const checking = tutorProgressSteps({ sourceMode: "library-first", phase: "validating", passages: 1 });
  assert.equal(summary(checking), "find:done draft:done check:active done:pending");
  assert.equal(checking[0].label, "Found 1 passage");
  assert.equal(progressAnnouncement(checking), "Checking citations…");
});

test("server phases map onto steps, and new phases count as drafting", () => {
  assert.equal(progressPhase("preparing"), "drafting");
  assert.equal(progressPhase("generating"), "drafting");
  assert.equal(progressPhase("validating"), "checking");
  assert.equal(progressPhase("searching"), "searching");
  assert.equal(progressPhase("something-new"), "drafting");
});

test("a web search shows as its own step, and only as done once it ran", () => {
  const waiting = tutorProgressSteps({ sourceMode: "library-first", phase: "generating", passages: 0, web: true });
  assert.equal(summary(waiting), "find:done web:pending draft:active check:pending done:pending");
  assert.equal(waiting[0].label, "No matching passage");
  const searching = tutorProgressSteps({ sourceMode: "library-first", phase: "searching", passages: 0, web: true, searched: true });
  assert.equal(summary(searching), "find:done web:active draft:pending check:pending done:pending");
  assert.equal(progressAnnouncement(searching), "Searching the web…");
  const after = tutorProgressSteps({ sourceMode: "library-first", phase: "generating", passages: 0, web: true, searched: true });
  assert.equal(summary(after), "find:done web:done draft:active check:pending done:pending");
  const neverSearched = tutorProgressSteps({ sourceMode: "library-first", phase: "validating", passages: 2, web: true });
  assert.equal(neverSearched.find((step) => step.id === "web").state, "skipped", "a search that never ran must not look done");
});

test("hand-picked sources are already in place; source-free answers show no steps", () => {
  const chosen = tutorProgressSteps({ sourceMode: "choose", phase: "drafting", passages: 3 });
  assert.equal(summary(chosen), "find:done draft:active check:pending done:pending");
  assert.equal(chosen[0].label, "Using 3 sources");
  assert.deepEqual(tutorProgressSteps({ sourceMode: "none", phase: "generating" }), []);
  assert.deepEqual(tutorProgressSteps({}), []);
  const structured = tutorProgressSteps({ sourceMode: "current", phase: "drafting", passages: 1, structured: true });
  assert.deepEqual(structured.map((step) => step.label), ["Using 1 source", "Building the result", "Checking the result", "Done"]);
});
