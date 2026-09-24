# Local AI streaming contract

Lumen streams Mac-local Ollama answers over a same-origin HTTP `POST`. The
browser never connects to Ollama directly and cannot select a provider, model,
service URL, or API key.

## Endpoints

- `POST /api/ai/respond/stream` returns `application/x-ndjson; charset=utf-8`.
- `POST /api/ai/respond` remains the compatible buffered JSON endpoint.
- `GET /api/ai/config` advertises `streamEndpoint`, `streamProtocol`, profile
  budgets, deadlines, and the operator-owned output ceiling.

Both POST endpoints accept the same strictly validated request. Streaming is a
transport choice, not a different grounding or safety policy.

Every request body must declare `"contract": "lumen.ai.request.v2"` (the
identity in `src/lib/aiContract.js`, also advertised as `requestContract` in
`GET /api/ai/config` and `/api/health`). A missing or different value fails
with HTTP 409 `AI_CONTRACT_MISMATCH` before any validation detail, so a stale
app shell or stale server process produces one actionable error instead of
opaque field rejections. The browser additionally refuses a Ready state when
the advertised `requestContract` differs from its compiled value.

## Protocol v1

The response header and first event identify `lumen.ai.ndjson.v1`. Every line is
one complete JSON object followed by `\n`. Events are ordered as follows:

1. Exactly one `start` event identifies the request, model, format, and profile.
2. Exactly one `approach` event contains a short server-derived summary and one
   to six high-level answer steps. It is not model chain-of-thought.
3. Zero or more `phase` events use `preparing`, `searching`, `generating`, or
   `validating`.
4. Optional `heartbeat` events keep slow local generation observable.
5. Optional `source` events add sanitized web sources in one-based order.
6. Markdown answers emit zero or more ordered `delta` events. `sequence` starts
   at zero and each `text` fragment is appended exactly once.
7. Exactly one terminal `complete` or `error` event ends the stream.

A successful terminal event has this shape:

```json
{"type":"complete","requestId":"…","response":{"ok":true,"requestId":"…","status":"completed","model":"…","outputText":"…","data":null,"usage":{"inputTokens":10,"outputTokens":20,"totalTokens":30},"webSearch":{"requested":false,"used":false,"rounds":0},"sources":[],"approach":{"summary":"…","steps":["…"]}}}
```

The browser validates the final envelope and, for Markdown responses, confirms that its
answer equals the concatenated deltas. It confirms that sources and approach match prior events, and
rejects missing, duplicate, out-of-order, oversized, or post-terminal events.
Structured tasks do not expose partial JSON; they emit progress and a fully
validated final object.

`webSearch.used` is `true` only when the answer is backed by retained web
evidence (`sources` is non-empty). `requested: true, used: false, rounds > 0`
means the authorized search ran but returned nothing usable, and the Markdown
answer is library-only. That answer's `outputText` starts with this server-written
notice, which contains no citation label:

```markdown
> **Current-web evidence unavailable.** The approved web search returned no usable public results, so this answer uses only your library sources and may not reflect the latest information.
```

A client that shows a web-fallback status should treat that combination as a
failed fallback, not as "not needed" and never as "used".

`requestAiStream(payload, options)` and `aiClient.requestStream(...)` resolve to
the same final envelope as `requestAi`. `onDelta(text, event)` receives answer
text. `onEvent(event)` receives metadata; when both callbacks are supplied,
delta events go only to `onDelta` so a renderer cannot append them twice.
`onSources` receives the cumulative sanitized source list.

## Response profiles and private model thinking

Profiles choose a server-owned default when `maxOutputTokens` is omitted:

| Profile | Default output cap | Ollama thinking | Intended use |
| --- | ---: | --- | --- |
| `fast` | 900 tokens | Off | Quick clarification and mobile follow-up; prose is asked for about 150 words unless the learner wants more |
| `balanced` | 1,800 tokens | Off | Default learning answer |
| `deep` | 3,200 tokens | Bounded first pass, then direct completion if needed | Opt-in difficult analysis |

The operator ceiling is 4,096 tokens on the shipped 16,384-token Qwen profile;
a request can choose fewer but never exceed it. Each profile has a distinct
advertised UTF-8 input budget because answer tokens and source/history tokens
share one context window.

Deep's first pass is capped at 768 generated tokens (or the requested cap,
if smaller). Ollama counts internal thinking against the generation ceiling;
the local Qwen model can consume a full 3,200-token turn without producing
answer text. If this pass stops at its limit or contains only thinking, Lumen
discards it and retries once with thinking disabled and the full requested
answer allowance. The overall request deadline still covers both turns.
Partial Deep drafts remain buffered, and a second incomplete answer still
returns a typed error rather than a false success. Thinking is never replayed
into the completion prompt or returned to the browser.

The browser fits the exact canonical JSON body it will submit. Normalized
`conversationSummary` and `responseFormat` fields, history, profile, output cap,
web flag, and every other envelope field are present before `JSON.stringify`
UTF-8 measurement. Initial, retrieved, no-match, retrieval-failure, structured,
and retry paths send that same fitted object. This avoids a boundary mismatch
from server defaults, JSON escaping, emoji, or CJK text.

Ollama exposes thinking-capable output in `message.thinking`. Lumen never sends,
stores, logs, or places that field into conversation history. The learner-facing
Approach toggle shows only deterministic orchestration metadata. This separation
follows Ollama's documented distinction between `message.thinking` and
`message.content`: <https://docs.ollama.com/capabilities/thinking>.

## Conversation compaction

`conversationSummary` is an optional normalized string of at most 3,000
characters. The client can retain recent complete user/assistant pairs and use
this field for older turns. It counts toward the same UTF-8/context budget and
is framed as untrusted learner memory—not as a system instruction. The server
does not run a second summarization model call.

## Cancellation, timeouts, and backpressure

- A browser `AbortSignal`, closed response socket, or cancelled stream aborts
  the active Ollama fetch and releases the concurrency slot.
- The server enforces an overall generation deadline, an upstream idle deadline,
  a request-body deadline, and a downstream backpressure deadline.
- Every downstream write awaits Node's `drain` event before another Ollama chunk
  is read. A slow phone therefore cannot create an unbounded server buffer.
- Upstream NDJSON has total-byte and per-line limits. Browser NDJSON has its own
  total, line, text, source, sequence, and terminal-envelope limits.
- `Cache-Control: no-store, no-transform` and `X-Accel-Buffering: no` discourage
  intermediaries from caching or coalescing token updates.

Ollama documents REST streaming as newline-delimited JSON and requires streamed
content/tool calls to be accumulated before a follow-up tool turn:
<https://docs.ollama.com/api/streaming> and
<https://docs.ollama.com/capabilities/tool-calling>.

Tool-capable intermediate turns are buffered because they may contain
provisional prose before a search call. Source-free tool-free prose streams as
it is generated, except that its opening is held until the first non-whitespace
character: an answer that opens with `{` or `[` stays buffered so a bare JSON
document can be discarded instead of shown. Prose backed by library or web
evidence remains buffered until
terminal completion and citation validation, while phase/heartbeat events keep
the request observable and cancellable. Buffered text is normally released in
the provider's original chunks. When the server changes the validated text (the
empty-web notice, a normalized citation label, or a removed template prefix), it
releases the final text instead, in chunks of at most 16,384 characters, so the
deltas still equal `outputText` exactly. This integrity boundary prevents an
unsupported partial draft from being shown and retained before Lumen can reject
it. When an authorized Qwen turn skips its required search tool, Lumen
discards the provisional prose, searches a bounded deterministic form of the
approved learner question, and continues with the resulting evidence. Search
results remain sanitized, canonically deduplicated, bounded, and ranked locally.
If a model-planned query is empty and one configured round remains, Lumen uses
that round for the bounded learner-question query. When every round is empty,
a Markdown request that carries library evidence is answered from that
evidence with the notice above; the answer must cite a supplied `[S#]` and
contains no `[W#]`. A request without library evidence, and any structured
request, still fails closed with `WEB_SEARCH_NO_RESULTS`. Lumen does not fetch
result pages.

A prose task whose final text is a bare JSON object or array is never
released. The server discards it and asks once for Markdown prose; a second
JSON draft fails with `AI_CONTRACT_ERROR`.

## Markdown and diagrams

Plain-text deltas are rendered at animation-frame cadence through the sanitized
GFM + KaTeX pipeline. A Mermaid fence is kept as readable source during an active
stream; only the terminal answer activates the shared lazy Mermaid renderer.
Reader, Teaching Mode, Mac tutor, and phone tutor serialize rendering because
Mermaid configuration is global. The original definition is retained for theme
rerenders, the returned SVG is sanitized, and syntax/load/size failures expose a
safe diagnostic with source, copy, and retry actions.

## Operator settings

```dotenv
AI_MAX_OUTPUT_TOKENS=4096
AI_FAST_OUTPUT_TOKENS=900
AI_BALANCED_OUTPUT_TOKENS=1800
AI_DEEP_OUTPUT_TOKENS=3200
OLLAMA_CONTEXT_WINDOW_TOKENS=16384
AI_REQUEST_TIMEOUT_MS=240000
AI_STREAM_IDLE_TIMEOUT_MS=60000
AI_STREAM_BACKPRESSURE_TIMEOUT_MS=15000
AI_STREAM_HEARTBEAT_MS=10000
AI_STREAM_MAX_RESPONSE_BYTES=4194304
```

Run focused coverage with:

```sh
node --test server/ai/streaming.test.mjs server/ai/quality.test.mjs src/lib/aiClient.test.mjs src/lib/aiRequestBudget.test.mjs src/lib/mermaidDiagrams.test.mjs
npm run audit:mermaid
```
