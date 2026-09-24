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

if (import.meta.env.PROD) {
  window.addEventListener("load", () => {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) {
      announcePwaIssue("Offline installation is unavailable on this connection. Open Lumen over HTTPS to enable the service worker.");
      return;
    }
    const workerUrl = `${import.meta.env.BASE_URL}service-worker.js?build=${encodeURIComponent(__LUMEN_BUILD_ID__)}`;
    navigator.serviceWorker.register(workerUrl).then((registration) => {
      const announce = () => window.dispatchEvent(new CustomEvent("lumen:pwa-update", { detail: registration }));
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
