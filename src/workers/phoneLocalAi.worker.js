import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

// Inference and model initialization stay off the main thread. This worker is
// created only after the learner explicitly chooses the on-device engine.
const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (event) => {
  handler.onmessage(event);
};
