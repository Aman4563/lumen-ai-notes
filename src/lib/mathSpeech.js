import {
  BIG_OPERATORS,
  COMBINING_MARKS,
  FUNCTION_NAMES,
  LONE_OPERATORS,
  NORM_BARS,
  REALS,
  SUPERSCRIPT_WORDS,
  SYMBOLS,
  normPhrase,
} from "./speakable.js";

/**
 * MathML read in words (issue #100): "Accuracy equals T P plus T N, over, T P
 * plus T N plus F P plus F N". The Reader chunk imports this through
 * speechContent.js; no entry module may, or the startup budget pays for it.
 *
 * It walks a `math` element through the smallest part of the DOM interface it
 * can (nodeType, localName or tagName, childNodes, textContent and, when there
 * is one, getAttribute), so a test double serves as well as a browser node.
 * The words for symbols are speakable.js's own tables, so the text pass and
 * this walker cannot name one symbol two ways.
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
// The elements whose children after the first are scripts: a subscript, a
// superscript, what sits under or over.
const SCRIPT_PARENTS = new Set(["msub", "msup", "msubsup", "munder", "mover", "munderover"]);
// U+2061–U+2064: function application, invisible times, separator and plus.
const INVISIBLE = /^[\u{2061}-\u{2064}]+$/u;
const ATTACHED = /^[,.;:]+$/u;
// Pandoc writes \mathbf, \mathcal and \mathbb letters as single characters from
// the Mathematical Alphanumeric block, and \mathcal{L} as the Letterlike ℒ;
// NFKC turns them into the plain letters. The Letterlike block also holds
// symbols (ℵ ™ ℃) that must stay, so there only a Latin or Greek letter folds.
const FOLDED = /[\u{2100}-\u{214F}\u{1D400}-\u{1D7FF}]/gu;
const PLAIN_LETTER = /^(?:[A-Za-z]|\p{Script=Greek})$/u;
// Letters in a row that make a word inside a script: P_{train}.
const WORD_RUN = 3;

const FUNCTIONS = new Set(FUNCTION_NAMES);

// What the text pass leaves as written in prose (it reads = + / only inside a
// formula run) but MathML has already marked as math, and a few only the
// walker says.
const OPERATORS = new Map([
  ...[...LONE_OPERATORS].map(([char, { word }]) => [char, word]),
  ["-", "minus"], ["<", "less than"], [">", "greater than"], ["*", "star"], ["\u{2217}", "star"], ["!", "factorial"],
]);

// Operators that take limits, read around them: "sum from i equals 1 to n of",
// "min over theta". The big ones end in "of"; min, max and lim do not.
const LIMIT_NAMES = new Set(["min", "max", "lim", "arg min", "arg max"]);

// What a mover's mark says: the combining marks Pandoc writes (hat, tilde,
// bar, dot, vector) and the plain marks KaTeX writes.
const ACCENTS = new Map([
  ...COMBINING_MARKS,
  ["^", "hat"], ["\u{203E}", "bar"], ["\u{00AF}", "bar"], ["\u{02C9}", "bar"],
  ["\u{02DC}", "tilde"], ["~", "tilde"], ["\u{02D9}", "dot"], ["\u{2192}", "vector"],
]);

// A script that is exactly one of these is its word; any other reads "to the
// power of …". Pandoc writes two primes as one character.
const SCRIPT_WORDS = new Map([...SUPERSCRIPT_WORDS, ["\u{2033}", "double prime"], ["\u{2032}\u{2032}", "double prime"]]);
// A square on a norm bar: ‖w‖₂² is "the squared L2 norm of w".
const SQUARES = new Set(["2", "²"]);

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
const fold = (text) => text.replace(FOLDED, (char) => {
  const plain = char.normalize("NFKC");
  return char.codePointAt(0) >= 0x1D400 || PLAIN_LETTER.test(plain) ? plain : char;
});

// The tree with, on every node, where its text sits in `math.textContent` and
// whether it is inside a script. Text nodes of every kind count, so the
// offsets match what textContent holds.
const annotate = (root) => {
  let offset = 0;
  const visit = (node, depth, inScript) => {
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE) {
      const data = String(node.textContent ?? "");
      const item = { text: data, start: offset, end: offset + data.length };
      offset = item.end;
      return item;
    }
    if (node.nodeType !== ELEMENT_NODE) return null;
    const item = { name: String(node.localName || node.tagName || "").toLowerCase(), node, start: offset, end: offset, children: [], inScript };
    if (depth >= MAX_DEPTH) {
      const data = String(node.textContent ?? "");
      item.name = "mtext";
      item.children.push({ text: data, start: offset, end: offset + data.length });
      offset += data.length;
    } else {
      let elements = 0;
      for (const child of node.childNodes || []) {
        const isElement = child.nodeType === ELEMENT_NODE;
        const parsed = visit(child, depth + 1, inScript || (isElement && elements >= 1 && SCRIPT_PARENTS.has(item.name)));
        if (isElement) elements += 1;
        if (parsed) item.children.push(parsed);
      }
    }
    item.end = offset;
    return item;
  };
  return visit(root, 0, false);
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
const isFunction = (symbol) => FUNCTIONS.has(symbol) || (symbol !== "𝔼" && /^\p{L}$/u.test(symbol));

// \mathbb{E} and \mathbb{R} are a double-struck E and R in KaTeX, and 𝔼 and ℝ in Pandoc.
const DOUBLE_STRUCK = new Map([["E", "𝔼"], ["R", REALS]]);
const symbolOf = (item, text) => (item.name === "mi" && attribute(item, "mathvariant") === "double-struck" ? DOUBLE_STRUCK.get(text) ?? text : text);

// The words for a symbol, from speakable.js's tables. A capital sigma is the
// letter in an identifier and the sum in an operator.
const wordFor = (name, symbol) => {
  if (name === "mi" && symbol === "Σ") return "Sigma";
  if (BIG_OPERATORS.has(symbol)) return `${BIG_OPERATORS.get(symbol)} of`;
  if (symbol === REALS) return "R";
  return SYMBOLS.get(symbol) ?? OPERATORS.get(symbol);
};

const NORM = "the norm of";
const ABSOLUTE_VALUE = "the absolute value of";
const BAR_SCRIPTED = new Set(["msub", "msup", "msubsup"]);

// The bars that pair: a norm bar (‖ or ∥, as an operator or an identifier) and
// a typed bar, Pandoc's | in either form and KaTeX's ∣ written as an
// identifier. The operator ∣ is \mid, never pairs and says "given".
const barKind = (item) => {
  if ((item.name !== "mo" && item.name !== "mi") || !item.children.every(isTextItem)) return null;
  const text = tokenText(item).trim();
  if (NORM_BARS.has(text)) return "norm";
  return (item.name === "mo" && text === "|") || (item.name === "mi" && text === "\u{2223}") ? "typed" : null;
};

// The tree carries state for the reading: a row's bars (row.bars) and a bar's
// place among them (item.barAt), the scripts a norm's opening bar has taken
// (construct.norm), a lone norm bar's toggle (row.openNorm). They assume each
// subtree is read once, in document order, which is how read() walks it.
//
// The bars of a row, by kind and in order, each with the script construct it
// is the base of (the closing bar of ‖w‖₂² or |x|²), if any, and the partner it
// pairs with (-1 for none). Bars pair off in order whatever their form: Pandoc
// marks both bars of |y − z| prefix and both of \|w\| postfix, KaTeX gives them
// none. A pair encloses a balanced stretch of brackets: the bars of D(P ∥ M) +
// D(Q ∥ M) or of P(a|b) + P(c|d) are separators, since the first stretch
// closes a bracket it did not open. The brackets are counted along the row,
// and a bracket may carry a script, as in (a + b)².
const barsOf = (row) => {
  if (!row.bars) {
    const lists = { norm: [], typed: [] };
    const lows = { norm: 0, typed: 0 };
    let depth = 0;
    for (const child of row.children) {
      const construct = BAR_SCRIPTED.has(child.name) ? child : null;
      const token = construct ? elementsOf(child)[0] : child;
      if (!token) continue;
      const mark = token.name === "mo" && token.children.every(isTextItem) ? tokenText(token).trim() : "";
      if (mark === "(" || mark === "[") {
        depth += 1;
      } else if (mark === ")" || mark === "]") {
        depth -= 1;
        lows.norm = Math.min(lows.norm, depth);
        lows.typed = Math.min(lows.typed, depth);
      } else {
        const kind = barKind(token);
        if (kind) {
          token.barAt = lists[kind].length;
          lists[kind].push({ token, construct, partner: -1, depth, low: lows[kind] });
          lows[kind] = depth;
        }
      }
    }
    for (const list of Object.values(lists)) {
      for (let at = 0; at < list.length;) {
        const next = list[at + 1];
        if (next && next.depth === list[at].depth && next.low >= list[at].depth) {
          list[at].partner = at + 1;
          next.partner = at;
          at += 2;
        } else {
          at += 1;
        }
      }
    }
    row.bars = lists;
  }
  return row.bars;
};

// "the squared L2 norm of", "the Frobenius norm of", "the L infinity norm of":
// the closing bar's subscript names the norm and a square on it says squared,
// as the text pass reads ‖w‖₂². `used` is what it took; any other script is
// left for the construct to read after the content.
const normReading = (construct) => {
  const [, first, second] = construct ? elementsOf(construct) : [];
  const sub = construct && construct.name !== "msup" ? first : null;
  const sup = construct && construct.name !== "msub" ? (construct.name === "msup" ? first : second) : null;
  const order = sub ? plainText(sub) : null;
  const squared = sup ? SQUARES.has(plainText(sup)) : false;
  return { words: normPhrase(order ?? "", squared), used: { sub: Boolean(order), sup: squared } };
};

// A pair reads at its opening bar and the closing bar says nothing. True when
// the bar belongs to a pair; a bar without a partner (a lone one, or the last
// of an odd count) is left to read on its own.
const readPairedBar = (kind, item, row, written, out) => {
  const list = barsOf(row)[kind];
  const bar = list[item.barAt];
  if (bar?.token !== item || bar.partner < 0) return false;
  if (bar.partner > item.barAt) {
    if (kind === "typed") {
      out.push({ ...written, text: ABSOLUTE_VALUE });
    } else {
      const { construct } = list[bar.partner];
      const { words, used } = normReading(construct);
      if (construct) construct.norm = used;
      out.push({ ...written, text: words });
    }
  }
  return true;
};

// A norm bar without a partner: a postfix bar says nothing (the bar of
// D(P ∥ Q)), any other opens a norm and the next one closes it.
const readLoneNormBar = (item, written, out, parent) => {
  const row = parent ?? {};
  if (attribute(item, "form") !== "postfix" && !row.openNorm) {
    row.openNorm = true;
    out.push({ ...written, text: NORM });
    return;
  }
  row.openNorm = false;
};

const readToken = (item, out, parent) => {
  const raw = tokenText(item);
  const core = raw.trim();
  if (!core || INVISIBLE.test(core)) return;
  const written = writtenAtom(raw, item.start);
  const kind = barKind(item);
  if (kind && parent && readPairedBar(kind, item, parent, written, out)) return;
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
    if (kind === "typed") {
      out.push({ ...written, text: "given" });
      return;
    }
    if (kind === "norm") {
      readLoneNormBar(item, written, out, parent);
      return;
    }
  }
  if (item.name === "mn" || item.name === "mtext") {
    out.push(written);
    return;
  }
  let symbol = symbolOf(item, core);
  let said = wordFor(item.name, symbol);
  let spoken = written.text;
  // A letter the tables do not know may be a bold or script letter, a single
  // character that reads as the plain one. The tables come first: 𝔼 and ℓ
  // would fold into E and l.
  if (said === undefined && item.name === "mi") {
    spoken = fold(spoken);
    symbol = fold(symbol);
    said = wordFor(item.name, symbol);
  }
  out.push({
    ...written,
    text: said ?? spoken,
    kind: said ? "word" : written.kind,
    fn: item.name === "mi" && isFunction(symbol),
    by: symbol === "×" || symbol === "ˣ",
  });
};

// An identifier letter that reads as itself: not Greek, ℓ, ℝ, 𝔼 or Σ, which
// have words, not a double-struck E or R, and not a modifier letter such as ˣ
// (the "by" of ℝᵐˣⁿ).
const plainLetter = (item) => {
  if (item.name !== "mi" || !item.children.every(isTextItem)) return null;
  const raw = tokenText(item).trim();
  const text = fold(raw);
  const named = (letter) => SYMBOLS.has(letter) || BIG_OPERATORS.has(letter) || letter === REALS || symbolOf(item, letter) !== letter;
  return /^(?!\p{Lm})\p{L}$/u.test(text) && !named(raw) && !named(text) ? text : null;
};

// Inside a script, three or more such letters in a row are one word:
// P_{train} says "train", not "t r a i n". Spaces between them in
// pretty-printed markup do not break the run. Outside a script letters stay
// spelled, so TP is "T P".
const letterRun = (children, at) => {
  if (plainLetter(children[at]) === null) return null;
  let letters = "";
  let count = 0;
  let last = at;
  for (let next = at; next < children.length; next += 1) {
    const child = children[next];
    if (isTextItem(child) && !child.text.trim()) continue;
    const letter = plainLetter(child);
    if (letter === null) break;
    letters += letter;
    count += 1;
    last = next;
  }
  return count >= WORD_RUN ? { word: atom(letters, children[at].start, children[last].end), last } : null;
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
  const { children } = item;
  for (let at = 0; at < children.length; at += 1) {
    const run = item.inScript ? letterRun(children, at) : null;
    if (run) {
      out.push(run.word);
      at = run.last;
    } else {
      read(children[at], out, item);
    }
  }
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

// The tokens under `base` that say something, as { name, text, symbol }.
const spokenTokens = (base) => tokensIn(base)
  .map((token) => {
    const text = tokenText(token).trim();
    return { name: token.name, text, symbol: symbolOf(token, text) };
  })
  .filter(({ text }) => text && !INVISIBLE.test(text));

// The operator a base is, if it is one that takes limits: ∑ ∏ ∫ 𝔼 (or a
// double-struck E), min max lim, and arg min or arg max (split by the
// invisible function application, or not). A capital sigma is the sum only
// as an operator.
const limitsOperator = (base) => {
  const tokens = spokenTokens(base);
  if (tokens.length === 2 && tokens[0].text === "arg" && (tokens[1].text === "min" || tokens[1].text === "max")) {
    return { word: `arg ${tokens[1].text}`, of: false };
  }
  if (tokens.length !== 1) return null;
  const { name, symbol } = tokens[0];
  if (name === "mi" && symbol === "Σ") return null;
  if (BIG_OPERATORS.has(symbol)) return { word: BIG_OPERATORS.get(symbol), of: true };
  return LIMIT_NAMES.has(symbol) ? { word: symbol, of: false } : null;
};

const isReals = (base) => {
  const tokens = spokenTokens(base);
  return tokens.length === 1 && tokens[0].symbol === REALS;
};

// <op> from <under> to <over> of | <op> over <under> | <op> to <over>, with
// "of" after the big operators.
const readLimits = (item, out, operator, base, under, over) => {
  const start = out.length;
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
  endsAs(out, start, !operator.of);
};

// Whether a bracket after a construct is applied to it. A token says so for
// itself; a construct says so from its head: f_θ, f*, f-hat, f-hat_ens and
// log_2 are functions, but the last word of a fraction, a root, a table or a
// power such as 2^k is not one, whatever token it ends in. A min, max or lim
// with limits takes its argument in a bracket: min_θ (f).
const endsAs = (out, start, isFunctionLike) => {
  for (let at = out.length - 1; at >= start; at -= 1) {
    if (!out[at].space) {
      out[at].fn = isFunctionLike;
      return;
    }
  }
};

const readSuperscript = (sup, out, parent, before) => {
  const key = plainText(sup);
  const said = key === null ? undefined : SCRIPT_WORDS.get(key);
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
  const start = out.length;
  const head = atomsOf(base, parent);
  out.push(...head);
  // ℝ^{m×n} is a space of matrices, not a power, and × is "by" in it: "R m by
  // n", as the text pass reads ℝᵐˣⁿ.
  if (item.name === "msup" && isReals(base)) {
    out.push(...atomsOf(sup, item).map((entry) => (entry.by ? { ...entry, text: "by" } : entry)));
    endsAs(out, start, false);
    return;
  }
  // A norm's opening bar has already read the scripts of its closing bar.
  const used = item.norm;
  if (sub && !used?.sub) {
    const tail = atomsOf(sub, item);
    if (real(tail).length > 1) out.push(inserted("sub", base.end));
    out.push(...tail);
  }
  if (sup && !used?.sup) readSuperscript(sup, out, item, sub ?? base);
  endsAs(out, start, Boolean(lastAtom(head)?.fn));
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
  const start = out.length;
  const accent = over && !under ? ACCENTS.get(plainText(over)) : undefined;
  if (accent) {
    const head = atomsOf(base, parent);
    out.push(...head, atom(accent, over.start, over.end));
    endsAs(out, start, Boolean(lastAtom(head)?.fn));
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
  endsAs(out, start, false);
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
  const start = out.length;
  const above = atomsOf(top, item);
  const below = atomsOf(bottom, item);
  const short = real(above).length === 1 && real(below).length === 1;
  out.push(...above);
  if (!short) out.push(inserted(",", top.end, "attach"));
  out.push(inserted("over", top.end));
  if (!short) out.push(inserted(",", top.end, "attach"));
  out.push(...below);
  endsAs(out, start, false);
};

// "root 3 of x" is spoken index first; the source holds the base first, so the
// construct is one piece over all of its source.
const readRoot = (item, out) => {
  const [base, index] = elementsOf(item);
  const start = out.length;
  const radicand = base ? atomsOf(base, item) : [];
  const degree = index ? atomsOf(index, item) : [];
  // A root missing its base or its index is malformed: say what is there.
  if (!real(radicand).length || !real(degree).length) {
    out.push(...radicand, ...degree);
  } else {
    out.push(atom(`root ${sayAtoms(degree)} of ${sayAtoms(radicand)}`, item.start, item.end));
  }
  endsAs(out, start, false);
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
  const start = out.length;
  let previousRow = null;
  for (const row of rows) {
    const cells = elementsOf(row)
      .map((cell) => ({ cell, atoms: atomsOf(cell, row) }))
      .filter(({ atoms }) => real(atoms).length);
    if (!cells.length) continue;
    if (previousRow && lastAtom(out).kind !== "attach") out.push(inserted(";", previousRow.end, "attach"));
    cells.forEach(({ atoms }, index) => {
      if (index && lastAtom(out).kind !== "attach") out.push(inserted(",", cells[index - 1].cell.end, "attach"));
      out.push(...atoms);
    });
    previousRow = row;
  }
  endsAs(out, start, false);
};

const READERS = new Map([
  ["semantics", (item, out) => {
    const [first] = elementsOf(item);
    if (first) read(first, out, item);
  }],
  ["mspace", (_item, out) => out.push(SPACE)],
  ["mfrac", readFraction],
  ["msqrt", (item, out) => {
    const start = out.length;
    out.push(inserted("square root of", item.start));
    readChildren(item, out);
    endsAs(out, start, false);
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
