# Local AI model decision for Lumen

Research reviewed: 2026-08-23. This is a dated decision snapshot, not a guarantee
that upstream catalogue, browser, license, or runtime behavior remains unchanged.
Revalidate every cited version, artifact, capability, size, license, and open issue
before changing or re-approving the default. This decision is deliberately split by where
inference runs; “usable from an iPhone” and “runs entirely inside an iPhone
browser” are not the same requirement.

## Decision summary

| Path | Selected model/runtime | Tool strategy | Role in Lumen |
|---|---|---|---|
| Recommended | `qwen3.5:4b` in Ollama on the serving Mac | One server-allowlisted `search_web` function; bounded approved-question fallback if Qwen skips the call | Default tutor for explanations, interviews, quizzes, and longer grounded work |
| Higher-quality host option | `qwen3.5:9b` in Ollama | Same bounded tool contract | Optional after latency/quality evaluation on the actual Mac |
| Runs in iPhone Safari | Llama 3.2 1B Instruct q4f16 through WebLLM | Schema-constrained planner with a bounded deterministic proposal fallback; every exact search query needs a separate tap | Explicitly labeled On-device Lite fallback |
| Future native iOS | Apple's Foundation Models framework | Native guided generation and tool calling | Best future route if Lumen gains a Swift/iOS shell; unavailable directly to this PWA |

The app must not silently fall back from one path to another. Model download,
local-host inference, and live search have different data flows, so the learner
chooses the path and sees the corresponding disclosure.

## Why Qwen3.5 4B is the default

The current host is an Apple M1 Pro with 16 GB unified memory. Ollama's published
`qwen3.5:4b` Q4 build is about 3.4 GB, advertises tool use, and is small enough to
leave practical memory for the operating system, browser, Node server, and
SearXNG. Qwen publishes the 4B model under Apache-2.0 and documents tool-calling
support. This makes it a stronger default than forcing a 1B browser model to do
senior interview reasoning.

The 9B Q4 tag is about 6.6 GB. It is a sensible optional quality candidate, but
it is not the default until the same prompt set demonstrates acceptable cold
start, token latency, thermal behavior, structured-output validity, and answer
quality on this exact host. Parameter count alone is not an evaluation.

Sources:

- [Ollama Qwen3.5 model tags and sizes](https://ollama.com/library/qwen3.5/tags)
- [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling)
- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- [Qwen3.5 4B model card, license, and tool-use guidance](https://huggingface.co/Qwen/Qwen3.5-4B)

## Why the browser model is a Lite option

Safari 26 added WebGPU, which makes worker-based browser inference technically
possible on an iPhone 16 Pro. WebLLM provides OpenAI-shaped local generation,
worker execution, persistent model caching, and JSON-constrained output. Its
prebuilt Llama 3.2 1B q4f16 configuration uses a 4,096-token context and reports
about 879 MB of required GPU memory. The model repository contains roughly
705 MB of model files, which the UI rounds to a 710 MB first download.

Those figures describe two different resources:

```text
first network download         model loaded for inference
~710 MB model files     ->     ~879 MB GPU memory + runtime overhead
browser site cache             unified-memory pressure, heat, and battery use
```

A 1B model can be useful for short explanations, recall prompts, basic cards,
and summaries. It is not honestly equivalent to the Mac-hosted model for
complex SDE-II/SDE-III interviews, subtle debugging, or long-source synthesis.
The UI therefore calls it **On-device Lite**, limits input/output, runs it in a
dedicated worker, and provides release/delete controls.

The browser runtime is deliberately pinned to WebLLM 0.2.82. A current open
upstream report attributes a WebGPU device-hang regression on longer prompts to
the ShapeTuple cache introduced in 0.2.83 and reproduced it in both 0.2.83 and
0.2.84; the same setup worked on 0.2.82. The report is from Windows/AMD rather
than iPhone Safari, so it is evidence for choosing the conservative last-good
runtime, not physical-iPhone validation. Lumen pins the matching WASM commit and
performs its own SHA-256 checks before WebLLM can load the selected artifacts.

WebLLM currently describes native function calling as work in progress. Lumen
does not pretend this small model has unrestricted tools. It constrains planning
to an exact JSON union:

```text
answer       -> generate locally with no network tool
search_web   -> show query and reason -> learner approves once -> bounded search
anything else -> reject
```

Sources:

- [Safari 26 WebGPU release notes](https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes)
- [WebKit's Safari 26 feature overview](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
- [WebLLM runtime, workers, JSON mode, and function-calling status](https://github.com/mlc-ai/web-llm)
- [WebLLM 0.2.82 release](https://github.com/mlc-ai/web-llm/releases/tag/v0.2.82)
- [Open ShapeTuple/WebGPU regression affecting 0.2.83 and 0.2.84](https://github.com/mlc-ai/web-llm/issues/844)
- [Pinned Llama 3.2 1B q4f16 browser model revision](https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC/tree/2a37b0a5ecb622d51ddc2fac74de0b95872affd7)
- [Llama 3.2 Community License distributed with Lumen](./LICENSES/LLAMA_3_2_COMMUNITY_LICENSE.txt)

## Why Apple Foundation Models is not the current PWA runtime

Apple's Foundation Models framework provides on-device guided generation and
tool calling and is attractive for a future native iOS version. It is a Swift
framework exposed to native apps, not a JavaScript API available directly to a
Safari PWA. Apple's current technical note documents a 4,096-token context
window, so a native wrapper would still need careful source selection and
context budgeting.

The practical future path is a thin native shell that exposes a narrow,
auditable bridge to the existing local-first study data and UI. It should not
be claimed as shipped until a signed iOS build, supported-device checks, tool
consent, and physical-device tests exist.

Sources:

- [Apple Foundation Models framework](https://developer.apple.com/documentation/foundationmodels/)
- [Apple guided generation and tool calling](https://developer.apple.com/documentation/FoundationModels/generating-content-and-performing-tasks-with-foundation-models)
- [Apple context-window technical note](https://developer.apple.com/documentation/technotes/tn3193-managing-the-on-device-foundation-model-s-context-window)
- [Apple Intelligence device requirements](https://support.apple.com/en-gb/121115)

## Free web search without a paid API

Lumen self-hosts SearXNG on the Mac and binds it to `127.0.0.1`; the iPhone never
receives its private address. The browser calls only Lumen's same-origin
`/api/local-search` endpoint. The server accepts exactly one bounded query,
applies rate/time/result limits, rejects redirects and unsafe result URLs, and
never fetches result pages. Search is off per request until the learner opts in,
and Library-first retrieval must separately recommend fallback. On-device Lite
always displays the exact query for a second one-use approval; if its small planner
vetoes or fails after both gates pass, Lumen derives the proposal only from the
bounded learner prompt instead of silently skipping search.

SearXNG removes a paid search-API bill, but it is not an offline search index.
The selected public engines receive the query and ordinary network metadata,
and their availability/terms still apply. The UI must keep saying this.

Sources:

- [SearXNG Search API](https://docs.searxng.org/dev/search_api.html)
- [Official SearXNG container deployment guidance](https://github.com/searxng/searxng/blob/master/docs/admin/installation-docker.rst)

## Evaluation gates before changing a default

Use a versioned prompt set drawn from the curriculum and measure at least:

1. factual/source faithfulness and unsupported-claim rate;
2. valid structured quiz/card/plan rate;
3. correct tool decision, exact-query quality, and citation coverage;
4. prompt-injection resistance in lesson and search-result text;
5. cold-load time, first-token latency, generation rate, peak memory, heat, and
   battery impact on the physical iPhone;
6. cancellation, background suspension, storage eviction, and offline behavior;
7. senior-interview rubric performance rather than subjective fluency.

Until those gates pass on a physical iPhone, the browser model remains a useful
experimental fallback and the Mac-hosted 4B model remains the recommended free
path.
