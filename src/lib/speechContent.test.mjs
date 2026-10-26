import assert from "node:assert/strict";
import test from "node:test";
import { verbalizeMath } from "./mathSpeech.js";
import * as speakable from "./speakable.js";

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
  for (const name of ["SYMBOLS", "SUPERSCRIPT_WORDS", "COMBINING_MARKS", "BIG_OPERATORS", "LONE_OPERATORS", "FUNCTION_NAMES", "NORM_BARS", "REALS"]) {
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
  assert.equal(verbalizeMath(el("math", {}, [text("x")])).text, "x", "text outside a token is read as written");
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

test("the MathML map is contiguous, ordered and anchors inserted words to an empty range", () => {
  const { mi, mo, mn, mtext, row, of, math } = mathml;
  // The invariants of a map (see spokenMap.js): contiguous over the spoken text,
  // sources in bounds, non-decreasing and non-overlapping.
  const check = (root, label) => {
    const { text: spoken, map } = verbalizeMath(root);
    const source = root.textContent;
    assert.ok(map.length, `${label}: a reading has a map`);
    assert.equal(map[0].spoken[0], 0, label);
    assert.equal(map.at(-1).spoken[1], spoken.length, label);
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
