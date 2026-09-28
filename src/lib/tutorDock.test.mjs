import assert from "node:assert/strict";
import test from "node:test";
import { holdLatest } from "../hooks/useTutorDock.js";

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
