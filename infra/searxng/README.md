# Loopback-only SearXNG for Lumen

This compose project exposes SearXNG only on `127.0.0.1:8080`. The iPhone never
talks to it directly and never receives its address; Lumen's same-origin server
is the only gateway.

```bash
node scripts/setup_local_search.mjs
docker compose --env-file infra/searxng/.env -f infra/searxng/compose.yaml up -d
curl -fsS 'http://127.0.0.1:8080/search?q=test&format=json'
```

Run these commands from the Lumen project root. The setup script creates a
private 32-byte random secret, writes it with owner-only permissions, and never
prints the secret to the terminal.

Rotate a secret that may have been exposed to terminal output, diagnostics, or
another process, then recreate the container so it receives the replacement:

```bash
node scripts/setup_local_search.mjs --rotate
docker compose --env-file infra/searxng/.env -f infra/searxng/compose.yaml up -d --force-recreate
```

The `.env` file contains a secret and is ignored by the repository's existing
`.env`/`.env.*` rules. Confirm that with `git check-ignore .env` if this workspace is
later placed under Git.

The image is pinned by both release tag and immutable multi-architecture digest
in `compose.yaml`. Review upstream release notes and verify the replacement
manifest digest before changing both values deliberately. JSON search is
explicitly enabled in `config/settings.yml`; request timeouts and connection
pools are bounded. The container runs as the image's `977:977` SearXNG account
with every Linux capability dropped, a read-only root filesystem, read-only
configuration, bounded tmpfs scratch/cache mounts, no privilege escalation, a
query-free local health check, and memory, CPU, and process caps.
It launches the image's packaged Granian binary directly as that non-root user;
the Flask `wsgi` interface and one-worker budget are explicit in Compose rather
than depending on mutable image defaults.
Its Docker logging driver is deliberately `none`: some upstream engine adapters
include the exact search query in warning URLs, so container stdout/stderr is
not retained in Docker's host log store. Lumen's own request logs record only a
request ID, duration, and result count—not the learner query. Search engines
still receive and may retain the explicitly approved query under their own
policies.

Stop it without removing its image:

```bash
docker compose --env-file infra/searxng/.env -f infra/searxng/compose.yaml down
```
