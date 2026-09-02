/**
 * Document-link resolution, extracted dependency-free so Node test suites
 * (the link audit) share the exact function the Reader uses. content.js
 * re-exports it for existing importers.
 */
export const resolveDocumentLink = (currentPath, href) => {
  if (!href || /^(https?:|mailto:|tel:|#)/i.test(href)) return null;
  const cleanHref = href.split("#")[0];
  if (!cleanHref.endsWith(".md")) return null;
  try {
    const base = new URL(currentPath, "https://lumen.local/");
    const resolved = new URL(cleanHref, base);
    return resolved.pathname.replace(/^\//, "");
  } catch {
    return null;
  }
};
