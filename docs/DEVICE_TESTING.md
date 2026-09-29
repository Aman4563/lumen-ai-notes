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
   persisted in each mode. This step covers storage that fails on write. Do
   not use Settings → Safari → Block All Cookies for it: with storage blocked
   outright, reading `localStorage` itself throws, and Lumen currently fails
   at startup, before narration runs, on main as well. That is a separate
   app-shell issue.

## Offline tools that need a device (issue #95)

The browser audits prove the warm tier in Chrome with a real service worker
and a stopped server. Only a home-screen app on an iPhone shows whether iOS
Safari does the same. Note the iOS version with each verdict.

1. **Warming in a home-screen app.** Safari has no `requestIdleCallback`, so
   Lumen asks the worker to fetch its offline tools 3 s after the first
   render, by posting a message to `registration.active`. Install Lumen to
   the Home Screen, open it once online and leave it on Home for 10 s. Then
   connect the iPhone to the Mac, open Safari → Develop → the iPhone →
   the Lumen page, and run in the console:
   `caches.match("./offline-routes.json").then((r) => r.json()).then(async (l) => (await Promise.all(l.warm.map((f) => caches.match(f)))).filter(Boolean).length + " of " + l.warm.length)`.
   Every warm file must be cached (for example "8 of 8"). If it reads
   "0 of 8", note whether the service worker received the message.
2. **Each tool offline.** Turn on Airplane Mode and relaunch from the Home
   Screen. Export a backup, export it encrypted, export a sync file (create
   a vault first), import the exported backup up to its review, upload an
   HTML page and an EPUB, run Check links in the Notebook, open a saved tutor
   answer with `$x^2$`, and open an edited lecture with TeX. Each must work,
   and the math must draw as KaTeX, not as `$x^2$`.
3. **Before warming.** Online, in the Web Inspector console, remove the warm
   files from the app cache:
   `caches.match("./offline-routes.json").then((r) => r.json()).then(async (l) => { for (const key of await caches.keys()) { const cache = await caches.open(key); for (const f of l.warm) await cache.delete(new URL(f, location.href).href); } })`.
   Turn on Airplane Mode and relaunch from the Home Screen. Export a backup:
   the toast must read "Backup failed: This tool isn't saved on this device
   yet. Reconnect once, and it will work offline." with no error screen and
   no reload. Upload a Markdown note and an HTML page together: the note
   imports and the toast lists the page as not imported. Leave a sync vault:
   it must work. A
   saved tutor answer shows `$x^2$` as source text. Settings and the Notebook
   still open, because they are installed with the app. If the export works
   instead, Safari answered the file from its HTTP cache (the assets are
   served `immutable`); record that, since it is not a failure. Turn Airplane
   Mode off and relaunch: after 3 s, step 1's console check reads every file
   again.
4. **An update that takes over offline.** With the warmed build installed,
   deploy a new build and open the home-screen app online until **Update
   now** appears. Do not tap it; wait 10 s, then close the app from the app
   switcher. Turn on Airplane Mode and relaunch, so the update takes over
   offline. Export a backup and open a saved tutor answer with `$x^2$`: both
   must work, because the waiting update saved its own copy of the tools.
   Step 1's console check must read every file. If the export shows the
   "isn't saved on this device yet" toast, note whether the update had
   already appeared before you closed the app.
5. **Math arriving while VoiceOver reads an answer.** Repeat step 3's cache
   removal, turn on Airplane Mode and relaunch, and open a saved tutor answer
   with `$x^2$` and a link, in the Mac tutor and in On-device Lite. Turn on
   VoiceOver and move its cursor onto the link. Turn Airplane Mode off: when
   the math renderer arrives, VoiceOver must stay on the link and must not
   start reading the answers again (On-device Lite's message list is a polite
   live region, and drawing the math replaces an answer's markup). The
   answer switches to rendered math once you move off it; note whether
   VoiceOver announces anything then. Headless Chrome checks DOM focus only,
   not VoiceOver's cursor or announcements.

## Narration panel and player checks that need a device (issue #97)

The browser audits check these with a mocked speech engine, an emulated
iPhone user agent and the live-region DOM. They cannot hear VoiceOver or
see Safari's real voice list. The `#/device-evidence` checklist records
them as "Narration wording" (`voice-platform-copy`) and "VoiceOver"
(`voiceover-narration-messages`); note the iOS version with each verdict.

1. **The iOS wording and the voice list (NU13, NM8).** Open Listen on an
   iPhone in Safari. The note under the panel must begin "Safari offers the
   voices built into iOS; voices downloaded in Settings may not appear
   here", and no message may tell you to install a voice. Then download an
   Enhanced or Premium voice in Settings → Accessibility → Spoken Content →
   Voices, return to Lumen, tap Refresh, and record whether that voice
   appears in the Voice list. On a Mac, the same note must name macOS, not
   iOS.
2. **Messages with VoiceOver (ND4, NM9).** Turn VoiceOver on, start Full
   lecture and let the panel close. Start a timer or ask Siri something to
   interrupt narration, then switch to another app and back. Each time
   VoiceOver must read the message once, and the player must keep it on its
   second line with Resume. Arm a 10-minute sleep timer and let it run
   out: the notification must be read once. Open the panel while a lecture
   plays: VoiceOver must not read each sentence aloud over the voice. Open
   Settings (and, separately, the menu) while a lecture plays and interrupt it
   the same way: VoiceOver must still read the message once, and closing
   Settings must not read it again.
3. **Retry.** A real synthesis failure is hard to force. If one happens (for
   example a network voice with the phone offline), the player must stay,
   show the message, and Retry must replay the same sentence.
4. **The player in landscape and at large text.** Turn the iPhone to
   landscape while a lecture plays, then set Settings → Display & Brightness →
   Text Size (or Accessibility → Larger Text) to its largest step. The player
   must sit above the bottom navigation with every button fully tappable, stay
   below the reader toolbar, and at the end of the lecture the Next card must
   scroll clear of both. Where the space between the toolbar and the player is
   shorter than the card (an iPhone SE or 8 turned sideways), the card must
   fill that space and a tap on it must open the next lecture; notched iPhones
   add a home-indicator inset in landscape that the headless audits do not
   emulate. Switch to another app and back: the background message must show
   its first lines without pushing the player off the screen.
5. **A message after leaving the lecture.** Start Full lecture, go Back to the
   Library while it plays, then switch to another app and back. The
   notification must not mention Resume or Retry (that screen has neither)
   and must say to open the lecture to listen again; with VoiceOver on it must
   be read once.

## Idle connections and lazily loaded screens (issue #138)

The server now closes a connection that never sent a request when its 15 s
header timeout ends, instead of writing `400 Bad Request` into it. Chrome
read that 400 as the answer to the next request it sent on the connection,
so a lazily loaded file failed and chunk recovery reloaded the page. The
server test and `audit:review` cover Chrome; only a real iPhone shows that
Safari retries a request on a connection the server closed.

1. **A lazy file after an idle minute.** Serve the app over HTTPS on the LAN
   (section 1) and open `#/review` in Safari on the iPhone. Create one card,
   switch Scheduler to Adaptive (FSRS), then leave the phone untouched and
   unlocked on that screen for at least 60 seconds. Tap **Calibrate from my
   history**. Its optimizer is loaded on demand and is not saved for
   offline use, so this tap reaches the server. The "Calibration needs at
   least 50 spaced reviews" warning must appear, and the page must not
   reload (the card list keeps its scroll place and no loading screen
   shows). Only the first tap is the check: once loaded, the optimizer is
   kept for later taps. Note the iOS version.
