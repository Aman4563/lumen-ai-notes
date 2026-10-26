// Issue #151: the Review center's recall figures are the 30-day tile (.review-recall-tile), the 7-day
// tile (.review-recall-week) and the 12-week trend (.review-retention-trend). Each says how many
// scheduled reviews it counts, and the 30-day tile adds its target under Adaptive scheduling, so each
// has more text to fit than before. review_audit measures them at a matrix of sizes and a11y_audit in
// its review-recall state; both share this one measurement and report its problems their own way.

export const RECALL_ARTICLES = [".review-recall-tile", ".review-recall-week", ".review-retention-trend"];

// What the three articles let out of their boxes, as a list of problems; empty when they all fit. A
// problem is a visible descendant more than 1 px outside its article, an element whose content is wider
// than its box (text that a box clips or lets spill), an icon squeezed narrower than it is drawn, or a
// page wider than its layout viewport. Mobile emulation grows innerWidth to fit overflowing content, so
// the page is measured against documentElement.clientWidth.
export const recallFit = (page) => page.evaluate((selectors) => {
  const problems = [];
  const named = (node) => `${node.tagName.toLowerCase()}${typeof node.className === "string" && node.className ? `.${node.className.trim().split(/\s+/)[0]}` : ""} “${node.textContent.trim().slice(0, 30)}”`;
  for (const selector of selectors) {
    const article = document.querySelector(selector);
    if (!article) {
      problems.push(`${selector} is missing`);
      continue;
    }
    const box = article.getBoundingClientRect();
    for (const node of article.querySelectorAll("*")) {
      if (!node.getClientRects().length || getComputedStyle(node).visibility === "hidden") continue;
      const rect = node.getBoundingClientRect();
      const outside = Math.max(box.left - rect.left, rect.right - box.right, box.top - rect.top, rect.bottom - box.bottom);
      if (outside > 1) problems.push(`${selector} ${named(node)} leaves its article by ${Math.round(outside)} px`);
      if (node instanceof HTMLElement && node.scrollWidth > node.clientWidth + 1) problems.push(`${selector} ${named(node)} holds ${node.scrollWidth} px of content in ${node.clientWidth} px`);
      if (node instanceof SVGSVGElement && rect.width < node.width.baseVal.value - 1) problems.push(`${selector} ${named(node)} is squeezed to ${Math.round(rect.width)} px of ${node.width.baseVal.value} px`);
    }
  }
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth) problems.push(`the page is ${root.scrollWidth} px wide in a ${root.clientWidth} px viewport`);
  return problems;
}, RECALL_ARTICLES);
