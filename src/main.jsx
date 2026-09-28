import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { chunkRecovery } from "./lib/chunkRecovery.js";
import "./styles.css";
import "./responsive.css";

const announcePwaIssue = (message) => window.dispatchEvent(new CustomEvent("lumen:pwa-error", { detail: message }));

// Vite reports missing lazy JS and extracted CSS through this event. Install
// the listener before React renders a route that can request either file.
chunkRecovery.listen(window);

// The themed select's picker (appearance: base-select, issue #92) is part of
// the page, so its Escape would also reach the dialog and sheet handlers on
// window and close them too. The picker closes itself; nothing else hears it.
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  try {
    if (document.querySelector("select:open")) event.stopImmediatePropagation();
  } catch { /* A browser without :open has no in-page picker. */ }
}, true);

if (import.meta.env.PROD) {
  window.addEventListener("load", () => {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) {
      announcePwaIssue("Offline installation is unavailable on this connection. Open Lumen over HTTPS to enable the service worker.");
      return;
    }
    const workerUrl = `${import.meta.env.BASE_URL}service-worker.js?build=${encodeURIComponent(__LUMEN_BUILD_ID__)}`;
    // Warm tools (KaTeX, uploads, backup and sync, the link check, library
    // retrieval) are not installed with the app. Once the first render is
    // idle, on every launch, ask the active worker to fetch whichever of them
    // it lacks. iOS Safari has no requestIdleCallback, so wait three seconds
    // there. Failure only means a tool says it needs a connection.
    const whenIdle = (callback) => (typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(callback, { timeout: 10_000 })
      : window.setTimeout(callback, 3_000));
    const warm = (worker) => worker?.postMessage({ type: "WARM" });
    whenIdle(() => navigator.serviceWorker.ready.then((registration) => warm(registration.active)).catch(() => {}));
    navigator.serviceWorker.register(workerUrl).then((registration) => {
      // An update waiting to take over warms its own cache as well. It
      // activates when Lumen next opens, perhaps offline, and activation
      // deletes the cache holding the previous release's tools.
      const announce = () => {
        whenIdle(() => warm(registration.waiting));
        window.dispatchEvent(new CustomEvent("lumen:pwa-update", { detail: registration }));
      };
      if (registration.waiting && navigator.serviceWorker.controller) announce();
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) announce();
        });
      });
    }).catch((error) => {
      console.warn("Lumen service-worker registration failed", error);
      announcePwaIssue(`Offline installation could not start: ${error?.message || "service-worker registration failed"}`);
    });
  });
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </React.StrictMode>,
);
