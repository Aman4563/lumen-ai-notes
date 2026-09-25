import assert from "node:assert/strict";
import test from "node:test";

import { composerEnterAction, composerKeyHint, sendModifierLabel, shouldRecallLastQuestion } from "./tutorKeyboard.js";

const key = (name, extra = {}) => ({ key: name, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, keyCode: name === "Enter" ? 13 : 38, ...extra });

test("Enter sends only with a fine pointer and outside Code review", () => {
  assert.equal(composerEnterAction(key("Enter"), { finePointer: true }), "send");
  assert.equal(composerEnterAction(key("Enter"), { finePointer: false }), "", "a phone's Return must stay a new line");
  assert.equal(composerEnterAction(key("Enter"), { finePointer: true, codeMode: true }), "", "Code review keeps Enter for pasted code");
  assert.equal(composerEnterAction(key("Enter", { shiftKey: true }), { finePointer: true }), "");
  assert.equal(composerEnterAction(key("Enter", { altKey: true }), { finePointer: true }), "");
  assert.equal(composerEnterAction(key("a"), { finePointer: true }), "");
});

test("Cmd/Ctrl+Enter sends everywhere", () => {
  for (const options of [{ finePointer: true }, { finePointer: false }, { finePointer: true, codeMode: true }]) {
    assert.equal(composerEnterAction(key("Enter", { metaKey: true }), options), "send");
    assert.equal(composerEnterAction(key("Enter", { ctrlKey: true }), options), "send");
  }
});

test("Enter never sends while an input method is composing", () => {
  assert.equal(composerEnterAction(key("Enter", { isComposing: true }), { finePointer: true }), "");
  assert.equal(composerEnterAction(key("Enter", { nativeEvent: { isComposing: true } }), { finePointer: true }), "", "React exposes composition on the native event");
  assert.equal(composerEnterAction(key("Enter", { keyCode: 229 }), { finePointer: true }), "", "Safari reports composition as keyCode 229");
  assert.equal(composerEnterAction(key("Enter", { metaKey: true, isComposing: true }), { finePointer: true }), "");
});

test("Up arrow recalls the last question only from an empty box", () => {
  const empty = { value: "", selectionStart: 0, selectionEnd: 0 };
  assert.equal(shouldRecallLastQuestion(key("ArrowUp"), empty), true);
  assert.equal(shouldRecallLastQuestion(key("ArrowUp"), { value: "draft", selectionStart: 0, selectionEnd: 0 }), false, "a draft must not be replaced");
  assert.equal(shouldRecallLastQuestion(key("ArrowUp", { shiftKey: true }), empty), false);
  assert.equal(shouldRecallLastQuestion(key("ArrowUp", { isComposing: true }), empty), false);
  assert.equal(shouldRecallLastQuestion(key("ArrowDown"), empty), false);
});

test("the hint names the platform's send key and hides on touch screens", () => {
  assert.equal(composerKeyHint({ finePointer: false }), "");
  assert.equal(composerKeyHint({ finePointer: true }), "Enter to send · Shift+Enter for a new line");
  assert.equal(composerKeyHint({ finePointer: true, codeMode: true, platform: "MacIntel" }), "⌘Enter to send · Enter for a new line");
  assert.equal(composerKeyHint({ finePointer: true, codeMode: true, platform: "Win32" }), "Ctrl+Enter to send · Enter for a new line");
  assert.equal(sendModifierLabel("macOS"), "⌘");
  assert.equal(sendModifierLabel("Linux x86_64"), "Ctrl+");
});
