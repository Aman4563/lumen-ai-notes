import assert from "node:assert/strict";
import test from "node:test";
import { fitQuestionBox, holdLatest } from "../hooks/useTutorDock.js";

// A tutor keeps a reopened conversation at its latest turn while it renders
// (#93, #94). Once the learner scrolls (or the hold times out) it lets go of
// its resize observer and window listeners at once, not only on unmount.
test("holdLatest releases its observer and listeners as soon as it stops", async () => {
  const listeners = new Map();
  const observers = [];
  globalThis.window = {
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name); },
  };
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.nodes = []; observers.push(this); }
    observe(node) { this.nodes.push(node); }
    disconnect() { this.nodes = []; this.disconnected = true; }
  };
  let kept = 0;
  let stopped = 0;
  const stop = holdLatest(() => { kept += 1; }, () => ["messages", null], () => { stopped += 1; });
  await Promise.resolve();
  assert.equal(kept, 1, "the end is shown once the host has opened the page");
  assert.deepEqual(observers[0].nodes, ["messages"]);
  assert.deepEqual([...listeners.keys()].sort(), ["keydown", "pointerdown", "touchstart", "wheel"]);
  observers[0].callback();
  assert.equal(kept, 2, "a resize while opening keeps the end in view");

  listeners.get("wheel")();
  assert.equal(stopped, 1);
  assert.equal(listeners.size, 0, "the window listeners stay attached after the learner scrolled");
  assert.equal(observers[0].disconnected, true, "the resize observer stays attached after the learner scrolled");
  observers[0].callback();
  assert.equal(kept, 2, "a stopped hold moved the conversation");
  stop();
  assert.equal(stopped, 1, "stopping twice ran onStop twice");
});

// The wide column (#93): the conversation gets the height the question box
// leaves it, and the browser clamps its scroll position whenever a layout
// makes it taller than the room past its end, as measuring the box at one
// line does for a moment.
const column = () => {
  let height = "";
  const field = {
    value: "a question",
    lines: 2,
    style: {
      get height() { return height; },
      set height(value) { height = value; conversation.scrollTop = conversation.top; },
    },
    // 24px lines, 11px padding each side and a 1px border.
    get scrollHeight() { return this.lines * 24 + 22; },
    get offsetHeight() { return height && height !== "auto" ? Number.parseFloat(height) : 48; },
    get clientHeight() { return this.offsetHeight - 2; },
  };
  const conversation = {
    top: 0,
    scrollHeight: 3000,
    get clientHeight() { return 420 - field.offsetHeight; },
    get scrollTop() { return this.top; },
    set scrollTop(value) { this.top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
  };
  globalThis.window = { scrollY: 0, scrollTo: () => {} };
  globalThis.getComputedStyle = () => ({ overflowY: "auto" });
  fitQuestionBox(field, conversation);
  return { field, conversation, fromEnd: () => conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight };
};

test("fitQuestionBox keeps a conversation at its end there as the box grows", () => {
  const { field, conversation, fromEnd } = column();
  conversation.scrollTop = 1e9;
  field.lines = 3;
  const top = fitQuestionBox(field, conversation);
  assert.equal(field.style.height, "96px");
  assert.equal(fromEnd(), 0, "measuring the box left the conversation short of its end");
  assert.equal(top, conversation.scrollTop, "the tutor cannot tell its own scroll from the learner's");
});

test("fitQuestionBox leaves a conversation read back where it was", () => {
  const { field, conversation } = column();
  for (const [place, back] of [["well above the end", 1200], ["just above the end", 20]]) {
    field.lines = 2;
    fitQuestionBox(field, conversation);
    conversation.scrollTop = conversation.scrollHeight - conversation.clientHeight - back;
    const before = conversation.scrollTop;
    field.lines = 4;
    fitQuestionBox(field, conversation);
    assert.equal(conversation.scrollTop, before, `a conversation read back ${place} moved`);
  }
});
