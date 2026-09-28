# Lumen documentation

The [project README](../README.md) introduces the app and the curriculum. The
documents below go deeper. The curriculum itself lives in
[notes/](../notes/README.md).

## Guides

How to install, run and operate Lumen.

- [App and iPhone guide](guides/APP_GUIDE.md): what the app does, running it
  on a Mac, installing it on an iPhone, backups and updates.
- [Local AI server](guides/AI_SERVER.md): running the Mac local tutor with
  Ollama, optional self-hosted web search, learner pairing and LAN
  deployment.
- [Private HTTPS on the home network](guides/LOCAL_HTTPS.md): the local
  certificate authority and HTTPS setup an iPhone needs for the installed
  app and the AI tutor.
- [On-device Lite AI](guides/PHONE_LOCAL_AI.md): the in-browser WebLLM model,
  its download consent, privacy and device requirements.

## Design notes

Records of how specific subsystems work and why.

- [AI streaming contract](AI_STREAMING.md): the NDJSON protocol for streamed
  Mac local answers.
- [Encrypted backup design](ENCRYPTED_BACKUP_DESIGN.md): the
  `lumen.backup.enc.v1` format.
- [Sync design](SYNC_DESIGN.md): encrypted, account-free, file-based
  cross-device sync.
- [Tutor threads design](TUTOR_THREADS_DESIGN.md): a proposal for several
  saved tutor conversations (not implemented).
- [Reminders design](REMINDERS_DESIGN.md): the rules for opt-in, quiet study
  reminders.
- [Semantic search design](SEMANTIC_SEARCH_DESIGN.md): a proposal for
  optional local semantic search (not implemented).
- [PDF and EPUB import deferral](IMPORT_DEFERRAL.md): why PDF import was
  deferred when HTML import shipped.

## Testing

- [Functional verification](FUNCTIONAL_TESTING.md): the release gate, what
  each browser suite covers, and dated regression notes.
- [Device testing paths](DEVICE_TESTING.md): producing physical-device
  evidence from an iPhone.
- [AI quality evaluation suite](../eval/README.md): the versioned retrieval
  and grounding evaluation.

## Maintainer references

Internal working documents for maintainers. They record requirement status,
audits and decisions, and are not needed to use the app. Contributors need the
invariants in section 18 of the engineering handoff and the verification log
in the requirements tracker; see [CONTRIBUTING.md](../.github/CONTRIBUTING.md).

- [Engineering handoff](internal/ENGINEERING_HANDOFF.md): architecture,
  invariants (section 18) and operational notes.
- [Product requirements tracker](internal/PRODUCT_REQUIREMENTS.md):
  requirement status and the append-only verification log.
- [Local AI model research](internal/LOCAL_AI_MODEL_RESEARCH.md): the dated
  decision record behind the default local models.
