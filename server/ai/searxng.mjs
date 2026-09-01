import { isIP } from "node:net";

import { fetchWithTimeout, readJsonResponse } from "./http.mjs";

const MAX_QUERY_CHARS = 240;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const DANGEROUS_FORMAT_CONTROLS = /[\p{Default_Ignorable_Code_Point}\u115f\u1160\u3164\uffa0]/u;
const SEARX_CONTROL_TOKEN = /(^|\s)[!:]\S+/;
const PRIVATE_DNS_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".home.arpa"];
const TRACKING_PARAMETERS = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid"]);
const QUERY_STOP_WORDS = new Set(["a", "an", "and", "are", "for", "from", "how", "in", "is", "of", "on", "or", "the", "to", "what", "when", "which", "with"]);
const GENERIC_SEARCH_TOKENS = new Set(["current", "latest", "new", "news", "official", "recent", "release", "released", "stable", "support", "supported", "today", "updated", "version"]);
const RECENCY_QUERY = /\b(latest|current|recent|today|new|news|release|released|version|updated|support(?:ed)?)\b/i;

const cleanText = (value, maximum) => String(value || "")
  .replace(/<[^>]*>/g, " ")
  .replace(/&(?:nbsp|#160);/gi, " ")
  .replace(/&(?:amp|#38);/gi, "&")
  .replace(/&(?:lt|#60);/gi, "<")
  .replace(/&(?:gt|#62);/gi, ">")
  .replace(/&(?:quot|#34);/gi, "\"")
  .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
  .replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, maximum);

const normalizePublishedAt = (value) => {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toISOString().slice(0, 10);
};

const isPrivateIpv4 = (hostname) => {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19));
};

const isPrivateIpv6 = (hostname) => {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "::" || normalized === "::1"
    || normalized.startsWith("fc") || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith("ff")
    || normalized.startsWith("::ffff:")
    || normalized === "100::" || normalized.startsWith("100::")
    || normalized === "2001:db8::" || normalized.startsWith("2001:db8:")
    || normalized === "2001:2::" || normalized.startsWith("2001:2:");
};

export const sanitizePublicResultUrl = (value) => {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  // A trailing DNS root dot is equivalent in browsers/resolvers but would
  // otherwise evade suffix checks such as localhost. and *.internal.
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (!hostname || hostname === "localhost" || PRIVATE_DNS_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return null;
  const ipVersion = isIP(hostname.replace(/^\[|\]$/g, ""));
  if ((ipVersion === 4 && isPrivateIpv4(hostname)) || (ipVersion === 6 && isPrivateIpv6(hostname))) return null;
  url.hostname = hostname;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.toLowerCase();
    if (normalized.startsWith("utm_") || TRACKING_PARAMETERS.has(normalized)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href.slice(0, 2_000);
};

export const validateSearchQuery = (value) => {
  if (typeof value !== "string") return null;
  const query = value.replace(/\s+/g, " ").trim();
  // SearX bang/category syntax can override the operator-owned engine and
  // category policy (for example !ddg or :images). The learner/model controls
  // search terms only, never routing.
  if (!query || query.length > MAX_QUERY_CHARS || CONTROL_CHARACTERS.test(query) || DANGEROUS_FORMAT_CONTROLS.test(query) || SEARX_CONTROL_TOKEN.test(query)) return null;
  return query;
};

export class WebSearchError extends Error {
  constructor(code, message, status = 502, options = {}) {
    super(message, options);
    this.name = "WebSearchError";
    this.code = code;
    this.status = status;
  }
}

const lexicalTokens = (value) => new Set(String(value || "")
  .toLocaleLowerCase("en-US")
  .match(/[a-z0-9][a-z0-9.+#-]{1,}/g)
  ?.filter((token) => !QUERY_STOP_WORDS.has(token)) || []);

const tokenOverlap = (queryTokens, value) => {
  if (!queryTokens.size) return 0;
  const valueTokens = lexicalTokens(value);
  let overlap = 0;
  for (const token of queryTokens) if (valueTokens.has(token)) overlap += 1;
  return overlap / queryTokens.size;
};

const siteTargets = (query) => [...query.matchAll(/(?:^|\s)site:([a-z0-9.-]+)/gi)]
  .map((match) => match[1].toLowerCase().replace(/^www\./, "").replace(/\.+$/, ""))
  .filter(Boolean);

const hasMinimumQueryRelevance = (result, query) => {
  const parsed = new URL(result.url);
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const targets = siteTargets(query);
  // A result outside an explicitly requested site cannot ground that query,
  // even if a degraded engine ignored the site operator.
  if (targets.length && !targets.some((target) => hostname === target || hostname.endsWith(`.${target}`))) return false;

  const queryWithoutOperators = query.replace(/(?:^|\s)site:[a-z0-9.-]+/gi, " ").trim();
  const queryTokens = lexicalTokens(queryWithoutOperators);
  if (!queryTokens.size) return false;
  const evidenceTokens = lexicalTokens(`${result.title} ${hostname.replace(/[.-]/g, " ")} ${result.snippet}`);
  const distinctiveTokens = [...queryTokens].filter((token) => !GENERIC_SEARCH_TOKENS.has(token));
  const requiredTokens = distinctiveTokens.length ? distinctiveTokens : [...queryTokens];
  const matchingTokens = requiredTokens.filter((token) => evidenceTokens.has(token)).length;
  // One product/entity token is enough for short or generic queries. Longer
  // specific queries need majority coverage so a generic product homepage
  // cannot masquerade as evidence for a requested feature or behavior.
  const minimumMatches = requiredTokens.length <= 2 ? 1 : Math.ceil(requiredTokens.length * 0.6);
  return matchingTokens >= minimumMatches;
};

const rankingScore = (result, query, index, now = Date.now()) => {
  const queryWithoutOperators = query.replace(/(?:^|\s)site:[a-z0-9.-]+/gi, " ").trim();
  const queryTokens = lexicalTokens(queryWithoutOperators);
  const parsed = new URL(result.url);
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let score = tokenOverlap(queryTokens, result.title) * 8
    + tokenOverlap(queryTokens, hostname.replace(/[.-]/g, " ")) * 5
    + tokenOverlap(queryTokens, result.snippet) * 2;
  if (queryWithoutOperators.length >= 4 && result.title.toLowerCase().includes(queryWithoutOperators.toLowerCase())) score += 5;
  const targets = siteTargets(query);
  if (targets.some((target) => hostname === target || hostname.endsWith(`.${target}`))) score += 20;
  if (/\bofficial\b/i.test(result.title)) score += 2;
  if (/^(docs|developer|documentation)\./.test(hostname) || /\/(docs?|documentation|reference)(?:\/|$)/i.test(parsed.pathname)) score += 1.5;
  if (RECENCY_QUERY.test(query) && result.publishedAt) {
    const ageDays = Math.max(0, (now - Date.parse(`${result.publishedAt}T00:00:00Z`)) / 86_400_000);
    score += ageDays <= 30 ? 4 : ageDays <= 180 ? 2.5 : ageDays <= 730 ? 1 : 0;
  }
  // Stable original-order tie breaker without allowing an engine-provided
  // score to overwhelm transparent Lumen-owned relevance signals.
  return score - index * 1e-6;
};

export const rankPublicSearchResults = (results, query, maximum, now = Date.now()) => results
  .filter((result) => hasMinimumQueryRelevance(result, query))
  .map((result, index) => ({ result, score: rankingScore(result, query, index, now) }))
  .sort((left, right) => right.score - left.score)
  .slice(0, maximum)
  .map(({ result }) => result);

export const searchSearxng = async ({ query, config, fetchImpl = fetch, signal }) => {
  const validatedQuery = validateSearchQuery(query);
  if (!validatedQuery) throw new WebSearchError("AI_TOOL_ARGUMENT_ERROR", "The local model produced an invalid web-search query.", 502);
  if (!config.webSearchEnabled) throw new WebSearchError("WEB_SEARCH_NOT_ALLOWED", "Web search was not enabled for this request.", 403);

  const searchUrl = new URL("/search", config.searxngUrl);
  searchUrl.searchParams.set("q", validatedQuery);
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("categories", "general");
  searchUrl.searchParams.set("safesearch", "1");
  // Lumen's current tutor UI and curriculum are English. Several no-key
  // engines substantially degrade ranking when SearXNG receives `all`; use the
  // actual product language until per-request locale is a validated contract.
  searchUrl.searchParams.set("language", "en");

  const startedAt = Date.now();
  let response;
  try {
    response = await fetchWithTimeout(searchUrl, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "lumen-local-learning/1.0" },
      redirect: "error",
    }, {
      fetchImpl,
      signal,
      timeoutMs: config.webSearchTimeoutMs,
      timeoutMessage: "The self-hosted web search timed out",
    });
  } catch (error) {
    if (error.code === "FETCH_ABORTED") throw error;
    const timeout = error.code === "FETCH_TIMEOUT";
    throw new WebSearchError(
      timeout ? "WEB_SEARCH_TIMEOUT" : "WEB_SEARCH_UNAVAILABLE",
      timeout ? "The self-hosted web search took too long to respond." : "The self-hosted web search is unavailable.",
      timeout ? 504 : 502,
      { cause: error },
    );
  }

  let payload;
  try {
    const remainingMs = Math.max(1, config.webSearchTimeoutMs - (Date.now() - startedAt));
    payload = await readJsonResponse(response, config.webSearchMaxResponseBytes, "SearXNG", {
      signal,
      timeoutMs: remainingMs,
    });
  } catch (error) {
    if (error.code === "RESPONSE_ABORTED") throw error;
    if (error.code === "RESPONSE_TIMEOUT") {
      throw new WebSearchError("WEB_SEARCH_TIMEOUT", "The self-hosted web search took too long to respond.", 504, { cause: error });
    }
    throw new WebSearchError("WEB_SEARCH_INVALID_RESPONSE", "The self-hosted web search returned an unreadable response.", 502, { cause: error });
  }
  if (!response.ok) {
    throw new WebSearchError("WEB_SEARCH_UNAVAILABLE", "The self-hosted web search could not complete this query.", 502);
  }

  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  const seen = new Set();
  const candidates = [];
  const maximumCandidates = Math.min(96, Math.max(config.webSearchMaxResults * 12, 24));
  for (const candidate of rawResults.slice(0, maximumCandidates)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const url = sanitizePublicResultUrl(candidate.url);
    const title = cleanText(candidate.title, 300);
    const snippet = cleanText(candidate.content || candidate.snippet, 1_200);
    const source = cleanText(candidate.engine || (Array.isArray(candidate.engines) ? candidate.engines.join(", ") : ""), 100);
    const publishedAt = normalizePublishedAt(candidate.publishedDate ?? candidate.published_at ?? candidate.pubdate);
    // Empty snippets cannot ground a time-sensitive answer and violate the
    // browser/on-device evidence contract, so discard them at the gateway.
    if (!url || !title || !snippet || seen.has(url)) continue;
    seen.add(url);
    candidates.push({ title, url, snippet, ...(source ? { source } : {}), ...(publishedAt ? { publishedAt } : {}) });
  }
  const results = rankPublicSearchResults(candidates, validatedQuery, config.webSearchMaxResults);
  return { query: validatedQuery, results };
};
