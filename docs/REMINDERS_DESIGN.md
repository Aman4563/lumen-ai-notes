# PLAN-002 reminders design — the ethical-notification decision

Status: design accepted 2026-09-02 (issue #9). This closes the "reminders
design" deferral recorded when PLAN-002 shipped its minimal slice (the
opt-in silent app badge). It is the gate for any future notification work.

## 1. Principles (non-negotiable)

1. **Opt-in, per mechanism.** No reminder of any kind exists until the
   learner turns that specific mechanism on. Defaults never nag.
2. **Silent before audible, glanceable before interruptive.** The
   escalation ladder is: app badge → scheduled quiet notification →
   nothing else. There is no sound tier and no repeat tier.
3. **No guilt mechanics.** No streak counters in reminders, no "you're
   falling behind!", no loss-framing. Copy states a fact ("12 cards
   ready") and stops. Reminders never fire more than once per local day.
4. **Local-first or not at all.** Anything requiring a push server
   (Web Push) is out — it would attach a network dependency and a
   third-party relay to a study habit. This rules Web Push out
   permanently, not provisionally.
5. **Honest capability reporting.** Where iOS Safari does not support a
   mechanism, Settings says so plainly rather than showing a dead toggle.

## 2. What is already shipped

- **App badge** (`setAppBadge`, opt-in, silent, clears when the queue
  drains) — the entire ladder's first rung, live since the PLAN-002
  slice. On iOS it requires the installed (Home Screen) PWA.

## 3. The accepted next rung: scheduled quiet notification

One local, quiet, daily-capped notification: "Your review session is
ready — N cards." fired only when (a) the learner enabled it, (b) the
due queue is non-empty, and (c) none was shown today.

Mechanism reality on the target platform (iOS Safari PWA):

- The **Notification Triggers API is dead** (removed from Chromium,
  never in WebKit) — true time-based scheduling without a server does
  not exist on the open web today.
- A **service-worker `periodicSync`** is Chromium-only. Not available.
- Therefore the only honest local implementation is **foreground
  computation**: when the app opens (or the SW activates), compare the
  local date and due count, and show at most one notification via
  `registration.showNotification` with `silent: true`. On iOS 16.4+
  this works for installed PWAs with granted permission.

Consequence, stated in the UI copy verbatim when the toggle is enabled:
"iOS only allows this reminder to appear when the app is opened or
refreshed — it cannot wake the phone on a schedule. The app badge is
the reliable rung." This is a platform truth, not a bug to engineer
around with a push relay (see principle 4).

## 4. Storage and settings shape

`settings.reminders = { badge: boolean (exists today as dueBadgeEnabled),
quietNotification: boolean, lastShownOn: "YYYY-MM-DD" (device-local,
NOT synced — reminders are per-device state like narration positions) }`.

## 5. Explicitly rejected

- Web Push / FCM relays (principle 4).
- Recurring escalation ("second reminder at 8pm") — one per day, ever.
- Streak-loss framing and re-engagement copy (principle 3).
- Email or any channel that leaves the device.
