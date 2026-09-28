# Device testing paths (issues #7/#17)

Three ways to produce the physical-device evidence the release tracker
still needs, in order of fidelity. All of them end the same way: a
completed `lumen.device-evidence.v1` report from the `#/device-evidence`
page pasted into issue #7.

## 1. Physical iPhone over the LAN (highest fidelity, ~15 min)

No cable required for the evidence run itself — the phone just needs the
trusted HTTPS address:

1. Serve the app over HTTPS on the LAN ([`guides/AI_SERVER.md`](guides/AI_SERVER.md) §TLS): the leaf at
   `.local/https/server-cert.pem` is valid to 2027-10-03.
2. On the iPhone, install and trust the local CA once:
   Safari → download `ca-cert.pem` from the served address → Settings →
   Profile Downloaded → Install → Settings → General → About →
   Certificate Trust Settings → enable full trust.
3. Open `https://<mac-lan-ip>:<port>/#/device-evidence` in Safari and walk
   the checklist (auto-probes fill themselves). If `AI_AUTH=pairing` is
   set, the AI checks will first ask for the pairing code from `.env`.
4. Export the JSON report (or Copy) and paste it into issue #7.

## 2. Physical iPhone over USB (adds automated driving)

Plugging the phone in does two extra things: locks the connection to the
cable (no LAN flakiness) and exposes Safari to WebDriver so the evidence
run can be scripted from the Mac.

1. Connect the iPhone by cable; tap **Trust This Computer** on the phone.
2. On the phone: Settings → Safari → Advanced → enable **Web Inspector**
   and **Remote Automation**.
3. On the Mac, `safaridriver --enable` once (admin password), then
   `safaridriver -p 4444` exposes the phone as a WebDriver target
   (`platformName: iOS`). Manual inspection also works immediately:
   Mac Safari → Develop → *(your iPhone)* → the open Lumen tab.
4. The evidence checklist itself is still a human pass — automation can
   drive navigation, but VoiceOver, audio-routing, and interruption
   checks are judgment calls the page records.

## 3. iOS Simulator (no iPhone needed)

`./scripts/simulator_evidence.sh` automates the whole setup: serves the
production build over HTTPS, boots the newest iPhone simulator, trusts
the local CA inside it (`simctl keychain add-root-cert`), opens
`#/device-evidence`, and takes a dated screenshot.

One-time setup (~15 GB): install Xcode from the App Store, then

```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcodebuild -downloadPlatform iOS
```

**What the simulator faithfully covers:** real iOS WebKit rendering and
layout, the service worker and offline caches, persistent-storage
grants, the iOS voice inventory, dialog focus order, and VoiceOver
semantics via Xcode's Accessibility Inspector.

**What it cannot cover (mark these SKIPPED in the report):** WebGPU/
WebLLM performance (the simulator borrows the Mac's GPU stack), real
audio route changes (no Bluetooth path), thermal/energy behavior, and
storage-quota pressure on device flash. A simulator report closes the
iOS-behavior rows; the performance rows stay open until a phone run.

## Narration checks that need a device (issue #96)

The browser audits cover these with a mocked speech engine and injected
storage errors. Only a real iPhone shows whether Safari behaves the same.
The `#/device-evidence` checklist records them as "Narration transport"
(`voice-cancel-speak`) and "Narration storage" (`voice-storage-failure`);
note the iOS version with each verdict.

1. **Next, Previous, Resume and a re-read on iOS before 27 (AM10).** WebKit
   before 27.0 removed an utterance that `speak()` queued in the same task as
   a `cancel()` of live speech. Lumen now waits one task after such a cancel.
   On an iPhone running iOS 26 or earlier: start Full lecture, then tap Next
   three times, Previous once, Pause and Resume, and play an audio bookmark
   while narration is playing. Each tap must speak the sentence the player
   shows, with no silent step. The first Read after opening the lecture must
   start audio at once, because iOS unlocks audio only inside that tap. On
   iOS 27 or later, run the same steps as a control.
2. **Narration when storage fails (ND9/AM9).** Open Lumen in a Private
   Browsing tab, and separately on a phone whose storage is nearly full.
   Start Full lecture, let it advance several sentences, bookmark one and
   stop. The Reader must never show "Lumen could not render this screen".
   Narration keeps playing, and a bookmark that could not be saved says so
   instead of claiming it was saved. Record whether resume and bookmarks
   persisted in each mode.
