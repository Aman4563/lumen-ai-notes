/**
 * Keyboard behaviour of the tutors' question box (TFEAT-10). A local model
 * request costs seconds to minutes, so Enter sends only where it is
 * unambiguous: with a mouse or trackpad, outside Code review, and never
 * while an input method is composing text. Phones keep Return as a new line
 * and use the Send button.
 */

/** Devices where Enter sends: a precise pointer that can hover. */
export const FINE_POINTER_QUERY = "(pointer: fine) and (hover: hover)";

const composing = (event) => Boolean(event?.nativeEvent?.isComposing ?? event?.isComposing) || event?.keyCode === 229;

/**
 * "send" when this keydown in the question box should send, otherwise ""
 * (the default: a new line). Cmd/Ctrl+Enter sends everywhere.
 */
export const composerEnterAction = (event, { finePointer = false, codeMode = false } = {}) => {
  if (event?.key !== "Enter" || composing(event)) return "";
  if (event.metaKey || event.ctrlKey) return "send";
  if (event.shiftKey || event.altKey) return "";
  return finePointer && !codeMode ? "send" : "";
};

/** Up arrow in an empty box with the caret at its start recalls the last question. */
export const shouldRecallLastQuestion = (event, field) => event?.key === "ArrowUp"
  && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey
  && !composing(event)
  && field?.value === ""
  && field.selectionStart === 0
  && field.selectionEnd === 0;

/** The platform's send modifier as learners see it on their keyboard. */
export const sendModifierLabel = (platform = "") => (/mac|iphone|ipad|ipod/i.test(platform) ? "⌘" : "Ctrl+");

/** The visible hint under the question box; empty on touch screens. */
export const composerKeyHint = ({ finePointer = false, codeMode = false, platform = "" } = {}) => {
  if (!finePointer) return "";
  return codeMode
    ? `${sendModifierLabel(platform)}Enter to send · Enter for a new line`
    : "Enter to send · Shift+Enter for a new line";
};

export const currentPlatform = () => globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || "";
