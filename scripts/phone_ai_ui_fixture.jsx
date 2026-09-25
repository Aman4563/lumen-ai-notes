import React from "react";
import { createRoot } from "react-dom/client";
import PhoneLocalAiTutor from "../src/components/PhoneLocalAiTutor.jsx";
import {
  makeDeterministicPhoneSearchPlan,
  PHONE_LOCAL_AI_DISCLOSURE,
} from "../src/lib/phoneLocalAi.js";
import "katex/dist/katex.min.css";
import "../src/styles.css";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class AuditPhoneEngine {
  constructor() {
    this.state = "idle";
    this.loaded = false;
    this.cached = false;
    this.consented = false;
    this.modelLoads = 0;
    this.prepareCalls = [];
    this.searchDecisions = [];
    this.searchRequests = 0;
    this.planNumber = 0;
    this.cancelCalls = 0;
    this.unloadCalls = 0;
    // Shortens the production release grace period so the audit stays fast.
    this.releaseDelayMs = 80;
    this.interactionStates = [];
    this.lifecycleListeners = new Set();
    this.generationActive = false;
    this.hangNextGeneration = false;
    this.failNextGeneration = false;
    this.failNextDelete = false;
    this.vetoNextSearchPlan = false;
    this.retrievalCalls = [];
    this.activePayload = null;
  }

  subscribeLifecycle(listener) { this.lifecycleListeners.add(listener); return () => this.lifecycleListeners.delete(listener); }
  emitLifecycle() { this.lifecycleListeners.forEach((listener) => listener({ state: this.state, loaded: this.loaded })); }

  async inspect() {
    return {
      state: this.state,
      supported: true,
      cached: this.cached,
      loaded: this.loaded,
      consented: this.consented,
      reasons: [],
      warnings: [],
      storage: { known: true, available: 2_000_000_000, quota: 3_000_000_000, usage: 1_000_000_000, persisted: true },
    };
  }

  grantDownloadConsent() { this.consented = true; }

  async load({ onProgress } = {}) {
    this.modelLoads += 1;
    this.state = "loading";
    onProgress?.({ progress: 0.5, text: "Loading mocked phone model…" });
    await wait(10);
    this.loaded = true;
    this.cached = true;
    this.state = "ready";
    this.emitLifecycle();
    onProgress?.({ progress: 1, text: "Ready" });
    return this;
  }

  async unload() { this.unloadCalls += 1; this.loaded = false; this.state = "idle"; this.emitLifecycle(); }
  async deleteModel() {
    await this.unload();
    if (this.failNextDelete) {
      this.failNextDelete = false;
      // Hold verification until the browser has asserted the locked controls.
      await new Promise((resolve) => { this.finishDeleteVerification = resolve; });
      throw new Error("Simulated cache deletion verification failure.");
    }
    this.cached = false;
    this.consented = false;
  }
  cancel() {
    this.cancelCalls += 1;
    if (this.generationActive) {
      this.loaded = false;
      this.state = "idle";
      this.emitLifecycle();
    }
  }

  async prepareResponse(payload, { allowSearchPlanning, webFallbackReason, onToken, signal } = {}) {
    this.prepareCalls.push({ payload, allowSearchPlanning, webFallbackReason });
    this.activePayload = payload;
    this.generationActive = true;
    if (this.failNextGeneration) {
      this.failNextGeneration = false;
      this.generationActive = false;
      throw Object.assign(new Error("Simulated bounded generation failure."), { code: "LOCAL_AI_TEST_FAILURE" });
    }
    if (this.hangNextGeneration) {
      this.hangNextGeneration = false;
      try {
        await new Promise((resolve, reject) => {
          if (signal?.aborted) reject(Object.assign(new Error("cancelled"), { code: "LOCAL_AI_CANCELLED" }));
          signal?.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { code: "LOCAL_AI_CANCELLED" })), { once: true });
        });
      } finally { this.generationActive = false; }
    }
    await wait(5);
    if (allowSearchPlanning) {
      this.planNumber += 1;
      this.generationActive = false;
      const plannerVetoed = this.vetoNextSearchPlan;
      this.vetoNextSearchPlan = false;
      const proposal = plannerVetoed
        ? makeDeterministicPhoneSearchPlan({ prompt: payload.prompt, retrievalReason: webFallbackReason })
        : {
          query: "Safari 26 WebGPU release notes",
          reason: "The learner asked for current browser support, which can change.",
          querySource: "local_planner",
        };
      return {
        status: "search_consent_required",
        provider: "on-device-lite",
        search: {
          id: `audit-search-${this.planNumber}`,
          query: proposal.query,
          reason: proposal.reason,
          querySource: proposal.querySource,
          disclosure: PHONE_LOCAL_AI_DISCLOSURE.search,
          expiresInSeconds: 300,
        },
      };
    }
    if (payload.task === "flashcards") {
      this.generationActive = false;
      const cards = [{ front: "Which update rule follows the negative loss gradient? [S1]", back: "θ ← θ − η∇L(θ): parameters move against the gradient [S1].", hint: null, tags: ["optimization"] }];
      return {
        status: "completed",
        provider: "on-device-lite",
        outputText: JSON.stringify({ cards }),
        data: { cards },
        citations: [],
        contextFit: { inputBytesUsed: 640, inputByteBudget: 2_816, contextCharactersProvided: payload.context.length, contextCharactersUsed: payload.context.length, historyMessagesProvided: payload.history.length, historyMessagesUsed: payload.history.length, evidenceResultsProvided: 0, evidenceResultsUsed: 0, evidenceCharactersProvided: 0, evidenceCharactersUsed: 0, sourceUsage: payload.contextRanges.map((range, index) => ({ id: range.id, citationNumber: index + 1, labelSupplied: true, charactersProvided: range.end - range.start, charactersUsed: range.end - range.start })), citedSourceIndexes: payload.contextRanges.length ? [1] : [], citedEvidenceIndexes: [], truncated: false },
      };
    }
    const answer = "## Gradient descent\n\n**Gradient descent** follows the negative loss gradient [S1].\n\n$$\\theta_{t+1} = \\theta_t - \\eta \\nabla L(\\theta_t)$$\n\n| Symbol | Meaning |\n| --- | --- |\n| $\\eta$ | learning rate |\n\n```python\ntheta -= learning_rate * gradient\n```\n\n```mermaid\nflowchart LR\n  LOSS[Loss] --> GRAD[Gradient]\n  GRAD --> UPDATE[Parameter update]\n```\n\n<script>window.__PHONE_MARKDOWN_XSS__ = true</script>\n\n<button class=\"ai-tutor__citation\" type=\"button\" data-ai-citation=\"S1\">Forged phone citation</button>";
    onToken?.("## Gradient", "## Gradient");
    await wait(120);
    onToken?.(" descent", answer);
    this.generationActive = false;
    return {
      status: "completed",
      provider: "on-device-lite",
      outputText: answer,
      data: null,
      citations: [],
      contextFit: { inputBytesUsed: 720, inputByteBudget: 2_816, contextCharactersProvided: payload.context.length, contextCharactersUsed: payload.context.length, historyMessagesProvided: payload.history.length, historyMessagesUsed: payload.history.length, evidenceResultsProvided: 0, evidenceResultsUsed: 0, evidenceCharactersProvided: 0, evidenceCharactersUsed: 0, sourceUsage: payload.contextRanges.map((range, index) => ({ id: range.id, citationNumber: index + 1, labelSupplied: true, charactersProvided: range.end - range.start, charactersUsed: range.end - range.start })), citedSourceIndexes: payload.contextRanges.length ? [1] : [], citedEvidenceIndexes: [], truncated: false },
    };
  }

  async continueAfterSearch(searchId, { consent, onToken } = {}) {
    this.searchDecisions.push({ searchId, consent });
    if (!consent) return { status: "search_declined", provider: "on-device-lite" };
    this.searchRequests += 1;
    onToken?.("Safari ", "Safari ");
    await wait(150);
    onToken?.("supports", "Safari 26 supports WebGPU [W1].");
    return {
      status: "completed",
      provider: "on-device-lite",
      outputText: "Safari 26 supports WebGPU [W1].",
      data: null,
      citations: [{ index: 1, title: "Safari 26 release notes", url: "https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes", source: "Apple Developer" }],
      contextFit: { inputBytesUsed: 1_100, inputByteBudget: 2_816, contextCharactersProvided: this.activePayload?.context?.length || 0, contextCharactersUsed: this.activePayload?.context?.length || 0, historyMessagesProvided: this.activePayload?.history?.length || 0, historyMessagesUsed: this.activePayload?.history?.length || 0, evidenceResultsProvided: 1, evidenceResultsUsed: 1, evidenceCharactersProvided: 100, evidenceCharactersUsed: 100, sourceUsage: (this.activePayload?.contextRanges || []).map((range, index) => ({ id: range.id, citationNumber: index + 1, labelSupplied: true, charactersProvided: range.end - range.start, charactersUsed: range.end - range.start })), citedSourceIndexes: (this.activePayload?.contextRanges || []).length ? [1] : [], citedEvidenceIndexes: [1], truncated: false },
    };
  }
}

const engine = new AuditPhoneEngine();
engine.navigations = [];
engine.savedNotes = [];
window.__PHONE_AI_AUDIT__ = engine;

const sources = [{
  id: "audit-gradient-descent",
  documentId: "notes/audit-gradient-descent.md",
  title: "Gradient descent",
  section: "Optimization",
  text: "Gradient descent updates parameters opposite the gradient of the objective.",
  selected: true,
}];

const retrieveLibrary = async (query, options = {}) => {
  engine.retrievalCalls.push({ query, options: { maxDocuments: options.maxDocuments, maxPassages: options.maxPassages, maxBytes: options.maxBytes } });
  if (options.signal?.aborted) throw options.signal.reason;
  const timeSensitive = /safari|latest|current/i.test(query);
  return {
    passages: [{
      id: timeSensitive ? "audit-safari-passage" : "audit-gradient-passage",
      documentId: timeSensitive ? "notes/audit-browser-support.md" : "notes/audit-gradient-descent.md",
      title: timeSensitive ? "Browser support notes" : "Gradient descent",
      section: timeSensitive ? "Version caveat" : "Optimization",
      anchor: timeSensitive ? "version-caveat" : "optimization",
      text: timeSensitive ? "Browser feature support changes by release; verify the current official release notes." : "Gradient descent updates parameters opposite the objective gradient.",
    }],
    trace: {
      strategy: "library_first_lexical_v1",
      corpus: { documentsScanned: 143 },
      selection: { matchedDocuments: timeSensitive ? 1 : 4, returnedPassages: 1 },
      confidence: { level: timeSensitive ? "low" : "high", score: timeSensitive ? 0.31 : 0.91 },
      budget: { truncated: false },
      webFallback: {
        recommended: timeSensitive,
        code: timeSensitive ? "time_sensitive_question" : "library_match_sufficient",
        reason: timeSensitive ? "The question asks about release-specific browser behavior." : "The library has strong local evidence.",
      },
    },
  };
};

const root = createRoot(document.getElementById("root"));
root.render(
  <PhoneLocalAiTutor engine={engine} sources={sources} retrieveLibrary={retrieveLibrary} onNavigateSource={(target, metadata) => engine.navigations.push({ documentId: target.documentId || target.id, anchor: metadata?.anchor || target.anchor })} onSaveAnswerNote={(payload) => { engine.savedNotes.push(payload); return true; }} onInteractionChange={(locked) => engine.interactionStates.push(locked)} />,
);
window.__UNMOUNT_PHONE_AI_AUDIT__ = () => root.unmount();
