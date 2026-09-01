export const readBoundedText = async (response, maximumBytes, label = "Service", { signal, timeoutMs } = {}) => {
  if (!response.body || typeof response.body.getReader !== "function") return "";
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  let interruptionReject;
  const interruption = new Promise((_resolve, reject) => {
    interruptionReject = reject;
  });
  const abortRead = () => {
    interruptionReject(Object.assign(new Error(`${label} response was cancelled`), { code: "RESPONSE_ABORTED" }));
  };
  if (signal?.aborted) abortRead();
  else signal?.addEventListener("abort", abortRead, { once: true });
  const timer = Number.isFinite(timeoutMs) && timeoutMs > 0 ? setTimeout(() => {
    interruptionReject(Object.assign(new Error(`${label} response body timed out`), { code: "RESPONSE_TIMEOUT" }));
  }, timeoutMs) : null;
  timer?.unref?.();
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interruption]);
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        throw Object.assign(new Error(`${label} response exceeded the safety limit`), { code: "RESPONSE_TOO_LARGE" });
      }
      chunks.push(value);
    }
  } catch (error) {
    // Do not await cancellation: a broken local service must not be able to
    // extend a response-body deadline by keeping stream cancellation pending.
    reader.cancel(error?.message || `${label} response rejected`).catch(() => {});
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", abortRead);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

export const fetchWithTimeout = async (url, init, {
  fetchImpl = fetch,
  signal,
  timeoutMs,
  timeoutMessage = "Service request timed out",
} = {}) => {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(signal?.reason || new Error("Caller aborted request"));
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(timeoutMessage));
  }, timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw Object.assign(new Error(timeoutMessage, { cause: error }), { code: "FETCH_TIMEOUT" });
    if (signal?.aborted || controller.signal.aborted) {
      throw Object.assign(new Error("Service request was cancelled", { cause: error }), { code: "FETCH_ABORTED" });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
};

/**
 * Opens a streamed Fetch response while retaining caller-abort propagation
 * until the response body has been consumed. `fetchWithTimeout` intentionally
 * detaches after headers for ordinary buffered responses; streaming callers
 * must invoke the returned cleanup function in a `finally` block instead.
 */
export const openFetchStream = async (url, init, {
  fetchImpl = fetch,
  signal,
  timeoutMs,
  timeoutMessage = "Service request timed out",
} = {}) => {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(signal?.reason || new Error("Caller aborted request"));
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(timeoutMessage));
  }, timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    let cleaned = false;
    return {
      response,
      signal: controller.signal,
      cleanup() {
        if (cleaned) return;
        cleaned = true;
        signal?.removeEventListener("abort", abortFromCaller);
      },
    };
  } catch (error) {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
    if (timedOut) throw Object.assign(new Error(timeoutMessage, { cause: error }), { code: "FETCH_TIMEOUT" });
    if (signal?.aborted || controller.signal.aborted) {
      throw Object.assign(new Error("Service request was cancelled", { cause: error }), { code: "FETCH_ABORTED" });
    }
    throw error;
  }
};

export const readJsonResponse = async (response, maximumBytes, label, options) => {
  const text = await readBoundedText(response, maximumBytes, label, options);
  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw Object.assign(new Error(`${label} returned invalid JSON`, { cause: error }), { code: "INVALID_JSON_RESPONSE" });
  }
};

/**
 * Incrementally reads an untrusted newline-delimited JSON response.
 *
 * `onValue` is awaited before the next upstream read. That is intentional: a
 * downstream HTTP writer can use the callback as the backpressure boundary,
 * preventing a slow phone or proxy from turning the server into an unbounded
 * response buffer.
 */
export const readNdjsonResponse = async (response, maximumBytes, label = "Service", {
  signal,
  idleTimeoutMs,
  maximumLineBytes = 512 * 1024,
  onValue,
} = {}) => {
  if (!response.body || typeof response.body.getReader !== "function") {
    throw Object.assign(new Error(`${label} returned no readable response stream`), { code: "INVALID_NDJSON_RESPONSE" });
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || !Number.isSafeInteger(maximumLineBytes) || maximumLineBytes < 1) {
    throw new TypeError("NDJSON byte limits must be positive safe integers");
  }

  const declaredLength = Number(response.headers?.get?.("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw Object.assign(new Error(`${label} response exceeded the safety limit`), { code: "RESPONSE_TOO_LARGE" });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const encoder = new TextEncoder();
  let totalBytes = 0;
  let buffered = "";
  let lineNumber = 0;

  const readNext = async () => {
    let timer = null;
    let abortHandler = null;
    const interrupted = new Promise((_resolve, reject) => {
      abortHandler = () => reject(Object.assign(new Error(`${label} response was cancelled`), { code: "RESPONSE_ABORTED" }));
      if (signal?.aborted) abortHandler();
      else signal?.addEventListener("abort", abortHandler, { once: true });
      if (Number.isFinite(idleTimeoutMs) && idleTimeoutMs > 0) {
        timer = setTimeout(() => {
          reject(Object.assign(new Error(`${label} response stream became idle`), { code: "RESPONSE_TIMEOUT" }));
        }, idleTimeoutMs);
        timer.unref?.();
      }
    });
    try {
      return await Promise.race([reader.read(), interrupted]);
    } finally {
      if (timer) clearTimeout(timer);
      if (abortHandler) signal?.removeEventListener("abort", abortHandler);
    }
  };

  const consumeLine = async (rawLine) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim()) return;
    lineNumber += 1;
    if (encoder.encode(line).byteLength > maximumLineBytes) {
      throw Object.assign(new Error(`${label} response line exceeded the safety limit`), { code: "NDJSON_LINE_TOO_LARGE" });
    }
    let value;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw Object.assign(new Error(`${label} returned invalid NDJSON on line ${lineNumber}`, { cause: error }), { code: "INVALID_NDJSON_RESPONSE" });
    }
    if (typeof onValue === "function") await onValue(value, lineNumber);
  };

  try {
    while (true) {
      const { done, value } = await readNext();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        throw Object.assign(new Error(`${label} response exceeded the safety limit`), { code: "RESPONSE_TOO_LARGE" });
      }
      buffered += decoder.decode(value, { stream: true });
      let newlineIndex = buffered.indexOf("\n");
      while (newlineIndex >= 0) {
        await consumeLine(buffered.slice(0, newlineIndex));
        buffered = buffered.slice(newlineIndex + 1);
        newlineIndex = buffered.indexOf("\n");
      }
      // A peer can omit newlines forever. Bound that partial line separately
      // rather than relying only on the larger whole-response allowance.
      if (encoder.encode(buffered).byteLength > maximumLineBytes) {
        throw Object.assign(new Error(`${label} response line exceeded the safety limit`), { code: "NDJSON_LINE_TOO_LARGE" });
      }
    }
    buffered += decoder.decode();
    await consumeLine(buffered);
    return { bytesRead: totalBytes, linesRead: lineNumber };
  } catch (error) {
    reader.cancel(error?.message || `${label} response rejected`).catch(() => {});
    if (error?.code) throw error;
    throw Object.assign(new Error(`${label} returned an unreadable NDJSON stream`, { cause: error }), { code: "INVALID_NDJSON_RESPONSE" });
  } finally {
    reader.releaseLock?.();
  }
};
