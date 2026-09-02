# PDF / EPUB import deferral (CONTENT-002)

Decided 2026-09-02 with the HTML importer (issue #12). HTML import shipped
dependency-free; these two formats deliberately did not:

- **PDF**: `pdfjs-dist` costs multiple megabytes plus a separate worker file
  against the iPhone-PWA startup budget (PERF-001), and PDFs carry no
  semantic structure — heading and reading-order recovery is heuristic and
  unreliable, which conflicts with the app's promise that imported content
  is faithful study material. If shipped later, it belongs behind the same
  consented-download pattern as the WebLLM model.
- **EPUB**: achievable dependency-free later — an EPUB is a zip of XHTML, so
  `DecompressionStream("deflate-raw")` over the zip local-file headers can
  feed the existing `htmlToMarkdown` converter chapter by chapter. DRM is
  out of scope. This is the preferred next import format.
