# On-device Lite AI for iPhone

Status: shipped in the AI Learning Studio as the **On-device Lite** engine. The default remains **Mac local · Recommended**; switching to the phone engine lazy-loads its UI/runtime but never downloads or loads model weights without the separate consent checkbox and download button.

## Decision

Use `Llama-3.2-1B-Instruct-q4f16_1-MLC` through pinned `@mlc-ai/web-llm@0.2.82` for the first phone engine.

Why this model:

- It is a current WebLLM prebuilt model, is marked `low_resource_required`, uses a 4,096-token context window, and WebLLM reports about 879 MB of required GPU memory.
- Its Hugging Face repository currently contains roughly 705 MB of model files. The UI rounds this to “about 710 MB”; this is the download, not the GPU-memory figure.
- It is large enough to be more useful for tutoring than the 135M–600M alternatives while remaining plausible on an iPhone 16 Pro. Physical-device thermal, memory-pressure, and generation-speed testing is still required.
- The model is free to download and run locally, subject to Meta's Llama 3.2 Community License. Lumen prominently displays **Built with Llama** and distributes the agreement and required attribution in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) and `public/licenses/`. WebLLM itself is Apache-2.0. “Free” does not mean public-domain or unlicensed.

The current prebuilt catalogue also contains Gemma 3 1B, Qwen 2.5 0.5B, Qwen 3 0.6B, SmolLM2, and TinyLlama variants. They are reasonable future fallbacks, but changing the default without a repeatable mobile quality/latency evaluation would be guesswork. The app therefore starts with one explicit, testable model rather than a confusing model picker.

Primary sources:

- [Safari 26 WebGPU release notes](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
- [WebLLM repository and worker/JSON-mode documentation](https://github.com/mlc-ai/web-llm)
- [WebLLM 0.2.82 release](https://github.com/mlc-ai/web-llm/releases/tag/v0.2.82)
- [Open 0.2.83/0.2.84 ShapeTuple/WebGPU regression report](https://github.com/mlc-ai/web-llm/issues/844)
- [Pinned Llama 3.2 1B q4f16 model revision](https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC/tree/2a37b0a5ecb622d51ddc2fac74de0b95872affd7)
- [WebLLM function-calling tracking issue](https://github.com/mlc-ai/web-llm/issues/526)

## What is genuinely local

After model files are cached, inference happens in the browser through WebGPU. The prompt, selected lesson excerpt, bounded history, and generated answer are passed to a dedicated Web Worker and are not sent to an LLM API.

The tutor's default **Library first** scope also stays local. It searches the
generated index for all 143 built-in lectures and every supported custom document
(up to 500), treats saved edits as authoritative, and includes matching personal
notes with explicit provenance. Only bounded candidate lecture bodies are loaded.
Before the 1B model's separate 4K-context fit, the phone UI keeps at most two
retrieved passages under a 4,400-byte retrieval-entry budget that includes metadata
and text. The context builder then applies its own 4,800-character cap and the engine
fits the exact serialized UTF-8 request. The response exposes retrieval
counts, anchors, confidence, truncation, and the web-fallback reason. Current lesson,
Choose, and No library remain explicit scope overrides.

The following operations still use the network:

1. First model download from the MLC/WebLLM model hosts.
2. An explicitly approved live web search. In Library-first mode, the learner must
   first enable fallback and local retrieval must classify the question as
   time-sensitive or insufficiently covered. The phone model then gets one chance
   to improve a query. If it chooses `answer` or returns unusable output, Lumen
   deterministically prepares a bounded query from the learner's prompt instead.
   Only after the learner approves that exact displayed query is it sent to this
   app's same-origin `/api/local-search` endpoint and then to the public engines
   configured in self-hosted SearXNG. Those engines receive the query and ordinary
   request metadata.
3. Normal app/lesson asset downloads.

Clearing Safari site data can delete the model. Safari may also evict cached files under storage pressure unless it grants persistent storage. The app requests persistence after download consent, but browsers are free to deny it.

Selecting the phone engine lazy-loads roughly 5–6 MB of application runtime chunks before the model-download consent surface can inspect WebLLM's cache. It does **not** download model weights before consent. The large transfer remains the separately approved approximately 710 MB model download.

The engine selector, compatibility/settings panel, model facts, progress states,
and tutor controls use the shared Lumen paper/dark/system surface, text, border,
accent, success, warning, and danger tokens. They do not assume a light background,
so status and consent surfaces follow the active app theme.

That large-download approval is remembered for this exact model in the current
browser until **Clear model files** revokes it. Fully local prompts do not require a
new consent checkbox for every answer. This is intentionally separate from web
egress: every proposed search still displays its exact query and requires a fresh,
single-use approval because that query leaves the device.

The runtime package is lockfile-pinned to WebLLM 0.2.82. An open upstream report identifies 0.2.83/0.2.84 as introducing a ShapeTuple-cache race that can hang a WebGPU device on longer prompts; 0.2.82 is the reporter's last-good version and already contains this Llama model. This is a conservative dependency choice, not proof of Safari correctness—the physical-iPhone gate remains open.

The selected model repository and compatible WebAssembly library use immutable commit URLs. Before WebLLM can load them, Lumen itself downloads or reads the exact named-cache entries and fail-closes on pinned SHA-256 checks for `mlc-chat-config.json`, the WebAssembly library, and `tokenizer.json`. Tensor shards rely on the immutable Hugging Face revision plus HTTPS rather than individual SRI fields. Cache readiness checks the exact named WebLLM caches, and deletion directly removes current, prior-0.2.84, and legacy URL prefixes without fetching missing manifests.

## Why this does not claim native tool calling

WebLLM describes function calling as work in progress. In 0.2.82, its native function-calling allowlist contains Hermes 7B/8B-class models, not this Llama 1B model. Those models need roughly 5 GB and are inappropriate as the default phone path.

The implementation instead has a narrow two-action planner:

```text
learner prompt
      |
      v
whole-library retrieval + confidence check
      |
      +-- sufficient or fallback off --> local completion
      |
      +-- weak/current and fallback allowed
                    |
                    v
             schema-constrained local plan
                    |
                    +-- answer/invalid --> bounded query from learner prompt
                    |
                    +-- search_web --> show exact query + reason
                           |
                     learner approves?
                       /          \
                     no            yes
                     |              |
                   stop     POST /api/local-search
                                      |
                              sanitize <= 5 results
                                      |
                              grounded local answer
```

The plan must be exactly:

```json
{
  "action": "answer",
  "query": "",
  "reason": "Stable lesson concept"
}
```

or:

```json
{
  "action": "search_web",
  "query": "short standalone query",
  "reason": "Why current external evidence is required"
}
```

A planner result is accepted only when it matches one of those schemas. Once both
external gates have already passed, an `answer` plan, malformed/empty JSON, or another
non-cancellation planner failure cannot silently veto the proposed fallback. Lumen uses
a sanitized query of at most 180 characters derived only from the learner prompt (or,
if that sanitizes empty, the retrieval reason) and labels the proposal as deterministic.
Lesson excerpts and history never enter that fallback query. A valid local-planner
`search_web` query is still preferred.

Search plans expire after five minutes, are single-use, and require `consent: true` for that individual query. The consent card auto-expires and discards the pending learner turn without sending a search. Decline, expiry, and cancellation consume the proposal; a retry creates a fresh approval. The model cannot choose a URL, method, body shape, number of results, command, filesystem action, or arbitrary tool.

## Browser and device gates

Before loading, the engine checks:

- secure context (HTTPS or localhost);
- WebGPU and a usable adapter;
- Web Workers;
- Cache API;
- Web Locks, so model load and deletion are serialized across same-origin tabs;
- a known GPU storage-buffer limit when the browser exposes it;
- known device memory when the browser exposes it;
- at least 1.15 GB of browser-storage headroom for a new download when quota data is available.

Safari usually does not expose `navigator.deviceMemory`; this is reported as a warning rather than incorrectly guessing RAM. A known value below 4 GB is blocked. Unknown quota is also shown as a warning. WebGPU absence, insecure HTTP, missing workers/cache/locks, adapter failure, known-insufficient memory, and known-insufficient storage fail closed. Clearing the model first persists a revocation epoch and broadcasts cancellation, then takes the origin-wide model lock before deleting and rechecking every owned cache entry; an older tab cannot finish a download and recreate the cleared files.

iOS/Safari 26 added WebGPU support, but the capability check—not a user-agent string—is authoritative. A plain `http://192.168…` LAN URL is not a secure context on the phone and cannot run this feature. Use a trusted HTTPS origin for iPhone testing.

## Files

- `src/lib/phoneLocalAi.js` — runtime, validation, consent, lifecycle, planner, search gate, grounding, and structured contracts.
- `src/workers/phoneLocalAi.worker.js` — WebLLM worker handler.
- `src/components/PhoneLocalAiSettings.jsx` — compatibility, consent, progress/cancel, load/unload, and delete controls.
- `src/phone-local-ai.css` — responsive component styles.
- `src/components/AiLearningStudio.jsx` — accessible Mac-local versus phone-local engine selector and lazy boundary.
- `src/components/PhoneLocalAiTutor.jsx` — source/mode/depth composer, session history, streaming, structured learning results, retry/cancel, safe citations, and per-query search approval/decline UI.
- `src/lib/mermaidDiagrams.js` and `src/lib/useMermaidDiagrams.js` — shared lazy, theme-aware, source-preserving Mermaid rendering and safe diagnostics.
- `src/ai-learning-studio.css` and `src/phone-local-ai-tutor.css` — mobile engine selector and tutor layouts with 44-pixel primary controls.
- `src/lib/phoneLocalAi.test.mjs` — mocks WebLLM, workers, cache, WebGPU, and search; it never downloads a model.
- `scripts/phone_ai_ui_audit.mjs` — mobile browser audit with a fake engine; proves the download gate, streamed answer, and one-shot search consent paths without fetching weights.

## Shipped app integration

The AI page first renders the Mac-local Qwen/Ollama tutor. Selecting **On-device Lite** crosses a nested lazy boundary, then the settings and tutor components share this singleton:

```js
import { getPhoneLocalAiEngine } from "./lib/phoneLocalAi.js";

const phoneEngine = getPhoneLocalAiEngine();
```

The shipped phone workspace passes that same engine to its settings surface:

```jsx
const PhoneLocalAiSettings = lazy(() => import("./components/PhoneLocalAiSettings.jsx"));

<PhoneLocalAiSettings
  engine={phoneEngine}
  onNotify={onNotify}
  onStatusChange={(status) => setPhoneAiStatus(status)}
/>
```

The UI implements requests through:

```js
const result = await phoneEngine.prepareResponse(payload, {
  signal: abortController.signal,
  onToken: (_token, fullText) => setDraft(fullText),
});

if (result.status === "search_consent_required") {
  // Render result.search.query, result.search.reason, and
  // result.search.disclosure verbatim. Do not auto-approve.
  setPendingLocalSearch(result.search);
}
```

After the learner presses an explicit “Search this query” button:

```js
const finalResult = await phoneEngine.continueAfterSearch(pending.id, {
  consent: true,
  signal: abortController.signal,
  onToken: (_token, fullText) => setDraft(fullText),
});
```

Before this engine call, `PhoneLocalAiTutor` runs the shared `retrieveLibrary`
adapter in Library-first mode, attaches the fitted passages, and enables its local
search planner only when both learner permission and the retrieval fallback decision
are true. If local retrieval itself fails, the trace marks the index unavailable—an
independent fallback recommendation. A separately enabled fallback may therefore prepare
an exact query, but it still contacts nothing until the learner reviews and approves that
one query.

Before WebLLM load or any query egress, the phone preflight reserves room for at least
48 UTF-8 bytes of real library evidence when grounding is requested and for a bounded
worst-case web result containing at least a 96-byte snippet when fallback is eligible.
An impossible request is rejected before inference or search approval rather than after
network data has already left the device.

When those two gates are true, a valid planner `search_web` query is preferred. A
planner `answer`, malformed/empty JSON, or other non-cancellation planning failure
creates the bounded deterministic exact-query proposal described above. This fallback
does not contact the network or approve itself.

Declining calls the same method once with `consent: false`, consumes the one-use plan, and confirms that the displayed query was not sent. Search approval is never remembered globally.

On-device conversation history is intentionally session-only and is visually separated from the durable Mac-local conversation. It is held in App memory, so switching engines or navigating away and back preserves completed turns while active or aborted turns are removed; the model's GPU memory is still released on unmount. It is not written to IndexedDB or exported in a backup. Reloading the page clears it. Generated flashcards can still be explicitly added to the normal review deck through the existing callback.

Plain answers stream into a live mobile response card at animation-frame cadence.
They use the same DOMPurify-sanitized GFM + KaTeX renderer as the Mac tutor, which shows
model-authored HTML as text so an answer cannot forge a citation control, including
tables, lists, links, fenced-code copy controls, `$...$` inline math, and `$$...$$`
display math. Compatible fenced Mermaid blocks remain readable source while tokens are
arriving and render only after the response completes. The shared renderer lazy-loads
Mermaid, sanitizes returned SVG, preserves the original definition for theme changes,
and exposes source/copy/retry diagnostics for load, size, or syntax failures.
Structured quizzes/cards/plans remain buffered until the complete object validates.
This improves time to visible text; it does not establish lower total generation
time on a physical iPhone.

Completed results use this shape:

```js
{
  status: "completed",
  provider: "on-device-lite",
  model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
  outputText: "Grounded explanation [S1]. Current fact [W1].",
  data: null, // validated object for structured quiz/cards/plan/feedback
  citations: [{ index: 1, title: "...", url: "..." }],
  contextFit: {
    inputBytesUsed: 2710,
    inputByteBudget: 3072,
    contextCharactersProvided: 4800,
    contextCharactersUsed: 2100,
    historyMessagesProvided: 2,
    historyMessagesUsed: 2,
    evidenceResultsProvided: 3,
    evidenceResultsUsed: 2,
    evidenceCharactersProvided: 2400,
    evidenceCharactersUsed: 900,
    sourceUsage: [{ id: "lesson-id", citationNumber: 1, labelSupplied: true, charactersProvided: 4800, charactersUsed: 2100 }],
    citedSourceIndexes: [1],
    citedEvidenceIndexes: [1],
    truncated: true
  }
}
```

The phone engine accepts the existing tasks: `tutor`, `explain`, `socratic`, `quiz`, `flashcards`, `interview`, `summarize`, `study_plan`, and `answer_feedback`. It reuses the current validated schemas for structured `quiz`, `flashcards`, `study_plan`, and `answer_feedback` output.

Library evidence uses explicit `[S1]`, `[S2]` labels and approved web evidence uses
explicit `[W1]`, `[W2]` labels in both prose and structured string fields. The engine
validates completed output after streaming and before saving: at least one retained
library label is required when labeled lesson text survived fitting, searched answers
must cite retained web evidence, and unresolved S/W labels fail closed. Markers inside
inline or fenced code remain examples rather than citations. Bare numeric brackets such
as `x[1]` are never reinterpreted as web evidence.

## `/api/local-search` contract

Request (exactly one field):

```http
POST /api/local-search
Content-Type: application/json

{"query":"current Safari WebGPU support"}
```

Response:

```json
{
  "ok": true,
  "results": [
    {
      "title": "Page title",
      "url": "https://source.example/page",
      "snippet": "Short evidence excerpt",
      "source": "Optional publisher",
      "publishedAt": "Optional publication date"
    }
  ]
}
```

The browser accepts at most five results, rejects non-HTTP(S) URLs, strips markup/control characters, bounds every field, and treats result text as untrusted data. The server must separately validate length, rate-limit, time out, cap results/body size, and prevent SSRF. The route can use a free self-hosted search service, but a phone cannot provide fresh web information entirely offline.

## Operational limitations

- No native/unrestricted tools, background agent loop, code execution, shell, filesystem, or arbitrary fetch.
- A 1B model can produce plausible but wrong explanations. Source-grounded teaching content and answer validation remain important.
- Complex SDE-II/SDE-III reasoning, long-document synthesis, and high-stakes decisions may exceed this model's capability.
- The 4K context is smaller than the server provider's context. Admission is capped at 9,000 combined characters and outputs at 768 tokens, then the engine remeasures the serialized UTF-8 prompt—including JSON escaping, instructions, history, schemas, and evidence—and fits it more strictly. The composer also measures the exact non-trimmable completion/planner framing before send, so a character-short but UTF-8-large emoji or multilingual prompt is disabled with its byte limit instead of loading the model and failing later. Visible truncation markers and the returned `contextFit` record disclose what was actually retained.
- Retry rebuilds the request from the controls currently on screen. Changing Standard to Compact, depth, source scope, or the web-fallback toggle before Retry no longer resubmits stale settings.
- iOS can suspend a PWA in the background; keep it foregrounded during load and generation.
- WebGPU work can heat the phone and consume battery. “Release memory” unloads the model while keeping its cached files.
- Live search is free of paid LLM APIs but is neither offline nor automatically private; its query leaves the phone through the configured same-origin server.

## Verification

Run:

```sh
npm run audit:phone-ai
npm run audit:phone-ai-ui
npm run build
```

The unit audit injects a fake WebLLM module and worker and covers SHA-256 artifact verification, exact UTF-8 preflight/context fitting, completion terminals, explicit fitted S/W grounding, code/indexing exclusions, named-cache readiness/deletion, download consent, cancellation, search bounds, deterministic planner-veto/malformed-plan fallback, and structured contracts. The browser audit uses a fake shared engine and checks the real AI-page selector, paper/dark theme surfaces, remembered download consent, byte-oversized composer blocking, current-control Retry rebuilding, both web gates, deterministic exact-query proposal, decline/retry, and approval UI. Neither audit fetches or caches real model weights. A trusted-HTTPS physical-iPhone run remains a release gate for download integrity, offline reload, Safari eviction, peak memory, latency, thermal behavior, battery impact, real search behavior, and real cancellation during model load/generation.

The shared AI/library suites additionally cover all 143 built-ins, a 500-custom-
document corpus, authoritative edits, personal-note provenance, stable anchors,
UTF-8 bounds, cancellation, sufficiency-driven web fallback, streamed GFM tables,
display KaTeX, and completed Mermaid rendering. These are deterministic/mock browser contracts; they do not
replace claim-level quality evaluation or the physical-device gate.
