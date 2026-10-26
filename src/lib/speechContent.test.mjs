import assert from "node:assert/strict";
import test from "node:test";
import { marked } from "marked";
import { FIXTURE_MARKDOWN, FIXTURE_SPOKEN, fixtureSpoken } from "../../scripts/speech_fixture.mjs";
// markdown.js configures the shared marked renderer on import: tables, code shells and diagram shells.
import "./markdown.js";
// A namespace import, so the test of the shared silent set fails on its own when mathSpeech.js does not export it.
import * as mathSpeech from "./mathSpeech.js";
import * as speakable from "./speakable.js";
import { SPEECH_MARK, buildSpeechQueue } from "./speech.js";
import { blockAt, buildSpeechSections, buildSpeechTarget, buildSpeechUnits, readableBlocks, speechBlockText } from "./speechContent.js";

const { verbalizeMath } = mathSpeech;

// A stub DOM for the speech-unit tests: just the parts of the DOM the walkers
// read, and no layout, so a sentence target takes its no-layout fallbacks.
// Nodes are built with text(data) and el(tag, attrs, children).
const text = (data) => ({
  nodeType: 3,
  data: String(data),
  parentNode: null,
  get parentElement() { return this.parentNode; },
  get textContent() { return this.data; },
});

// A comma list of compound selectors: a tag, .class and [attr] or [attr="value"]
// parts in any mix (`math[display="block"]`). Anything else throws, so a test
// that needs more does not silently match nothing.
const compoundMatcher = (source) => {
  const parts = /^([A-Za-z][\w-]*)?((?:\.[\w-]+|\[[\w:-]+(?:="[^"]*")?\])*)$/u.exec(source);
  if (!source || !parts) throw new Error(`The stub DOM does not support the selector “${source}”`);
  const [, tag, rest] = parts;
  const tests = [...rest.matchAll(/\.([\w-]+)|\[([\w:-]+)(?:="([^"]*)")?\]/gu)].map(([, className, name, value]) => (node) => {
    if (className) return node.classList.contains(className);
    return value === undefined ? node.hasAttribute(name) : node.getAttribute(name) === value;
  });
  return (node) => (!tag || node.localName === tag.toLowerCase()) && tests.every((matches) => matches(node));
};
const selectorMatcher = (source) => {
  const matchers = String(source).split(",").map((part) => compoundMatcher(part.trim()));
  return (node) => node.nodeType === 1 && matchers.some((matches) => matches(node));
};

const el = (tag, attrs = {}, children = []) => {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    localName: tag.toLowerCase(),
    childNodes: [],
    parentNode: null,
    get parentElement() { return this.parentNode; },
    get children() { return this.childNodes.filter((child) => child.nodeType === 1); },
    get textContent() { return this.childNodes.map((child) => child.textContent).join(""); },
    getAttribute: (name) => (Object.hasOwn(attrs, name) ? String(attrs[name]) : null),
    hasAttribute: (name) => Object.hasOwn(attrs, name),
    classList: { contains: (name) => String(attrs.class ?? "").split(/\s+/u).includes(name) },
    // data-diagram-status → dataset.diagramStatus, as the DOM names it.
    dataset: Object.fromEntries(Object.keys(attrs)
      .filter((name) => name.startsWith("data-"))
      .map((name) => [name.slice(5).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase()), String(attrs[name])])),
    matches: (source) => selectorMatcher(source)(node),
    closest(source) {
      const matches = selectorMatcher(source);
      for (let at = node; at; at = at.parentNode) if (matches(at)) return at;
      return null;
    },
    querySelectorAll(source) {
      const matches = selectorMatcher(source);
      const found = [];
      const visit = (parent) => parent.childNodes.forEach((child) => {
        if (child.nodeType !== 1) return;
        if (matches(child)) found.push(child);
        visit(child);
      });
      visit(node);
      return found;
    },
    querySelector: (source) => node.querySelectorAll(source)[0] ?? null,
  };
  for (const child of children) {
    child.parentNode = node;
    node.childNodes.push(child);
  }
  return node;
};

test("the stub DOM answers the queries the speech tests rely on", () => {
  const code = el("pre", { "aria-label": "python code" }, [el("code", {}, [text("x = 1\n")])]);
  const math = el("math", { display: "block" }, [el("mi", {}, [text("x")])]);
  const shell = el("div", { class: "diagram-shell other", "data-diagram-status": "pending" }, [el("div", { class: "mermaid" }, [text("flowchart LR")])]);
  const article = el("article", {}, [el("p", {}, [text("One "), el("em", {}, [text("two")])]), el("div", { class: "code-shell" }, [code]), math, shell]);
  assert.equal(article.textContent, "One twox = 1\nxflowchart LR");
  assert.deepEqual(article.querySelectorAll("p, pre, .diagram-shell, math[display=\"block\"]").map((node) => node.localName), ["p", "pre", "math", "div"]);
  assert.equal(article.querySelector("pre[aria-label=\"python code\"]"), code);
  assert.equal(article.querySelector("[display=\"inline\"]"), null);
  assert.equal(code.closest("div.code-shell"), code.parentElement);
  assert.equal(code.querySelector("code").closest("pre, p"), code);
  assert.equal(shell.matches(".diagram-shell"), true);
  assert.equal(shell.querySelector(".mermaid").closest(".diagram-shell"), shell);
  assert.equal(shell.dataset.diagramStatus, "pending");
  assert.equal(shell.classList.contains("other"), true);
  assert.equal(shell.getAttribute("class"), "diagram-shell other");
  assert.equal(shell.getAttribute("missing"), null);
  assert.equal(shell.hasAttribute("data-diagram-status"), true);
  assert.equal(shell.tagName, "DIV");
  assert.equal(article.children.length, 4);
  assert.equal(article.childNodes[0].childNodes[0].parentElement, article.childNodes[0]);
  assert.throws(() => article.querySelector("div > p"), /does not support the selector/u);
});

test("MathML is read aloud, once, by its structure", () => {
  const read = (node) => verbalizeMath(el("math", { display: "block" }, [el("semantics", {}, [el("mrow", {}, [node].flat())])])).text;
  const mi = (value) => el("mi", {}, [text(value)]);
  const mo = (value, attrs = {}) => el("mo", attrs, [text(value)]);
  const mn = (value) => el("mn", {}, [text(value)]);
  const row = (...children) => el("mrow", {}, children);
  assert.equal(read([el("mtext", {}, [text("Accuracy")]), mo("="), el("mfrac", {}, [row(mi("T"), mi("P"), mo("+"), mi("T"), mi("N")), row(mi("T"), mi("P"), mo("+"), mi("T"), mi("N"), mo("+"), mi("F"), mi("P"), mo("+"), mi("F"), mi("N"))])]), "Accuracy equals T P plus T N, over, T P plus T N plus F P plus F N");
  assert.equal(read([el("mover", {}, [mi("y"), mo("\u{0302}", { accent: "true" })]), mo("="), el("msub", {}, [mi("f"), mi("θ")]), mo("(", { form: "prefix" }), mi("x"), mo(")", { form: "postfix" }), mi(".")]), "y hat equals f theta of (x).");
  assert.equal(read(el("mfrac", {}, [mn("1"), mi("n")])), "1 over n");
  assert.equal(read([el("munderover", {}, [mo("∑"), row(mi("i"), mo("="), mn("1")), mi("n")]), el("msub", {}, [mi("x"), mi("i")])]), "sum from i equals 1 to n of x i");
  assert.equal(read([row(el("mi", { mathvariant: "normal" }, [text("arg")]), mo("\u{2061}")), el("munder", {}, [el("mi", { mathvariant: "normal" }, [text("min")]), mi("θ")])]), "arg min over theta");
  assert.equal(read(el("msup", {}, [mi("θ"), mo("*")])), "theta star");
  assert.equal(read(el("msup", {}, [mi("X"), mi("T")])), "X transpose");
  assert.equal(read(el("msup", {}, [mi("A"), row(mo("−"), mn("1"))])), "A inverse");
  assert.equal(read(el("msup", {}, [mi("γ"), mi("k")])), "gamma to the power of k");
  assert.equal(read(el("msub", {}, [mi("r"), row(mi("t"), mo("+"), mi("k"), mo("+"), mn("1"))])), "r sub t plus k plus 1");
  assert.equal(read(el("msqrt", {}, [mi("x")])), "square root of x");
  assert.equal(read([mi("P"), mo("(", { form: "prefix" }), mi("y"), mo("="), mn("1"), mo("∣"), mi("x"), mo(")", { form: "postfix" })]), "P of (y equals 1 given x)");
  assert.equal(verbalizeMath(el("math", {}, [el("semantics", {}, [row(mi("x")), el("annotation", { encoding: "application/x-tex" }, [text("x")])])])).text, "x");
});

// MathML builders for the walker tests below. `math(...)` wraps its nodes the
// way Pandoc does (math > semantics > mrow).
const mathml = {
  mi: (value, attrs = {}) => el("mi", attrs, [text(value)]),
  mo: (value, attrs = {}) => el("mo", attrs, [text(value)]),
  mn: (value) => el("mn", {}, [text(value)]),
  mtext: (value) => el("mtext", { mathvariant: "normal" }, [text(value)]),
  row: (...children) => el("mrow", {}, children),
  of: (tag, ...children) => el(tag, {}, children),
  math: (...nodes) => el("math", { display: "block" }, [el("semantics", {}, [el("mrow", {}, nodes.flat())])]),
};
const readMath = (...nodes) => verbalizeMath(mathml.math(...nodes)).text;

test("a KaTeX copy of a formula reads like the Pandoc one", () => {
  const { mi, mo, mn, row, of } = mathml;
  // KaTeX gives parentheses no form attribute, writes the hat as "^" and
  // spells \mathbb{E} as a double-struck E.
  const fence = { stretchy: "false" };
  assert.equal(readMath(el("mover", { accent: "true" }, [mi("y"), mo("^")]), mo("="), of("msub", mi("f"), mi("θ")), mo("(", fence), mi("x"), mo(")", fence), mi(".", { mathvariant: "normal" })), "y hat equals f theta of (x).");
  assert.equal(readMath(mi("E", { mathvariant: "double-struck" }), mo("[", fence), mi("X"), mo("]", fence)), "expected value of [X]");
  assert.equal(readMath(mi("Var", { mathvariant: "normal" }), mo("\u{2061}"), mo("(", fence), mi("X"), mo(")", fence)), "Var of (X)");
  assert.equal(readMath(mi("arg"), mo("\u{2061}"), of("msub", row(mi("min"), mo("\u{2061}")), mi("θ")), mi("L"), mo("(", fence), mi("θ"), mo(")", fence)), "arg min over theta L of (theta)");
  assert.equal(readMath(of("msubsup", mo("∑"), row(mi("i"), mo("="), mn("1")), mi("n")), of("msubsup", mi("x"), mi("i"), mn("2"))), "sum from i equals 1 to n of x i squared");
  assert.equal(readMath(of("msup", mi("x"), mi("⊤", { mathvariant: "normal" }))), "x transpose");
});

test("operators, symbols and punctuation are read as words", () => {
  const { mi, mo, mn, mtext } = mathml;
  assert.equal(readMath(mi("a"), mo("≤"), mi("b"), mo("≠"), mi("c"), mo("≈"), mi("d"), mo("∈"), mi("S"), mo("∉"), mi("T")), "a less than or equal to b not equal to c approximately d in S not in T");
  assert.equal(readMath(mi("a"), mo("<"), mi("b"), mo(">"), mi("c"), mo("≥"), mi("d")), "a less than b greater than c greater than or equal to d");
  assert.equal(readMath(mi("a"), mo("×"), mi("b"), mo("⋅"), mi("c"), mo("·"), mi("d"), mo("÷"), mi("e"), mo("±"), mi("f"), mo("−"), mi("g"), mo("-"), mi("h")), "a times b times c times d divided by e plus or minus f minus g minus h");
  assert.equal(readMath(mi("x"), mo("→"), mn("0"), mo("⇒"), mi("y"), mo("⇔"), mi("z"), mo("∝"), mi("w"), mo("∼"), mi("p")), "x leads to 0 implies y if and only if z proportional to w distributed as p");
  assert.equal(readMath(mi("n"), mo("!"), mo("*")), "n factorial star");
  // Pandoc spells some operators as identifiers.
  assert.equal(readMath(mi("a"), mi("/"), mi("b"), mi("+"), mi("−"), mi("c")), "a over b plus minus c");
  assert.equal(readMath(mo("{"), mi("x"), mo("}"), mo("\u{2062}"), mo("\u{2063}"), mo("\u{2064}"), mi("y")), "x y");
  assert.equal(readMath(mi("a"), mo(","), mi("b"), mo(";"), mi("c"), mo(":"), mi("d"), mi(".")), "a, b; c: d.");
  assert.equal(readMath(mo("["), mi("a"), mo(","), mi("b"), mo("]"), mo("("), mi("c"), mo(")")), "[a, b] (c)");
  assert.equal(readMath(mi("α"), mi("Δ"), mi("ℓ"), mi("∞"), mi("ℝ"), mi("Σ"), mi("𝔼"), mi("∂"), mi("∇", { mathvariant: "normal" })), "alpha Delta ell infinity R Sigma expected value of partial gradient of");
  assert.equal(readMath(mn("0.04"), mtext(" relevant items in top K"), mi("%")), "0.04 relevant items in top K %");
});

test("vertical bars read as an absolute value, a norm or the conditioning bar", () => {
  const { mi, mo, mn, of } = mathml;
  const bar = (form, mark = "|") => mo(mark, form ? { form } : {});
  assert.equal(readMath(bar("prefix"), mi("x"), bar("postfix")), "the absolute value of x");
  // Pandoc gives both bars of |y − z| the prefix form, so the second one closes the first.
  assert.equal(readMath(bar("prefix"), mi("y"), mo("−"), mi("z"), bar("prefix"), mo("="), mn("1")), "the absolute value of y minus z equals 1");
  assert.equal(readMath(bar("prefix"), mi("a"), bar("prefix"), mo("+"), bar("prefix"), mi("b"), bar("prefix")), "the absolute value of a plus the absolute value of b");
  assert.equal(readMath(mi("y"), bar(null), mi("x")), "y given x");
  assert.equal(readMath(bar("prefix", "‖"), mi("w"), bar("postfix", "‖")), "the norm of w");
  assert.equal(readMath(bar("prefix", "∥"), mi("w"), bar("prefix", "∥")), "the norm of w");
  // The closing bar can carry a script: |x|² and ‖w‖₂ are bars with a script.
  assert.equal(readMath(bar("prefix"), mi("x"), of("msup", bar("prefix"), mn("2"))), "the absolute value of x squared");
  assert.equal(readMath(bar("prefix", "‖"), mi("w"), of("msub", bar("postfix", "‖"), mn("2"))), "the L2 norm of w");
  // Typed bars pair off in order around a balanced stretch, whatever their form: Pandoc's | in either form and
  // KaTeX's ∣ (U+2223) written as an identifier. A typed bar with no partner is the conditioning bar. \mid is
  // the operator ∣, never pairs and always says "given".
  const mid = "\u{2223}";
  const cond = (left, right) => [mi("P"), mo("(", { form: "prefix" }), mi(left), bar("prefix"), mi(right), mo(")", { form: "postfix" })];
  assert.equal(readMath(cond("y", "x")), "P of (y given x)");
  assert.equal(readMath(mi(mid), mi("x"), mi(mid)), "the absolute value of x");
  assert.equal(readMath(mi("P"), mo("(", { stretchy: "false" }), mi("y"), mi(mid), mi("x"), mo(")", { stretchy: "false" })), "P of (y given x)");
  assert.equal(readMath(bar("postfix"), mi("x")), "given x", "a lone bar says given whatever its form");
  assert.equal(readMath(mo(mid), mi("x"), mo(mid)), "given x given");
  assert.equal(readMath(cond("a", "b"), mo("+"), cond("c", "d")), "P of (a given b) plus P of (c given d)", "the bars of two conditionals in one row are separators");
  assert.equal(readMath(mi("P"), mo("("), bar("prefix"), mi("x"), bar("prefix"), mo(">"), mn("1"), bar("prefix"), mi("y"), mo(")")), "P of (the absolute value of x greater than 1 given y)");
});

test("big operators read their limits, and Pandoc's inline form reads the same", () => {
  const { mi, mo, mn, row, of } = mathml;
  assert.equal(readMath(of("msub", mo("∑"), mi("i")), of("msub", mi("a"), mi("i"))), "sum over i of a i");
  assert.equal(readMath(of("munder", mo("∑"), mi("j")), mi("x")), "sum over j of x");
  assert.equal(readMath(of("munderover", mo("∏"), row(mi("t"), mo("="), mn("1")), mi("T")), of("msub", mi("p"), mi("t"))), "product from t equals 1 to T of p t");
  assert.equal(readMath(of("msubsup", mo("∫"), mn("0"), mn("1")), mi("g")), "integral from 0 to 1 of g");
  assert.equal(readMath(mo("∫"), mi("g")), "integral of g");
  assert.equal(readMath(mo("∑"), mi("x")), "sum of x");
  assert.equal(readMath(mi("𝔼"), mo("["), mi("X"), mo("]")), "expected value of [X]");
  assert.equal(readMath(of("msub", mi("𝔼"), row(mi("x"), mo("∼"), mi("p"))), mo("["), mi("f"), mo("]")), "expected value over x distributed as p of [f]");
  assert.equal(readMath(of("munder", mi("lim"), row(mi("x"), mo("→"), mn("0"))), mi("f")), "lim over x leads to 0 f");
  // A capital sigma is a sum as an operator and the letter as an identifier; KaTeX's 𝔼 is a double-struck E.
  assert.equal(readMath(of("munder", mo("Σ"), mi("i")), mi("x")), "sum over i of x");
  assert.equal(readMath(of("msub", mi("E", { mathvariant: "double-struck" }), mi("x")), mi("f")), "expected value over x of f");
  assert.equal(readMath(of("munder", row(mi("arg"), mo("\u{2061}"), mi("max")), mi("θ")), mi("L")), "arg max over theta L");
});

test("a single letter, a Greek letter or a listed function applied to parentheses says of", () => {
  const { mi, mo, mn, row, of } = mathml;
  const named = (name) => row(mi(name, { mathvariant: "normal" }), mo("\u{2061}"));
  const call = (...args) => [mo("("), ...args, mo(")")];
  assert.equal(readMath(named("log"), call(mi("x"))), "log of (x)");
  assert.equal(readMath(of("msub", named("log"), mn("2")), call(mi("i"), mo("+"), mn("1"))), "log 2 of (i plus 1)");
  assert.equal(readMath(mi("ℓ"), call(mi("y"))), "ell of (y)");
  assert.equal(readMath(mi("σ"), call(mi("z"))), "sigma of (z)");
  assert.equal(readMath(of("msup", mi("f"), mo("*")), call(mi("x"))), "f star of (x)");
  assert.equal(readMath(of("mover", mi("f"), mo("\u{0302}", { accent: "true" })), call(mi("x"))), "f hat of (x)");
  // Not a function: a number, a name outside the list, a closing bracket, a big operator, 𝔼 (its reading already ends in "of").
  assert.equal(readMath(mn("2"), call(mi("x"))), "2 (x)");
  assert.equal(readMath(mi("foo"), call(mi("x"))), "foo (x)");
  assert.equal(readMath(call(mi("x")), call(mi("y"))), "(x) (y)");
  assert.equal(readMath(of("msub", mo("∑"), mi("i")), call(mi("x"))), "sum over i of (x)");
  assert.equal(readMath(mi("𝔼"), call(mi("X"))), "expected value of (X)");
});

test("a bracket applies to a function, not to whatever a construct happens to end in", () => {
  const { mi, mo, mn, row, of } = mathml;
  const call = (...args) => [mo("("), ...args, mo(")")];
  const cell = (...nodes) => of("mtd", ...nodes);
  // Pandoc's \frac{1}{N}(X^T X), \frac{1}{n}(x-y)^2, 2^k(x+1), (1-\alpha)^t(x) and \sqrt{x}(y).
  assert.equal(readMath(of("mfrac", mn("1"), mi("N")), call(of("msup", mi("X"), mi("T")), mi("X"))), "1 over N (X transpose X)");
  assert.equal(readMath(of("mfrac", mn("1"), mi("n")), mo("("), mi("x"), mo("−"), mi("y"), of("msup", mo(")"), mn("2"))), "1 over n (x minus y) squared");
  assert.equal(readMath(of("msup", mn("2"), mi("k")), call(mi("x"), mo("+"), mn("1"))), "2 to the power of k (x plus 1)");
  assert.equal(readMath(mo("("), mn("1"), mo("−"), mi("α"), of("msup", mo(")"), mi("t")), call(mi("x"))), "(1 minus alpha) to the power of t (x)");
  assert.equal(readMath(of("msqrt", mi("x")), call(mi("y"))), "square root of x (y)");
  // The same for a root with an index, a table, a subscript on a number and what sits under a letter.
  assert.equal(readMath(of("mroot", mi("x"), mi("n")), call(mi("y"))), "root n of x (y)");
  assert.equal(readMath(of("mtable", of("mtr", cell(mi("a")), cell(mi("b")))), call(mi("x"))), "a, b (x)");
  assert.equal(readMath(of("msub", mn("2"), mi("i")), call(mi("x"))), "2 i (x)");
  assert.equal(readMath(of("munder", mi("x"), mi("a")), call(mi("y"))), "x with a below (y)");
  assert.equal(readMath(of("msup", mi("ℝ", { mathvariant: "double-struck" }), mi("d")), call(mi("x"))), "R d (x)");
  // A function with a script, an accent or a word for a subscript still takes its bracket.
  const hat = () => of("mover", mi("f"), mo("\u{0302}", { accent: "true" }));
  assert.equal(readMath(of("msub", mi("f"), mi("θ")), call(mi("x"))), "f theta of (x)");
  assert.equal(readMath(of("msup", mi("f"), mo("*")), call(mi("x"))), "f star of (x)");
  assert.equal(readMath(hat(), call(mi("x"))), "f hat of (x)");
  assert.equal(readMath(of("msub", hat(), row(mi("e"), mi("n"), mi("s"))), call(mi("x"))), "f hat ens of (x)");
  assert.equal(readMath(of("msub", row(mi("log"), mo("\u{2061}")), mn("2")), call(mi("i"), mo("+"), mn("1"))), "log 2 of (i plus 1)");
  assert.equal(readMath(of("msub", mi("P"), row(mi("t"), mi("r"), mi("a"), mi("i"), mi("n"))), call(mi("x"))), "P train of (x)");
  assert.equal(readMath(of("msub", mo("∑"), mi("i")), call(mi("x"))), "sum over i of (x)");
  assert.equal(readMath(of("msup", mi("γ"), mi("k")), call(mi("r"))), "gamma to the power of k of (r)", "γ is a function base, so the brief's rule stands");
  // An operator with limits that does not end in "of" keeps one before a bracket: \min_\theta (f).
  assert.equal(readMath(of("msub", row(mi("min"), mo("\u{2061}")), mi("θ")), call(mi("f"))), "min over theta of (f)");
  assert.equal(readMath(of("munder", row(mi("arg"), mo("\u{2061}"), mi("max")), mi("θ")), call(mi("f"))), "arg max over theta of (f)");
  assert.equal(readMath(of("munder", mi("lim"), row(mi("x"), mo("→"), mn("0"))), call(mi("f"))), "lim over x leads to 0 of (f)");
  assert.equal(readMath(of("munder", mi("max"), mi("i")), call(mi("a"))), "max over i of (a)");
});

test("accents are read after their base and any other mover says what sits above", () => {
  const { mi, mo, row, of } = mathml;
  const accented = (mark) => readMath(of("mover", mi("x"), mo(mark)));
  // Pandoc's marks are combining characters; KaTeX's are the plain ones (^ ~ and the modifier macron).
  const marks = {
    hat: ["^", "\u{0302}"],
    bar: ["\u{203E}", "\u{00AF}", "\u{0305}", "\u{02C9}"],
    tilde: ["\u{02DC}", "~", "\u{0303}"],
    dot: ["\u{02D9}", "\u{0307}"],
    vector: ["\u{2192}", "\u{20D7}"],
  };
  for (const [word, spellings] of Object.entries(marks)) for (const mark of spellings) assert.equal(accented(mark), `x ${word}`, `U+${mark.codePointAt(0).toString(16)}`);
  assert.equal(readMath(of("mover", row(mi("A"), mi("B")), mo("\u{203E}"))), "A B bar");
  assert.equal(readMath(of("mover", mi("x"), mi("a"))), "x with a above");
  assert.equal(readMath(of("munder", mi("x"), mi("a"))), "x with a below");
  assert.equal(readMath(of("munderover", mi("x"), mi("a"), mi("b"))), "x with a below and b above");
});

test("scripts read as transpose, inverse, squared and the like", () => {
  const { mi, mo, mn, row, of } = mathml;
  assert.equal(readMath(of("msup", mi("x"), mn("2"))), "x squared");
  assert.equal(readMath(of("msup", mi("x"), mn("3"))), "x cubed");
  assert.equal(readMath(of("msup", mi("x"), mo("′"))), "x prime");
  assert.equal(readMath(of("msup", mi("f"), mo("″"))), "f double prime", "Pandoc writes two primes as one character");
  assert.equal(readMath(of("msup", mi("f"), row(mo("′"), mo("′")))), "f double prime", "KaTeX as two");
  // Pandoc spells the minus of an inverse as an identifier.
  assert.equal(readMath(of("msup", mi("n"), row(mi("−"), mn("1")))), "n inverse");
  assert.equal(readMath(of("msup", mi("x"), row(mi("n"), mo("+"), mn("1")))), "x to the power of n plus 1");
  assert.equal(readMath(of("msup", mn("2"), row(mi("r"), of("msub", mi("l"), mi("i"))))), "2 to the power of r l i");
  assert.equal(readMath(of("msup", mi("x"), of("msqrt", mn("2")))), "x to the power of square root of 2");
  assert.equal(readMath(of("msub", mi("x"), mn("1"))), "x 1");
  assert.equal(readMath(of("msub", mi("y"), row(mi("i"), mi("k")))), "y sub i k");
  assert.equal(readMath(of("msubsup", mi("x"), mi("i"), mn("2"))), "x i squared");
  assert.equal(readMath(mo("("), mi("p"), mo("−"), mi("y"), of("msup", mo(")"), mn("2"))), "(p minus y) squared");
});

test("fractions, roots and tables", () => {
  const { mi, mo, mn, mtext, row, of } = mathml;
  assert.equal(readMath(of("mfrac", mi("d"), row(mi("d"), mi("x")))), "d, over, d x");
  assert.equal(readMath(of("mfrac", of("msqrt", mi("x")), mn("2"))), "square root of x, over, 2");
  assert.equal(readMath(of("msqrt", row(mi("x"), mo("+"), mn("1")))), "square root of x plus 1");
  assert.equal(readMath(of("mroot", mi("x"), mn("3"))), "root 3 of x");
  assert.equal(readMath(of("mroot", row(mi("x"), mo("+"), mn("1")), mn("3"))), "root 3 of x plus 1");
  assert.equal(readMath(of("mroot", mi("x"), row())), "x", "a root missing its index says what is there");
  const cell = (...nodes) => of("mtd", ...nodes);
  const line = (...cells) => of("mtr", ...cells);
  const matrix = () => of("mtable", line(cell(mi("a")), cell(mi("b"))), line(cell(mi("c")), cell(mi("d"))));
  assert.equal(readMath(matrix()), "a, b; c, d");
  assert.equal(readMath(mo("["), matrix(), mo("]")), "[a, b; c, d]");
  assert.equal(readMath(mo("{"), of("mtable", line(cell(mn("1")), cell(row(mi("x"), mo(">"), mn("0")))), line(cell(mn("0")), cell(mtext("otherwise"))))), "1, x greater than 0; 0, otherwise");
  assert.equal(readMath(of("mtable", line(cell(mi("a")), cell()), line(cell(mi("c")), cell(mi("d"))))), "a; c, d");
  // Pandoc's cases rows already end in commas: no ",," or ",;".
  const comma = () => mo(",");
  assert.equal(readMath(mo("{"), of("mtable", line(cell(mn("1"), comma()), cell(row(mi("x"), mo(">"), mn("0")), comma())), line(cell(mn("0"), comma()), cell(mtext("otherwise"))))), "1, x greater than 0, 0, otherwise");
});

test("the walker reads the text pass's own word tables", () => {
  const { mi, mo, of } = mathml;
  for (const name of ["SYMBOLS", "SUPERSCRIPT_WORDS", "COMBINING_MARKS", "BIG_OPERATORS", "LONE_OPERATORS", "FUNCTION_NAMES", "NORM_BARS", "REALS", "normPhrase"]) {
    assert.ok(speakable[name], `speakable.js exports ${name}`);
  }
  const named = (text) => `U+${text.codePointAt(0).toString(16).toUpperCase()}`;
  // Whatever the text pass names, the walker names the same way: Greek letters, operators, relations, arrows.
  for (const [symbol, word] of speakable.SYMBOLS) {
    assert.equal(readMath(mi(symbol)), word, `${named(symbol)} as an identifier`);
    assert.equal(readMath(mo(symbol)), word, `${named(symbol)} as an operator`);
  }
  for (const [script, word] of speakable.SUPERSCRIPT_WORDS) assert.equal(readMath(of("msup", mi("x"), mi(script))), `x ${word}`, script);
  for (const [mark, word] of speakable.COMBINING_MARKS) assert.equal(readMath(of("mover", mi("x"), mo(mark))), `x ${word}`, named(mark));
  for (const [operator, name] of speakable.BIG_OPERATORS) assert.equal(readMath(mo(operator)), `${name} of`, operator);
  for (const [operator, { word }] of speakable.LONE_OPERATORS) assert.equal(readMath(mo(operator)), word, operator);
  for (const name of speakable.FUNCTION_NAMES) assert.equal(readMath(mi(name), mo("("), mi("x"), mo(")")), `${name} of (x)`, name);
  assert.equal(readMath(mi(speakable.REALS)), "R");
  for (const bar of speakable.NORM_BARS) assert.equal(readMath(mi(bar), mi("x"), mi(bar)), "the norm of x", named(bar));
});

test("norm bars pair off in a row whatever their form, and the closing bar's scripts name the norm", () => {
  const { mi, mo, mn, of } = mathml;
  const bar = (form, mark = "‖") => mo(mark, form ? { form } : {});
  // Pandoc gives both bars of \|w\| the postfix form, and puts the order and the square on the closing bar.
  assert.equal(readMath(bar("postfix"), mi("w"), bar("postfix")), "the norm of w");
  assert.equal(readMath(bar("postfix", "∥"), mi("w"), of("msubsup", bar("postfix", "∥"), mn("2"), mn("2"))), "the squared L2 norm of w");
  assert.equal(readMath(bar("postfix"), mi("w"), of("msub", bar("postfix"), mn("2"))), "the L2 norm of w");
  assert.equal(readMath(bar("postfix"), mi("w"), of("msup", bar("postfix"), mn("2"))), "the squared norm of w");
  assert.equal(readMath(bar("postfix"), mi("A"), of("msub", bar("postfix"), mi("F"))), "the Frobenius norm of A");
  assert.equal(readMath(bar("postfix"), mi("x"), of("msub", bar("postfix"), mi("∞"))), "the L infinity norm of x");
  assert.equal(readMath(bar("postfix"), mi("x"), of("msub", bar("postfix"), mi("p"))), "the Lp norm of x");
  // A superscript that is not a square stays in the reading, after the content.
  assert.equal(readMath(bar("postfix"), mi("x"), of("msup", bar("postfix"), mi("p"))), "the norm of x to the power of p");
  // Two norms in a row pair off in order.
  assert.equal(readMath(bar("postfix"), mi("a"), bar("postfix"), mo("+"), bar("postfix"), mi("b"), of("msub", bar("postfix"), mn("1"))), "the norm of a plus the L1 norm of b");
  // KaTeX spells the bars as identifiers, and Pandoc's \left\| ... \right\| marks them prefix and postfix.
  assert.equal(readMath(mi("∥"), mi("w"), of("msub", mi("∥"), mn("2"))), "the L2 norm of w");
  assert.equal(readMath(bar("prefix", "∥"), mi("w"), bar("postfix", "∥")), "the norm of w");
  // Bars pair only around a balanced stretch: the bars of two KL terms in one row are separators, not a norm
  // (the corpus's Jensen-Shannon formula), and a norm after a KL term still pairs.
  const kl = (left, right) => [mi("D"), mo("("), mi(left), bar("postfix", "∥"), mi(right), mo(")")];
  assert.equal(readMath(kl("P", "M"), mo("+"), kl("Q", "M")), "D of (P M) plus D of (Q M)");
  assert.equal(readMath(kl("P", "Q"), mo("+"), bar("postfix"), mi("w"), bar("postfix")), "D of (P Q) plus the norm of w");
  assert.equal(readMath(bar("postfix"), mi("w"), bar("postfix"), mo("+"), kl("P", "Q")), "the norm of w plus D of (P Q)");
  assert.equal(readMath(bar("postfix"), mo("("), mi("a"), mo("+"), mi("b"), mo(")"), bar("postfix")), "the norm of (a plus b)");
  // A bar alone in its row reads as before: the KL divergence's bar is postfix and says nothing, a lone prefix bar opens, a lone identifier stays as written.
  assert.equal(readMath(mi("D"), mo("("), mi("P"), bar("postfix", "∥"), mi("Q"), mo(")")), "D of (P Q)");
  assert.equal(readMath(bar("prefix"), mi("w")), "the norm of w");
  assert.equal(readMath(mi("P"), mi("∥"), mi("Q")), "P ∥ Q");
});

test("a norm says the same words in MathML as in the text pass", () => {
  const { mi, mo, mn, of } = mathml;
  const { subOpen, subClose } = speakable.SPEECH_MARK;
  const bar = () => mo("‖", { form: "postfix" });
  const cases = [
    ["‖w‖", [bar(), mi("w"), bar()]],
    ["‖w‖₂", [bar(), mi("w"), of("msub", bar(), mn("2"))]],
    ["‖w‖²", [bar(), mi("w"), of("msup", bar(), mn("2"))]],
    ["‖w‖₂²", [bar(), mi("w"), of("msubsup", bar(), mn("2"), mn("2"))]],
    ["‖x‖ₚ", [bar(), mi("x"), of("msub", bar(), mi("p"))]],
    [`‖A‖${subOpen}F${subClose}`, [bar(), mi("A"), of("msub", bar(), mi("F"))]],
    ["‖x‖∞", [bar(), mi("x"), of("msub", bar(), mi("∞"))]],
  ];
  for (const [unicode, nodes] of cases) assert.equal(readMath(nodes), speakable.speakable(unicode), unicode);
  assert.equal(speakable.normPhrase("2", true), "the squared L2 norm of");
  assert.equal(speakable.normPhrase("", false), "the norm of");
});

test("a power of the reals reads as the text pass reads it: R m by n", () => {
  const { mi, mo, mn, row, of } = mathml;
  const reals = () => mi("ℝ", { mathvariant: "double-struck" });
  assert.equal(readMath(of("msup", reals(), row(mi("m"), mo("×"), mi("n")))), "R m by n");
  assert.equal(readMath(of("msup", reals(), mi("d"))), "R d");
  assert.equal(readMath(of("msup", reals(), mn("2"))), "R 2");
  assert.equal(readMath(of("msup", reals(), row(mi("m"), mi("ˣ"), mi("n")))), "R m by n");
  // KaTeX writes a double-struck R.
  assert.equal(readMath(of("msup", mi("R", { mathvariant: "double-struck" }), row(mi("m"), mo("×"), mi("n")))), "R m by n");
  // A nested exponent reads as math.
  assert.equal(readMath(of("msup", reals(), of("msub", mi("d"), row(mi("m"), mi("o"), mi("d"), mi("e"), mi("l"))))), "R d model");
  // × says "times" everywhere else, and a power of anything else is still a power.
  assert.equal(readMath(mi("a"), mo("×"), mi("b")), "a times b");
  assert.equal(readMath(of("msup", mi("x"), row(mi("m"), mo("×"), mi("n")))), "x to the power of m times n");
});

test("Mathematical Alphanumeric letters read as the plain letter, after the table lookup", () => {
  const { mi, mo } = mathml;
  assert.equal(readMath(mi("𝒟", { mathvariant: "script" })), "D");
  assert.equal(readMath(mi("\u{1D431}", { mathvariant: "bold" })), "x");
  assert.equal(readMath(mi("\u{1D499}", { mathvariant: "bold-italic" })), "x");
  assert.equal(readMath(mi("\u{1D6C2}", { mathvariant: "bold" })), "alpha", "a bold Greek letter is looked up again once it is plain");
  assert.equal(readMath(mi("\u{1D41F}"), mo("("), mi("x"), mo(")")), "f of (x)", "a bold f is still a letter that can be applied");
  // 𝔼 and ℓ would fold into E and l: the table comes first.
  assert.equal(readMath(mi("𝔼")), "expected value of");
  assert.equal(readMath(mi("ℓ")), "ell");
  assert.equal(readMath(mi("\u{1D431}\u{1D432}")), "xy", "every letter of an identifier folds");
  // The Letterlike block folds too (\mathcal{L} is U+2112), the table still first, and its symbols stay.
  assert.equal(readMath(mi("\u{2112}", { mathvariant: "script" }), mo("("), mi("θ"), mo(")")), "L of (theta)");
  assert.equal(readMath(mi("\u{211D}")), "R");
  assert.equal(readMath(mi("\u{2115}")), "N");
  assert.equal(readMath(mi("\u{2126}")), "Omega", "the ohm sign is a capital omega");
  assert.equal(readMath(mi("\u{2135}")), "\u{2135}", "alef is not turned into a Hebrew letter");
  assert.equal(readMath(mi("\u{2122}")), "\u{2122}", "a symbol of the block is left as written");
});

test("inside a script a run of three or more single letters reads as one word", () => {
  const { mi, mo, mn, row, of } = mathml;
  const letters = (word) => row(...[...word].map((letter) => mi(letter)));
  assert.equal(readMath(of("msub", mi("P"), letters("train"))), "P train");
  assert.equal(readMath(of("msub", mi("π"), letters("ref"))), "pi ref");
  assert.equal(readMath(of("msup", mi("x"), letters("abc"))), "x to the power of abc");
  assert.equal(readMath(of("munder", mi("min"), letters("abc"))), "min over abc");
  assert.equal(readMath(of("mover", mi("x"), letters("abc"))), "x with abc above");
  assert.equal(readMath(of("msubsup", mi("x"), letters("abc"), mn("2"))), "x abc squared");
  // The run is one token, so P_{train}(x) is a function with a one-word subscript, and a hat on the function
  // keeps it one: \hat{f}_{ens}(x).
  assert.equal(readMath(of("msub", mi("P"), letters("train")), mo("("), mi("x"), mo(")")), "P train of (x)");
  assert.equal(readMath(of("msub", of("mover", mi("f"), mo("\u{0302}", { accent: "true" })), letters("ens")), mo("("), mi("x"), mo(")")), "f hat ens of (x)");
  // Fewer than three stay spelled, and so do letters outside any script.
  assert.equal(readMath(of("msub", mi("C"), letters("FP"))), "C sub F P");
  assert.equal(readMath(mi("T"), mi("P"), mi("R")), "T P R");
  assert.equal(readMath(of("msub", mi("x"), row(mi("a"), mi("b"), mo("+"), mi("c"), mi("d"), mi("e")))), "x sub a b plus cde");
  // A letter that is read by name (Greek, ℓ) or is not a letter breaks a run.
  assert.equal(readMath(of("msub", mi("x"), row(mi("a"), mi("θ"), mi("b"), mi("c")))), "x sub a theta b c");
  assert.equal(readMath(of("msub", mi("x"), row(mi("a"), mi("b"), mi("ℓ"), mi("c"), mi("d")))), "x sub a b ell c d", "ℓ would fold into an l, so it is checked before folding");
  assert.equal(readMath(of("msub", mi("x"), row(mi("a"), mi("b"), mn("1"), mi("c"), mi("d")))), "x sub a b 1 c d");
  // Spaces between the letters of pretty-printed markup do not break the run, and the run reaches into a nested fraction.
  assert.equal(readMath(of("msub", mi("x"), el("mrow", {}, [text("\n"), mi("t"), text(" "), mi("r"), text("\n"), mi("a")]))), "x tra");
  assert.equal(readMath(of("msup", mi("x"), of("mfrac", letters("num"), letters("den")))), "x to the power of num over den", "each side of the fraction is one word, so one token");
});

test("silent markup, spaces and strange input", () => {
  const { mi, mo, mn, mtext, row, of } = mathml;
  assert.equal(readMath(mi("a"), of("mphantom", mi("b")), mi("c")), "a c");
  assert.equal(verbalizeMath(el("math", {}, [el("semantics", {}, [row(mi("x")), el("annotation", { encoding: "application/x-tex" }, [text("y")]), el("annotation-xml", {}, [mi("z")])])])).text, "x");
  assert.equal(readMath(mi("a"), el("mspace", { width: "1em" }), mi("b")), "a b");
  assert.equal(readMath(mtext("Precision@K"), mo("="), mn("1"), mo(","), el("mspace", { width: "2.0em" }), mtext("Recall@K")), "Precision@K equals 1, Recall@K");
  assert.deepEqual(verbalizeMath(el("math", {}, [])), { text: "", map: [] });
  assert.equal(verbalizeMath(el("math", {}, [text("x")])).text, "", "text outside a token is not read: the sanitizer leaves an annotation's TeX there");
  // Nesting far deeper than any formula is read as its text, not recursed into: these plain nodes
  // hold their text up front, so only the walker could overflow the stack.
  let deep = { nodeType: 1, localName: "mi", childNodes: [{ nodeType: 3, textContent: "x" }], textContent: "x" };
  for (let level = 0; level < 100000; level += 1) deep = { nodeType: 1, localName: "mrow", childNodes: [deep], textContent: "x" };
  assert.equal(verbalizeMath({ nodeType: 1, localName: "math", childNodes: [deep], textContent: "x" }).text, "x");
});

test("the MathML walker needs only the minimal node interface", () => {
  // No localName, no getAttribute, no classList: a fake built for the blocks tests.
  const leaf = (tagName, data) => ({ nodeType: 1, tagName, childNodes: [{ nodeType: 3, textContent: data }], textContent: data });
  const math = { nodeType: 1, tagName: "MATH", childNodes: [leaf("MI", "x"), leaf("MO", "="), leaf("MN", "1")], textContent: "x=1" };
  assert.equal(verbalizeMath(math).text, "x equals 1");
});

// The invariants of a map (see spokenMap.js): contiguous over the spoken text, sources in bounds,
// non-decreasing and non-overlapping; nothing spoken means no map.
const checkMap = (root, label) => {
  const { text: spoken, map } = verbalizeMath(root);
  const source = root.textContent;
  assert.equal(map.length > 0, spoken !== "", `${label}: a reading has a map and nothing else does`);
  if (map.length) {
    assert.equal(map[0].spoken[0], 0, label);
    assert.equal(map.at(-1).spoken[1], spoken.length, label);
  }
  map.forEach((piece, index) => {
    const [start, end] = piece.source;
    assert.ok(piece.spoken[0] < piece.spoken[1], `${label}: piece ${index} is empty`);
    assert.ok(start >= 0 && start <= end && end <= source.length, `${label}: piece ${index} is out of bounds`);
    if (index) {
      assert.equal(piece.spoken[0], map[index - 1].spoken[1], `${label}: a gap before piece ${index}`);
      assert.ok(start >= map[index - 1].source[1], `${label}: piece ${index} overlaps the one before`);
    }
  });
  const pieceOf = (words) => map.find((piece) => spoken.slice(...piece.spoken) === words);
  return { spoken, map, source, pieceOf };
};

test("malformed trees never throw and keep the map contract", () => {
  const { mi, mo, mn } = mathml;
  const parts = () => [mi("x"), mo("+"), mn("1"), mi("θ"), mo("‖"), mo("|")];
  const tags = ["mfrac", "msub", "msup", "msubsup", "munder", "mover", "munderover", "msqrt", "mroot", "mtable", "mtr", "mtd", "mrow", "mstyle", "semantics", "mphantom", "annotation", "annotation-xml", "mspace", "mi", "mo", "mn", "mtext", "unknown"];
  for (const tag of tags) {
    // Every child count, from none to more than any construct takes.
    for (let count = 0; count <= parts().length; count += 1) checkMap(mathml.math(el(tag, {}, parts().slice(0, count))), `${tag} with ${count} children`);
    // An element holding only itself empty, and one holding only spaces.
    checkMap(mathml.math(el(tag, {}, [el(tag, {}, []), text("  ")])), `${tag} in ${tag}`);
    checkMap(mathml.math(el(tag, {}, [text("\n ")])), `${tag} of spaces`);
  }
  checkMap(mathml.math(el("mtable", {}, [mi("a"), el("mtr", {}, [mi("b"), el("mtd", {}, [])]), el("mtr", {}, [])])), "a table of strange rows");
  checkMap(mathml.math(el("msub", {}, [text("x"), text("y")])), "scripts of text");
  checkMap(mathml.math(el("mfrac", {}, [el("mrow", {}, []), mi("n")])), "a fraction with an empty top");
});

test("the MathML map is contiguous, ordered and anchors inserted words to an empty range", () => {
  const { mi, mo, mn, mtext, row, of, math } = mathml;
  const check = (root, label) => {
    const result = checkMap(root, label);
    assert.ok(result.map.length, `${label}: a reading has a map`);
    return result;
  };
  const side = (...children) => row(...children);
  const accuracy = math(mtext("Accuracy"), mo("="), of("mfrac", side(mi("T"), mi("P"), mo("+"), mi("T"), mi("N")), side(mi("T"), mi("P"), mo("+"), mi("T"), mi("N"), mo("+"), mi("F"), mi("P"), mo("+"), mi("F"), mi("N"))));
  assert.equal(check(accuracy, "accuracy").spoken, "Accuracy equals T P plus T N, over, T P plus T N plus F P plus F N");
  const hat = math(of("mover", mi("y"), mo("\u{0302}", { accent: "true" })), mo("="), of("msub", mi("f"), mi("θ")), mo("(", { form: "prefix" }), mi("x"), mo(")", { form: "postfix" }), mi("."));
  const hatMap = check(hat, "hat");
  assert.equal(hatMap.spoken, "y hat equals f theta of (x).");
  // y [0,1] U+0302 [1,2] = [2,3] f [3,4] θ [4,5] ( [5,6] x [6,7] ) [7,8] . [8,9]: "of" sits at the "(", "hat" reads the accent.
  assert.deepEqual(hatMap.pieceOf("of").source, [5, 5]);
  assert.deepEqual(hatMap.pieceOf("hat").source, [1, 2]);
  assert.deepEqual(hatMap.pieceOf("theta").source, [4, 5]);
  assert.deepEqual(hatMap.pieceOf(".").source, [8, 9]);
  // The anchor: an inserted word has an empty source range at its position.
  const fraction = check(math(of("mfrac", mn("1"), mi("n"))), "one over n");
  assert.equal(fraction.spoken, "1 over n");
  assert.deepEqual(fraction.pieceOf("1").source, [0, 1]);
  assert.deepEqual(fraction.pieceOf("over").source, [1, 1]);
  assert.deepEqual(fraction.pieceOf("n").source, [1, 2]);
  // A word that reads a script maps to the script it reads; the words around it are inserted.
  const power = check(math(of("msup", mi("x"), mn("2")), of("msup", mi("y"), mi("k"))), "powers");
  assert.equal(power.spoken, "x squared y to the power of k");
  assert.deepEqual(power.pieceOf("squared").source, [1, 2]);
  assert.deepEqual(power.pieceOf("to the power of").source, [3, 3]);
  // A reordered construct is one piece over its whole source.
  const root = check(math(mi("a"), mo("+"), of("mroot", mi("x"), mn("3"))), "root");
  assert.equal(root.spoken, "a plus root 3 of x");
  assert.deepEqual(root.pieceOf("root 3 of x").source, [2, 4]);
  // Annotation text is part of the offsets and is never spoken.
  const annotated = el("math", {}, [el("semantics", {}, [row(mi("x")), el("annotation", { encoding: "application/x-tex" }, [text("x")])])]);
  const kept = check(annotated, "annotation");
  assert.equal(kept.source, "xx");
  assert.deepEqual(kept.map.map((piece) => piece.source), [[0, 1]]);
  // Whitespace between elements counts in the offsets and is not spoken.
  const printed = el("math", {}, [text("\n  "), el("semantics", {}, [text("\n"), row(text("\n "), mi("a"), text("\n "), mo("+"), text("\n "), mi("b"), text("\n")), text("\n")]), text("\n")]);
  const spaced = check(printed, "pretty-printed");
  assert.equal(spaced.spoken, "a plus b");
  assert.deepEqual(["a", "plus", "b"].map((word) => spaced.pieceOf(word).source), [[6, 7], [9, 10], [12, 13]]);
  assert.deepEqual(["a", "+", "b"], [6, 9, 12].map((at) => spaced.source[at]));
  // A text token's own spaces are not part of its piece.
  const padded = check(math(mtext(" latency ")), "padded");
  assert.equal(padded.spoken, "latency");
  assert.deepEqual(padded.map[0].source, [1, 8]);
  // The newer constructs keep them too: a norm whose order and square sit on the closing bar, a power
  // of the reals, bold letters (two UTF-16 units each) and a run of letters read as one word.
  const closing = () => mo("‖", { form: "postfix" });
  const norm = check(math(closing(), mi("w"), of("msubsup", closing(), mn("2"), mn("2"))), "norm");
  assert.equal(norm.spoken, "the squared L2 norm of w");
  assert.deepEqual(norm.pieceOf("the squared L2 norm of").source, [0, 1], "the words sit on the opening bar and the closing bar's scripts are a gap");
  assert.deepEqual(norm.pieceOf("w").source, [1, 2]);
  const reals = check(math(of("msup", mi("ℝ", { mathvariant: "double-struck" }), row(mi("m"), mo("×"), mi("n")))), "reals");
  assert.equal(reals.spoken, "R m by n");
  assert.deepEqual(reals.pieceOf("by").source, [2, 3]);
  const bold = check(math(mi("\u{1D431}"), mi("𝒟")), "bold letters");
  assert.equal(bold.spoken, "x D");
  assert.deepEqual([bold.pieceOf("x").source, bold.pieceOf("D").source], [[0, 2], [2, 4]]);
  const word = check(math(of("msub", mi("P"), row(...[..."train"].map((letter) => mi(letter))))), "letter run");
  assert.equal(word.spoken, "P train");
  assert.deepEqual(word.pieceOf("train").source, [1, 6]);
  // Bigger formulas keep the invariants too.
  const cell = (...nodes) => of("mtd", ...nodes);
  const line = (...cells) => of("mtr", ...cells);
  check(math(of("munderover", mo("∑"), side(mi("i"), mo("="), mn("1")), mi("n")), of("msub", mi("x"), mi("i")), mo("="), of("msqrt", side(mi("a"), mo("+"), mn("1"))), mo("|", { form: "prefix" }), mi("z"), mo("|", { form: "prefix" }), of("mtable", line(cell(mi("a")), cell(mi("b"))), line(cell(mi("c")), cell(mi("d")))), mo(".")), "mixed");
});

// ---------------------------------------------------------------------------------------------------------
// Speech units for text blocks, sections and targets (issue #100, Task 3b).
// ---------------------------------------------------------------------------------------------------------

const spoken = (root, options) => buildSpeechQueue(buildSpeechUnits(root, options)).queue.map((entry) => entry.text);

// A fenced block as marked renders it: the shell, its header (the language and a Copy button) and the pre.
const codeShell = (label, body) => el("div", { class: "code-shell" }, [
  el("div", { class: "code-label" }, [el("span", {}, [text(label)]), el("button", { class: "code-copy", type: "button", "aria-label": `Copy ${label} code` }, [text("Copy")])]),
  el("pre", { tabindex: "0", role: "group", "aria-label": `${label} code` }, [el("code", { class: `language-${label === "text" ? "" : label}` }, [text(body)])]),
]);

// KaTeX's display math: the MathML, which the narration reads, beside the visible copy, which it does not.
const katexDisplay = (letter) => el("span", { class: "katex-display" }, [el("span", { class: "katex" }, [
  el("span", { class: "katex-mathml" }, [mathml.math(mathml.mi(letter))]),
  el("span", { class: "katex-html", "aria-hidden": "true" }, [text(letter)]),
])]);

// The fixture lecture as the app's marked renders it (scripts/speech_fixture.mjs), as stub DOM: tables hold "\n"
// text nodes between their cells and rows, code is a codeShell, the block formula sits inside a <p>, and a
// Mermaid fence is a div.diagram-shell.
const fixture = () => {
  const nl = () => text("\n");
  const cell = (tag, value) => [el(tag, {}, [text(value)]), nl()];
  const line = (tag, values) => el("tr", {}, [nl(), ...values.flatMap((value) => cell(tag, value))]);
  const { mi, mo, mtext, row, of, math } = mathml;
  const side = (...letters) => row(...letters.map((letter) => (letter === "+" ? mo("+") : mi(letter))));
  return el("article", {}, [
    el("h1", {}, [text("Speakable fixture")]), nl(),
    el("h2", {}, [text("6. Task taxonomy")]), nl(),
    el("p", {}, [text("Classification predicts a label.")]), nl(),
    el("div", { class: "table-scroll", tabindex: "0", role: "group", "aria-label": "Table" }, [
      el("table", {}, [
        nl(),
        el("thead", {}, [nl(), line("th", ["Situation", "First inspect", "Safe action"]), nl()]),
        nl(),
        el("tbody", {}, [line("td", ["Disk full", "df -h", "Free space"]), nl(), line("td", ["High latency", "p99 graphs", "Roll back"]), nl()]),
      ]),
      nl(),
    ]),
    codeShell("python", "import numpy as np\nX = np.ones((3, 2))\ny = np.zeros(3)\nw = np.linalg.lstsq(X, y, rcond=None)[0]\nprint(w)\nprint(w.shape)"),
    codeShell("text", "name a ─┐\n        ├──> list object\nname b ─┘"),
    el("p", {}, [text("First line"), el("br"), text("Second line")]), nl(),
    el("p", {}, [text("The model predicts ŷ = wᵀx + b for each input.")]), nl(),
    el("p", {}, [math(mtext("Accuracy"), mo("="), of("mfrac", side("T", "P", "+", "T", "N"), side("T", "P", "+", "T", "N", "+", "F", "P", "+", "F", "N")), mo(","))]), nl(),
    el("div", { class: "diagram-shell", "data-diagram-status": "pending", tabindex: "0", role: "group", "aria-label": "Diagram" }, [
      el("div", { class: "mermaid", "data-diagram-status": "pending", role: "img", "aria-label": "Mermaid diagram awaiting rendering" }, [text("flowchart LR\n  A[Data] --> B[Model]\n  B --> C[Prediction]")]),
    ]),
    el("p", {}, [text("Gradient descent repeats three steps for every batch of examples, measuring the loss on that batch, computing the gradient of the loss for every single weight, and moving each weight a smaller step against its gradient until the loss stops improving.")]), nl(),
  ]);
};

// Reading-line geometry for the stub: the target's line sits 140 px below the container's top.
const placed = (node, top, bottom) => Object.assign(node, { getBoundingClientRect: () => ({ top, bottom }) });
const lineAt = (top) => ({ getBoundingClientRect: () => ({ top: top - 140, height: 800 }) });

// What issue #101 relies on (it highlights from these offsets): every text unit's map starts at 0 and tiles its text,
// its sources are non-decreasing and stay inside the unit's range, an identity piece (spoken and source of equal
// length) reads the very characters it maps to unless the unit holds math (a letter read by name), and the units of a
// block tile the block.
const checkUnits = (root, units, { exact = true } = {}) => {
  const blocks = readableBlocks(root);
  const clean = blocks.map(speechBlockText);
  const ends = new Map();
  for (const unit of units) {
    if (unit.kind === "announcement") continue;
    const { blockIndex, start, end } = unit.unit;
    const label = `“${unit.text}” of block ${blockIndex}`;
    assert.ok(blocks[blockIndex], `${label}: no such block`);
    assert.ok(0 <= start && start <= end && end <= clean[blockIndex].length, `${label}: range ${start}-${end}`);
    assert.ok(stripMarks(unit.text).trim(), `${label}: says nothing`);
    assert.equal(ends.has(blockIndex) ? ends.get(blockIndex) : 0, start, `${label}: the units of a block tile it`);
    ends.set(blockIndex, end);
    assert.equal(unit.map[0].spoken[0], 0, label);
    assert.equal(unit.map.at(-1).spoken[1], unit.text.length, label);
    let previous = null;
    for (const piece of unit.map) {
      const [spokenStart, spokenEnd] = piece.spoken;
      const [from, to] = piece.source;
      assert.ok(spokenStart < spokenEnd, `${label}: an empty piece`);
      assert.ok(start <= from && from <= to && to <= end, `${label}: a piece reaches outside ${start}-${end}`);
      if (previous) {
        assert.equal(spokenStart, previous.spoken[1], `${label}: a gap before ${spokenStart}`);
        assert.ok(from >= previous.source[1], `${label}: pieces overlap in the block`);
      }
      if (exact && spokenEnd - spokenStart === to - from) assert.equal(unit.text.slice(spokenStart, spokenEnd), clean[blockIndex].slice(from, to), `${label}: an identity piece reads other characters`);
      previous = piece;
    }
  }
  for (const [blockIndex, end] of ends) assert.equal(end, clean[blockIndex].length, `block ${blockIndex}: its last unit ends at the end of the block`);
};
const stripMarks = (value) => value.replace(/[\uE000-\uE005]/gu, "");

test("the stub fixture reads as the text marked renders for the fixture lecture", () => {
  const html = marked.parse(FIXTURE_MARKDOWN);
  const rendered = html.replace(/<[^>]*>/gu, "").replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
  assert.equal(fixture().textContent, rendered);
});

test("every unit carries blockIndex, start, end and map, and text units tile their block", () => {
  const root = fixture();
  const blocks = readableBlocks(root);
  const units = buildSpeechUnits(root, { code: "read" });
  for (const unit of units) {
    const block = blocks[unit.unit.blockIndex];
    assert.ok(block, `unit “${unit.text}” names block ${unit.unit.blockIndex}`);
    if (unit.kind === "announcement") assert.deepEqual([unit.unit.start, unit.unit.end, unit.map], [0, 0, []]);
  }
  blocks.forEach((block, index) => {
    const own = units.filter((unit) => unit.unit.blockIndex === index && unit.kind !== "announcement");
    if (!own.length) return;
    assert.equal(own[0].unit.start, 0);
    own.forEach((unit, at) => { if (at) assert.equal(unit.unit.start, own[at - 1].unit.end); });
    assert.equal(own.at(-1).unit.end, speechBlockText(block).length);
  });
  assert.equal(blockAt(root, 2), blocks[2]);
  // A plain paragraph's units are its source sentences.
  const paragraph = el("p", {}, [text("Gradient descent moves downhill.  Learning rate\ncontrols each step.")]);
  const article = el("article", {}, [paragraph]);
  assert.deepEqual(buildSpeechUnits(article).map(({ unit }) => speechBlockText(paragraph).slice(unit.start, unit.end).trim()), ["Gradient descent moves downhill.", "Learning rate controls each step."]);
});

test("an edited copy's KaTeX is read once and inline math joins its sentence", () => {
  const katex = el("span", { class: "katex" }, [
    el("span", { class: "katex-mathml" }, [el("math", {}, [el("semantics", {}, [el("mrow", {}, [el("mi", {}, [text("L")])]), el("annotation", { encoding: "application/x-tex" }, [text("L")])])])]),
    el("span", { class: "katex-html", "aria-hidden": "true" }, [text("L")]),
  ]);
  const paragraph = el("p", {}, [text("The loss "), katex, text(" is low. Next.")]);
  assert.deepEqual(spoken(el("article", {}, [paragraph])), ["The loss L is low.", "Next."]);
});

test("<br> and nested blocks are sentence breaks; headings end as sentences", () => {
  assert.deepEqual(spoken(el("article", {}, [el("h2", {}, [text("6. Task taxonomy")]), el("p", {}, [text("First line"), el("br"), text("Second line")])])), ["6. Task taxonomy.", "First line.", "Second line."]);
  assert.deepEqual(spoken(el("article", {}, [el("blockquote", {}, [el("p", {}, [text("One idea")]), el("p", {}, [text("Another idea")])])])), ["One idea.", "Another idea."]);
  // The text before a nested block and the text after it are sentences of their own.
  const nested = el("li", {}, [text("Outer item"), el("ul", {}, [el("li", {}, [text("Inner item")]), el("li", {}, [text("Next item")])]), text("Closing words")]);
  assert.deepEqual(spoken(el("article", {}, [el("ul", {}, [nested])])), ["Outer item.", "Inner item.", "Next item.", "Closing words."]);
  const units = buildSpeechUnits(el("article", {}, [el("p", {}, [text("Call "), el("code", {}, [text("a/b = c")]), text(" ≈ 2.")])]));
  assert.ok(units[0].text.includes(SPEECH_MARK.plainOpen));
  assert.deepEqual(buildSpeechQueue(units).queue.map((entry) => entry.text), ["Call a/b = c approximately 2."]);
});

test("the sentence target is one unit and the document target carries units", () => {
  const root = fixture();
  const documentTarget = buildSpeechTarget({ scope: "document", article: root });
  assert.equal(documentTarget.units.length, buildSpeechUnits(root).length);
  assert.ok(documentTarget.text.startsWith("Speakable fixture. 6. Task taxonomy."));
  const sentence = buildSpeechTarget({ scope: "sentence", article: root, scrollContainer: { getBoundingClientRect: () => ({ top: 0, height: 800 }) } });
  assert.equal(sentence.units.length, 1);
});

test("the fixture's text blocks speak exactly the text-block lines of FIXTURE_SPOKEN", () => {
  const root = fixture();
  const blocks = readableBlocks(root);
  const textUnits = buildSpeechUnits(root).filter((unit) => /^(?:h[1-4]|p|li|blockquote|figcaption)$/u.test(blocks[unit.unit.blockIndex].localName));
  // The table, the code and text diagram, the display formula and the diagram say the other lines (Task 3c).
  const others = /^(?:Table,|Row \d+\.|Python example,|Text diagram,|Accuracy equals|Diagram:)/u;
  assert.deepEqual(buildSpeechQueue(textUnits).queue.map((entry) => entry.text), FIXTURE_SPOKEN.filter((line) => !others.test(line)));
});

test("readableBlocks lists text blocks and atomic blocks in document order and drops what is read elsewhere", () => {
  const bareCode = () => el("pre", {}, [el("code", {}, [text("x = 1")])]);
  const outer = el("li", {}, [text("Outer "), el("ul", {}, [el("li", {}, [text("Inner")])])]);
  const quote = el("blockquote", {}, [el("p", {}, [text("Quoted")])]);
  // What marked writes for a fence that is all a list item or a quote holds: a shell with a header above the pre.
  const stepShell = codeShell("bash", "make test");
  const onlyFence = el("li", {}, [stepShell]);
  const quoteShell = codeShell("python", "print(1)");
  const quoteOfFence = el("blockquote", {}, [quoteShell]);
  const onlyBare = el("li", {}, [bareCode()]);
  const formula = mathml.math(mathml.mi("x"));
  const onlyFormula = el("p", {}, [formula]);
  const displayShell = katexDisplay("y");
  const onlyDisplay = el("p", {}, [displayShell]);
  const inline = el("p", {}, [text("Let "), el("math", {}, [el("mi", {}, [text("x")])]), text(" be.")]);
  const diagramError = el("div", { class: "diagram-shell" }, [el("p", {}, [text("The Mermaid module could not be loaded.")]), el("pre", {}, [text("flowchart LR")])]);
  const empty = el("p", {}, [text(" \n ")]);
  const caption = el("figcaption", {}, [text("Figure 1")]);
  const cellParagraph = el("p", {}, [text("cell")]);
  const row = el("tr", {}, [el("td", {}, [cellParagraph])]);
  const runShell = codeShell("bash", "make test");
  const withFence = el("li", {}, [text("Run this:"), runShell]);
  const article = el("article", {}, [outer, quote, el("ul", {}, [onlyFence]), quoteOfFence, el("ul", {}, [onlyBare]), onlyFormula, onlyDisplay, inline, diagramError, empty, caption, el("table", {}, [el("tbody", {}, [row])]), el("ul", {}, [withFence])]);
  const blocks = readableBlocks(article);
  // Named, so that a wrong list reads as names rather than as two dumps of circular stub nodes.
  const names = new Map([
    [outer, "outer"], [quote, "quote"], [stepShell.childNodes[1], "step fence"], [quoteShell.childNodes[1], "quote fence"], [onlyBare.childNodes[0], "bare fence"],
    [formula, "formula"], [displayShell.querySelector("math"), "display formula"], [inline, "inline"], [diagramError, "diagram"], [caption, "caption"], [row, "row"],
    [withFence, "withFence"], [runShell.childNodes[1], "withFence fence"],
  ]);
  assert.deepEqual(blocks.map((block) => names.get(block) ?? `${block.localName} “${block.textContent}”`), [
    "outer", "quote", "step fence", "quote fence", "bare fence", "formula", "display formula", "inline", "diagram", "caption", "row", "withFence", "withFence fence",
  ]);
  assert.equal(blockAt(article, 8), diagramError);
  assert.equal(blockAt(article, blocks.length), null);
  assert.equal(blockAt(article, -1), null);
  assert.deepEqual(readableBlocks(el("article")), []);
  assert.deepEqual(readableBlocks(null), []);
});

test("a unit's map indexes the block's text exactly, whatever is skipped or collapsed around it", () => {
  const { subOpen, subClose, supOpen, supClose, plainOpen, plainClose } = SPEECH_MARK;
  const paragraph = el("p", {}, [
    text("  Mass  "), el("span", { class: "katex-html" }, [text("XYZ")]), text("  of x"),
    el("sub", {}, [text("i")]), text(" and "), el("sup", {}, [text("2")]), text(" and "), el("code", {}, [text("np.ones")]), text(".\n"),
    el("em", {}, [text("Second  "), el("strong", {}, [text("sentence")])]), text(" ends here"),
  ]);
  const article = el("article", {}, [paragraph]);
  const units = buildSpeechUnits(article);
  assert.deepEqual(units.map((unit) => unit.text), [
    `Mass of x${subOpen}i${subClose} and ${supOpen}2${supClose} and ${plainOpen}np.ones${plainClose}.`,
    "Second sentence ends here.",
  ]);
  checkUnits(article, units);
  const block = speechBlockText(paragraph);
  assert.equal(block, "Mass XYZ of xi and 2 and np.ones. Second sentence ends here");
  // The source of a word is the very word in the block, and the added full stop sits at the end of its sentence.
  const second = units[1];
  const piece = (words) => second.map.find((item) => second.text.slice(...item.spoken) === words);
  assert.equal(block.slice(...piece("sentence").source), "sentence");
  assert.deepEqual(piece(".").source, [block.length, block.length]);
  assert.deepEqual([units[0].unit.start, units[0].unit.end, units[1].unit.start, units[1].unit.end], [0, block.indexOf("Second"), block.indexOf("Second"), block.length]);
  assert.deepEqual(units.map((unit) => unit.kind), [undefined, undefined]);
  // Markers sit where their element's content starts and ends, with empty source ranges.
  const first = units[0];
  const open = first.map.find((item) => first.text[item.spoken[0]] === subOpen);
  assert.deepEqual(open.source, [block.indexOf("i and"), block.indexOf("i and")]);
});

test("skipped markup counts in the offsets and speaks nothing", () => {
  const hidden = (value) => el("span", { class: "katex-html", "aria-hidden": "true" }, [text(value)]);
  const math = el("math", {}, [el("semantics", {}, [
    el("mrow", {}, [el("mi", {}, [text("y")]), el("mphantom", {}, [el("mi", {}, [text("PH")])])]),
    el("annotation-xml", {}, [text("AX")]),
    el("annotation", { encoding: "application/x-tex" }, [text("y")]),
  ])]);
  // The code inside the list item is a block of its own: the item neither reads it nor joins its two sides.
  const item = el("li", {}, [text("A"), hidden("HIDDEN"), text(" B "), math, text(" C"), el("pre", {}, [text("code body")]), text(" D")]);
  const article = el("article", {}, [el("ul", {}, [item])]);
  // The code under the item is a block of its own: it announces itself after the item's two sentences.
  const everything = buildSpeechUnits(article);
  assert.deepEqual(everything.map((unit) => unit.text), ["A B y C.", "D.", "Code example, 1 line."]);
  const units = everything.filter((unit) => unit.kind !== "announcement");
  assert.deepEqual(units.map((unit) => unit.text), ["A B y C.", "D."]);
  checkUnits(article, units);
  const block = speechBlockText(item);
  assert.equal(block, "AHIDDEN B yPHAXy Ccode body D");
  assert.deepEqual(units.map(({ unit }) => [unit.blockIndex, unit.start, unit.end]), [[0, 0, 28], [0, 28, 29]]);
  const word = (unit, words) => unit.map.find((piece) => unit.text.slice(...piece.spoken) === words);
  assert.deepEqual(word(units[0], "y").source, [10, 11], "a formula's word maps into the formula's own text");
  assert.deepEqual(word(units[0], "C").source, [17, 18]);
  assert.deepEqual(word(units[1], "D").source, [28, 29]);
});

test("the walk that finds a text block's words and the walk that says them agree on what is silent", () => {
  const silent = [
    ["annotation", () => el("annotation", { encoding: "application/x-tex" }, [text("TEX")])],
    ["annotation-xml", () => el("annotation-xml", {}, [text("AX")])],
    ["mphantom", () => el("mphantom", {}, [text("PH")])],
    ["katex-html", () => el("span", { class: "katex-html", "aria-hidden": "true" }, [text("HTML")])],
    ["code-label", () => el("div", { class: "code-label" }, [text("bash"), el("button", {}, [text("Copy")])])],
  ];
  for (const [name, make] of silent) {
    // Only a fenced block and something silent: no words, so the item is no block and only the fence is.
    const item = el("li", {}, [make(), codeShell("bash", "make test"), make()]);
    const fenced = el("article", {}, [el("ul", {}, [item])]);
    assert.deepEqual(readableBlocks(fenced).map((block) => block.localName), ["pre"], `${name} counted as the words of a list item`);
    assert.deepEqual(buildSpeechUnits(fenced).map((unit) => unit.text), ["Shell example, 1 line."], `${name}: only the fence speaks, never the item or the silent markup`);
    // The same markup between words is counted in the offsets and not said.
    const sentence = el("p", {}, [text("A "), make(), text(" B.")]);
    const article = el("article", {}, [sentence]);
    const units = buildSpeechUnits(article);
    assert.deepEqual(units.map((unit) => unit.text), ["A B."], `${name} was said`);
    checkUnits(article, units);
  }
});

test("a code block inside a list item leaves the label of its shell unread", () => {
  // A fence under a list step is rendered inside that item, header included.
  const item = el("li", {}, [text("Run this first:"), codeShell("bash", "make test"), text(" then check.")]);
  const article = el("article", {}, [el("ul", {}, [item])]);
  const units = buildSpeechUnits(article);
  assert.deepEqual(units.map((unit) => unit.text), ["Run this first:", "then check.", "Shell example, 1 line."]);
  assert.deepEqual(readableBlocks(article).map((block) => block.localName), ["li", "pre"]);
  assert.equal(speechBlockText(item), "Run this first:bashCopymake test then check.");
  checkUnits(article, units);
});

test("whatever follows the last spoken word belongs to the last unit", () => {
  const trailing = el("p", {}, [text("Only words"), el("span", { class: "katex-html" }, [text("HIDDEN")]), text("  ")]);
  const withCode = el("li", {}, [text("Run it:"), el("pre", {}, [text("make test")])]);
  const article = el("article", {}, [trailing, el("ul", {}, [withCode])]);
  const units = buildSpeechUnits(article);
  assert.deepEqual(units.map((unit) => [unit.text, unit.unit.blockIndex, unit.unit.start, unit.unit.end]), [
    ["Only words.", 0, 0, "Only wordsHIDDEN".length],
    ["Run it:", 1, 0, "Run it:make test".length],
    ["Code example, 1 line.", 2, 0, 0],
  ]);
  checkUnits(article, units);
});

test("an inline code span with nothing to say leaves no marker, and a hard break inside one keeps every unit balanced", () => {
  const { plainOpen, plainClose } = SPEECH_MARK;
  const empty = el("p", {}, [text("Use "), el("code", {}, []), text(" and "), el("code", {}, [text(" ")]), text(" here.")]);
  assert.deepEqual(buildSpeechUnits(el("article", {}, [empty])).map((unit) => unit.text), ["Use and here."]);
  const broken = el("article", {}, [el("p", {}, [text("Run "), el("code", {}, [text("one"), el("br"), text("two")]), text(" now")])]);
  const units = buildSpeechUnits(broken);
  assert.deepEqual(units.map((unit) => unit.text), [`Run ${plainOpen}one${plainClose}.`, `${plainOpen}two${plainClose} now.`]);
  checkUnits(broken, units);
  assert.deepEqual(spoken(broken), ["Run one.", "two now."]);
});

test("a sentence boundary never falls inside inline code, a script or inline math", () => {
  const { plainOpen, plainClose, supOpen, supClose } = SPEECH_MARK;
  const code = (...children) => el("code", {}, children.length ? children : [text("print(\"Hello. World\")")]);
  const unitsOf = (...children) => buildSpeechUnits(el("article", {}, [el("p", {}, children)]));
  // A full stop and a capital inside the code is a sentence end to the segmenter; the unit keeps the code whole.
  const hello = unitsOf(text("Call "), code(), text(" to greet. Next one."));
  assert.ok(hello.some((unit) => unit.text.includes(`${plainOpen}print("Hello. World")${plainClose}`)), JSON.stringify(hello.map((unit) => unit.text)));
  assert.equal(hello.at(-1).text, "Next one.");
  // The segmenter ends the sentence between the full stop and the closing marker: the boundary follows the marker.
  const stop = unitsOf(text("Use "), code(text("foo.")), text(" Next sentence here."));
  assert.deepEqual(stop.map((unit) => unit.text), [`Use ${plainOpen}foo.${plainClose}`, "Next sentence here."]);
  const power = unitsOf(text("The cost is O(n)"), el("sup", {}, [text("2.")]), text(" Next sentence here."));
  assert.deepEqual(power.map((unit) => unit.text), [`The cost is O(n)${supOpen}2.${supClose}`, "Next sentence here."]);
  // Inline math whose reading holds a sentence end stays one piece.
  const prose = el("math", {}, [el("mtext", {}, [text("Step one. Step two")])]);
  const read = unitsOf(text("See "), prose, text(" now. Next sentence."));
  assert.ok(read.some((unit) => unit.text.includes("Step one. Step two")), JSON.stringify(read.map((unit) => unit.text)));
  assert.equal(read.at(-1).text, "Next sentence.");
  checkUnits(el("article", {}, [el("p", {}, [text("See "), prose, text(" now. Next sentence.")])]), read, { exact: false });
});

// A paragraph of the given nodes, and inline code holding the given text.
const paragraphOf = (...children) => el("article", {}, [el("p", {}, children)]);
const inlineCode = (value) => el("code", {}, [text(value)]);

test("a sentence goes on past an atomic piece that holds a sentence end", () => {
  const { plainOpen, plainClose, supOpen, supClose } = SPEECH_MARK;
  const call = () => inlineCode("print(\"Hello. World\")");
  // The full stop and the capital inside the code are no sentence end: the unit goes on past the code.
  const greet = paragraphOf(text("Call "), call(), text(" to greet."));
  assert.deepEqual(buildSpeechUnits(greet).map((unit) => unit.text), [`Call ${plainOpen}print("Hello. World")${plainClose} to greet.`]);
  assert.deepEqual(spoken(greet), ["Call print(\"Hello. World\") to greet."]);
  checkUnits(greet, buildSpeechUnits(greet));
  assert.deepEqual(spoken(paragraphOf(text("Call "), call(), text(" to greet. Next one."))), ["Call print(\"Hello. World\") to greet.", "Next one."]);
  // The same for a script and for a formula whose reading holds a sentence end.
  const note = paragraphOf(text("The note"), el("sup", {}, [text("See above. Then below")]), text(" ends here. Next one."));
  assert.deepEqual(buildSpeechUnits(note).map((unit) => unit.text), [`The note${supOpen}See above. Then below${supClose} ends here.`, "Next one."]);
  const formula = paragraphOf(text("See "), el("math", {}, [el("mtext", {}, [text("Step one. Step two")])]), text(" now. Next one."));
  assert.deepEqual(spoken(formula), ["See Step one. Step two now.", "Next one."]);
  checkUnits(formula, buildSpeechUnits(formula), { exact: false });
});

test("a sentence ends after an atomic piece that closes on its end", () => {
  const { plainOpen, plainClose, supOpen, supClose } = SPEECH_MARK;
  // The segmenter puts the closing marker in the next sentence; the boundary follows the marker.
  const stop = paragraphOf(text("Use "), inlineCode("foo."), text(" Next one."));
  assert.deepEqual(buildSpeechUnits(stop).map((unit) => unit.text), [`Use ${plainOpen}foo.${plainClose}`, "Next one."]);
  assert.deepEqual(spoken(stop), ["Use foo.", "Next one."]);
  checkUnits(stop, buildSpeechUnits(stop));
  // Two groups closing together, and one that closes on the end of the text.
  const nested = paragraphOf(text("Cost"), el("sup", {}, [text("see "), inlineCode("n."), text(" ")]), text(" Next one."));
  assert.deepEqual(buildSpeechUnits(nested).map((unit) => unit.text), [`Cost${supOpen}see ${plainOpen}n.${plainClose} ${supClose}`, "Next one."]);
  assert.deepEqual(spoken(paragraphOf(text("Use "), inlineCode("foo."))), ["Use foo."]);
});

test("inline math keeps the map of its own words, shifted into the block", () => {
  const paragraph = el("p", {}, [text("Take  "), el("math", {}, [el("msqrt", {}, [el("mi", {}, [text("x")])])]), text(" and "), el("math", {}, [el("mfrac", {}, [el("mn", {}, [text("1")]), el("mi", {}, [text("n")])])]), text(" next.")]);
  const article = el("article", {}, [paragraph]);
  const units = buildSpeechUnits(article);
  assert.deepEqual(units.map((unit) => unit.text), ["Take square root of x and 1 over n next."]);
  checkUnits(article, units);
  const block = speechBlockText(paragraph);
  assert.equal(block, "Take x and 1n next.");
  const [unit] = units;
  const word = (words) => unit.map.find((piece) => unit.text.slice(...piece.spoken) === words);
  assert.equal(block.slice(...word("x").source), "x");
  assert.equal(block.slice(...word("1").source), "1");
  assert.equal(block.slice(...word("n").source), "n");
  // An inserted word keeps an empty range where the source implies it.
  assert.deepEqual(word("square root of").source, [5, 5]);
  assert.deepEqual(word("over").source, [block.indexOf("1") + 1, block.indexOf("1") + 1]);
});

test("sections start at H1-H3, text before the first heading is the Introduction, and each first unit says so", () => {
  const long = "A".repeat(100);
  const article = el("article", {}, [
    el("p", {}, [text("Intro text.")]),
    el("h1", {}, [text("Title")]), el("p", {}, [text("Alpha.")]),
    el("h2", {}, [text(long)]), el("p", {}, [text("Bravo.")]), el("h4", {}, [text("Note")]), el("p", {}, [text("Charlie.")]),
    el("h3", {}, [text("Sub")]), el("p", {}, [text("Delta one. Delta two.")]),
  ]);
  const units = buildSpeechUnits(article);
  assert.deepEqual(units.map((unit) => [unit.text, unit.section, unit.sectionStart === true]), [
    ["Intro text.", "Introduction", true],
    ["Title.", "Title", true],
    ["Alpha.", "Title", false],
    [`${long}.`, long.slice(0, 80), true],
    ["Bravo.", long.slice(0, 80), false],
    ["Note.", long.slice(0, 80), false],
    ["Charlie.", long.slice(0, 80), false],
    ["Sub.", "Sub", true],
    ["Delta one.", "Sub", false],
    ["Delta two.", "Sub", false],
  ]);
  assert.ok(units.every((unit) => unit.sectionStart === undefined || unit.sectionStart === true), "sectionStart is true or absent");
  assert.deepEqual(buildSpeechSections(article), [
    { label: "Introduction", text: "Intro text." },
    { label: "Title", text: "Title. Alpha." },
    { label: long.slice(0, 80), text: `${long}. Bravo. Note. Charlie.` },
    { label: "Sub", text: "Sub. Delta one. Delta two." },
  ]);
  // A lecture that opens with a heading has no Introduction, and nothing readable has no sections.
  assert.deepEqual(buildSpeechSections(el("article", {}, [el("h2", {}, [text("Only")])])), [{ label: "Only", text: "Only." }]);
  assert.deepEqual(buildSpeechSections(el("article", {}, [])), []);
});

test("sections are built from the text units without their markers", () => {
  const article = el("article", {}, [el("h2", {}, [text("Powers")]), el("p", {}, [text("Take x"), el("sup", {}, [text("2")]), text(" and "), el("code", {}, [text("a/b")]), text(".")])]);
  const [section] = buildSpeechSections(article);
  assert.equal(section.text, "Powers. Take x2 and a/b.");
  const units = buildSpeechUnits(article);
  assert.ok(units[1].text.includes(SPEECH_MARK.supOpen), "the unit keeps its markers for the text pass");
});

test("the document target carries units, sections made from them, and the text they read", () => {
  const root = fixture();
  const target = buildSpeechTarget({ scope: "document", article: root });
  assert.deepEqual([target.available, target.scope, target.label], [true, "document", "Full lecture"]);
  assert.deepEqual(target.sections, buildSpeechSections(root));
  assert.equal(target.text, target.sections.map((section) => section.text).join(" "));
  assert.equal(target.text, target.units.map((unit) => stripMarks(unit.text)).join(" "));
  assert.deepEqual(target.sections.map((section) => section.label), ["Speakable fixture", "6. Task taxonomy"]);
  // With no unit to read, the target falls back to the page's text.
  const hidden = el("article", {}, [el("p", {}, [el("span", { class: "katex-html" }, [text("x")])])]);
  const fallback = buildSpeechTarget({ scope: "document", article: hidden, sourceText: " Source  text " });
  assert.deepEqual([fallback.available, fallback.text, fallback.units], [true, "Source text", undefined]);
  assert.equal(buildSpeechTarget({ scope: "document", article: hidden }).available, false);
  assert.equal(buildSpeechTarget({ scope: "selection", selectedText: " chosen  text " }).text, "chosen text");
  assert.equal(buildSpeechTarget({ scope: "selection", selectedText: " chosen  text " }).units, undefined);
});

test("the section target is the units of the blocks in the section range", () => {
  const article = el("article", {}, [
    placed(el("h1", {}, [text("Chapter")]), 0, 40),
    placed(el("h2", {}, [text("Alpha")]), 50, 90),
    placed(el("p", {}, [text("Alpha body one. Alpha body two.")]), 95, 140),
    placed(el("h3", {}, [text("Beta")]), 150, 190),
    placed(el("p", {}, [text("Beta body.")]), 195, 240),
    placed(el("h2", {}, [text("Gamma")]), 250, 290),
    placed(el("p", {}, [text("Gamma body.")]), 295, 340),
  ]);
  const target = buildSpeechTarget({ scope: "section", article, scrollContainer: lineAt(100) });
  assert.deepEqual([target.available, target.scope, target.label], [true, "section", "Current section"]);
  assert.equal(target.text, "Alpha. Alpha body one. Alpha body two. Beta. Beta body.");
  assert.deepEqual(target.units.map((unit) => [unit.unit.blockIndex, unit.section, unit.sectionStart === true]), [
    [1, "Alpha", true], [2, "Alpha", false], [2, "Alpha", false], [3, "Beta", true], [4, "Beta", false],
  ]);
  assert.equal(target.sections, undefined);
  // The last section runs to the end, and a line before every block starts the first one.
  assert.equal(buildSpeechTarget({ scope: "section", article, scrollContainer: lineAt(300) }).text, "Gamma. Gamma body.");
  assert.equal(buildSpeechTarget({ scope: "section", article, scrollContainer: lineAt(-300) }).units[0].unit.blockIndex, 0);
  assert.equal(buildSpeechTarget({ scope: "section", article: el("article", {}), scrollContainer: lineAt(0) }).available, false);
});

test("the sentence target is the first unit of the next block that has one", () => {
  const silent = () => el("p", {}, [el("span", { class: "katex-html" }, [text("x")])]);
  const article = el("article", {}, [
    placed(el("h2", {}, [text("Setup")]), 0, 40),
    placed(silent(), 45, 90),
    placed(el("p", {}, [text("After the gap. Second one.")]), 95, 140),
  ]);
  const target = (top) => buildSpeechTarget({ scope: "sentence", article, scrollContainer: lineAt(top) });
  // On a heading, and on a block that speaks nothing, the sentence is the next one there is to read.
  for (const top of [10, 60, 100]) assert.deepEqual([target(top).text, target(top).units.length, target(top).units[0].unit.blockIndex], ["After the gap.", 1, 2], `at ${top}`);
  assert.deepEqual([target(10).available, target(10).scope, target(10).label], [true, "sentence", "Current sentence"]);
  assert.deepEqual([target(100).units[0].section, target(100).units[0].sectionStart], ["Setup", undefined], "the unit keeps its section whichever way it was found");
  assert.equal(target(100).sections, undefined);
  const nothing = buildSpeechTarget({ scope: "sentence", article: el("article", {}, [placed(silent(), 0, 40)]), scrollContainer: lineAt(10) });
  assert.deepEqual([nothing.available, nothing.reason], [false, "No readable sentence is visible."]);
  assert.equal(buildSpeechTarget({ scope: "sentence", article: el("article", {}) }).available, false);
});

// Just enough of Range and TreeWalker for the sentence target's line-to-offset measure: the block's text flows at
// `perLine` characters a line, 20 px a line from `top`.
const flowedText = (block, { perLine, top = 0, lineHeight = 20 }) => {
  const nodes = [];
  const starts = new Map();
  let length = 0;
  const visit = (node) => node.childNodes.forEach((child) => {
    if (child.nodeType !== 3) return visit(child);
    starts.set(child, length);
    length += child.data.length;
    nodes.push(child);
  });
  visit(block);
  const lines = (node, from, to) => {
    if (to <= from) return [];
    const first = Math.floor((starts.get(node) + from) / perLine);
    const last = Math.floor((starts.get(node) + to - 1) / perLine);
    return Array.from({ length: last - first + 1 }, (_, at) => ({ top: top + (first + at) * lineHeight, bottom: top + (first + at + 1) * lineHeight, height: lineHeight }));
  };
  block.ownerDocument = {
    createTreeWalker: () => { let at = 0; return { nextNode: () => nodes[at++] ?? null }; },
    createRange: () => {
      let node = null;
      let from = 0;
      let to = 0;
      const rects = () => lines(node, from, to);
      return {
        selectNodeContents: (target) => { node = target; from = 0; to = target.data.length; },
        setStart: (target, offset) => { node = target; from = offset; },
        setEnd: (target, offset) => { node = target; to = offset; },
        getClientRects: rects,
        getBoundingClientRect: () => {
          const all = rects();
          return all.length ? { top: all[0].top, bottom: all.at(-1).bottom, height: all.at(-1).bottom - all[0].top } : { top: 0, bottom: 0, height: 0 };
        },
      };
    },
  };
  return block;
};

test("the sentence target is the unit under the reading line, measured in the block's collapsed text", () => {
  // Raw characters 18-19 are two spaces and 29 a line feed, so the collapsed text is 1 + 1 characters shorter by the
  // time the second line starts at raw character 38, the space after “here.”: collapsed offset 37, inside sentence 2.
  const paragraph = flowedText(placed(el("p", {}, [text("Alpha one is here.  Bravo two"), text("\nis here. Charlie three is here.")]), 0, 60), { perLine: 38 });
  const article = el("article", {}, [paragraph]);
  const sentence = (line) => buildSpeechTarget({ scope: "sentence", article, scrollContainer: lineAt(line) });
  assert.equal(speechBlockText(paragraph), "Alpha one is here. Bravo two is here. Charlie three is here.");
  assert.equal(sentence(30).text, "Bravo two is here.");
  assert.equal(sentence(30).units[0].unit.start, 19);
  assert.equal(sentence(5).text, "Alpha one is here.");
  assert.equal(sentence(55).text, "Charlie three is here.", "a line below the text is the last sentence");
  assert.equal(sentence(30).units.length, 1);
});

test("units build in linear time for a lecture of 500,000 characters", () => {
  const sentence = "The quick brown fox jumps over the lazy dog again. ";
  const lecture = el("article", {}, Array.from({ length: 400 }, (_, index) => (index % 40
    ? el("p", {}, [text(`Block ${index}. ${sentence.repeat(24)}`)])
    : el("h2", {}, [text(`Heading ${index}`)]))));
  const oneBlock = el("article", {}, [el("p", {}, [text(sentence.repeat(9_800))])]);
  const time = (work) => {
    const started = performance.now();
    const result = work();
    return { result, elapsed: performance.now() - started };
  };
  // Generous: these guard the complexity (a scan per block or per sentence took minutes), not the machine.
  const many = time(() => buildSpeechUnits(lecture));
  assert.equal(many.result.length, 10 * 1 + 390 * 25, "a heading and 25 sentences a block");
  assert.ok(many.elapsed < 4_000, `400 blocks took ${Math.round(many.elapsed)} ms`);
  const target = time(() => buildSpeechTarget({ scope: "document", article: lecture }));
  assert.equal(target.result.units.length, many.result.length);
  assert.ok(target.elapsed < 4_000, `the document target took ${Math.round(target.elapsed)} ms`);
  const near = time(() => buildSpeechTarget({ scope: "sentence", article: lecture, scrollContainer: lineAt(0) }));
  assert.equal(near.result.units.length, 1);
  assert.ok(near.elapsed < 2_000, `the sentence target took ${Math.round(near.elapsed)} ms`);
  const one = time(() => buildSpeechUnits(oneBlock));
  assert.equal(one.result.length, 9_800);
  assert.ok(one.elapsed < 4_000, `one 500,000-character block took ${Math.round(one.elapsed)} ms`);
  assert.equal(one.result.at(-1).unit.end, speechBlockText(oneBlock.childNodes[0]).length);
  assert.equal(one.result[1].unit.start, sentence.length);
});

test("the language of the target reaches the sentence segmenter", () => {
  const Real = Intl.Segmenter;
  const locales = [];
  Intl.Segmenter = class extends Real {
    constructor(locale, options) {
      locales.push(locale);
      super(locale, options);
    }
  };
  try {
    const article = el("article", {}, [el("p", {}, [text("पहला वाक्य। दूसरा वाक्य!")])]);
    assert.deepEqual(buildSpeechUnits(article, { language: "hi-IN" }).map((unit) => unit.text), ["पहला वाक्य।", "दूसरा वाक्य!"]);
    assert.ok(locales.includes("hi-IN"), `segmented with ${locales}`);
    locales.length = 0;
    assert.equal(buildSpeechTarget({ scope: "document", article, language: "ja-JP" }).units.length, 2);
    assert.ok(locales.includes("ja-JP"), `segmented with ${locales}`);
  } finally {
    Intl.Segmenter = Real;
  }
});

test("text blocks keep working on plain fakes with no childNodes", () => {
  const fake = (tagName, textContent) => ({ tagName, textContent, parentElement: { closest: () => null } });
  const article = { querySelectorAll: () => [fake("H2", "Optimization"), fake("P", "Gradient descent moves downhill.  Learning rate\ncontrols each step."), fake("LI", "  "), fake("PRE", "x = 1")] };
  assert.deepEqual(readableBlocks(article).map((block) => block.tagName), ["H2", "P", "PRE"]);
  const units = buildSpeechUnits(article);
  assert.deepEqual(units.map((unit) => [unit.text, unit.unit.blockIndex, unit.unit.start, unit.unit.end]), [
    ["Optimization.", 0, 0, 12],
    ["Gradient descent moves downhill.", 1, 0, 33],
    ["Learning rate controls each step.", 1, 33, 66],
    ["Code example, 1 line.", 2, 0, 0],
  ]);
  checkUnits(article, units);
});

// ---------------------------------------------------------------------------------------------------------
// A sanitized copy of a formula (issue #100, Task 3c). The app runs rendered Markdown through DOMPurify's MathML
// profile (sanitizeMarkdownHtml), which removes semantics, annotation and annotation-xml and keeps what they held:
// the annotation's TeX stays behind as a bare text node inside <math>.
// ---------------------------------------------------------------------------------------------------------

// KaTeX's $\frac{a}{b}$ as the Reader holds it: the MathML with the TeX beside it as text, then the visible copy.
const sanitizedKatex = (tex, nodes, attrs = {}) => el("span", { class: "katex" }, [
  el("span", { class: "katex-mathml" }, [el("math", attrs, [el("mrow", {}, nodes), text(tex)])]),
  el("span", { class: "katex-html", "aria-hidden": "true" }, [text("ab")]),
]);

test("TeX the sanitizer leaves beside a formula is not read, and still counts in the offsets", () => {
  const { mi, mo, mn, mtext, of } = mathml;
  assert.equal(verbalizeMath(el("math", {}, [el("mrow", {}, [mi("y")]), text("y")])).text, "y");
  const tex = "\\frac{a}{b}";
  const fraction = el("math", {}, [el("mrow", {}, [of("mfrac", mi("a"), mi("b"))]), text(tex)]);
  const read = checkMap(fraction, "sanitized fraction");
  assert.equal(read.spoken, "a over b");
  assert.equal(read.source, `ab${tex}`);
  assert.ok(read.map.every((piece) => piece.source[1] <= 2), "no piece reads the TeX: it is a gap after the formula");
  // Text is read inside a token and nowhere else: a string literal and a token holding an element still speak.
  assert.equal(verbalizeMath(el("math", {}, [el("ms", {}, [text("a string")])])).text, "a string");
  assert.equal(readMath(mtext("latency"), mo("="), mn("1")), "latency equals 1");
  assert.equal(verbalizeMath(el("math", {}, [el("mtext", {}, [text("see "), el("mspace"), text("above")])])).text, "see above");
  // Loose text between the elements of a formula, where a removed annotation can leave its TeX, is not read either.
  assert.equal(verbalizeMath(el("math", {}, [el("mrow", {}, [mi("x"), text("TEX"), mo("+"), mn("1")]), text("x+1")])).text, "x plus 1");
  assert.equal(verbalizeMath(el("math", {}, [text("TEX"), el("mrow", {}, [mi("x")])])).text, "x");
});

test("an edited copy's sanitized KaTeX is read once, inside its sentence", () => {
  const { mi, of } = mathml;
  const paragraph = el("p", {}, [text("The loss "), sanitizedKatex("\\frac{a}{b}", [of("mfrac", mi("a"), mi("b"))]), text(" is low. Next one.")]);
  const article = el("article", {}, [paragraph]);
  assert.deepEqual(buildSpeechUnits(article).map((unit) => unit.text), ["The loss a over b is low.", "Next one."]);
  assert.deepEqual(spoken(article), ["The loss a over b is low.", "Next one."]);
  checkUnits(article, buildSpeechUnits(article), { exact: false });
  // A bare <math> in the paragraph, with no KaTeX wrappers around it, reads once too.
  const bare = el("article", {}, [el("p", {}, [text("Let "), el("math", {}, [el("mrow", {}, [mi("y")]), text("y")]), text(" be one.")])]);
  assert.deepEqual(spoken(bare), ["Let y be one."]);
});

test("a tag the MathML walker keeps silent is silent in a text block too, from one set", () => {
  assert.ok(mathSpeech.SILENT_TAGS instanceof Set, "mathSpeech.js exports the one set of silent tags");
  for (const tag of ["annotation", "annotation-xml", "mphantom"]) assert.ok(mathSpeech.SILENT_TAGS.has(tag), tag);
  for (const tag of mathSpeech.SILENT_TAGS) {
    const sentence = el("p", {}, [text("A "), el(tag, {}, [text("HIDDEN")]), text(" B.")]);
    assert.deepEqual(spoken(el("article", {}, [sentence])), ["A B."], `${tag} was said in a text block`);
    const formula = el("math", {}, [el("mi", {}, [text("x")]), el(tag, {}, [el("mi", {}, [text("HIDDEN")])])]);
    assert.equal(verbalizeMath(formula).text, "x", `${tag} was said in a formula`);
  }
});

// ---------------------------------------------------------------------------------------------------------
// Table rows, code, diagrams and display math as speech units (issue #100, Task 3c).
// ---------------------------------------------------------------------------------------------------------

test("the fixture lecture speaks exactly this in every code and table setting", () => {
  assert.deepEqual(spoken(fixture()), FIXTURE_SPOKEN);
  for (const code of ["announce", "skip", "read"]) {
    for (const tables of ["rows", "announce"]) assert.deepEqual(spoken(fixture(), { code, tables }), fixtureSpoken({ code, tables }), `${code}/${tables}`);
  }
});

test("irregular tables read without empty labels", () => {
  const cell = (tag, value) => el(tag, {}, value ? [text(value)] : []);
  const table = (...rows) => el("table", {}, [el("tbody", {}, rows.map((cells) => el("tr", {}, cells)))]);
  assert.deepEqual(spoken(el("article", {}, [table([cell("td", "a"), cell("td", "b")], [cell("td", "c"), cell("td", "")])])), ["Table, 2 columns.", "Row 1. a; b.", "Row 2. c."]);
  const headed = el("table", {}, [
    el("thead", {}, [el("tr", {}, [cell("th", "Name"), cell("th", "")])]),
    el("tbody", {}, [el("tr", {}, [cell("td", "x"), cell("td", "y"), cell("td", "z")])]),
  ]);
  assert.deepEqual(spoken(el("article", {}, [headed])), ["Table, 3 columns: Name.", "Row 1. Name: x; y; z."]);
});

test("code is announced, skipped or read, and text diagrams are always announced", () => {
  const pre = (label, body) => el("div", { class: "code-shell" }, [el("pre", { "aria-label": `${label} code` }, [el("code", {}, [text(body)])])]);
  assert.deepEqual(spoken(el("article", {}, [pre("text", "context -> model\n")])), ["Code example, 1 line."]);
  assert.deepEqual(spoken(el("article", {}, [pre("js", "a()\nb()\n")])), ["JavaScript example, 2 lines."]);
  assert.deepEqual(spoken(el("article", {}, [pre("ini", "a=1\n")])), ["INI example, 1 line."]);
  assert.deepEqual(spoken(el("article", {}, [pre("haskell", "main = pure ()\n")])), ["Haskell example, 1 line."]);
  for (const code of ["announce", "skip", "read"]) assert.deepEqual(spoken(el("article", {}, [pre("text", "a ─┐\n  ├─> b\n")]), { code }), ["Text diagram, 2 lines."], code);
  const item = el("li", {}, [text("Run this first:"), pre("bash", "make test\n"), text(" then check.")]);
  assert.deepEqual(spoken(el("article", {}, [el("ul", {}, [item])])), ["Run this first:", "then check.", "Shell example, 1 line."]);
});

test("a diagram is described from its definition, never its diagnostic", () => {
  const shell = (status, inner, attrs = {}) => el("div", { class: "diagram-shell", "data-diagram-status": status }, [el("div", { class: "mermaid", "data-diagram-status": status, ...attrs }, inner)]);
  const definition = "flowchart LR\n  A[Data] --> B[Model]\n  B --> C[Prediction]";
  assert.deepEqual(spoken(el("article", {}, [shell("pending", [text(definition)])])), ["Diagram: Flowchart: Data leads to Model leads to Prediction."]);
  assert.deepEqual(spoken(el("article", {}, [shell("rendered", [el("svg", {}, [text("DataModelPrediction")])], { "aria-label": "Flowchart: Data → Model → Prediction" })])), ["Diagram: Flowchart: Data leads to Model leads to Prediction."]);
  assert.deepEqual(spoken(el("article", {}, [shell("error", [el("p", {}, [text("The Mermaid module could not be loaded.")]), el("pre", {}, [text(definition)])])])), ["Diagram."]);
});

// What each atomic kind hands the queue builder (the unit contract of plan-context.md): announcements have no range
// and no map, rows are "row", the lines of code read aloud are "code", and a formula is a text unit of its own block.
test("the fixture's atomic units carry the unit contract, in their blocks, in order", () => {
  const root = fixture();
  const blocks = readableBlocks(root);
  const units = buildSpeechUnits(root, { code: "read" });
  const kindOf = (unit) => unit.kind ?? "text";
  const where = (kind) => units.filter((unit) => kindOf(unit) === kind).map((unit) => [unit.unit.blockIndex, blocks[unit.unit.blockIndex].localName, unit.text]);
  assert.deepEqual(where("announcement"), [
    [3, "tr", "Table, 3 columns: Situation, First inspect, Safe action."],
    [6, "pre", "Python example, 6 lines."],
    [7, "pre", "Text diagram, 3 lines."],
    [11, "div", "Diagram: Flowchart: Data → Model → Prediction."],
  ]);
  for (const unit of units.filter((item) => kindOf(item) === "announcement")) assert.deepEqual([unit.unit.start, unit.unit.end, unit.map], [0, 0, []], unit.text);
  assert.deepEqual(where("row"), [
    [4, "tr", "Row 1. Situation: Disk full; First inspect: df -h; Safe action: Free space."],
    [5, "tr", "Row 2. Situation: High latency; First inspect: p99 graphs; Safe action: Roll back."],
  ]);
  const python = ["import numpy as np", "X = np.ones((3, 2))", "y = np.zeros(3)", "w = np.linalg.lstsq(X, y, rcond=None)[0]", "print(w)", "print(w.shape)"];
  assert.deepEqual(where("code"), python.map((line) => [6, "pre", line]));
  assert.deepEqual(where("text").filter(([, tag]) => tag === "math"), [[10, "math", "Accuracy equals T P plus T N, over, T P plus T N plus F P plus F N."]]);
  // The units of a block tile its text, the lines of code and the rows included; an identity piece reads the very
  // characters it maps to everywhere but in a formula (a letter read by name).
  checkUnits(root, units, { exact: false });
  checkUnits(root, units.filter((unit) => ["row", "code"].includes(kindOf(unit))));
  // Each line of code owns the stretch of the block that starts at its first word.
  const clean = speechBlockText(blocks[6]);
  assert.deepEqual(units.filter((unit) => unit.kind === "code").map(({ unit }) => clean.slice(unit.start, unit.end).trim()), python);
  // Every unit after the heading belongs to its section; the first one of the section says so.
  const after = units.slice(units.findIndex((unit) => unit.text === "6. Task taxonomy."));
  assert.ok(after.every((unit) => unit.section === "6. Task taxonomy"));
  assert.deepEqual(after.filter((unit) => unit.sectionStart).map((unit) => unit.text), ["6. Task taxonomy."]);
  // Settings change what the atomic blocks say, never the blocks or the sentences: a saved position (blockIndex and
  // offset) means the same sentence in every setting.
  const sentences = (options) => buildSpeechUnits(root, options).filter((unit) => !unit.kind).map((unit) => [unit.unit.blockIndex, unit.unit.start, unit.unit.end, unit.text]);
  const reference = sentences({});
  assert.equal(reference.length, 8, "two headings, five sentences and the display formula (the long sentence is one unit; the queue splits it)");
  for (const code of ["announce", "skip", "read"]) for (const tables of ["rows", "announce"]) assert.deepEqual(sentences({ code, tables }), reference, `${code}/${tables}`);
});

const articleOf = (...children) => el("article", {}, children);
const cellOf = (tag, ...nodes) => el(tag, {}, nodes);
const rowOf = (tag, values) => el("tr", {}, values.map((value) => cellOf(tag, ...(value === "" ? [] : [text(value)]))));
// A table as marked writes it: a head of th cells and a body of td rows.
const tableOf = (header, ...rows) => el("table", {}, [
  ...(header ? [el("thead", {}, [rowOf("th", header)])] : []),
  el("tbody", {}, rows.map((values) => rowOf("td", values))),
]);

test("a table is announced once, with its columns and, when only announced, its rows", () => {
  const one = articleOf(tableOf(["A"], ["x"]));
  assert.deepEqual(spoken(one), ["Table, 1 column: A.", "Row 1. A: x."]);
  assert.deepEqual(spoken(one, { tables: "announce" }), ["Table, 1 column, 1 row: A."]);
  const two = articleOf(tableOf(["A", "B"], ["x", "y"], ["z", "w"]));
  assert.deepEqual(spoken(two), ["Table, 2 columns: A, B.", "Row 1. A: x; B: y.", "Row 2. A: z; B: w."]);
  assert.deepEqual(spoken(two, { tables: "announce" }), ["Table, 2 columns, 2 rows: A, B."]);
  // A header and no rows is still a table.
  assert.deepEqual(spoken(articleOf(tableOf(["A", "B"])), { tables: "announce" }), ["Table, 2 columns, 0 rows: A, B."]);
  assert.deepEqual(spoken(articleOf(tableOf(["A", "B"]))), ["Table, 2 columns: A, B."]);
  // No header: the announcement is on the first row, and the rows keep their numbers.
  const bare = articleOf(tableOf(null, ["a", "b"], ["c", "d"]));
  assert.deepEqual(spoken(bare), ["Table, 2 columns.", "Row 1. a; b.", "Row 2. c; d."]);
  assert.deepEqual(spoken(bare, { tables: "announce" }), ["Table, 2 columns, 2 rows."]);
  assert.deepEqual(spoken(articleOf(tableOf(null, ["only"])), { tables: "announce" }), ["Table, 1 column, 1 row."]);
  // Two tables are announced one after the other, each counted by itself.
  assert.deepEqual(spoken(articleOf(tableOf(["A"], ["x"]), tableOf(["B", "C"], ["y", "z"]))), [
    "Table, 1 column: A.", "Row 1. A: x.", "Table, 2 columns: B, C.", "Row 1. B: y; C: z.",
  ]);
});

test("a table's labels follow its columns, whatever is empty, missing or in the way", () => {
  // An empty cell is skipped but keeps its column: the next cell is read under its own label.
  assert.deepEqual(spoken(articleOf(tableOf(["A", "B", "C"], ["x", "", "z"]))), ["Table, 3 columns: A, B, C.", "Row 1. A: x; C: z."]);
  // A row with only empty cells has no text, so it is no block: it is neither read nor counted.
  assert.deepEqual(spoken(articleOf(tableOf(["A", "B"], ["x", "y"], ["", ""], ["z", "w"]))), ["Table, 2 columns: A, B.", "Row 1. A: x; B: y.", "Row 2. A: z; B: w."]);
  assert.deepEqual(spoken(articleOf(tableOf(["A", "B"], ["x", "y"], ["", ""], ["z", "w"])), { tables: "announce" }), ["Table, 2 columns, 2 rows: A, B."]);
  // A header row with no text at all is no block either; the table is announced on its first row.
  assert.deepEqual(spoken(articleOf(tableOf(["", ""], ["x", "y"]))), ["Table, 2 columns.", "Row 1. x; y."]);
  // Row headers (th) in a body row are cells like any other, and only a first row of th cells is the header.
  const rowHeaders = el("table", {}, [el("thead", {}, [rowOf("th", ["Model", "Score"])]), el("tbody", {}, [el("tr", {}, [cellOf("th", text("Base")), cellOf("td", text("0.8"))])])]);
  assert.deepEqual(spoken(articleOf(rowHeaders)), ["Table, 2 columns: Model, Score.", "Row 1. Model: Base; Score: 0.8."]);
  const later = el("table", {}, [el("tbody", {}, [rowOf("td", ["a", "b"]), rowOf("th", ["c", "d"])])]);
  assert.deepEqual(spoken(articleOf(later)), ["Table, 2 columns.", "Row 1. a; b.", "Row 2. c; d."]);
  const mixed = el("table", {}, [el("tbody", {}, [el("tr", {}, [cellOf("th", text("Base")), cellOf("td", text("0.8"))]), rowOf("td", ["Tuned", "0.9"])])]);
  assert.deepEqual(spoken(articleOf(mixed)), ["Table, 2 columns.", "Row 1. Base; 0.8.", "Row 2. Tuned; 0.9."]);
  // A header longer than its rows counts its columns too.
  assert.deepEqual(spoken(articleOf(tableOf(["A", "B", "C"], ["x"]))), ["Table, 3 columns: A, B, C.", "Row 1. A: x."]);
  // A cell's last punctuation ends the row, and a row ends in a full stop otherwise.
  assert.deepEqual(spoken(articleOf(tableOf(["A"], ["done!"], ["Why?"], ["end"]))), ["Table, 1 column: A.", "Row 1. A: done!", "Row 2. A: Why?", "Row 3. A: end."]);
  // A table inside a table cell belongs to that cell: its rows are not rows of the outer table.
  const inner = el("table", {}, [el("tbody", {}, [rowOf("td", ["i"])])]);
  const outer = el("table", {}, [el("thead", {}, [rowOf("th", ["A", "B"])]), el("tbody", {}, [el("tr", {}, [cellOf("td", text("x"), inner), cellOf("td", text("y"))])])]);
  assert.deepEqual(spoken(articleOf(outer)), ["Table, 2 columns: A, B.", "Row 1. A: x i; B: y."]);
  assert.deepEqual(spoken(articleOf(outer), { tables: "announce" }), ["Table, 2 columns, 1 row: A, B."]);
});

test("a table cell is read as a text block reads its inline content, in the row's coordinates", () => {
  const { mi, of } = mathml;
  const { plainOpen, plainClose, supOpen, supClose } = SPEECH_MARK;
  // Inline code keeps its slash, a formula is said once in words (its TeX and visible copy are not), a superscript is marked.
  const ratio = sanitizedKatex("\\frac{a}{b}", [of("mfrac", mi("a"), mi("b"))]);
  const table = el("table", {}, [
    el("thead", {}, [rowOf("th", ["Metric", "Formula", "Code", "Cost"])]),
    el("tbody", {}, [el("tr", {}, [
      cellOf("td", text("Ratio")), cellOf("td", ratio), cellOf("td", el("code", {}, [text("a/b")])), cellOf("td", text("n"), el("sup", {}, [text("2")]), el("br"), text("per step")),
    ])]),
  ]);
  const article = articleOf(table);
  assert.deepEqual(spoken(article), [
    "Table, 4 columns: Metric, Formula, Code, Cost.",
    "Row 1. Metric: Ratio; Formula: a over b; Code: a/b; Cost: n squared per step.",
  ]);
  const [, row] = buildSpeechUnits(article);
  assert.equal(row.text, `Row 1. Metric: Ratio; Formula: a over b; Code: ${plainOpen}a/b${plainClose}; Cost: n${supOpen}2${supClose} per step.`);
  checkUnits(article, buildSpeechUnits(article), { exact: false });
  // A header label is read the same way: code in it keeps its equals sign and its Greek letter, in the announcement and as the label.
  const coded = el("table", {}, [el("thead", {}, [el("tr", {}, [cellOf("th", el("code", {}, [text("x = θ")]))])]), el("tbody", {}, [rowOf("td", ["one"])])]);
  assert.deepEqual(spoken(articleOf(coded)), ["Table, 1 column: x = θ.", "Row 1. x = θ: one."]);
  // The full stop that ends the announcement goes after the code's own, if it has one.
  const stopped = el("table", {}, [el("thead", {}, [el("tr", {}, [cellOf("th", el("code", {}, [text("end.")]))])])]);
  assert.deepEqual(spoken(articleOf(stopped)), ["Table, 1 column: end."]);
  // The map goes from the words to the row's own text: a formula's words map into the formula (the TeX and the visible
  // copy beside it are gaps) and the words of the other cells map to themselves.
  const block = speechBlockText(readableBlocks(article)[1]);
  assert.equal(block, "Ratioab\\frac{a}{b}aba/bn2per step");
  const word = (words) => row.map.find((piece) => row.text.slice(...piece.spoken) === words);
  assert.deepEqual([word("a").source, word("over").source, word("b").source], [[5, 6], [6, 6], [6, 7]]);
  assert.equal(block.slice(...word("Ratio").source), "Ratio");
  assert.equal(block.slice(...word("per").source), "per");
  assert.equal(block.slice(...word("step").source), "step");
});

test("a table cell that holds a display formula or code reads it as its own text", () => {
  const table = el("table", {}, [
    el("thead", {}, [rowOf("th", ["Name", "Value", "Code"])]),
    el("tbody", {}, [el("tr", {}, [cellOf("td", text("Loss")), cellOf("td", mathml.math(mathml.mi("x"))), cellOf("td", el("pre", {}, [text("a = 1")]))])]),
  ]);
  const article = articleOf(table);
  // The formula and the code are inside the row, so they are the row's to read and no blocks of their own.
  assert.deepEqual(readableBlocks(article).map((block) => block.localName), ["tr", "tr"]);
  assert.deepEqual(buildSpeechUnits(article).map((unit) => unit.text), ["Table, 3 columns: Name, Value, Code.", "Row 1. Name: Loss; Value: x; Code: a = 1."]);
  checkUnits(article, buildSpeechUnits(article), { exact: false });
});

test("a long row reaches the queue as one unit and splits between its cells", () => {
  const cell = (letter) => letter.repeat(70);
  const article = articleOf(tableOf(["A", "B", "C"], [cell("a"), cell("b"), cell("c")]));
  assert.equal(buildSpeechUnits(article).filter((unit) => unit.kind === "row").length, 1);
  assert.deepEqual(spoken(article), ["Table, 3 columns: A, B, C.", `Row 1. A: ${cell("a")}; B: ${cell("b")};`, `C: ${cell("c")}.`]);
});

test("the units of a row tile it, whitespace between cells and all", () => {
  // marked puts a line feed between the cells and the rows; they are gaps in the map and belong to the earlier unit.
  const nl = () => text("\n");
  const cell = (tag, value) => [el(tag, {}, [text(value)]), nl()];
  const line = (tag, values) => el("tr", {}, [nl(), ...values.flatMap((value) => cell(tag, value))]);
  const article = articleOf(el("table", {}, [nl(), el("thead", {}, [nl(), line("th", ["Name", "Role"]), nl()]), nl(), el("tbody", {}, [line("td", ["Ada", "  lead   engineer  "]), nl()])]));
  const units = buildSpeechUnits(article);
  assert.deepEqual(units.map((unit) => unit.text), ["Table, 2 columns: Name, Role.", "Row 1. Name: Ada; Role: lead engineer."]);
  checkUnits(article, units);
  const [row] = units.filter((unit) => unit.kind === "row");
  const block = speechBlockText(readableBlocks(article)[1]);
  assert.equal(block, "Ada lead engineer");
  assert.deepEqual([row.unit.start, row.unit.end], [0, block.length]);
  const piece = (words) => row.map.find((item) => row.text.slice(...item.spoken) === words);
  assert.equal(block.slice(...piece("Ada").source), "Ada");
  assert.equal(block.slice(...piece("engineer").source), "engineer");
  // Inserted words sit at an empty range where the cell they introduce starts; the full stop at the end of the last cell.
  assert.deepEqual(piece("Row 1. ").source, [0, 0]);
  assert.deepEqual(piece("Role: ").source, [block.indexOf("lead"), block.indexOf("lead")]);
  assert.deepEqual(piece("; ").source, [3, 3]);
  assert.deepEqual(piece(".").source, [block.length, block.length]);
});

// A fenced block as marked renders it, without the header: the pre carries the language in its label.
const fence = (label, body) => el("div", { class: "code-shell" }, [el("pre", { "aria-label": `${label} code` }, [el("code", {}, [text(body)])])]);

test("a code block is named from its label and counts its lines", () => {
  const names = {
    python: "Python", py: "Python",
    js: "JavaScript", javascript: "JavaScript", jsx: "JavaScript", mjs: "JavaScript",
    ts: "TypeScript", typescript: "TypeScript", tsx: "TypeScript",
    bash: "Shell", sh: "Shell", shell: "Shell", zsh: "Shell", console: "Shell",
    sql: "SQL", json: "JSON", yaml: "YAML", yml: "YAML", html: "HTML", css: "CSS",
    c: "C", cpp: "C++", "c++": "C++", go: "Go", rust: "Rust", rs: "Rust", java: "Java", r: "R",
    dockerfile: "Dockerfile", docker: "Dockerfile", toml: "TOML",
    text: "Code", plaintext: "Code", txt: "Code",
    // Any other id: capitals up to three letters, capitalised beyond.
    ini: "INI", xml: "XML", php: "PHP", lua: "LUA", haskell: "Haskell", kotlin: "Kotlin",
  };
  // The unit says the name; what a voice makes of it (the pack reads JSON as "jay-son") is the text pass's.
  const announced = (label, body = "x\n") => buildSpeechUnits(articleOf(fence(label, body))).map((unit) => unit.text);
  for (const [id, name] of Object.entries(names)) assert.deepEqual(announced(id), [`${name} example, 1 line.`], id);
  assert.deepEqual(spoken(articleOf(fence("json", "{}\n"))), ["jay-son example, 1 line."]);
  assert.deepEqual(buildSpeechQueue(buildSpeechUnits(articleOf(fence("python", "x\n"))), { pronunciations: [{ term: "Python", spoken: "Pie-thon" }] }).queue.map((entry) => entry.text), ["Pie-thon example, 1 line."]);
  // The label is lower-cased by the renderer, but a capital in it changes nothing; the words after the language are not part of it.
  assert.deepEqual(announced("Python"), ["Python example, 1 line."]);
  assert.deepEqual(announced("JS"), ["JavaScript example, 1 line."]);
  assert.deepEqual(announced("python title=app.py"), ["Python example, 1 line."]);
  // No label: a bare pre, or a label that is only the word "code".
  assert.deepEqual(spoken(articleOf(el("pre", {}, [text("x = 1\ny = 2\n")]))), ["Code example, 2 lines."]);
  assert.deepEqual(spoken(articleOf(el("pre", { "aria-label": "code" }, [text("x = 1\n")]))), ["Code example, 1 line."]);
  // Trailing line feeds are not lines; the blank lines inside the code are.
  assert.deepEqual(spoken(articleOf(fence("py", "a\n\n\nb\n\n"))), ["Python example, 4 lines."]);
  assert.deepEqual(spoken(articleOf(fence("py", "a\nb\nc"))), ["Python example, 3 lines."]);
});

test("code read aloud is a unit per non-empty line that tiles the block, said as written but for pronunciations", () => {
  const article = articleOf(fence("python", "alpha = 1\n    beta = 2\n\n\ngamma = 3\n"));
  const units = buildSpeechUnits(article, { code: "read" });
  assert.deepEqual(units.map((unit) => [unit.kind, unit.text]), [
    ["announcement", "Python example, 5 lines."], ["code", "alpha = 1"], ["code", "beta = 2"], ["code", "gamma = 3"],
  ]);
  checkUnits(article, units);
  assert.equal(speechBlockText(readableBlocks(article)[0]), "alpha = 1 beta = 2 gamma = 3");
  // Each line owns the stretch from its first word to the next line's: the indentation and blank lines belong to the earlier one.
  assert.deepEqual(units.slice(1).map(({ unit }) => [unit.blockIndex, unit.start, unit.end]), [[0, 0, 10], [0, 10, 19], [0, 19, 28]]);
  assert.deepEqual(spoken(article, { code: "read" }), ["Python example, 5 lines.", "alpha = 1", "beta = 2", "gamma = 3"]);
  // Pronunciations apply in code, math does not (the equals sign and the slash stay as written).
  assert.deepEqual(spoken(articleOf(fence("python", "import numpy as np\nratio = a/b\n")), { code: "read" }), ["Python example, 2 lines.", "import num pie as np", "ratio = a/b"]);
  // Skipped: nothing at all. Announced: the announcement alone. Any other setting is the default.
  assert.deepEqual(spoken(article, { code: "skip" }), []);
  assert.deepEqual(spoken(article, { code: "announce" }), ["Python example, 5 lines."]);
  assert.deepEqual(spoken(article), ["Python example, 5 lines."]);
  assert.deepEqual(spoken(article, { code: "everything" }), ["Python example, 5 lines."]);
  // A line that is long enough to need it is split by the queue, not by the unit.
  const long = articleOf(fence("python", `x = [${Array.from({ length: 80 }, (_, at) => `item${at}`).join(", ")}]\n`));
  assert.equal(buildSpeechUnits(long, { code: "read" }).filter((unit) => unit.kind === "code").length, 1);
  assert.ok(spoken(long, { code: "read" }).length > 2);
});

test("a block with a box-drawing character is a text diagram, whatever its label says and whatever is read", () => {
  for (const label of ["text", "python", "bash"]) assert.deepEqual(spoken(articleOf(fence(label, "┌──┐\n└──┘\n"))), ["Text diagram, 2 lines."], label);
  // The range is U+2500 to U+257F, both ends in; the blocks beside it are code.
  assert.deepEqual(spoken(articleOf(fence("text", "a \u2500 b\n"))), ["Text diagram, 1 line."]);
  assert.deepEqual(spoken(articleOf(fence("text", "a \u257F b\n"))), ["Text diagram, 1 line."]);
  assert.deepEqual(spoken(articleOf(fence("text", "a \u24FF b\n"))), ["Code example, 1 line."]);
  assert.deepEqual(spoken(articleOf(fence("text", "a \u2580 b\n"))), ["Code example, 1 line."]);
  // One announcement with no range or map, in every code setting.
  for (const code of ["announce", "skip", "read"]) {
    const [unit, ...rest] = buildSpeechUnits(articleOf(fence("text", "a ─┐\n  ├─> b\n")), { code });
    assert.deepEqual([unit.kind, unit.unit, unit.map, rest.length], ["announcement", { blockIndex: 0, start: 0, end: 0 }, [], 0], code);
  }
});

test("a diagram says its description once, in whatever state it is, and never 'Diagram: Diagram'", () => {
  const shell = (status, inner, attrs = {}) => el("div", { class: "diagram-shell", "data-diagram-status": status }, [el("div", { class: "mermaid", "data-diagram-status": status, ...attrs }, inner)]);
  // The description of an unknown kind is the word itself, and one that starts with the word is the whole announcement.
  assert.deepEqual(spoken(articleOf(shell("pending", [text("quantumDiagram")]))), ["Diagram."]);
  assert.deepEqual(spoken(articleOf(shell("rendered", [el("svg", {}, [text("x")])], { "aria-label": "Diagram of the pipeline" }))), ["Diagram of the pipeline."]);
  assert.deepEqual(spoken(articleOf(shell("rendering", [text("flowchart LR\n  A --> B")]))), ["Diagram: Flowchart: A leads to B."]);
  const [unit, ...rest] = buildSpeechUnits(articleOf(shell("pending", [text("flowchart LR\n  A --> B")])));
  assert.deepEqual([unit.kind, unit.text, unit.unit, unit.map, rest.length], ["announcement", "Diagram: Flowchart: A → B.", { blockIndex: 0, start: 0, end: 0 }, [], 0]);
  // A diagram that cannot say anything still announces itself, and a diagram under a heading belongs to that section.
  const under = buildSpeechUnits(articleOf(el("h2", {}, [text("Flow")]), shell("error", [el("p", {}, [text("Diagram renderer unavailable")])])));
  assert.deepEqual(under.map((item) => [item.text, item.section]), [["Flow.", "Flow"], ["Diagram.", "Flow"]]);
});

test("display math is one unit: its words without a trailing comma, ended as a sentence", () => {
  const { mi, mo, mn, of, math } = mathml;
  const formula = (...nodes) => articleOf(math(...nodes));
  assert.deepEqual(spoken(formula(of("mfrac", mn("1"), mi("n")), mo(","))), ["1 over n."]);
  assert.deepEqual(spoken(formula(of("mfrac", mn("1"), mi("n")))), ["1 over n."]);
  // Only a comma at the very end goes; a full stop already there is the sentence's, and the others stay.
  assert.deepEqual(spoken(formula(mi("y"), mo("="), mi("x"), mo("."))), ["y equals x."]);
  assert.deepEqual(spoken(formula(mi("a"), mo(","), mi("b"), mo(","))), ["a, b."]);
  const article = formula(of("mfrac", mn("1"), mi("n")), mo(","));
  const [unit, ...rest] = buildSpeechUnits(article);
  assert.equal(rest.length, 0);
  // The comma stays in the block, so the unit covers it; the full stop sits where the words end.
  assert.deepEqual([unit.kind, unit.text, unit.unit], [undefined, "1 over n.", { blockIndex: 0, start: 0, end: 3 }]);
  assert.deepEqual(unit.map.at(-1), { spoken: [8, 9], source: [2, 2] });
  checkUnits(article, [unit], { exact: false });
  // Under a heading it is in that section; KaTeX's display copy reads once.
  assert.deepEqual(buildSpeechUnits(articleOf(el("h2", {}, [text("Loss")]), katexDisplay("y"))).map((item) => [item.text, item.section]), [["Loss.", "Loss"], ["y.", "Loss"]]);
  // A formula that says nothing (an annotation alone) is a block and has no unit.
  const hollow = articleOf(el("math", { display: "block" }, [el("semantics", {}, [el("annotation", {}, [text("x")])])]));
  assert.equal(readableBlocks(hollow).length, 1);
  assert.deepEqual(buildSpeechUnits(hollow), []);
});

test("a display formula's words map into the block's collapsed text", () => {
  const { mi, mo } = mathml;
  // Pretty-printed MathML: white space between the elements is in the offsets and collapses in the block.
  const printed = el("math", { display: "block" }, [text("\n  "), el("mrow", {}, [text("\n    "), mi("a"), text("\n    "), mo("+"), text("\n    "), mi("b"), text("\n  ")]), text("\n")]);
  const article = articleOf(printed);
  const [unit, ...rest] = buildSpeechUnits(article);
  assert.equal(rest.length, 0);
  const block = speechBlockText(printed);
  assert.equal(block, "a + b");
  assert.equal(unit.text, "a plus b.");
  assert.deepEqual([unit.unit.start, unit.unit.end], [0, block.length]);
  const word = (words) => unit.map.find((piece) => unit.text.slice(...piece.spoken) === words);
  assert.deepEqual([word("a").source, word("plus").source, word("b").source], [[0, 1], [2, 3], [4, 5]]);
  checkUnits(article, [unit], { exact: false });
});

test("display math in the sanitized shape is said once, and the KaTeX around it adds nothing", () => {
  const { mi, of } = mathml;
  const display = el("span", { class: "katex-display" }, [sanitizedKatex("\\frac{a}{b}", [of("mfrac", mi("a"), mi("b"))], { display: "block" })]);
  const article = articleOf(el("p", {}, [text("Before.")]), display, el("p", {}, [text("After.")]));
  assert.deepEqual(readableBlocks(article).map((block) => block.localName), ["p", "math", "p"]);
  assert.deepEqual(spoken(article), ["Before.", "a over b.", "After."]);
  checkUnits(article, buildSpeechUnits(article), { exact: false });
  // The words map into the formula's own text, past the TeX that sits after it.
  const [, unit] = buildSpeechUnits(article);
  const block = speechBlockText(readableBlocks(article)[1]);
  assert.equal(block, "ab\\frac{a}{b}");
  assert.deepEqual([unit.unit.start, unit.unit.end], [0, block.length]);
  assert.ok(unit.map.every((piece) => piece.source[1] <= 2));
});

test("the document target passes the code and table settings on to the units", () => {
  const root = fixture();
  const read = buildSpeechTarget({ scope: "document", article: root, code: "read", tables: "announce" });
  assert.ok(read.text.includes("Table, 3 columns, 2 rows: Situation, First inspect, Safe action. Python example, 6 lines. import numpy as np X = np.ones((3, 2))"), read.text);
  assert.ok(!read.text.includes("Row 1."));
  assert.deepEqual(buildSpeechTarget({ scope: "document", article: root, code: "skip" }).units.filter((unit) => unit.text.startsWith("Python")), []);
  assert.ok(buildSpeechTarget({ scope: "document", article: root }).text.includes("Row 2. Situation: High latency; First inspect: p99 graphs; Safe action: Roll back. Python example, 6 lines. Text diagram, 3 lines."));
  assert.equal(buildSpeechSections(root, { code: "read" }).at(-1).text, buildSpeechTarget({ scope: "document", article: root, code: "read" }).sections.at(-1).text);
});

test("tables and code build in linear time", () => {
  const rows = Array.from({ length: 5_000 }, (_, at) => [`name ${at}`, `value ${at}`, `note ${at}`]);
  const table = articleOf(tableOf(["Name", "Value", "Note"], ...rows));
  const code = articleOf(fence("python", Array.from({ length: 50_000 }, (_, at) => `value_${at} = ${at}`).join("\n")));
  const time = (work) => {
    const started = performance.now();
    const result = work();
    return { result, elapsed: performance.now() - started };
  };
  // Generous: these guard the complexity (the table's header and counts worked out again for every row, a scan of the
  // block for every line), not the machine.
  const grid = time(() => buildSpeechUnits(table));
  assert.equal(grid.result.length, 1 + 5_000);
  assert.equal(grid.result.at(-1).text, "Row 5000. Name: name 4999; Value: value 4999; Note: note 4999.");
  assert.ok(grid.elapsed < 4_000, `5,000 rows took ${Math.round(grid.elapsed)} ms`);
  const lines = time(() => buildSpeechUnits(code, { code: "read" }));
  assert.equal(lines.result.length, 1 + 50_000);
  assert.equal(lines.result.at(-1).unit.end, speechBlockText(readableBlocks(code)[0]).length);
  assert.ok(lines.elapsed < 4_000, `50,000 lines took ${Math.round(lines.elapsed)} ms`);
  const first = time(() => buildSpeechTarget({ scope: "sentence", article: table, scrollContainer: lineAt(0) }));
  assert.equal(first.result.units.length, 1);
  assert.ok(first.elapsed < 2_000, `the sentence target took ${Math.round(first.elapsed)} ms`);
});
