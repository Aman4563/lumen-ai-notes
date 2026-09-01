const utf8JsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/**
 * Fits only the source-context portion of a canonical AI request. The payload
 * factory owns the complete envelope, including history, compacted summary,
 * response profile/format, and web-search boolean, so every pass measures the
 * exact body that fetch will serialize.
 */
export const fitAiRequestContext = ({
  maximumBytes,
  maximumContextCharacters,
  buildContext,
  buildPayload,
}) => {
  const byteLimit = Number.isSafeInteger(maximumBytes) && maximumBytes > 0 ? maximumBytes : null;
  let contextBudget = Math.max(0, Math.floor(maximumContextCharacters || 0));
  let context = buildContext(contextBudget);
  let payload = buildPayload(context);
  let bytes = utf8JsonBytes(payload);

  if (byteLimit) {
    for (let pass = 0; bytes > byteLimit && contextBudget > 0 && pass < 64; pass += 1) {
      // JSON escaping and multi-byte Unicode make character counts an invalid
      // proxy for wire bytes. Shrink from the measured UTF-8 excess and always
      // rebuild the full payload before the next decision.
      contextBudget = Math.max(0, contextBudget - Math.max(64, Math.ceil((bytes - byteLimit) * 1.15)));
      context = buildContext(contextBudget);
      payload = buildPayload(context);
      bytes = utf8JsonBytes(payload);
    }
  }

  return { context, payload, bytes, contextBudget, maximumBytes: byteLimit };
};

export const assertAiRequestFits = (fitted) => Boolean(fitted?.payload)
  && fitted.bytes === utf8JsonBytes(fitted.payload)
  && (!Number.isSafeInteger(fitted.maximumBytes) || fitted.bytes <= fitted.maximumBytes);

