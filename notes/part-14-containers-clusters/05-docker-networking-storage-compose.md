# Chapter 5 — Docker Networking, Storage, Compose, and Operations

## 1. Container networking model

Each ordinary container can have its own network namespace with interfaces, routes,
DNS configuration, and listening sockets. Docker networks connect endpoints and
provide driver-specific behavior.

- default bridge: basic local connectivity; legacy name behavior differs;
- user-defined bridge: local multi-container apps with built-in name resolution;
- host networking: shares host network namespace where supported;
- none: no ordinary external network interface;
- overlay: multi-host networks in compatible orchestration modes;
- macvlan/ipvlan: advanced direct network presence with operational trade-offs.

Prefer a user-defined network for local applications. Do not hardcode container IPs;
they are runtime state. Use service/DNS names and application retries/readiness.

## 2. Name resolution and listening addresses

On a user-defined network, containers can resolve peer names/aliases. `localhost`
inside a container refers to that container, not the host or another container.
A service binding only `127.0.0.1` inside its container is normally unreachable by
peers; bind an appropriate container interface and control exposure via network/
firewall/publishing.

Docker Desktop host access differs from native Linux; use documented host gateway
mechanisms rather than assuming one magic address everywhere.

## 3. Published ports and attack surface

Port publishing installs host forwarding. Specify host IP intentionally:

```bash
docker run -p 127.0.0.1:5432:5432 postgres:VERSION
```

Omitting host IP often binds broadly. Check actual listeners/firewall and never
publish databases/admin/debug ports without authentication and need. Container
network isolation is not an application authorization system.

## 4. Network debugging ladder

1. Is the process running and listening on the expected container address/port?
2. Is the caller using the correct service name and container port?
3. Are endpoints attached to the same intended network?
4. Does DNS return expected address?
5. Do routes/firewall/published mappings permit traffic?
6. Does TLS/SNI/application protocol match?
7. Are timeouts caused by overload/dependency rather than reachability?

Use `docker network inspect`, container logs, `ss`, DNS lookup, and an authorized
diagnostic container. Avoid permanently adding debugging packages to minimal images.

## 5. Storage options

| Option | Lifecycle | Best for | Main risks |
|---|---|---|---|
| writable layer | container instance | ephemeral scratch | lost on removal, copy-on-write cost |
| named volume | independent runtime object | local persistent service data | backup/ownership/hidden lifecycle |
| bind mount | host path | source/config/dev integration | host coupling, permissions, broad access |
| tmpfs | memory-backed runtime mount | bounded ephemeral sensitive/temp state | memory pressure, lost on stop |
| external service | outside host/container | durable shared production state | network, consistency, auth, cost |

Mounting over a nonempty image directory hides those image files for that container;
it does not delete them. File ownership uses numeric IDs at the kernel boundary.

## 6. Backup and restore

A volume backup must be application-consistent. Copying database files during writes
may produce corruption even if tar succeeds. Quiesce, use database-native backup/
snapshot semantics, record application/schema/version, encrypt/protect, and test
restore. A backup never restored is an assumption.

## 7. Compose mental model

Compose describes services, networks, volumes, configs/secrets and relationships
for a multi-container application. It is useful for development, integration tests,
and some single-host deployments. It is not automatically a multi-node orchestrator.

```yaml
services:
  api:
    build: .
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      DATABASE_URL: postgresql://db/app
    depends_on:
      db:
        condition: service_healthy
    read_only: true
    tmpfs:
      - /tmp
  db:
    image: postgres:VERSION
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
volumes:
  db-data: {}
```

Pin real images/digests and keep credentials outside committed YAML. `depends_on`
controls creation/start relationships according to Compose behavior; application
code still needs bounded retry because dependencies can fail later.

## 8. Compose configuration and precedence

Effective values may come from Compose files/merges, shell interpolation, `.env`,
environment lists/files, CLI options, image defaults, and app configuration.
Inspect the rendered model:

```bash
docker compose config
docker compose config --services
```

Rendered config may expose secrets. Understand difference between interpolation
input and environment passed to a container. Avoid ambiguous implicit files in CI.

## 9. Compose lifecycle

```bash
docker compose up --build
docker compose ps
docker compose logs -f --tail=200
docker compose exec api sh
docker compose down
```

`down` can remove networks/containers; options may remove volumes/images. Inspect
and protect durable data. `stop` preserves containers; `rm` removes stopped service
containers; exact choices depend on desired lifecycle.

Scaling stateful services requires application/database design; `--scale` does not
create safe consensus, replication, sharding, or a load balancer automatically.

## 10. Health checks

Health checks answer a narrow observable condition. Readiness should cover ability
to serve under current initialized state; liveness should detect irrecoverable local
stuck state without depending on every downstream service. A check can overload
the app, leak credentials, or cause restart storms if poorly designed.

Compose health status does not automatically provide production traffic routing.

## 11. Logs and observability

Write structured application logs to stdout/stderr; configure driver, rotation,
size/retention and shipping. Docker logs are not guaranteed long-term/audited
storage. Add metrics/traces, request IDs, image/config versions, resource signals,
and health events.

Never log secrets, access tokens, personal data, or full prompts by default.

## 12. Resource and security controls

Run non-root; read-only root; explicit writable mounts; drop capabilities; no-new-
privileges; seccomp/security profiles; bounded CPU/memory/PIDs; scoped networks;
secret mounts/identity; signed/scanned images. Compose keys/support can depend on
implementation/version; validate with current docs and actual runtime.

## 13. Common failure matrix

| Symptom | Likely distinctions |
|---|---|
| container exits immediately | main process success/crash, wrong command, missing config |
| works with exec but not entrypoint | shell/exec form, working dir, env, signal, user |
| peer connection refused | wrong name/port, server not listening, loopback bind |
| host cannot connect | publish/bind/firewall/VM network |
| permission denied on mount | UID/GID/mode, read-only, security label, parent traversal |
| changes disappear | written to writable layer or ephemeral container |
| old code after rebuild | build context/cache/tag/old container, bind mount hides image |
| disk fills | images/layers/cache/logs/volumes or app data |
| OOM killed | cgroup limit/peak, host pressure, unbounded cache/workers |

## 14. Operational lab

Build a three-service app (gateway/API/database or cache). Use user-defined network,
service names, named volume, loopback-only publishing, non-root/read-only API,
health checks, resource limits, and log rotation. Then inject wrong port, loopback
bind, bad UID, missing env, full disk, SIGTERM, and dependency delay. Diagnose from
evidence before editing.

