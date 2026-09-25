# Security policy

## Supported versions

Security fixes are made on `main` and shipped in the next release. Only the
latest release receives fixes.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No; upgrade to the latest release |

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**[Report a vulnerability](https://github.com/Aman4563/lumen-ai-notes/security/advisories/new)**
(Security tab → Advisories → Report a vulnerability). Do not open a public
issue, pull request or discussion for a suspected vulnerability.

Include what you can of the following:

- the affected area (for example the local AI server, pairing, backups, sync,
  the service worker, or how AI output is rendered) and version or commit;
- steps to reproduce, or a proof of concept that does not target anyone else's
  data or device;
- the impact you expect and any conditions it depends on.

This is a single-maintainer project. The aim is to acknowledge a report within
7 days and to agree a fix and disclosure timeline with you after triage. You
will be credited in the advisory unless you ask otherwise.

## Scope

Lumen is local-first: study data stays in the learner's browser, and the
optional AI server runs on the learner's own machine. Reports are especially
welcome for:

- the local AI server (`server/`): authentication and learner pairing, origin
  and LAN exposure checks, request limits, web-search tooling;
- rendering of model output: sanitization, citation integrity, links, images
  and diagrams (see [ENGINEERING_HANDOFF.md](ENGINEERING_HANDOFF.md)
  section 18);
- encrypted backups and cross-device sync;
- the service worker and offline caches;
- anything that sends learner content somewhere the privacy disclosures say
  it does not go.

Out of scope: attacks that require an already compromised device or browser
profile; the behaviour or licences of third-party models (see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)); findings from automated
scanners without a demonstrated impact; and social engineering.

## Design references

- [AI_SERVER.md](AI_SERVER.md): local AI server configuration, pairing and
  LAN deployment.
- [LOCAL_HTTPS.md](LOCAL_HTTPS.md): the local certificate authority and HTTPS
  setup. Keep the CA private key offline and never commit keys or `.env`.
- [docs/ENCRYPTED_BACKUP_DESIGN.md](docs/ENCRYPTED_BACKUP_DESIGN.md) and
  [docs/SYNC_DESIGN.md](docs/SYNC_DESIGN.md): backup encryption and sync.
