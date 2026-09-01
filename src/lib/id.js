// Local entity identifiers are not authentication tokens. Prefer the native
// secure-context UUID API, but keep LAN/legacy-browser study flows operational
// with getRandomValues (available more broadly) and a final non-cryptographic
// fallback. Server-side secrets and request IDs never use this helper.
export const createId = (cryptoApi = globalThis.crypto) => {
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();

  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else {
    const seed = `${Date.now()}-${globalThis.performance?.now?.() || 0}-${Math.random()}`;
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = (seed.charCodeAt(index % seed.length) + Math.floor(Math.random() * 256) + index * 31) & 255;
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};
