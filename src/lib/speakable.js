import { createSpokenBuilder } from "./spokenMap.js";
import pack from "../data/pronunciations.ml.v1.json" with { type: "json" };

/**
 * The text pass every narrated utterance goes through (issue #100): the
 * learner's pronunciations and the built-in ML pack in one pass, then Unicode
 * math read in words, with a map from the spoken text back to its source.
 */

/**
 * Private-use characters the DOM layer writes around what the page shows as
 * <sub>, <sup> and inline code. They speak nothing.
 */
export const SPEECH_MARK = Object.freeze({
  subOpen: "\uE000", subClose: "\uE001",
  supOpen: "\uE002", supClose: "\uE003",
  plainOpen: "\uE004", plainClose: "\uE005", // inline code: pronunciations only, no math
});

const SUB_OPEN = 0xe000;
const SUB_CLOSE = 0xe001;
const SUP_OPEN = 0xe002;
const SUP_CLOSE = 0xe003;
const PLAIN_OPEN = 0xe004;
const PLAIN_CLOSE = 0xe005;
const isMark = (code) => code >= SUB_OPEN && code <= PLAIN_CLOSE;

export const stripSpeechMarks = (text) => String(text ?? "").replace(/[\uE000-\uE005]/gu, "");

/**
 * Pronunciation overrides (AUDIO-001): learner-defined replacements applied
 * to narration text before chunking. Whole-word, case-insensitive, single
 * pass (a replacement never re-triggers another term), bounded to 50 terms.
 * An empty spoken form skips the term.
 */
export const MAX_PRONUNCIATIONS = 50;

export const normalizePronunciations = (value) => (Array.isArray(value) ? value : [])
  .filter((entry) => entry && typeof entry.term === "string" && typeof entry.spoken === "string" && entry.term.trim())
  .map((entry) => ({ term: entry.term.trim().slice(0, 60), spoken: entry.spoken.trim().slice(0, 120) }))
  .filter((entry, index, list) => list.findIndex((other) => other.term.toLocaleLowerCase() === entry.term.toLocaleLowerCase()) === index)
  .slice(0, MAX_PRONUNCIATIONS);

// The pack marks `matchCase` on terms whose lowercase form is a word or
// another term, so two entries repeat each other only with the same exact
// term (matchCase) or the same lowercase term (otherwise): MAP and mAP both
// stay, where normalizePronunciations would keep one.
const normalizePack = (entries) => {
  const seen = new Set();
  const list = [];
  for (const entry of entries) {
    if (typeof entry?.term !== "string" || typeof entry.spoken !== "string" || !entry.term.trim()) continue;
    const term = entry.term.trim();
    const matchCase = entry.matchCase === true;
    const key = matchCase ? term : term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(Object.freeze({ term, spoken: entry.spoken.trim(), matchCase }));
  }
  return Object.freeze(list);
};

/** The built-in ML pronunciations, as { term, spoken, matchCase }. */
export const PRONUNCIATION_PACK = normalizePack(pack.entries);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A term that starts or ends with a letter or digit matches only as a whole
// word on that side, so "CUDAx" and "xCUDA" stay as written. The two checks
// wrap the whole alternation rather than each term: per term, the Unicode
// classes made the pack's pattern take 60 ms to compile. Wrapped, they mean
// the same: a match starting on a letter or digit has no word character
// before it, and one ending on a letter or digit none after it; a failed end
// check backtracks to the next, shorter term.
const WORD_START = "(?:(?<![\\p{L}\\p{N}_])(?=[\\p{L}\\p{N}])|(?![\\p{L}\\p{N}]))";
const WORD_END = "(?:(?<=[\\p{L}\\p{N}])(?![\\p{L}\\p{N}_])|(?<![\\p{L}\\p{N}]))";

const matchers = new Map();

// One alternation over the learner's terms and the pack, longest first, so
// "QLoRA" wins over "LoRA" and "KV cache" over "KV". A learner's term drops
// every pack entry with the same lowercase term.
const pronunciationMatcher = (pronunciations) => {
  const overrides = normalizePronunciations(pronunciations);
  const key = JSON.stringify(overrides);
  const known = matchers.get(key);
  if (known) return known;
  const learnerTerms = new Set(overrides.map((entry) => entry.term.toLowerCase()));
  const candidates = [
    ...overrides.map((entry) => ({ ...entry, matchCase: false })),
    ...PRONUNCIATION_PACK.filter((entry) => !learnerTerms.has(entry.term.toLowerCase())),
  ].sort((left, right) => right.term.length - left.term.length || (left.term < right.term ? -1 : Number(left.term > right.term)));
  const byTerm = new Map();
  for (const candidate of candidates) {
    const lower = candidate.term.toLowerCase();
    byTerm.set(lower, [...(byTerm.get(lower) || []), candidate]);
  }
  const matcher = { pattern: new RegExp(`${WORD_START}(?:${candidates.map((entry) => escapeRegExp(entry.term)).join("|")})${WORD_END}`, "giu"), byTerm };
  if (matchers.size >= 16) matchers.clear();
  matchers.set(key, matcher);
  return matcher;
};

// The replaced spans: a match takes the first candidate equal to it
// case-insensitively (exactly, when the candidate is matchCase); a match no
// candidate takes is left as written.
const pronouncedSpans = (text, { pattern, byTerm }) => {
  const spans = [];
  for (const match of text.matchAll(pattern)) {
    const entry = (byTerm.get(match[0].toLowerCase()) || []).find((candidate) => !candidate.matchCase || candidate.term === match[0]);
    if (entry) spans.push({ start: match.index, end: match.index + match[0].length, spoken: entry.spoken });
  }
  return spans;
};

// Unicode superscripts and the characters they raise; ⊤ is the transpose sign.
const SUPERSCRIPTS = new Map(Object.entries({
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  "⁺": "plus", "⁻": "minus", "⁼": "equals", "⁽": "(", "⁾": ")", "ᐟ": "over", "⊤": "T",
  "ᵃ": "a", "ᵇ": "b", "ᶜ": "c", "ᵈ": "d", "ᵉ": "e", "ᶠ": "f", "ᵍ": "g", "ʰ": "h", "ⁱ": "i", "ʲ": "j", "ᵏ": "k", "ˡ": "l", "ᵐ": "m",
  "ⁿ": "n", "ᵒ": "o", "ᵖ": "p", "ʳ": "r", "ˢ": "s", "ᵗ": "t", "ᵘ": "u", "ᵛ": "v", "ʷ": "w", "ˣ": "x", "ʸ": "y", "ᶻ": "z",
  "ᴬ": "A", "ᴮ": "B", "ᴰ": "D", "ᴱ": "E", "ᴳ": "G", "ᴴ": "H", "ᴵ": "I", "ᴶ": "J", "ᴷ": "K", "ᴸ": "L", "ᴹ": "M", "ᴺ": "N", "ᴼ": "O",
  "ᴾ": "P", "ᴿ": "R", "ᵀ": "T", "ᵁ": "U", "ⱽ": "V", "ᵂ": "W",
  "ᵅ": "alpha", "ᵝ": "beta", "ᵞ": "gamma", "ᵟ": "delta", "ᵋ": "epsilon", "ᶿ": "theta", "ᶥ": "iota", "ᵠ": "phi", "ᶲ": "phi", "ᵡ": "chi",
}));

const SUBSCRIPTS = new Map(Object.entries({
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  "₊": "plus", "₋": "minus", "₌": "equals", "₍": "(", "₎": ")",
  "ₐ": "a", "ₑ": "e", "ₕ": "h", "ᵢ": "i", "ⱼ": "j", "ₖ": "k", "ₗ": "l", "ₘ": "m", "ₙ": "n", "ₒ": "o", "ₚ": "p", "ᵣ": "r", "ₛ": "s",
  "ₜ": "t", "ᵤ": "u", "ᵥ": "v", "ₓ": "x",
  "ᵦ": "beta", "ᵧ": "gamma", "ᵨ": "rho", "ᵩ": "phi", "ᵪ": "chi",
}));

// A superscript that is exactly one of these is its word; any other reads
// "to the power of …".
const SUPERSCRIPT_WORDS = new Map(Object.entries({
  "ᵀ": "transpose", "⊤": "transpose", T: "transpose",
  "⁻¹": "inverse", "−1": "inverse", "-1": "inverse",
  "²": "squared", 2: "squared", "³": "cubed", 3: "cubed",
  "*": "star", "∗": "star", "′": "prime",
}));

// Combining marks, read after the letter they sit on.
const COMBINING_MARKS = new Map(Object.entries({ "\u0302": "hat", "\u0303": "tilde", "\u0304": "bar", "\u0305": "bar", "\u0307": "dot", "\u20D7": "vector" }));

const SYMBOLS = new Map(Object.entries({
  α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", ϵ: "epsilon", ζ: "zeta", η: "eta", θ: "theta", ϑ: "theta",
  ι: "iota", κ: "kappa", λ: "lambda", μ: "mu", ν: "nu", ξ: "xi", ο: "omicron", π: "pi", ρ: "rho", σ: "sigma", ς: "sigma",
  τ: "tau", υ: "upsilon", φ: "phi", ϕ: "phi", χ: "chi", ψ: "psi", ω: "omega",
  Γ: "Gamma", Δ: "Delta", Θ: "Theta", Λ: "Lambda", Ξ: "Xi", Π: "Pi", Φ: "Phi", Ψ: "Psi", Ω: "Omega",
  ŷ: "y hat", Ŷ: "Y hat", ŵ: "w hat", Ŵ: "W hat", ᾱ: "alpha bar",
  "∇": "gradient of", "√": "square root of", "∈": "in", "≈": "approximately", "≤": "less than or equal to",
  "≥": "greater than or equal to", "≠": "not equal to", "−": "minus", "∣": "given",
  "×": "times", "÷": "divided by", "·": "times", "⋅": "times", "±": "plus or minus", "∓": "minus or plus",
  "∞": "infinity", "∂": "partial", "′": "prime", "″": "double prime",
  "→": "leads to", "←": "gets", "⇒": "implies", "⇔": "if and only if", "∝": "proportional to", "∼": "distributed as",
  "≡": "equivalent to", "≪": "much less than", "≫": "much greater than", "∉": "not in", "∩": "intersection", "∪": "union",
  "⊂": "subset of", "⊆": "subset of or equal to", "∀": "for all", "∃": "there exists", "∅": "the empty set",
  "⊙": "element-wise times", "⊗": "tensor product", "∘": "composed with", "∧": "and", "∨": "or", "¬": "not",
  "⟂": "perpendicular to", ℓ: "ell", "½": "one half", "¼": "one quarter", "¾": "three quarters",
  ℕ: "N", ℤ: "Z", ℚ: "Q", ℂ: "C",
}));

const BIG_OPERATORS = new Map(Object.entries({ "Σ": "sum", "∑": "sum", "∏": "product", "∫": "integral", "𝔼": "expected value" }));
const NORM_BARS = new Set(["‖", "∥"]);
const REALS = "ℝ";

// ASCII operators are words only alone, and only inside a formula run.
const LONE_OPERATORS = new Map([["=", { word: "equals", partners: "=<>!" }], ["+", { word: "plus", partners: "+" }], ["/", { word: "over", partners: "/" }]]);

// What makes a marked subscript compound, so it says "sub": r sub t plus k plus 1.
const COMPOUND_SCRIPT = /[\s+\-*\/=<>^±∓×÷·⋅−∘⊙⊗∧∨¬≈≤≥≠≡≪≫∈∉⊂⊆∩∪→←⇒⇔∝∼∣]/u;

// A token holding any character read below, or a sub or sup marker, is
// symbolic: it makes the formula run it belongs to active.
const SYMBOLIC = new RegExp(`[${[
  ...SUPERSCRIPTS.keys(), ...SUBSCRIPTS.keys(), ...COMBINING_MARKS.keys(), ...SYMBOLS.keys(), ...BIG_OPERATORS.keys(), ...NORM_BARS, REALS,
].map((char) => `\\u{${char.codePointAt(0).toString(16)}}`).join("")}\\uE000-\\uE003]`, "u");
const FORMULA_CHARACTERS = /^[\p{L}\p{N}_.,;:!?%'"()[\]{}|*^=+\-\/<>~&]+$/u;
const LONG_WORD = /\p{L}{4}/u;
const FUNCTION_NAMES = Object.freeze(["log", "exp", "max", "min", "softmax", "sigmoid", "tanh", "sin", "cos", "tan", "det", "tr", "Var", "Cov", "lim", "clip", "sign"]);

const isFormulaCompatible = (token, symbolic) => symbolic
  || (FORMULA_CHARACTERS.test(token) && !LONG_WORD.test(token))
  || FUNCTION_NAMES.some((name) => token.startsWith(name));

/**
 * Writes spoken text with the spacing words need: a word gets a space before
 * it unless it follows whitespace or ( [ {, and one after it unless
 * whitespace, , . ; : ! ? ) ] } % or the end follows. The builder collapses
 * the rest.
 */
const createSpeaker = () => {
  const builder = createSpokenBuilder();
  let last = "";
  let spaceAt = null;
  const write = (text, start, end) => {
    if (text && spaceAt !== null) {
      if (!/^[\s,.;:!?)\]}%]/u.test(text)) builder.append(" ", spaceAt, spaceAt);
      spaceAt = null;
    }
    builder.append(text, start, end);
    if (text) last = text.at(-1);
  };
  const lead = (at) => {
    if (spaceAt !== null) builder.append(" ", spaceAt, spaceAt);
    else if (last && !/[\s([{]/u.test(last)) builder.append(" ", at, at);
    else return;
    spaceAt = null;
    last = " ";
  };
  return {
    text: (value, start) => write(value, start, start + value.length),
    said: (spoken, start, end) => write(spoken, start, end),
    word(value, start, end) {
      lead(start);
      write(value, start, end);
      spaceAt = end;
    },
    lead,
    trail: (at) => { spaceAt = at; },
    build: () => builder.build(),
  };
};

const isSpace = (item) => item?.char !== undefined && /\s/u.test(item.char);
const isLetter = (item) => item?.char !== undefined && /^\p{L}$/u.test(item.char);
// A group's content as text; a replaced term counts as what it says.
const groupText = (group) => group.items.map((item) => item.char ?? item.said ?? groupText(item)).join("");

// The words a run of Unicode sub- or superscript characters stands for: each
// character as its base character, operators and Greek letters as words.
const scriptWords = (chars, table, times = "") => chars
  .map((char) => {
    const base = char === "ˣ" && times ? times : table.get(char);
    return /^[\p{L}\p{N}()]$/u.test(base) ? base : ` ${base} `;
  })
  .join("")
  .replace(/\s+/gu, " ")
  .trim();

const scriptRun = (items, index, table) => {
  let next = index;
  while (next < items.length && table.has(items[next].char)) next += 1;
  const chars = items.slice(index, next).map((item) => item.char);
  return { chars, text: chars.join(""), start: items[index].start, end: items[next - 1].end, next };
};

// The sub- or superscript at `index`: a marked group or a Unicode run.
const scriptAt = (items, index, kind) => {
  const item = items[index];
  if (item?.group === kind) return { group: item, text: groupText(item).trim(), start: item.start, end: item.end, next: index + 1 };
  const table = kind === "sub" ? SUBSCRIPTS : SUPERSCRIPTS;
  return item && table.has(item.char) ? scriptRun(items, index, table) : null;
};

// A script's content as its own words: a Unicode run by its base characters,
// a marked group read as math.
const readScript = (script, table, out) => {
  if (!script.group) {
    out.word(scriptWords(script.chars, table), script.start, script.end);
    return;
  }
  out.lead(script.start);
  readItems(script.group.items, out);
  out.trail(script.end);
};

const readSuperscript = (script, out) => {
  const word = SUPERSCRIPT_WORDS.get(script.text);
  if (word) out.word(word, script.start, script.end);
  else if (!script.group) out.word(`to the power of ${scriptWords(script.chars, SUPERSCRIPTS)}`, script.start, script.end);
  else {
    out.word("to the power of", script.start, script.start);
    readScript(script, SUPERSCRIPTS, out);
  }
  return script.next;
};

const readSubscript = (script, out) => {
  if (script.group && COMPOUND_SCRIPT.test(script.text)) out.word("sub", script.start, script.start);
  readScript(script, SUBSCRIPTS, out);
  return script.next;
};

// ‖x‖₂ → "the L2 norm of x", ½‖w‖² → "one half the squared norm of w". A bar
// opens a norm only before a non-space and closes it only after one, so the
// bar in KL(P ‖ Q) stays a bar. The words go where the opening bar was; the
// closing bar and its scripts become a gap.
const readNorm = (items, index, out) => {
  const bar = items[index];
  if (!items[index + 1] || isSpace(items[index + 1])) return 0;
  let close = index + 2;
  while (close < items.length && !(items[close].char === bar.char && !isSpace(items[close - 1]))) close += 1;
  if (close >= items.length) return 0;
  let next = close + 1;
  let order = "";
  const sub = scriptAt(items, next, "sub");
  if (sub) {
    order = sub.group ? sub.text : scriptWords(sub.chars, SUBSCRIPTS);
    next = sub.next;
  } else if (items[next]?.char === "∞") {
    order = "∞";
    next += 1;
  }
  const sup = scriptAt(items, next, "sup");
  const squared = sup?.text === "²" || sup?.text === "2";
  if (squared) next = sup.next;
  const lp = order === "∞" ? "L infinity " : order ? `L${order} ` : "";
  out.word(`the ${squared ? "squared " : ""}${lp}norm of`, bar.start, bar.end);
  readItems(items.slice(index + 1, close), out);
  return next;
};

// ℝᵐˣⁿ → "R m by n", ℝᵈ → "R d", ℝ<sup>V×d</sup> → "R V by d".
const readReals = (items, index, out) => {
  out.word("R", items[index].start, items[index].end);
  const sup = scriptAt(items, index + 1, "sup");
  if (!sup) return index + 1;
  out.word(sup.group ? sup.text.replace(/\s*[×ˣ]\s*/gu, " by ") : scriptWords(sup.chars, SUPERSCRIPTS, "by"), sup.start, sup.end);
  return sup.next;
};

// Σ ∑ ∏ ∫ 𝔼 with their limits: "sum from i equals 1 to n of", "sum over i
// of", "sum of". Σ right before a superscript is the letter: Σ⁻¹ → "Sigma
// inverse".
const readBigOperator = (items, index, out) => {
  const operator = items[index];
  const name = BIG_OPERATORS.get(operator.char);
  const sub = scriptAt(items, index + 1, "sub");
  const sup = scriptAt(items, sub ? sub.next : index + 1, "sup");
  if (!sub && sup && operator.char === "Σ") {
    out.word("Sigma", operator.start, operator.end);
    return index + 1;
  }
  if (!sub && !sup) {
    out.word(`${name} of`, operator.start, operator.end);
    return index + 1;
  }
  out.word(`${name} ${sub ? (sup ? "from" : "over") : "to"}`, operator.start, operator.end);
  if (sub) readScript(sub, SUBSCRIPTS, out);
  if (sub && sup) out.word("to", sup.start, sup.start);
  if (sup) readScript(sup, SUPERSCRIPTS, out);
  const limits = sup || sub;
  out.word("of", limits.end, limits.end);
  return limits.next;
};

// = + / alone: not part of == <= ++ //, and not against the inside of a
// bracket, where "(D ∣ +)" names the sign itself.
const operatorWord = (items, index) => {
  const { word, partners } = LONE_OPERATORS.get(items[index].char);
  const before = items[index - 1]?.char ?? "";
  const after = items[index + 1]?.char ?? "";
  const beside = (char, set) => char !== "" && set.includes(char);
  return beside(before, partners) || beside(after, partners) || beside(before, "([{") || beside(after, ")]}") ? "" : word;
};

// A single letter, a Greek letter or a listed function right before "(" is
// applied to it: P(y ∣ x) → "P of (y given x)".
const appliesTo = (items, index) => {
  let at = index - 1;
  while (at >= 0 && COMBINING_MARKS.has(items[at].char)) at -= 1;
  if (!isLetter(items[at])) return false;
  if (SYMBOLS.has(items[at].char)) return true;
  let first = at;
  while (first > 0 && isLetter(items[first - 1]) && !SYMBOLS.has(items[first - 1].char)) first -= 1;
  return first === at || FUNCTION_NAMES.includes(items.slice(first, at + 1).map((item) => item.char).join(""));
};

const readAt = (items, index, out) => {
  const item = items[index];
  if (item.said !== undefined) {
    out.said(item.said, item.start, item.end);
    return index + 1;
  }
  if (item.group) return item.group === "sub" ? readSubscript(scriptAt(items, index, "sub"), out) : readSuperscript(scriptAt(items, index, "sup"), out);
  const { char } = item;
  if (NORM_BARS.has(char)) {
    const next = readNorm(items, index, out);
    if (next) return next;
  }
  if (char === REALS) return readReals(items, index, out);
  if (BIG_OPERATORS.has(char)) return readBigOperator(items, index, out);
  if (SUPERSCRIPTS.has(char)) return readSuperscript(scriptAt(items, index, "sup"), out);
  if (SUBSCRIPTS.has(char)) return readSubscript(scriptAt(items, index, "sub"), out);
  const operator = LONE_OPERATORS.has(char) ? operatorWord(items, index) : "";
  if (COMBINING_MARKS.has(char) && (isLetter(items[index - 1]) || COMBINING_MARKS.has(items[index - 1]?.char))) out.word(COMBINING_MARKS.get(char), item.start, item.end);
  else if (SYMBOLS.has(char)) out.word(SYMBOLS.get(char), item.start, item.end);
  else if (operator) out.word(operator, item.start, item.end);
  else {
    if (char === "(" && appliesTo(items, index)) out.word("of", item.start, item.start);
    out.text(char, item.start);
  }
  return index + 1;
};

const readItems = (items, out) => {
  for (let index = 0; index < items.length;) index = readAt(items, index, out);
};

// A formula run as items: { char, start, end } per code point;
// { group: "sub" | "sup", items, start, end } per marked group, its range the
// content between the markers; { said, start, end } per replaced term.
const runItems = (source, start, end, spans) => {
  const root = { items: [] };
  const stack = [root];
  let next = 0;
  for (let index = start; index < end;) {
    const top = stack.at(-1);
    if (spans[next]?.start === index) {
      const span = spans[next];
      top.items.push({ said: span.spoken, start: span.start, end: span.end });
      next += 1;
      index = span.end;
      continue;
    }
    const code = source.codePointAt(index);
    const char = String.fromCodePoint(code);
    if (code === SUB_OPEN || code === SUP_OPEN) {
      const group = { group: code === SUB_OPEN ? "sub" : "sup", items: [], start: index + 1, end };
      top.items.push(group);
      stack.push(group);
    } else if (code === SUB_CLOSE || code === SUP_CLOSE) {
      // A close without its open speaks nothing.
      if (top.group === (code === SUB_CLOSE ? "sub" : "sup")) {
        top.end = index;
        stack.pop();
      }
    } else if (!isMark(code)) top.items.push({ char, start: index, end: index + char.length });
    index += char.length;
  }
  return root.items;
};

// Source text spoken as written, markers dropped.
const emitText = (out, source, start, end) => {
  let from = start;
  for (let index = start; index < end; index += 1) {
    if (!isMark(source.charCodeAt(index))) continue;
    if (index > from) out.text(source.slice(from, index), from);
    from = index + 1;
  }
  if (end > from) out.text(source.slice(from, end), from);
};

// A stretch spoken as written apart from its replaced terms.
const emitLiteral = (out, source, start, end, spans) => {
  let from = start;
  for (const span of spans) {
    emitText(out, source, from, span.start);
    out.said(span.spoken, span.start, span.end);
    from = span.end;
  }
  emitText(out, source, from, end);
};

// Tokens are maximal non-whitespace runs; a marked group belongs to the token
// it touches, spaces inside it included.
const tokensOf = (source, start, end) => {
  const tokens = [];
  let depth = 0;
  let tokenStart = -1;
  const push = (tokenEnd) => {
    const value = source.slice(tokenStart, tokenEnd);
    const symbolic = SYMBOLIC.test(value);
    tokens.push({ start: tokenStart, end: tokenEnd, symbolic, compatible: isFormulaCompatible(value, symbolic) });
    tokenStart = -1;
  };
  for (let index = start; index < end; index += 1) {
    const code = source.charCodeAt(index);
    if (code === SUB_OPEN || code === SUP_OPEN) depth += 1;
    else if ((code === SUB_CLOSE || code === SUP_CLOSE) && depth > 0) depth -= 1;
    if (depth === 0 && /\s/u.test(source[index])) {
      if (tokenStart >= 0) push(index);
    } else if (tokenStart < 0) tokenStart = index;
  }
  if (tokenStart >= 0) push(end);
  return tokens;
};

// A formula run is a maximal sequence of formula-compatible tokens; it is read
// as math only when it holds a symbolic token, so "Gaussian + identity" keeps
// its plus and "x = 5" its equals sign.
const emitMath = (out, source, segment) => {
  const within = (start, end) => segment.spans.filter((span) => span.start >= start && span.end <= end);
  let from = segment.start;
  if (SYMBOLIC.test(source.slice(segment.start, segment.end))) {
    const tokens = tokensOf(source, segment.start, segment.end);
    for (let first = 0; first < tokens.length;) {
      let last = first;
      while (tokens[first].compatible && last + 1 < tokens.length && tokens[last + 1].compatible) last += 1;
      if (tokens[first].compatible && tokens.slice(first, last + 1).some((token) => token.symbolic)) {
        const { start } = tokens[first];
        const { end } = tokens[last];
        emitLiteral(out, source, from, start, within(from, start));
        readItems(runItems(source, start, end, within(start, end)), out);
        from = end;
      }
      first = last + 1;
    }
  }
  emitLiteral(out, source, from, segment.end, within(from, segment.end));
};

// The input's top-level pieces: a replaced term, inline code (plain:
// pronunciations only) and the text between them. A term replaced inside a
// sub or sup group stays with its text, so the group reads whole; at the top
// level a replaced term ends the formula run before it.
const segmentsOf = (source, spans) => {
  const segments = [];
  let current = null;
  let depth = 0;
  let next = 0;
  const open = (plain, start) => {
    current = { plain, start, end: start, spans: [] };
  };
  const close = (end) => {
    if (!current) return;
    current.end = end;
    segments.push(current);
    current = null;
  };
  for (let index = 0; index < source.length;) {
    const span = spans[next];
    if (span?.start === index) {
      next += 1;
      if (current?.plain || depth > 0) current.spans.push(span);
      else {
        close(index);
        segments.push({ term: span });
      }
      index = span.end;
      continue;
    }
    const code = source.charCodeAt(index);
    if (current?.plain) {
      if (code === PLAIN_CLOSE) close(index);
    } else if (code === PLAIN_OPEN && depth === 0) {
      close(index);
      open(true, index + 1);
    } else {
      if (!current) open(false, index);
      if (code === SUB_OPEN || code === SUP_OPEN) depth += 1;
      else if ((code === SUB_CLOSE || code === SUP_CLOSE) && depth > 0) depth -= 1;
    }
    index += 1;
  }
  close(source.length);
  return segments;
};

/**
 * `text` as narration says it, with a map from the spoken text back to
 * `text`'s offsets. Pronunciations apply everywhere, inline code included;
 * a replacement is never read again. With `math`, Unicode math outside inline
 * code is read in words. Markers speak nothing.
 */
export const speakableWithMap = (text, { pronunciations = [], math = true } = {}) => {
  const source = String(text ?? "");
  const out = createSpeaker();
  for (const segment of segmentsOf(source, pronouncedSpans(source, pronunciationMatcher(pronunciations)))) {
    if (segment.term) out.said(segment.term.spoken, segment.term.start, segment.term.end);
    else if (segment.plain || !math) emitLiteral(out, source, segment.start, segment.end, segment.spans);
    else emitMath(out, source, segment);
  }
  return out.build();
};

export const speakable = (text, options) => speakableWithMap(text, options).text;
