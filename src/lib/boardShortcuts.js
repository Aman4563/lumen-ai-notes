/**
 * Whiteboard keyboard and pointer shortcuts (issue #55). The board renders
 * these as its own keyboard help; the app-wide "?" sheet can list the same
 * entries so the two never drift apart.
 */
export const BOARD_SHORTCUTS = [
  ["V · P · H · E", "Select, pen, highlighter, eraser"],
  ["L · R · O · A · T · N", "Line, rectangle, ellipse, arrow, text, sticky note"],
  ["Tab / Shift + Tab", "Select the next or previous object (drawing surface focused)"],
  ["Enter", "Edit the selected text or sticky note; place new text"],
  ["Arrow keys", "Nudge the selection (Shift: larger steps); pan when zoomed in"],
  ["Delete / Backspace", "Delete the selection"],
  ["⌘/Ctrl + A", "Select every object on the page"],
  ["⌘/Ctrl + C / V", "Copy / paste the selection"],
  ["⌘/Ctrl + Z", "Undo (Shift: redo)"],
  ["Shift + click", "Add or remove an object from the selection"],
  ["Double-click / double-tap", "Edit text or a sticky note"],
  ["⌘/Ctrl + scroll or pinch", "Zoom around the pointer"],
  ["Scroll, Space + drag", "Pan while zoomed in"],
  ["Esc", "Deselect and close menus"],
];
