export const copyText = async (value) => {
  const text = String(value ?? "");
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return "clipboard";
    } catch {
      // Fall through to the selection-based compatibility path.
    }
  }

  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  field.style.pointerEvents = "none";
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, field.value.length);
  const copied = typeof document.execCommand === "function" && document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard access is unavailable");
  return "selection";
};
