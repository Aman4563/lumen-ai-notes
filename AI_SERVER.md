# Lumen local AI server

Lumen uses **Ollama on the computer serving the app** for free local inference.
The iPhone remains a lightweight reader: after the learner acknowledges the
local-model disclosure, it sends a bounded learning request to Lumen over the
local network, and Lumen calls Ollama on the same computer. No OpenAI, Anthropic,
Google, or other paid model API/key is required.

Optional current-information lookup uses a **self-hosted SearXNG** instance.
Search is disabled at two layers: the server capability is off by default, and
even after an operator enables it, every request must carry the learner's
explicit `webSearch: true` choice. A model cannot turn search on by itself.

The learner-facing default is **Library first**, not “current open article.”
Before inference, the browser searches all 143 built-in lectures and every
supported custom document (up to 500), with saved edits authoritative and
personal notes included under explicit provenance. It sends only a bounded set
of relevant, source-anchored passages to the local model. A separate consented
web lookup is eligible only when the local retrieval trace says the question is
time-sensitive or local evidence is insufficient.

Local inference has no per-token/API bill, but the computer, electricity,
internet data, and search engines configured in SearXNG can still have ordinary
operating or policy constraints.

## 1. Install and test Ollama

Install Ollama on the Mac or other computer that runs Lumen, start it, then pull
the default compact tool-capable model:

```bash
ollama pull qwen3.5:4b
ollama run qwen3.5:4b
```

The server defaults to `http://127.0.0.1:11434` and `qwen3.5:4b`, but AI is
**opt-in**: `AI_ENABLED` defaults to `false`. Use one of the explicit launch
profiles below. To change the model, edit only the server-side `OLLAMA_MODEL`
value and review/update `OLLAMA_MODEL_DIGEST`. When a digest is configured,
Lumen compares it with Ollama's `/api/tags` identity and fails the normal tutor
readiness check on a mismatch. The browser cannot choose a provider, service URL, model, tool, token
ceiling, or hidden instruction. It may request a smaller output budget, but can
never exceed the server-owned `AI_MAX_OUTPUT_TOKENS` ceiling.

The default response profiles are:

| Profile | Default output ceiling | Behavior |
|---|---:|---|
| Fast | 900 tokens | Short, direct answer: prose is asked for about 150 words unless the learner asks for more; provider thinking off. |
| Balanced | 1,800 tokens | Default depth/speed balance; provider thinking off. |
| Deep | 3,200 tokens | Longer answer; supported local-model thinking may run privately. |

`AI_MAX_OUTPUT_TOKENS` defaults to 4,096 and remains the absolute ceiling. The
three profile defaults can be changed with `AI_FAST_OUTPUT_TOKENS`,
`AI_BALANCED_OUTPUT_TOKENS`, and `AI_DEEP_OUTPUT_TOKENS`; startup rejects values
that are unordered or exceed the absolute ceiling. Each profile also receives a
server-published maximum request-byte budget. A longer output allowance therefore
reserves more context-window space and permits fewer browser-supplied bytes.

Deep-mode provider thinking is never part of the public contract. Ollama's
`message.thinking` field is discarded and is not streamed, returned, logged as
answer content, or saved in browser history. The UI's **Approach** panel instead
shows deterministic orchestration and evidence metadata; it is not hidden
chain-of-thought.

Recommended starting points depend on host memory and desired speed:

- `qwen3.5:4b` is Lumen's default balance for a mobile-facing local server.
- A smaller quantized tool-capable model can improve latency on a low-memory
  host, at the cost of reasoning and structured-output reliability.
- A larger tool-capable model can improve answer quality when the serving Mac
  has enough unified memory. Keep `AI_MAX_CONCURRENT=1` or `2` to prevent memory
  pressure from simultaneous iPhone requests.

Model support changes over time. Confirm the chosen model's tool-calling and
structured-output capabilities in its current Ollama model page before making
it the production default. Lumen probes both `/api/tags` and `/api/show`; basic
tutoring requires an installed model that attests `completion`, while Mac-local
web search is enabled only when the model also attests `tools`.

## 2. Local library grounding

Library retrieval runs in the browser before the local-model request. It does
not upload the whole library and does not make a network request itself.

The retrieval pipeline:

1. searches metadata and the generated full-text index for every built-in and
   custom document;
2. treats a saved built-in edit as authoritative instead of using stale indexed
   text;
3. searches saved personal notes and labels those passages as personal-note
   provenance;
4. lazy-loads only the highest-ranked candidate lecture bodies;
5. splits Markdown at source headings, scores and diversifies passages, and
   enforces exact UTF-8 passage/request budgets; and
6. returns stable passage, document, revision, section, and anchor identifiers,
   together with corpus/selection counts, confidence components, truncation,
   and a web-fallback recommendation/reason.

The retrieval module defaults to no more than 10 loaded candidates, 9 passages
from 6 documents, and 24,000 returned bytes, with hard caps of 18 candidates,
12 passages from 8 documents, and 48,000 bytes. The tutor applies the stricter
active response-profile and model-context budget before sending anything. The
On-device Lite surface further limits this to two passages under a 4,400-byte
retrieval-entry budget including metadata and text, before its context-builder cap
and separate exact serialized fit into the 4,096-token model window.

The Mac tutor measures the complete canonical JSON body that it will submit,
not an approximate character count. That body already contains the normalized
`conversationSummary` and `responseFormat` fields as well as history, profile,
output cap, and web-search flag. Initial context, retrieved passages, no-match,
retrieval-failure fallback, structured requests, and retries all rebuild and fit
this same body with `JSON.stringify` UTF-8 bytes. The exact fitted object is then
sent, preventing server normalization or emoji/CJK/escaping from moving an
apparently valid request over the advertised profile boundary.

The default Library-first mode can answer a free-form question even when no
article is open. Current lesson, Choose sources, and No library are explicit
scope overrides. A high retrieval score is a lexical sufficiency signal, not a
guarantee that Qwen will cite every generated factual claim correctly; claim-level
grounding evaluation remains open.

## 3. Optional self-hosted web search

Lumen includes a reproducible, loopback-only Compose deployment with JSON search
enabled. Generate a secret and start it:

```bash
node scripts/setup_local_search.mjs
docker compose --env-file infra/searxng/.env -f infra/searxng/compose.yaml up -d
curl -fsS 'http://127.0.0.1:8080/search?q=test&format=json'
```

The compose file binds only `127.0.0.1:8080`, requires `SEARXNG_SECRET`, pins an
immutable multi-architecture image digest, runs as the packaged non-root user
with a read-only root and no Linux capabilities, and applies resource bounds.
Its mounted `config/settings.yml` explicitly enables JSON:

```yaml
search:
  formats:
    - html
    - json
```

Then set:

```dotenv
WEB_SEARCH_ENABLED=true
SEARXNG_URL=http://127.0.0.1:8080
```

SearXNG is a metasearch proxy, not an offline index. A query may be sent to the
search engines enabled by the SearXNG operator. Lumen discloses this before
consent, limits query/result sizes and tool rounds, rejects SearXNG bang/category
control syntax, filters unsafe/private clickable result URLs, and never fetches
result pages. Tracking parameters and fragments are stripped, canonical URLs are
deduplicated, and a bounded candidate set is reranked using query/title/snippet
overlap, requested-site/domain matches, documentation/official-page hints, and
recency for time-sensitive queries before at most the configured top results
reach the model.

The Mac model may derive up to `WEB_SEARCH_MAX_ROUNDS` bounded queries from the
approved prompt, attached context, and bounded conversation history. If Qwen
skips the required tool call, Lumen discards that provisional answer and uses a
bounded deterministic query derived from the already authorized learner question
so the opt-in cannot be silently ignored. If a model-planned query returns no
usable evidence and one disclosed round remains, Lumen retries once with that
bounded learner-question query before failing closed. Feature-specific queries
also require majority overlap across their distinctive terms so a generic product
homepage cannot become evidence for an unrelated feature. Before a buffered
answer that must cite supplied evidence is validated, labels the model did
write in a grouped or spaced form (`[S1, S2]`, `[S 1]`) are normalized to
`[S1] [S2]`; the server never adds a label to text that has none, never
changes case, and never touches code. A buffered grounded draft
that still fails its citation check receives at most one local regeneration with
explicit citation-placement guidance; a second failure remains an error. A prose
answer that arrives as a bare JSON document gets one regeneration as Markdown,
then fails with `AI_CONTRACT_ERROR`. The phone flow shows the exact single
query before sending it. In Library-first mode, the browser sends
`webSearch: true` only when the learner enabled fallback **and**
local retrieval recommends it. A strong local match prevents web egress even
when permission is checked. Public engines can rate-limit, return CAPTCHAs, omit
recent sources, or supply irrelevant/misleading snippets. Reranking cannot repair
evidence that SearXNG did not return, and Lumen does not fetch linked pages to
verify snippets. When the search returns no usable evidence but library passages
were attached, a Markdown answer is generated from those passages only: it must
cite a supplied `[S#]`, may not contain any `[W#]`, starts with a visible
"Current-web evidence unavailable" notice, and reports `webSearch.used: false`
with the rounds actually searched. Lumen still fails closed with
`WEB_SEARCH_NO_RESULTS` when there is no library evidence, for structured tasks,
or when the library-only answer fails its citation check twice, and whenever a
searched answer lacks a valid `[W#]` citation. This remains best-effort
retrieval, not a guaranteed current-facts service. Review engine terms, rate limits, and privacy
settings before enabling them.

The local-model disclosure acknowledgement is remembered only in the current
browser until the learner chooses **Review again** or clears site data; local-only
requests do not require the same checkbox on every turn. This acknowledgement
does not authorize search. Current-web fallback is separately off by default and
must be authorized for each request and retry. That single-use authorization
covers the disclosed bounded query-generation process, not an exact string
preview: generated query text can reproduce words or short fragments from the
prompt, selected context, or bounded history. Use On-device Lite when each exact
query must be displayed and separately approved.

The included Compose profile uses Docker's `none` logging driver because some
SearXNG engine adapters write exact queries to stdout/stderr. Search engines
still receive the query and may retain ordinary request metadata under their
own policies.

## 4. Run Lumen

### Loopback development profile

Development intentionally uses plain HTTP only on `127.0.0.1`. The script
overrides any LAN/TLS values in `.env`, so Vite can proxy `/api` to port 8787:

```bash
# Terminal 1
npm run dev:ai

# Terminal 2
npm run dev
```

This profile enables Ollama tutoring for the developer's own loopback browser
and keeps search off. After starting the loopback SearXNG service, use
`npm run dev:ai:search` instead when search is wanted.

### Private-LAN iPhone profile

For an iPhone, build once and serve the app and API from one HTTPS origin. A
minimal `.env` profile is:

```dotenv
AI_ENABLED=true
WEB_SEARCH_ENABLED=true
HOST=0.0.0.0
PORT=4194
TLS_CERT_FILE=.local/https/server-cert.pem
TLS_KEY_FILE=.local/https/server-key.pem
AI_ALLOWED_ORIGINS=https://macbook-pro.local:4194
OLLAMA_MODEL=qwen3.5:4b
# Reviewed on 2026-08-23. Re-verify and update this value when changing or
# deliberately re-pulling the model artifact.
OLLAMA_MODEL_DIGEST=2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd
OLLAMA_CONTEXT_WINDOW_TOKENS=16384
```

Replace the example hostname with the stable LAN origin included in the local
certificate (or use a router-reserved IP origin), then run:

```bash
npm run build
npm start
```

For an iPhone on the private LAN, use the trusted local HTTPS setup in
[`LOCAL_HTTPS.md`](./LOCAL_HTTPS.md). A plain LAN HTTP origin cannot provide
Safari WebGPU, a reliable installed PWA, or encrypted prompt transport. The
server enables TLS only when both `TLS_CERT_FILE` and `TLS_KEY_FILE` are set;
supplying only one fails at startup. If AI or search is enabled on a
non-loopback host, startup also requires TLS and a nonempty list of exact HTTPS
allowed origins.

`GET /api/ai/config` reports the local provider/model, whether Ollama and the
configured model are reachable/installed, web-search capability, limits, and
privacy behavior. It never returns Ollama/SearXNG private URLs. It also advertises
the response profiles, their output/request budgets, and the versioned streaming
endpoint. `POST /api/ai/respond` returns the existing bounded JSON envelope;
`POST /api/ai/respond/stream` provides incremental prose delivery. Both routes
validate, rate-limit, and bound every request.

Both `GET /api/health` and `GET /api/ai/config` also publish `requestContract`
(currently `lumen.ai.request.v2`, defined once in `src/lib/aiContract.js`).
Every AI request body must declare the same value in its `contract` field. A
UI built from a different source than the running server therefore fails
closed with one typed `AI_CONTRACT_MISMATCH` error (HTTP 409) and actionable
reload/restart guidance, instead of reporting Ready and then rejecting
individual fields. Deploy the server and `dist/` together from the same
build; a skewed pair is a deployment error that this handshake makes visible. The
same-origin `POST /api/local-search` route accepts exactly `{ "query": "..." }`
for the phone's explicit search action; it has the same origin, rate, size,
timeout, result, and public-URL controls and never accepts a target URL.

If Ollama is stopped, the app shell still works and AI requests return a typed
`AI_LOCAL_MODEL_UNAVAILABLE` error. If the model is missing, requests return
`AI_MODEL_NOT_FOUND`. Set `AI_ENABLED=false` to disable AI deliberately.

## Streaming contract

Mac-local Markdown responses use `Content-Type: application/x-ndjson` and
`X-Lumen-Stream-Protocol: lumen.ai.ndjson.v1`. A successful stream has this
order:

```text
start -> approach -> phase/heartbeat/source* -> delta* -> complete
                                                \------> error
```

- `start` fixes the request ID, model, response format, response profile, and
  protocol version.
- `approach` contains disclosure-safe, server-derived orchestration steps. It
  never contains provider thinking.
- `phase` reports preparing, searching, generating, or validating status.
- `heartbeat` prevents an active but temporarily quiet tool/model turn from
  looking disconnected.
- `source` adds one validated public web source in order.
- `delta` carries ordered answer text with a monotonically increasing sequence.
- `complete` repeats the validated final response envelope. For Markdown, its text
  must equal the accumulated deltas; its approach, sources, and request ID must match
  prior events. Structured responses intentionally emit no partial JSON text.
- `error` is the only alternative terminal event and contains a sanitized typed
  error.

The server flushes response headers immediately, disables intermediary buffering,
awaits socket drain so browser backpressure reaches the Ollama reader, caps total
stream bytes, emits heartbeats, and cancels upstream work when the client closes
or presses Stop. The browser independently caps line/response/text sizes, validates
event keys/order/sequence/request identity, applies idle and overall deadlines,
and rejects missing, duplicated, mismatched, or post-terminal events.

Source-free prose deltas are rendered at animation-frame cadence through the same
sanitized GFM + KaTeX pipeline used for completed answers. The renderer tolerates
partial paragraphs, lists, and code fences. Library- and web-grounded prose is
held until its terminal completion and every `[S#]`/`[W#]` reference validate;
the learner still sees live phases, heartbeats, elapsed time, and Stop while the
validated answer is prepared. Structured tasks likewise do not expose partial
JSON. This avoids displaying or persisting a fluent draft that the grounding or
schema checks later reject.

Streaming improves live progress and cancellation feedback; source-free prose
also improves time to visible text. It does not promise a smaller end-to-end
generation time. On 2026-09-01, a real grounded `qwen3.5:4b` browser smoke showed
the live card in 32 ms, completed in 20.069 seconds, and delivered 280 ordered
validated text-delta events plus a matching terminal envelope.

## Security and privacy boundaries

- Only server environment variables define provider, model, and service URLs.
- Local service URLs are loopback-only by default. A deliberate flag is needed
  for a trusted private-LAN service; public remote AI/search endpoints are
  rejected.
- Web search is never available without both server configuration and explicit
  per-request learner opt-in and, in Library-first mode, a local insufficiency
  or time-sensitivity decision.
- Full-library ranking happens on the learner device. Only the bounded retrieved
  passages named in the reviewed local-model disclosure leave the phone for the Mac-local
  Ollama service; unrelated library bodies are not sent.
- Search arguments, result count, rounds, time, response bytes, and public URLs
  are validated and bounded. Lumen does not follow search-result links.
- Local model responses and tool output remain untrusted and are validated
  before structured data reaches the UI. Markdown prose is parsed as GFM and
  KaTeX with trusted features disabled; raw HTML in it is shown as text, and
  citation controls come only from `[S#]`/`[W#]` markers. Model links keep only
  `http(s)`/`mailto` targets off the app's own host and never wrap a citation, and
  Markdown images become links that load nothing. Answers saved to notes and AI
  flashcards keep the same rules in the Notebook and Review. The result is then
  sanitized with DOMPurify. Mermaid
  definitions render under strict settings and the returned SVG is sanitized
  again, with diagram links removed.
- An optional conversation summary is bounded to 3,000 characters, produced by
  deterministic local extraction rather than another model call, displayed to
  the learner, and treated as untrusted continuity material by the model prompt.
- The Approach panel is derived from request/retrieval metadata. It never exposes
  raw model reasoning or provider chain-of-thought.
- The application server does not persist prompts or responses. After tutor use, up
  to 50 messages are automatically retained as disclosed, clearable local browser data
  and appear in backups; a separate configurable retention toggle remains unimplemented.
- Origin and Host checks protect normal browsers, but they are **not client
  authentication**: a custom LAN client can forge HTTP headers. Learner
  pairing closes this gap: with `AI_AUTH=pairing` and an `AI_PAIRING_CODE`
  (minimum 8 characters), the `/api/ai/respond`, `/api/ai/respond/stream`,
  and `/api/local-search` endpoints require a paired session. The learner
  enters the code once in the AI studio; `POST /api/auth/pair` verifies it in
  constant time (five attempts per client per five minutes) and issues a
  stateless HMAC-signed session in an HttpOnly SameSite=Strict cookie
  (`Secure` under TLS, lifetime `AI_SESSION_TTL_HOURS`, default 30 days).
  Revoke every session by rotating the pairing code and restarting, or by
  changing/unsetting `AI_SESSION_SECRET` (an unset secret is ephemeral per
  boot, so a restart alone revokes). Health, configuration, pairing, and
  static assets stay public; configuration additionally reports
  `auth.sessionActive` so the UI can show the pairing gate before a request
  fails. Two ergonomics layers sit on top: `AI_AUTH_LOOPBACK` (default
  `exempt`) trusts requests from the serving machine itself — whoever sits
  there can read `.env` anyway — while `require` restores the fully global
  gate; and `./scripts/pair_device.sh` mints a single-use five-minute
  pairing ticket (`POST /api/auth/pair/ticket`, loopback or paired sessions
  only) rendered as a QR — scanning it opens `#/pair?ticket=…`, which
  redeems the ticket for the same 30-day session with nothing to type. Serving AI or search beyond loopback now **fails closed at startup**
  unless pairing is enabled or the single-learner trusted-LAN profile is
  explicitly acknowledged with `AI_ALLOW_UNAUTHENTICATED_LAN=true`.
- A local-LAN HTTP URL is not encrypted. Use the private trusted-certificate
  procedure in `LOCAL_HTTPS.md`, or an equivalently authenticated HTTPS reverse
  proxy. Never expose Ollama or SearXNG directly to the LAN or public internet.

The reviewed profile verifies the installed `qwen3.5:4b` artifact against
`OLLAMA_MODEL_DIGEST` before readiness and before inference. A deliberate model
upgrade must therefore update both `OLLAMA_MODEL` and its reviewed digest.
Omitting the digest is supported for experimentation, but a mutable tag can then
change behavior without an application-code diff. Capture `ollama list`, model
and container digests, licenses, and versions with release evidence before
treating a different deployment as reproducible.

## Supported contracts

Tasks: `tutor`, `explain`, `socratic`, `quiz`, `flashcards`, `interview`,
`summarize`, `study_plan`, `answer_feedback`, and `code_review`.

Task instructions describe the expected answer shape rather than giving a
literal template, because the small local model copies examples verbatim.
A Socratic turn that follows a tutor question first assesses the learner's
answer in one or two sentences (correct, partly correct, or a misconception),
then asks exactly one new question that cites the supplied source motivating
it. Code review labels each finding as a Defect (traced to a concrete failing
input) or a Convention/alternative, and does not state a library default unless
certain. Grounded prose is asked to end every source-backed paragraph or list
item with its `[S#]` label.

Every request chooses `responseProfile: "fast" | "balanced" | "deep"` (Balanced
is the default) and may provide a smaller `maxOutputTokens`. It may also carry
bounded recent `history` plus an optional `conversationSummary`. The server owns
the final response-profile, context-window, body, input-character, and output-token
limits; browser values can only reduce those limits.

Quiz, flashcard, study-plan, and answer-feedback requests can set
`responseFormat: "structured"`. Lumen passes a server-owned JSON Schema to
Ollama and independently validates the returned value before accepting it. For
structured requests that also need live search, Lumen deliberately separates
the phases: unformatted tool planning and retrieval happen first, then tools are
removed and the final evidence-backed turn receives the JSON schema. This avoids
the default Qwen/Ollama behavior where simultaneous `tools` and `format` can
suppress the tool call.

The only server tool is `search_web`. It is added to the Ollama request only
when validated `webSearch: true` consent is present. Tool results are treated as
untrusted evidence and returned as bounded public source metadata. If the model
skips the tool before any search round, Lumen performs the bounded deterministic
approved-question fallback described above. The request still fails closed if
completion is not terminal or the answer lacks a valid `[W#]`/URL citation to
returned evidence. If search yields no usable snippet, it fails closed unless
library evidence can answer a Markdown request, as described above.

Markdown answers must use ordinary GFM and standard `$...$` / `$$...$$` math
delimiters. The shared browser renderer supports headings, emphasis, links,
blockquotes, ordered/unordered lists, tables, fenced code with copy controls,
KaTeX inline/display output, and compatible fenced Mermaid diagrams. Mermaid is
lazy-loaded only after a completed Markdown surface contains a diagram; in-flight
tutor fences remain readable source. Reader, Teaching Mode, Mac tutor, and phone
tutor share the serialized renderer. Original definitions are retained for
paper/dark/system theme rerenders, returned SVG is sanitized, and a parse/load
failure shows the source plus copy/retry diagnostics instead of a generic broken
diagram. Unsafe HTML/URLs and privileged KaTeX behavior are not trusted.
Structured results use dedicated validated components rather than rendering
partial provider JSON as Markdown.

## Verification

```bash
npm run check:release
# With Ollama and the integrated loopback server running:
npm run check:live
# With SearXNG also running:
npm run audit:ai-live-search
```

See [functional testing](docs/FUNCTIONAL_TESTING.md) for the real-model matrix,
browser workflow coverage, service setup, and device/upstream limits. The
browser gate starts its own isolated application server when `LUMEN_URL` is
unset; it requires Chrome or `CHROME_PATH`.

The automated AI tests cover whole-library retrieval at 143 built-ins and the
500-custom-document supported limit, edits/personal notes, provenance, confidence,
canonical profile-boundary UTF-8 fitting, web-fallback decisions and skipped-tool
fallback, public-result ranking/deduplication,
response-profile contracts, deterministic conversation compaction, NDJSON
event validation, cancellation/backpressure/deadlines, hidden-thinking exclusion,
remembered local disclosure versus one-request web authorization, sanitized
GFM/KaTeX/Mermaid rendering, and narrow mobile UI behavior. Mock-based audits make no
paid API call and intentionally do not prove model answer quality.

At the 2026-08-31 repair checkpoint, the Mermaid unit suite passed 5/5 and the
production build passed. The focused browser audit also passed: the runtime was
requested exactly once and only after a completed response, five valid diagrams
rendered, one invalid definition produced a safe diagnostic, and all five valid
diagrams rerendered from their preserved definitions after a theme change.

The real Qwen smoke cited above is Mac evidence only. AI-001/002/003 remain
`Partial`: claim-level citation support and grounded-answer quality need versioned
evaluation; public-engine quality can degrade independently; and trusted-HTTPS
physical-iPhone download/inference/memory/thermal/battery behavior remains an
open device gate.

Official references:

- [Ollama chat API](https://docs.ollama.com/api/chat)
- [Ollama streaming](https://docs.ollama.com/api/streaming)
- [Ollama thinking](https://docs.ollama.com/capabilities/thinking)
- [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling)
- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- [SearXNG search API](https://docs.searxng.org/dev/search_api.html)
