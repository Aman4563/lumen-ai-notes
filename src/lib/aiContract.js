/**
 * Single source of truth for the client/server AI request-contract identity.
 *
 * The integrated Node server and the built UI must agree on the exact request
 * envelope (accepted fields, validation, and profile budget semantics). A
 * deployment that updates only one side previously produced a misleading
 * "Ready" state followed by opaque field-validation rejections (see the
 * 2026-09-01 `contextCitations` incident in ENGINEERING_HANDOFF.md §10.3).
 *
 * The server publishes this value as `requestContract` in `GET /api/ai/config`
 * and `/api/health`, and requires it as the `contract` field of every
 * `POST /api/ai/respond` and `/api/ai/respond/stream` body. The browser client
 * refuses to report a Ready state against a server that advertises a different
 * (or no) contract, and the server rejects a stale UI with a typed
 * `AI_CONTRACT_MISMATCH` error instead of a generic validation failure.
 *
 * Bump the version whenever the request envelope changes shape or meaning:
 * adding/removing/renaming accepted request fields, changing validation limits
 * that a previously fitted request relied on, or changing profile budget
 * semantics. Purely additive response-side fields do not require a bump.
 * Server and `dist/` must always be deployed together from the same source.
 */
export const AI_REQUEST_CONTRACT_ID = "lumen.ai.request.v2";
