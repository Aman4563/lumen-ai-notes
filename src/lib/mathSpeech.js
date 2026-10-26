/**
 * MathML read in words (issue #100): "Accuracy equals T P plus T N, over, T P
 * plus T N plus F P plus F N". The Reader chunk imports this through
 * speechContent.js; no entry module may, or the startup budget pays for it.
 *
 * It walks a `math` element through the smallest part of the DOM interface it
 * can (nodeType, localName or tagName, childNodes, textContent and, when there
 * is one, getAttribute), so a test double serves as well as a browser node.
 *
 * `verbalizeMath(math)` returns { text, map }. The map is the spokenMap.js
 * kind: MapPiece[] whose sources are offsets into `math.textContent`, the text
 * nodes joined in order. Annotation text counts in those offsets and is never
 * spoken. The pieces tile the spoken text, with non-decreasing, non-overlapping
 * sources. A word read from the source (a token, a script such as "squared") is
 * a piece over that source; a word the source only implies ("over", "of",
 * "sub", a comma) is a piece with an empty range at its position; a
 * construct that is spoken out of source order (a root) is one piece over
 * the whole construct.
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

// Far deeper than any formula. A node this deep is read as its text instead of
// recursing, so hostile markup cannot overflow the stack.
const MAX_DEPTH = 64;

// Elements whose text is read as one unit, and markup that speaks nothing.
const TOKENS = new Set(["mi", "mn", "mo", "mtext"]);
const SILENT = new Set(["annotation", "annotation-xml", "mphantom"]);
// Wrappers that add nothing to the reading of what they hold.
const WRAPPERS = new Set(["mrow", "mstyle", "mpadded"]);
// U+2061–U+2064: function application, invisible times, separator and plus.
const INVISIBLE = /^[\u{2061}-\u{2064}]+$/u;
const ATTACHED = /^[,.;:]+$/u;

// The words below are the ones speakable.js reads the same characters as; the
// two files are kept in step by hand (its tables are not exported).
const NAMES = new Map(Object.entries({
  α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", ϵ: "epsilon", ζ: "zeta", η: "eta", θ: "theta", ϑ: "theta",
  ι: "iota", κ: "kappa", λ: "lambda", μ: "mu", ν: "nu", ξ: "xi", ο: "omicron", π: "pi", ρ: "rho", σ: "sigma", ς: "sigma",
  τ: "tau", υ: "upsilon", φ: "phi", ϕ: "phi", χ: "chi", ψ: "psi", ω: "omega",
  Γ: "Gamma", Δ: "Delta", Θ: "Theta", Λ: "Lambda", Ξ: "Xi", Π: "Pi", Φ: "Phi", Ψ: "Psi", Ω: "Omega",
  ℓ: "ell", "∞": "infinity", ℝ: "R", "𝔼": "expected value of",
}));

// Operators and relations, read wherever they stand: Pandoc spells some of them
// (/ + −) as identifiers.
const OPERATORS = new Map(Object.entries({
  "=": "equals", "+": "plus", "−": "minus", "-": "minus", "±": "plus or minus",
  "×": "times", "·": "times", "⋅": "times", "/": "over", "÷": "divided by",
  "<": "less than", ">": "greater than", "≤": "less than or equal to", "≥": "greater than or equal to",
  "≠": "not equal to", "≈": "approximately", "∈": "in", "∉": "not in", "∝": "proportional to",
  "→": "leads to", "⇒": "implies", "⇔": "if and only if", "∼": "distributed as", "∣": "given",
  "∂": "partial", "∇": "gradient of", "′": "prime", "*": "star", "∗": "star", "!": "factorial",
  "∑": "sum of", "∏": "product of", "∫": "integral of",
}));

const FUNCTION_NAMES = new Set(["log", "exp", "max", "min", "sin", "cos", "tan", "tanh", "det", "tr", "Var", "Cov", "softmax"]);

// Operators that take limits, read around them: "sum from i equals 1 to n of",
// "min over theta". The big ones end in "of"; min, max and lim do not.
const BIG_OPERATORS = new Map(Object.entries({ "∑": "sum", "∏": "product", "∫": "integral", "𝔼": "expected value" }));
const LIMIT_NAMES = new Set(["min", "max", "lim", "arg min", "arg max"]);

// What a mover's mark says: hat, bar, tilde, dot and vector, as Pandoc spells
// them (combining characters) and as KaTeX does (^ ~ and the modifier macron).
const ACCENTS = new Map(Object.entries({
  "^": "hat", "\u{0302}": "hat",
  "\u{203E}": "bar", "\u{00AF}": "bar", "\u{0304}": "bar", "\u{0305}": "bar", "\u{02C9}": "bar",
  "\u{02DC}": "tilde", "~": "tilde", "\u{0303}": "tilde",
  "\u{02D9}": "dot", "\u{0307}": "dot",
  "\u{2192}": "vector", "\u{20D7}": "vector",
}));

// A superscript that is exactly one of these is its word; any other reads
// "to the power of …".
const SUPERSCRIPT_WORDS = new Map(Object.entries({
  T: "transpose", "⊤": "transpose", "ᵀ": "transpose",
  "−1": "inverse", "-1": "inverse", "⁻¹": "inverse",
  2: "squared", "²": "squared", 3: "cubed", "³": "cubed",
  "*": "star", "∗": "star", "′": "prime", "″": "double prime", "′′": "double prime",
}));

const BAR_WORDS = new Map([["|", "the absolute value of"], ["‖", "the norm of"], ["∥", "the norm of"]]);

// The reading is a list of atoms, laid out into spoken text at the end, so a
// construct can look at what a part says ("one token") before it spaces it.
// An atom's kind decides its spacing: an opening bracket takes no space after
// it, a closing bracket and , . ; : none before them.
const atom = (text, start, end, kind = "word") => ({ text, start, end, kind, fn: false });
const inserted = (text, at, kind = "word") => atom(text, at, at, kind);
// An mspace: the next atom is set apart even after an opening bracket.
const SPACE = Object.freeze({ space: true });
const real = (atoms) => atoms.filter((entry) => !entry.space);
const lastAtom = (atoms) => {
  for (let at = atoms.length - 1; at >= 0; at -= 1) if (!atoms[at].space) return atoms[at];
  return undefined;
};

const attribute = (item, name) => item.node?.getAttribute?.(name) ?? null;
const isTextItem = (item) => item.name === undefined;
const elementsOf = (item) => item.children.filter((child) => !isTextItem(child));
const tokenText = (item) => item.children.map((child) => child.text).join("");

// The tree with, on every node, where its text sits in `math.textContent`.
// Text nodes of every kind count, so the offsets match what textContent holds.
const annotate = (root) => {
  let offset = 0;
  const visit = (node, depth) => {
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) {
      const data = String(node.textContent ?? "");
      const item = { text: data, start: offset, end: offset + data.length };
      offset = item.end;
      return item;
    }
    if (node.nodeType !== ELEMENT_NODE) return null;
    const item = { name: String(node.localName || node.tagName || "").toLowerCase(), node, start: offset, end: offset, children: [] };
    if (depth >= MAX_DEPTH) {
      const data = String(node.textContent ?? "");
      item.name = "mtext";
      item.children.push({ text: data, start: offset, end: offset + data.length });
      offset += data.length;
    } else {
      for (const child of node.childNodes || []) {
        const parsed = visit(child, depth + 1);
        if (parsed) item.children.push(parsed);
      }
    }
    item.end = offset;
    return item;
  };
  return visit(root, 0);
};

// `raw` as written: trimmed, inner whitespace collapsed, its source range the
// trimmed text (the spaces around a token are a gap, not part of its piece).
// , . ; : alone attach to the word before them.
const writtenAtom = (raw, start) => {
  const core = raw.trim();
  const from = start + raw.length - raw.trimStart().length;
  return atom(core.replace(/\s+/gu, " "), from, from + core.length, ATTACHED.test(core) ? "attach" : "word");
};

// A single letter, a Greek letter or a listed function name can be applied to
// (…). 𝔼 is a letter too, but its reading already ends in "of".
const isFunction = (symbol) => FUNCTION_NAMES.has(symbol) || (symbol !== "𝔼" && /^\p{L}$/u.test(symbol));

// Pandoc gives both bars of |y − z| the prefix form, so bars pair up inside
// their parent: the first opens ("the absolute value of"), the next closes.
// A postfix bar always closes. A | with no form is the conditioning bar.
const readBar = (item, symbol, written, out, parent) => {
  const form = attribute(item, "form");
  const family = symbol === "|" ? "|" : "‖";
  const state = parent ? (parent.bars ??= {}) : {};
  if (form === "postfix") {
    state[family] = false;
    return;
  }
  if (form === "prefix" || (family === "‖" && form !== "postfix")) {
    if (state[family]) {
      state[family] = false;
      return;
    }
    state[family] = true;
    out.push({ ...written, text: BAR_WORDS.get(symbol) });
    return;
  }
  out.push({ ...written, text: "given" });
};

const readToken = (item, out, parent) => {
  const raw = tokenText(item);
  const core = raw.trim();
  if (!core || INVISIBLE.test(core)) return;
  const written = writtenAtom(raw, item.start);
  if (item.name === "mo") {
    if (core === "{" || core === "}") return;
    if (core === "(" || core === "[") {
      // f(x), P(y), log(x), f_θ(x): the call reads "of". Whether the bracket
      // is marked prefix or not does not matter, KaTeX leaves it unmarked.
      if (core === "(" && lastAtom(out)?.fn) out.push(inserted("of", written.start));
      out.push({ ...written, kind: "open" });
      return;
    }
    if (core === ")" || core === "]") {
      out.push({ ...written, kind: "close" });
      return;
    }
    if (BAR_WORDS.has(core)) {
      readBar(item, core, written, out, parent);
      return;
    }
  }
  if (item.name === "mn" || item.name === "mtext") {
    out.push(written);
    return;
  }
  // \mathbb{E} is a double-struck E in KaTeX and 𝔼 in Pandoc. A capital sigma
  // is the letter in an identifier and the sum in an operator.
  const symbol = item.name === "mi" && core === "E" && attribute(item, "mathvariant") === "double-struck" ? "𝔼" : core;
  const said = item.name === "mo" && symbol === "Σ" ? OPERATORS.get("∑") : item.name === "mi" && symbol === "Σ" ? "Sigma" : NAMES.get(symbol) ?? OPERATORS.get(symbol);
  out.push({ ...written, text: said ?? written.text, kind: said ? "word" : written.kind, fn: item.name === "mi" && isFunction(symbol) });
};

const read = (item, out, parent) => {
  if (isTextItem(item)) {
    const piece = writtenAtom(item.text, item.start);
    if (piece.text) out.push(piece);
  } else if (SILENT.has(item.name)) {
    // Nothing is spoken, but its text is still part of the offsets.
  } else if (READERS.has(item.name)) {
    READERS.get(item.name)(item, out, parent);
  } else if (TOKENS.has(item.name) && item.children.every(isTextItem)) {
    readToken(item, out, parent);
  } else {
    readChildren(item, out);
  }
};

const readChildren = (item, out) => {
  for (const child of item.children) read(child, out, item);
};

const atomsOf = (item, parent) => {
  const atoms = [];
  read(item, atoms, parent);
  return atoms;
};

const layout = (atoms) => {
  const pieces = [];
  let previous = null;
  let spaced = false;
  for (const entry of atoms) {
    if (entry.space) {
      spaced = true;
      continue;
    }
    if (previous && entry.kind !== "close" && entry.kind !== "attach" && (previous.kind !== "open" || spaced)) {
      pieces.push(atom(" ", previous.end, previous.end));
    }
    pieces.push(entry);
    previous = entry;
    spaced = false;
  }
  return pieces;
};

const sayAtoms = (atoms) => layout(atoms).map((piece) => piece.text).join("");

// What a script or mark says when it is nothing but tokens, with spaces and
// invisible operators dropped; null when anything else (a root, a fraction)
// is in it, so √2 in an exponent never reads "squared".
const plainText = (item) => {
  if (isTextItem(item)) return item.text.replace(/[\s\u{2061}-\u{2064}]+/gu, "");
  if (!TOKENS.has(item.name) && !WRAPPERS.has(item.name)) return null;
  let text = "";
  for (const child of item.children) {
    const part = plainText(child);
    if (part === null) return null;
    text += part;
  }
  return text;
};

const tokensIn = (item, found = []) => {
  if (isTextItem(item) || SILENT.has(item.name)) return found;
  if (TOKENS.has(item.name) && item.children.every(isTextItem)) found.push(item);
  else item.children.forEach((child) => tokensIn(child, found));
  return found;
};

// The operator a base is, if it is one that takes limits: ∑ ∏ ∫ 𝔼 (or a
// double-struck E), min max lim, and arg min or arg max (split by the
// invisible function application, or not).
const limitsOperator = (base) => {
  const tokens = tokensIn(base)
    .map((token) => ({ name: token.name, text: tokenText(token).trim(), variant: attribute(token, "mathvariant") }))
    .filter(({ text }) => text && !INVISIBLE.test(text));
  if (tokens.length === 2 && tokens[0].text === "arg" && (tokens[1].text === "min" || tokens[1].text === "max")) {
    return { word: `arg ${tokens[1].text}`, of: false };
  }
  if (tokens.length !== 1) return null;
  const [{ name, text, variant }] = tokens;
  const symbol = name === "mo" && text === "Σ" ? "∑" : name === "mi" && text === "E" && variant === "double-struck" ? "𝔼" : text;
  if (BIG_OPERATORS.has(symbol)) return { word: BIG_OPERATORS.get(symbol), of: true };
  return LIMIT_NAMES.has(symbol) ? { word: symbol, of: false } : null;
};

// <op> from <under> to <over> of | <op> over <under> | <op> to <over>, with
// "of" after the big operators.
const readLimits = (item, out, operator, base, under, over) => {
  out.push(atom(operator.word, base.start, base.end));
  if (under) {
    out.push(inserted(over ? "from" : "over", base.end));
    read(under, out, item);
  }
  if (over) {
    out.push(inserted("to", (under ?? base).end));
    read(over, out, item);
  }
  if (operator.of) out.push(inserted("of", item.end));
};

// A function with a script or an accent is still applied to a bracket after it:
// f_θ(x), f*(x), f-hat(x). The call reads "of" after the last word of the construct.
const keepsFunction = (head, out) => {
  const [only, extra] = real(head);
  const last = lastAtom(out);
  if (only?.fn && !extra && last) last.fn = true;
};

const readSuperscript = (sup, out, parent, before) => {
  const key = plainText(sup);
  const said = key === null ? undefined : SUPERSCRIPT_WORDS.get(key);
  if (said) {
    out.push(atom(said, sup.start, sup.end));
    return;
  }
  out.push(inserted("to the power of", before.end));
  read(sup, out, parent);
};

// msub, msup and msubsup. Pandoc writes an inline sum or integral with
// these, not with munder and mover, and they read the same. The base belongs
// to the row the construct stands in, so a bar with a script (|x|², ‖w‖₂)
// still pairs with the bar before it.
const readScripts = (item, out, parent) => {
  const [base, first, second] = elementsOf(item);
  const sub = item.name === "msup" ? null : first;
  const sup = item.name === "msub" ? null : item.name === "msup" ? first : second;
  if (!base || (!sub && !sup)) {
    readChildren(item, out);
    return;
  }
  const operator = limitsOperator(base);
  if (operator) {
    readLimits(item, out, operator, base, sub, sup);
    return;
  }
  const head = atomsOf(base, parent);
  out.push(...head);
  if (sub) {
    const tail = atomsOf(sub, item);
    if (real(tail).length > 1) out.push(inserted("sub", base.end));
    out.push(...tail);
  }
  if (sup) readSuperscript(sup, out, item, sub ?? base);
  keepsFunction(head, out);
};

// munder, mover and munderover.
const readUnderOver = (item, out, parent) => {
  const [base, first, second] = elementsOf(item);
  const under = item.name === "mover" ? null : first;
  const over = item.name === "munder" ? null : item.name === "mover" ? first : second;
  if (!base || (!under && !over)) {
    readChildren(item, out);
    return;
  }
  const accent = over && !under ? ACCENTS.get(plainText(over)) : undefined;
  if (accent) {
    const head = atomsOf(base, parent);
    out.push(...head, atom(accent, over.start, over.end));
    keepsFunction(head, out);
    return;
  }
  const operator = limitsOperator(base);
  if (operator) {
    readLimits(item, out, operator, base, under, over);
    return;
  }
  out.push(...atomsOf(base, parent));
  if (under) {
    out.push(inserted("with", base.end));
    read(under, out, item);
    out.push(inserted("below", under.end));
  }
  if (over) {
    out.push(inserted(under ? "and" : "with", (under ?? base).end));
    read(over, out, item);
    out.push(inserted("above", over.end));
  }
};

// Two single tokens read "1 over n"; anything longer gets commas around the
// bar, "T P plus T N, over, T P plus T N plus F P plus F N", so the listener
// hears where the top ends.
const readFraction = (item, out) => {
  const [top, bottom] = elementsOf(item);
  if (!bottom) {
    readChildren(item, out);
    return;
  }
  const above = atomsOf(top, item);
  const below = atomsOf(bottom, item);
  const short = real(above).length === 1 && real(below).length === 1;
  out.push(...above);
  if (!short) out.push(inserted(",", top.end, "attach"));
  out.push(inserted("over", top.end));
  if (!short) out.push(inserted(",", top.end, "attach"));
  out.push(...below);
};

// "root 3 of x" is spoken index first; the source holds the base first, so the
// construct is one piece over all of its source.
const readRoot = (item, out) => {
  const [base, index] = elementsOf(item);
  const radicand = base ? atomsOf(base, item) : [];
  const degree = index ? atomsOf(index, item) : [];
  // A root missing its base or its index is malformed: say what is there.
  if (!real(radicand).length || !real(degree).length) {
    out.push(...radicand, ...degree);
    return;
  }
  out.push(atom(`root ${sayAtoms(degree)} of ${sayAtoms(radicand)}`, item.start, item.end));
};

// Cells joined ", ", rows "; ". An empty cell or row is skipped, not read as
// a bare comma, and a cell that already ends in , ; . or : (Pandoc's cases and
// aligned rows end in commas) takes no separator after it.
const readTable = (item, out) => {
  const rows = elementsOf(item).filter((row) => row.name === "mtr" || row.name === "mlabeledtr");
  if (!rows.length) {
    readChildren(item, out);
    return;
  }
  let previousRow = null;
  for (const row of rows) {
    const cells = elementsOf(row)
      .map((cell) => ({ cell, atoms: atomsOf(cell, row) }))
      .filter(({ atoms }) => real(atoms).length);
    if (!cells.length) continue;
    if (previousRow && lastAtom(out).kind !== "attach") out.push(inserted(";", previousRow.end, "attach"));
    cells.forEach(({ cell, atoms }, index) => {
      if (index && lastAtom(out).kind !== "attach") out.push(inserted(",", cells[index - 1].cell.end, "attach"));
      out.push(...atoms);
    });
    previousRow = row;
  }
};

const READERS = new Map([
  ["semantics", (item, out) => {
    const [first] = elementsOf(item);
    if (first) read(first, out, item);
  }],
  ["mspace", (_item, out) => out.push(SPACE)],
  ["mfrac", readFraction],
  ["msqrt", (item, out) => {
    out.push(inserted("square root of", item.start));
    readChildren(item, out);
  }],
  ["mroot", readRoot],
  ["msub", readScripts],
  ["msup", readScripts],
  ["msubsup", readScripts],
  ["munder", readUnderOver],
  ["mover", readUnderOver],
  ["munderover", readUnderOver],
  ["mtable", readTable],
]);

/**
 * `math` read in words, with a map from the spoken text back to offsets in
 * `math.textContent` (see the top of this file). Nothing spoken gives
 * { text: "", map: [] }.
 */
export const verbalizeMath = (math) => {
  const tree = math ? annotate(math) : null;
  const atoms = [];
  if (tree) read(tree, atoms, null);
  let text = "";
  const map = [];
  for (const piece of layout(atoms)) {
    map.push({ spoken: [text.length, text.length + piece.text.length], source: [piece.start, piece.end] });
    text += piece.text;
  }
  return { text, map };
};
