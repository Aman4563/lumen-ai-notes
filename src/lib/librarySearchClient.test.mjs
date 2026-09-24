import assert from "node:assert/strict";
import { test } from "node:test";

import { createLibrarySearchClient, LibrarySearchError } from "./librarySearchClient.js";

class FakeWorker {
  constructor() {
    this.messages = [];
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(message) {
    this.onmessage?.({ data: message });
  }
}

test("search requests correlate by id and later requests supersede earlier ones", async () => {
  const worker = new FakeWorker();
  const client = createLibrarySearchClient({ workerFactory: () => worker });
  assert.equal(client.usingWorker, true);

  client.setCorpus([{ id: "a", title: "A", source: "builtin" }], [["a", "alpha body"]]);
  assert.equal(worker.messages[0].type, "corpus");

  const first = client.search("alpha", ["a"]);
  const second = client.search("alpha beta", ["a"]);
  const firstRequest = worker.messages.find((message) => message.type === "search");
  const secondRequest = worker.messages.filter((message) => message.type === "search")[1];
  assert.ok(secondRequest.requestId > firstRequest.requestId);

  // Responses can arrive out of order; the superseded request must resolve
  // stale so the UI never paints outdated results over newer ones.
  worker.emit({ type: "result", requestId: secondRequest.requestId, results: [{ id: "a", searchScore: 9, snippet: "s" }] });
  worker.emit({ type: "result", requestId: firstRequest.requestId, results: [{ id: "a", searchScore: 1, snippet: "old" }] });
  const secondResult = await second;
  const firstResult = await first;
  assert.equal(secondResult.stale, false);
  assert.deepEqual(secondResult.results, [{ id: "a", searchScore: 9, snippet: "s" }]);
  assert.equal(firstResult.stale, true);
});

test("worker errors surface as typed failures and a crash falls back to main-thread search", async () => {
  const worker = new FakeWorker();
  const client = createLibrarySearchClient({ workerFactory: () => worker });
  const failing = client.search("query", ["a"]);
  const failingId = worker.messages.find((message) => message.type === "search").requestId;
  worker.emit({ type: "error", requestId: failingId, message: "boom" });
  await assert.rejects(failing, (error) => error instanceof LibrarySearchError && error.code === "WORKER_SEARCH_FAILED");

  const stranded = client.search("query", ["a"]);
  worker.onerror?.(new Error("crash"));
  await assert.rejects(stranded, (error) => error.code === "WORKER_CRASHED");
  assert.equal(worker.terminated, true);
  assert.equal(client.usingWorker, false);

  // The fallback path still answers searches with the retained corpus data.
  client.setCorpus([{ id: "doc", title: "Gradient descent", description: "Optimization", partNumber: 1, chapterNumber: 1, source: "builtin" }], [["doc", "gradient descent updates parameters"]]);
  client.updateCustom([{ id: "custom", title: "My gradient note", description: "", searchText: "gradient tricks", raw: "gradient tricks", partNumber: 99, chapterNumber: 1, source: "custom" }], []);
  const fallback = await client.search("gradient", ["doc", "custom"]);
  assert.equal(fallback.results.length, 2);
  assert.ok(fallback.results.every((result) => typeof result.searchScore === "number"));
  const corrected = await client.search("gradiant", ["doc"]);
  assert.deepEqual(corrected.results[0].corrections, [{ term: "gradiant", word: "gradient" }], "typo corrections ride the fallback result contract");
  const contextual = await client.search("parameters", ["doc"]);
  assert.match(contextual.results[0].snippet, /updates parameters/, "the fallback cuts snippets from the corpus body");
});

test("worker construction failure degrades to synchronous search and terminate is final", async () => {
  const client = createLibrarySearchClient({ workerFactory: () => { throw new Error("no Worker API"); } });
  assert.equal(client.usingWorker, false);
  client.setCorpus([{ id: "a", title: "Attention", description: "", partNumber: 1, chapterNumber: 1, source: "builtin" }], [["a", "self-attention mixes tokens"]]);
  const result = await client.search("attention", ["a"]);
  assert.equal(result.results[0].id, "a");

  client.terminate();
  await assert.rejects(client.search("attention", ["a"]), (error) => error.code === "CLIENT_TERMINATED");
});
