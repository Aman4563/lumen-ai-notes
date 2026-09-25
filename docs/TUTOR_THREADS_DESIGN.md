# TFEAT-13 design: titled tutor topics (several saved conversations)

Status: design only, 2026-09-24 (issue #57). The interim step shipped with
it and needs no schema change: **New topic** in the tutor header (its in-app
confirmation offers "Export, then clear") and the **three-hour context
break** (turns before a break of more than three hours are neither sent nor
summarised; a divider and the privacy panel say so). Everything below is a
proposal. None of it is implemented.

## 1. Goals and non-goals

- A learner can keep separate conversations ("Linear regression",
  "Transformers") and return to any of them. Only the open topic's turns
  reach the model.
- Existing guarantees stay intact. Concurrent tutor turns from two tabs
  merge without loss. A cleared or deleted conversation never comes back
  from a stale tab. Backups round-trip every topic. The AI request contract
  does not change.
- Not in scope: sharing topics, search across topics, model-written titles
  (titles come from the learner's own first question), On-device Lite
  topics (its conversation stays session-only).

## 2. What exists today

- `profile.aiTutorHistory` is one rolling record collection, capped at 50
  messages (`RECORD_COLLECTION_LIMITS.aiTutorHistory`, in
  `ROLLING_RECORD_COLLECTIONS` in `src/lib/profileSync.js`). Merges union
  the messages by id and keep the newest.
- `profile.aiTutorHistoryTombstones` (union, capped at 1,000) removes
  cleared and retention-evicted message ids before every merge
  (`withoutClearedAiMessages`). This is what stops a stale tab from bringing
  a cleared turn back.
- `db.js` `normalizeAiTutorHistory` whitelists the message fields.
  `AiTutor.jsx` `normalizeHistory`, `historySignature` and
  `mergeHistoryById` mirror them in the component.
- Retention (`settings.aiHistoryRetention`: 50, 25, 10, or 0 for "session
  only") trims the history and tombstones what it drops. Both
  `updateSettings` and `saveAiTutorHistory` in `App.jsx` do this.
- `backup.js` counts `aiTutorMessages`. `audit:sync`
  (`scripts/cross_tab_audit.mjs`) covers the history across tabs.
- Per-tab state keyed by message id: quiz state
  (`lumen.ai.quiz-state.v1`, session storage), the unsent draft and the
  local-model disclosure.

## 3. Data model

Two shapes were considered.

**A. `threadId` on each message plus a small thread collection
(recommended).** Messages stay in `aiTutorHistory`, each with a
`threadId`. A new record collection `profile.aiTutorThreads` holds
`{ id, title, createdAt, updatedAt }`, and
`profile.aiTutorThreadTombstones` (a union, capped at 1,000) records
deleted topics.

- Message merging keeps working as it does now: per message, by id. Two
  tabs adding turns to the same topic still both keep their turns.
- Deleting a topic tombstones the topic id and all of its message ids,
  using the mechanism clearing already uses.

**B. Messages nested inside thread records.** This is rejected. A thread
record would merge as a whole, so two tabs answering in the same topic
would produce a sync-conflict clone of the whole topic instead of a union
of turns.

Topic ids are random (`createId()`). The one exception is the migrated
legacy topic (§6).

## 4. Persistence chain (all required together)

1. `db.js`: normalizers for `aiTutorThreads` (title ≤ 120 characters,
   ISO times) and `aiTutorThreadTombstones`. Add `threadId` (≤ 200
   characters) to `normalizeAiTutorHistory`'s whitelist, plus the defaults
   in the empty profile.
2. `AiTutor.jsx`: add `threadId` to `normalizeHistory` and
   `historySignature`. The component receives the whole history and an
   `activeThreadId`, and shows and sends only that topic's messages.
3. `profileSync.js`:
   - `aiTutorThreads` becomes a record collection that is not rolling. Its
     merge filters out tombstoned topic ids first (the
     `withoutClearedAiMessages` pattern), so **delete beats edit** for
     topics. This is the opposite of the default record rule. Without it, a
     stale tab's rename would bring a deleted topic back.
   - A concurrent rename keeps the newer `updatedAt` and makes no
     recovered-conflict clone: a title is not study data worth
     duplicating.
   - Messages whose topic is tombstoned are dropped in the same pass.
4. `backup.js`: count `aiTutorTopics`, add both collections to the backup
   fixture, and round-trip them in `backup.test.mjs`.
5. `audit:sync`: add a scenario where two tabs create, rename and delete
   topics at the same time. Check that no topic comes back after a delete,
   that turns in a shared topic are unioned, and that a restore
   (generation fence) replaces topics as it replaces everything else.

## 5. Retention, redefined

- `aiHistoryRetention` becomes a per-topic cap on messages (50, 25 or 10).
  "Session only" still stores nothing.
- A total cap bounds the profile: at most 20 topics and 200 messages. When
  it is exceeded, the least recently used topic is evicted whole (its id and
  its messages are tombstoned) rather than the oldest messages across every
  topic. That way an old topic is never left half empty. The rolling
  message cap in `RECORD_COLLECTION_LIMITS` rises to 200 to match.
- Eviction is visible: a notice names the topic that was removed, and
  Settings shows the topic and message counts.

## 6. Migration

- Legacy messages without a `threadId` are assigned to one migrated topic,
  "Earlier conversation". Its id is fixed (`legacy`), so two tabs migrating
  at the same time create the same topic, not two.
- Migration happens in the normalizer, so every reader (backup import, sync
  fold, the tutor) agrees on it.
- It is idempotent and keeps message ids. Tombstones and quiz state keyed by
  message id stay valid.

## 7. Requests and grounding: unchanged

- Only the active topic's messages go through `tutorConversationWindow`
  and the shared fit path. The payload shape, the byte measurement, the
  profile budgets and the "drop only whole units" rule do not change.
- The three-hour break stays inside a topic. Coming back to a topic the
  next day starts from its recent turns, and the divider and privacy panel
  explain this. Whether a learner who picks a topic on purpose should skip
  the break is an open question (§10).
- Follow-ups, answer checks and weak-spot quizzes already carry their own
  memory, so topics do not affect them.

## 8. Interface

- The header shows the open topic's title with a **Topics** button. It opens
  the existing `TutorSheet`, which is a bottom sheet on phones with 56px
  rows and centred on wider screens. The sheet lists each topic's title,
  last-used date and message count, with **New topic**, **Rename** (an
  inline field) and **Delete** (the in-app `TutorConfirmDialog`, with
  "Export, then delete").
- A new topic is titled from its first question (the first 60 characters,
  without citation labels) and can be renamed.
- An empty topic shows the suggested starts.
- Which topic is open is per-tab UI state (session storage). It defaults
  to the most recently used topic and is never stored in the profile.
- Quiz state is keyed by message id. It must be pruned against the messages
  of **every** topic, not only the open one, or switching topics would
  erase another topic's quiz answers.
- Export offers the open topic, and also "All topics".

## 9. Tests

- Unit tests:
  - The normalizers.
  - The legacy migration, which must give the same id in two tabs.
  - The topic merge: delete beats rename, a concurrent rename keeps the
    newer title, and a topic's messages drop when it is tombstoned.
  - Eviction of the least recently used topic at the total cap.
- `audit:sync`: the two-tab scenario from §4.
- `ai_ui_audit`:
  - A new topic sends a history of length 0.
  - Switching topics restores that topic's messages.
  - Deleting a topic with "Export, then delete" downloads it first.
  - Starters show in an empty topic.
- Backup: a round trip of the fixture with two topics and a tombstone.

## 10. Open questions before implementation

1. Should picking a topic on purpose override the three-hour break for
   that topic, or should the break always apply?
2. The caps (20 topics, 200 messages): is that enough for a semester of
   study, and is 200 messages within the backup-size budget on an iPhone?
3. Titles come from the learner's own questions and travel in backups. Is
   a "private topic" (not backed up) worth the extra state?
4. Should Settings' "clear AI history" clear every topic, or offer a
   choice?
