import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const baseUrl = process.env.LUMEN_URL || "http://127.0.0.1:4173/";
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-audio-profile-"));
const runtimeErrors = [];
let browser;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const clickByText = async (page, selector, text) => {
  const clicked = await page.$$eval(selector, (nodes, expected) => {
    const node = nodes.find((item) => item.textContent.replace(/\s+/g, " ").trim().includes(expected));
    node?.click();
    return Boolean(node);
  }, text);
  assert.ok(clicked, `could not find ${selector} containing “${text}”`);
};

const setRange = async (page, label, value) => page.$eval(`input[aria-label="${label}"]`, (input, nextValue) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, String(nextValue));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}, value);

// The iOS speech engine, mocked. `pending` mirrors speechSynthesis.pending.
// `webkitLegacy` reproduces WebKit before 27, where cancel() of live speech
// also removes an utterance queued by speak() in the same task ("cancel()
// removed utterances queued by subsequent speak() calls", fixed in 27.0).
// Date.now() runs `__lumenClockOffset` ms ahead so sleep-timer cases can move
// the clock without waiting.
const installSpeechMock = ({ webkitLegacy = false } = {}) => {
  class TestUtterance {
    constructor(text) {
      this.text = text;
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
      this.lang = "";
      this.voice = null;
    }
  }
  const realNow = Date.now.bind(Date);
  window.__lumenClockOffset = 0;
  Date.now = () => realNow() + window.__lumenClockOffset;
  window.__lumenSpoken = [];
  const listeners = new Map();
  window.__lumenTestVoices = [
    { name: "Samantha", lang: "en-US", voiceURI: "samantha-en-us", default: true, localService: true },
    { name: "Rishi", lang: "en-IN", voiceURI: "rishi-en-in", default: false, localService: true },
    { name: "Lekha", lang: "hi-IN", voiceURI: "lekha-hi-in", default: false, localService: true },
    { name: "Example cloud voice", lang: "en-US", voiceURI: "cloud-en-us", default: false, localService: false },
  ];
  let dropInThisTask = false;
  const synthesis = {
    current: null,
    paused: false,
    speaking: false,
    pending: false,
    getVoices: () => window.__lumenTestVoices,
    speak(utterance) {
      if (dropInThisTask) {
        window.__lumenSpoken.push({ text: utterance.text, dropped: true });
        return;
      }
      this.current = utterance;
      this.paused = false;
      this.speaking = true;
      this.pending = false;
      window.__lumenSpoken.push({ text: utterance.text, voice: utterance.voice?.voiceURI || null });
      utterance.onstart?.();
    },
    cancel() {
      if (webkitLegacy && (this.speaking || this.pending)) {
        dropInThisTask = true;
        setTimeout(() => { dropInThisTask = false; }, 0);
      }
      this.current = null;
      this.paused = false;
      this.speaking = false;
      this.pending = false;
    },
    pause() {
      this.paused = true;
      this.current?.onpause?.();
    },
    resume() {
      this.paused = false;
      this.current?.onresume?.();
    },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    dispatch(type) { listeners.get(type)?.(); },
  };
  Object.defineProperty(window, "SpeechSynthesisUtterance", { configurable: true, value: TestUtterance });
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synthesis });
};

const readStoredProfile = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("lumen-ai-notes", 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const transaction = request.result.transaction("study-data", "readonly");
    const get = transaction.objectStore("study-data").get("profile");
    get.onsuccess = () => resolve(get.result);
    get.onerror = () => reject(get.error);
  };
}));

try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: profileDirectory,
    args: [
      "--allow-insecure-localhost",
      "--ignore-certificate-errors",
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(installSpeechMock, {});
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) runtimeErrors.push(message.text());
  });

  const documentId = "notes/part-01-foundations/01-ai-ml-mental-model.md";
  await page.goto(`${baseUrl}#/read/${encodeURIComponent(documentId)}`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".markdown-body h1", { timeout: 15_000 });
  await page.click('button[aria-label="Listen"]');
  await page.waitForSelector('.speech-popover[role="dialog"]');
  await page.waitForFunction(() => document.querySelector(".speech-popover .popover-heading strong")?.textContent.includes("4 device voices"));
  // READER-12: the sheet takes focus and its Read control is above the fold;
  // READER-3: scope tiles draw their own theme colors, never the browser's
  // default button face.
  const sheet = await page.$eval(".speech-popover", (popover) => {
    const read = [...popover.querySelectorAll(".speech-controls button")].find((button) => button.textContent.includes("Read"));
    const box = read.getBoundingClientRect();
    const frame = popover.getBoundingClientRect();
    const active = getComputedStyle(popover.querySelector(".speech-scope-grid button.active"));
    return {
      focusInside: popover.contains(document.activeElement),
      readInView: box.top >= frame.top && box.bottom <= frame.bottom,
      idleTiles: [...popover.querySelectorAll(".speech-scope-grid button:not(.active)")].map((button) => getComputedStyle(button).backgroundColor),
      activeDistinct: active.color !== active.backgroundColor,
    };
  });
  assert.equal(sheet.focusInside, true, "opening narration did not move focus into the sheet");
  assert.equal(sheet.readInView, true, "the Read control is below the fold of the narration sheet");
  assert.ok(sheet.idleTiles.every((color) => color === "rgba(0, 0, 0, 0)"), `narration scope tiles fell back to the browser button face: ${sheet.idleTiles.join(", ")}`);
  assert.equal(sheet.activeDistinct, true, "the selected narration scope has no visible contrast");

  assert.equal(await page.$$eval('select[aria-label="Narration voice"] option', (options) => options.length), 4, "all reported voices must be selectable");
  assert.equal(await page.$$eval('select[aria-label="Narration language"] option', (options) => options.length), 4, "all reported languages plus automatic mode must be selectable");
  assert.match(await page.$eval(".speech-popover .microcopy", (node) => node.textContent), /Voices come from iOS/u);
  // Issue #92 renamed the network voice label to "Network"; the microcopy
  // must name the label the voice list actually shows.
  assert.match(await page.$eval(".speech-popover .microcopy", (node) => node.textContent), /voices marked “Network”/u);
  assert.ok(await page.$$eval('select[aria-label="Narration voice"] option', (options) => options.some((option) => /· Network$/u.test(option.textContent))), "no network voice carries the “Network” label the microcopy names");

  await page.select('select[aria-label="Narration language"]', "hi-IN");
  await page.waitForFunction(() => document.querySelector('select[aria-label="Narration voice"]')?.value === "lekha-hi-in");
  await setRange(page, "Narration volume", 0.4);
  await setRange(page, "Narration pitch", 0.8);
  await clickByText(page, ".speech-preset-row button", "Review");
  await clickByText(page, ".speech-controls button", "Test voice");
  const preview = await page.evaluate(() => ({
    text: speechSynthesis.current?.text,
    language: speechSynthesis.current?.lang,
    voice: speechSynthesis.current?.voice?.voiceURI,
    rate: speechSynthesis.current?.rate,
    pitch: speechSynthesis.current?.pitch,
    volume: speechSynthesis.current?.volume,
  }));
  assert.match(preview.text, /चुनी हुई/u, "Hindi voice preview must use a matching preview phrase");
  assert.deepEqual(preview, { ...preview, language: "hi-IN", voice: "lekha-hi-in", rate: 1.25, pitch: 0.8, volume: 0.4 });
  await clickByText(page, ".speech-controls button", "Stop");

  await clickByText(page, ".speech-scope-grid button", "Sentence");
  await page.waitForFunction(() => document.querySelector(".speech-target-status")?.textContent.includes("Current sentence"));
  await clickByText(page, ".speech-controls button", "Read current sentence");
  await page.waitForSelector('.audio-bar[aria-label="Narration controls"]');
  assert.equal(await page.evaluate(() => speechSynthesis.current.text.length <= 180), true, "iPhone utterance must remain bounded");
  assert.match(await page.$eval(".audio-label strong", (node) => node.textContent), /Current sentence/u);
  await page.click('button[aria-label="Pause narration"]');
  await page.waitForSelector('button[aria-label="Resume narration"]');
  assert.equal(await page.evaluate(() => speechSynthesis.paused), true);
  await page.click('button[aria-label="Resume narration"]');
  await page.waitForSelector('button[aria-label="Pause narration"]');
  assert.equal(await page.evaluate(() => speechSynthesis.paused), false);

  // AUDIO-001 queue evidence: the document scope builds a multi-segment queue
  // with working previous/next transport; a section queue is a bounded subset.
  await page.$eval('button[aria-label="Stop narration"]', (node) => node.click());
  await page.$eval('button[aria-label="Listen"]', (node) => node.click());
  await page.waitForSelector('.speech-popover[role="dialog"]');
  await clickByText(page, ".speech-scope-grid button", "Full");
  await page.waitForFunction(() => document.querySelector(".speech-target-status")?.textContent.toLowerCase().includes("full lecture"));
  await clickByText(page, ".speech-controls button", "Read full lecture");
  await page.waitForSelector('.audio-bar[aria-label="Narration controls"]');
  await page.waitForFunction(() => document.querySelector(".markdown-body .narration-active"), { timeout: 5_000 })
    .catch(() => assert.fail("full-lecture narration did not highlight the spoken block"));
  const documentProgress = await page.$eval(".audio-label strong", (node) => node.textContent);
  const documentTotal = Number(documentProgress.match(/(\d+)\/(\d+)/)?.[2] || 0);
  assert.ok(documentTotal > 1, `the document queue must contain multiple sentence segments, got "${documentProgress}"`);
  await page.$eval('button[aria-label="Next narration sentence"]', (node) => node.click());
  await page.waitForFunction(() => document.querySelector(".audio-label strong")?.textContent.includes(" 2/"), { timeout: 5_000 });
  await page.$eval('button[aria-label="Previous narration sentence"]', (node) => node.click());
  await page.waitForFunction(() => document.querySelector(".audio-label strong")?.textContent.includes(" 1/"), { timeout: 5_000 });
  assert.equal(await page.$eval('button[aria-label="Previous narration sentence"]', (node) => node.disabled), true, "previous must disable at the first segment");

  // AUDIO-001 heading skip: a full-lecture queue exposes section transport
  // that jumps forward by whole sections and back to the section start.
  await page.waitForSelector('button[aria-label="Next section"]', { timeout: 5_000 });
  await page.$eval('button[aria-label="Next section"]', (node) => node.click());
  const afterSectionSkip = await page.waitForFunction(() => {
    const match = document.querySelector(".audio-label strong")?.textContent.match(/(\d+)\/(\d+)/);
    return match && Number(match[1]) > 1 ? Number(match[1]) : false;
  }, { timeout: 5_000 }).then((handle) => handle.jsonValue());
  assert.ok(afterSectionSkip > 1, `next-section must jump past the first sentence, landed at ${afterSectionSkip}`);
  await page.$eval('button[aria-label="Previous section"]', (node) => node.click());
  await page.waitForFunction(() => document.querySelector(".audio-label strong")?.textContent.includes(" 1/"), { timeout: 5_000 });

  // AUDIO-001 resume position: advancing persists a device-local position and
  // the next full-lecture start resumes from it.
  for (let advance = 0; advance < 6; advance += 1) {
    const displayed = await page.$eval(".audio-label strong", (node) => Number(node.textContent.match(/(\d+)\//)?.[1] || 0));
    if (displayed > 3) break;
    await page.$eval('button[aria-label="Next section"]', (node) => node.click());
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await page.waitForFunction(() => Number(document.querySelector(".audio-label strong")?.textContent.match(/(\d+)\//)?.[1] || 0) > 3, { timeout: 5_000 });
  const resumeIndex = await page.$eval(".audio-label strong", (node) => Number(node.textContent.match(/(\d+)\//)?.[1] || 0));
  await page.$eval('button[aria-label="Stop narration"]', (node) => node.click());
  await page.$eval('button[aria-label="Listen"]', (node) => node.click());
  await page.waitForSelector('.speech-popover[role="dialog"]');

  // AUDIO-001 sleep timer: chips arm a 10-minute end-of-sentence stop.
  await page.waitForSelector('.speech-sleep-row[role="radiogroup"]');
  await clickByText(page, ".speech-sleep-row button", "10 min");
  assert.equal(await page.$eval('.speech-sleep-row button[aria-checked="true"]', (node) => node.textContent.trim()), "10 min", "the sleep timer chip must arm");

  await clickByText(page, ".speech-controls button", "Read full lecture");
  await page.waitForSelector('.audio-bar[aria-label="Narration controls"]');
  const resumedAt = await page.$eval(".audio-label strong", (node) => Number(node.textContent.match(/(\d+)\//)?.[1] || 0));
  assert.equal(resumedAt, resumeIndex, `full-lecture narration must resume from the persisted position (expected ${resumeIndex}, got ${resumedAt})`);

  // Issue #17: bookmark the current sentence, jump back via the panel, delete.
  await page.$eval('button[aria-label="Bookmark this sentence"]', (node) => node.click());
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("bookmarked"), { timeout: 5_000 })
    .catch(() => assert.fail("bookmarking the sentence did not confirm"));
  await page.$eval('button[aria-label="Next narration sentence"]', (node) => node.click());
  await page.$eval('button[aria-label="Stop narration"]', (node) => node.click());
  await page.$eval('button[aria-label="Listen"]', (node) => node.click());
  await page.waitForSelector(".speech-bookmarks .speech-bookmark-play", { timeout: 5_000 });
  await page.$eval(".speech-bookmarks .speech-bookmark-play", (node) => node.click());
  await page.waitForSelector('.audio-bar[aria-label="Narration controls"]', { timeout: 5_000 });
  const bookmarkedAt = await page.$eval(".audio-label strong", (node) => Number(node.textContent.match(/(\d+)\//)?.[1] || 0));
  assert.equal(bookmarkedAt, resumeIndex, `playing a bookmark must start at its sentence (expected ${resumeIndex}, got ${bookmarkedAt})`);
  await page.$eval('button[aria-label="Stop narration"]', (node) => node.click());
  await page.$eval('button[aria-label="Listen"]', (node) => node.click());
  await page.waitForSelector(".speech-bookmarks", { timeout: 5_000 });
  await page.$eval('.speech-bookmark-row button[aria-label="Delete this audio bookmark"]', (node) => node.click());
  await page.waitForFunction(() => !document.querySelector(".speech-bookmarks"), { timeout: 5_000 })
    .catch(() => assert.fail("deleting the audio bookmark did not clear the list"));
  // Leave the flow as the next block expects: full-lecture narration playing.
  await clickByText(page, ".speech-controls button", "Read full lecture");
  await page.waitForSelector('.audio-bar[aria-label="Narration controls"]', { timeout: 5_000 });

  await page.$eval('button[aria-label="Stop narration"]', (node) => node.click());
  await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("lumen-narration-")).forEach((key) => localStorage.removeItem(key)));
  await page.$eval('button[aria-label="Listen"]', (node) => node.click());
  await page.waitForSelector('.speech-popover[role="dialog"]');
  await clickByText(page, ".speech-scope-grid button", "Section");
  await page.waitForFunction(() => document.querySelector(".speech-target-status")?.textContent.toLowerCase().includes("section"));
  await clickByText(page, ".speech-controls button", "Read current section");
  await page.waitForSelector('.audio-bar[aria-label="Narration controls"]');
  const sectionTotal = Number((await page.$eval(".audio-label strong", (node) => node.textContent)).match(/(\d+)\/(\d+)/)?.[2] || 0);
  assert.ok(sectionTotal >= 1 && sectionTotal <= documentTotal, `a section queue (${sectionTotal}) must be a bounded subset of the document queue (${documentTotal})`);
  await page.$eval('button[aria-label="Stop narration"]', (node) => node.click());
  await page.$eval('button[aria-label="Listen"]', (node) => node.click());
  await page.waitForSelector('.speech-popover[role="dialog"]');
  await clickByText(page, ".speech-scope-grid button", "Sentence");
  await clickByText(page, ".speech-controls button", "Read current sentence");
  await page.waitForSelector('.audio-bar[aria-label="Narration controls"]');

  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.waitForSelector('button[aria-label="Resume narration"]');
  assert.equal(await page.evaluate(() => speechSynthesis.current), null, "backgrounding must cancel native autoplay while preserving the queue");
  const resumeTarget = await page.$eval('button[aria-label="Resume narration"]', (button) => {
    const box = button.getBoundingClientRect();
    const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { reachable: button.contains(target), coveringElement: target?.outerHTML.slice(0, 400) };
  });
  assert.ok(resumeTarget.reachable, `Resume narration is covered: ${JSON.stringify(resumeTarget)}`);
  await page.click('button[aria-label="Resume narration"]');
  await page.waitForSelector('button[aria-label="Pause narration"]');
  assert.ok(await page.evaluate(() => speechSynthesis.current?.text.length > 0), "foreground resume must replay only after a tap");
  await page.click('button[aria-label="Stop narration"]');

  const selectedText = await page.$eval(".markdown-body", (article) => {
    const paragraph = [...article.querySelectorAll("p")].find((node) => node.textContent.trim().length > 100);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return paragraph.textContent.replace(/\s+/g, " ").trim();
  });
  await page.click('button[aria-label="Listen"]');
  await page.waitForSelector('.speech-popover[role="dialog"]');
  await clickByText(page, ".speech-scope-grid button", "Selection");
  await page.waitForFunction(() => document.querySelector(".speech-target-status")?.textContent.includes("Selection ·"));
  await clickByText(page, ".speech-controls button", "Read selection");
  assert.ok(selectedText.startsWith(await page.evaluate(() => speechSynthesis.current.text)), "selection mode must narrate the captured lecture selection");
  await page.click('button[aria-label="Stop narration"]');
  await page.click('button[aria-label="Listen"]');
  await page.waitForSelector('.speech-popover[role="dialog"]');

  await page.evaluate(() => {
    window.__lumenTestVoices = [];
    speechSynthesis.dispatch("voiceschanged");
  });
  await page.waitForSelector(".speech-availability button");
  await clickByText(page, ".speech-availability button", "Refresh");
  await page.waitForFunction(() => document.querySelector(".speech-availability")?.textContent.includes("has not reported any voices"), { timeout: 3_000 });
  await page.evaluate(() => {
    window.__lumenTestVoices = [
      { name: "Samantha", lang: "en-US", voiceURI: "samantha-en-us", default: true, localService: true },
      { name: "Lekha", lang: "hi-IN", voiceURI: "lekha-hi-in", default: false, localService: true },
    ];
    speechSynthesis.dispatch("voiceschanged");
  });
  await page.waitForFunction(() => document.querySelector(".speech-popover .popover-heading strong")?.textContent.includes("2 device voices"));

  await delay(700);
  const stored = await readStoredProfile(page);
  assert.equal(stored.settings.speechLanguage, "hi-IN");
  assert.equal(stored.settings.voiceURI, "lekha-hi-in");
  assert.equal(stored.settings.speechRate, 1.25);
  assert.equal(stored.settings.speechPitch, 0.8);
  assert.equal(stored.settings.speechVolume, 0.4);
  assert.equal(stored.settings.speechScope, "selection");

  const geometry = await page.$eval(".speech-popover", (panel) => {
    const rect = panel.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, scrollable: panel.scrollHeight >= panel.clientHeight };
  });
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.viewportWidth, `audio panel overflowed horizontally: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.viewportHeight, `audio panel overflowed vertically: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.scrollable, true, "the dense iPhone audio sheet must remain internally scrollable");

  // Issue #17 (AUDIO-002): the opt-in playlist continues a finished full
  // lecture into the next chapter of the same Part and starts narrating it.
  await clickByText(page, ".speech-scope-grid button", "Full");
  await page.$eval('.speech-autoadvance-row input[type="checkbox"]', (input) => input.click());
  assert.equal(await page.$eval('.speech-autoadvance-row input', (input) => input.checked), true, "the playlist toggle must arm");
  await clickByText(page, ".speech-controls button", "Read full lecture");
  await page.waitForSelector('.audio-bar[aria-label="Narration controls"]');
  await page.evaluate(() => {
    // Drive every utterance to its natural end; when finish() stops queuing
    // new utterances, the current one stays put and the loop exits.
    let guard = 5_000;
    while (guard-- > 0) {
      const utterance = window.speechSynthesis.current;
      if (!utterance || !utterance.onend) break;
      utterance.onend();
      if (window.speechSynthesis.current === utterance) break;
    }
  });
  await page.waitForFunction(() => window.location.hash.includes("02-problem-framing"), { timeout: 10_000 })
    .catch(() => assert.fail("finishing a full lecture with the playlist on did not advance to the next chapter"));
  await page.waitForFunction(() => document.querySelector(".markdown-body h1")?.textContent.toLowerCase().includes("problem framing"), { timeout: 10_000 });
  await page.waitForFunction(() => window.speechSynthesis.current?.text.length > 0, { timeout: 10_000 })
    .catch(() => assert.fail("the next chapter did not begin narrating after auto-advance"));
  assert.ok(await page.$eval(".audio-label", (node) => node.textContent.includes("Full lecture")), "auto-advanced narration must be a full-lecture queue");
  await page.$eval('button[aria-label="Stop narration"]', (node) => node.click());

  assert.deepEqual(runtimeErrors, [], `audio runtime errors: ${runtimeErrors.join(" | ")}`);

  // Issue #96: narration state, queue and storage. Every case runs in its own
  // browser context (fresh settings and storage), and failures are collected
  // so one broken case cannot hide the others.
  const issue96Failures = [];
  const issue96Case = async (name, { webkitLegacy = false, prepare } = {}, run) => {
    const context = await browser.createBrowserContext();
    const casePage = await context.newPage();
    const caseErrors = [];
    try {
      await casePage.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await casePage.evaluateOnNewDocument(installSpeechMock, { webkitLegacy });
      casePage.on("pageerror", (error) => caseErrors.push(error.message));
      casePage.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("Failed to load resource")) caseErrors.push(message.text());
      });
      await prepare?.(casePage);
      await run(casePage);
      assert.deepEqual(caseErrors, [], `runtime errors: ${caseErrors.join(" | ")}`);
    } catch (error) {
      issue96Failures.push(`${name}: ${String(error.message).split("\n")[0]}`);
    } finally {
      await context.close().catch(() => {});
    }
  };
  const openLecture = async (casePage, id = documentId) => {
    await casePage.goto(`${baseUrl}#/read/${encodeURIComponent(id)}`, { waitUntil: "networkidle2", timeout: 30_000 });
    await casePage.waitForSelector(".markdown-body h1", { timeout: 15_000 });
  };
  const openPanel = async (casePage) => {
    if (!(await casePage.$(".speech-popover"))) await casePage.$eval('button[aria-label="Listen"]', (node) => node.click());
    await casePage.waitForSelector('.speech-popover[role="dialog"]', { timeout: 5_000 });
  };
  const chooseScope = async (casePage, label, status) => {
    await clickByText(casePage, ".speech-scope-grid button", label);
    await casePage.waitForFunction((text) => document.querySelector(".speech-target-status")?.textContent.toLowerCase().includes(text), { timeout: 5_000 }, status);
  };
  const waitForBar = (casePage, message) => casePage.waitForSelector('.audio-bar[aria-label="Narration controls"]', { timeout: 5_000 })
    .catch(() => assert.fail(message));
  const barPosition = (casePage) => casePage.$eval(".audio-label strong", (node) => {
    const match = node.textContent.match(/(\d+)\/(\d+)/u);
    return { current: Number(match?.[1] || 0), total: Number(match?.[2] || 0), text: node.textContent };
  });
  const waitForPosition = (casePage, current, message) => casePage.waitForFunction((expected) => {
    const match = document.querySelector(".audio-label strong")?.textContent.match(/(\d+)\//u);
    return Number(match?.[1]) === expected && Boolean(window.speechSynthesis.current);
  }, { timeout: 5_000 }, current).catch(() => assert.fail(message));
  // Speaks the whole queue by ending each utterance, and returns its text.
  const speakQueue = async (casePage) => {
    const { total } = await barPosition(casePage);
    return casePage.evaluate(async (count) => {
      const texts = [];
      for (let index = 0; index < count; index += 1) {
        const utterance = window.speechSynthesis.current;
        if (!utterance) break;
        texts.push(utterance.text);
        utterance.onend?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return texts;
    }, total);
  };
  const shiftClock = (casePage, minutes) => casePage.evaluate((ms) => { window.__lumenClockOffset += ms; }, minutes * 60_000);
  const armedChip = (casePage) => casePage.$eval('.speech-sleep-row button[aria-checked="true"]', (node) => node.textContent.trim());
  const diagramsSettled = (casePage) => casePage.waitForFunction(() => !document.querySelector('.diagram-shell[data-diagram-status="pending"], .diagram-shell[data-diagram-status="rendering"]'), { timeout: 20_000 }).catch(() => {});
  // Places `find(article)` so the reading line (Reader's band 18% down the
  // viewport, 45–140 px) crosses it, and reports where both sit.
  const placeOnReadingLine = (casePage, needle) => casePage.evaluate((text) => {
    const scroller = document.querySelector(".reader-scroll");
    const heading = [...document.querySelectorAll(".markdown-body h1, .markdown-body h2, .markdown-body h3")].find((node) => node.textContent.trim().startsWith(text));
    const frame = scroller.getBoundingClientRect();
    const line = frame.top + Math.min(140, Math.max(45, frame.height * 0.18));
    scroller.scrollTop += heading.getBoundingClientRect().top - line + 4;
    const box = heading.getBoundingClientRect();
    return { line, top: box.top, bottom: box.bottom };
  }, needle);

  // ND1: a sleep timer survives the playlist advancing to the next chapter
  // and still ends narration at its original deadline.
  await issue96Case("sleep timer across auto-advance", {}, async (casePage) => {
    await openLecture(casePage);
    await openPanel(casePage);
    await casePage.$eval('.speech-autoadvance-row input[type="checkbox"]', (input) => { if (!input.checked) input.click(); });
    await clickByText(casePage, ".speech-sleep-row button", "10 min");
    await clickByText(casePage, ".speech-controls button", "Read full lecture");
    await waitForBar(casePage, "full-lecture narration did not start");
    await shiftClock(casePage, 5);
    await casePage.evaluate(() => {
      let guard = 5_000;
      while (guard-- > 0) {
        const utterance = window.speechSynthesis.current;
        if (!utterance || !utterance.onend) break;
        utterance.onend();
        if (window.speechSynthesis.current === utterance) break;
      }
    });
    await casePage.waitForFunction(() => window.location.hash.includes("02-problem-framing") && window.speechSynthesis.current?.text.length > 0, { timeout: 10_000 })
      .catch(() => assert.fail("the playlist did not continue into chapter 2"));
    await openPanel(casePage);
    const chip = await armedChip(casePage);
    assert.equal(chip, "10 min", `the sleep timer read “${chip}” after the playlist advanced`);
    // Eleven minutes after the Read, six into chapter 2: the original
    // deadline has passed, so the next sentence boundary ends narration.
    await shiftClock(casePage, 6);
    await casePage.evaluate(() => window.speechSynthesis.current.onend());
    await casePage.waitForFunction(() => !document.querySelector(".audio-bar"), { timeout: 5_000 })
      .catch(() => assert.fail("narration outlived the original sleep deadline after the playlist advanced"));
    assert.match(await casePage.$eval(".speech-popover .speech-live", (node) => node.textContent), /sleep timer ended narration/u);
    assert.equal(await armedChip(casePage), "Off", "an expired sleep timer must return to Off");
  });

  // NM2: a timer armed while idle counts from the Read, not from arming;
  // resuming after the deadline has passed re-arms it.
  await issue96Case("sleep timer armed while idle", {}, async (casePage) => {
    await openLecture(casePage);
    await openPanel(casePage);
    await clickByText(casePage, ".speech-sleep-row button", "10 min");
    await shiftClock(casePage, 11);
    await clickByText(casePage, ".speech-controls button", "Read full lecture");
    await waitForBar(casePage, "a sleep timer armed while idle swallowed the next Read (no player, no utterance)");
    assert.ok(await casePage.evaluate(() => window.speechSynthesis.current?.text.length > 0), "Read spoke nothing");
    await shiftClock(casePage, 9);
    await casePage.evaluate(() => window.speechSynthesis.current.onend());
    await waitForPosition(casePage, 2, "the countdown ran from arming, not from the Read");
    await casePage.$eval('button[aria-label="Pause narration"]', (node) => node.click());
    await casePage.waitForSelector('button[aria-label="Resume narration"]');
    await shiftClock(casePage, 5);
    await casePage.$eval('button[aria-label="Resume narration"]', (node) => node.click());
    await casePage.waitForSelector('button[aria-label="Pause narration"]');
    await casePage.evaluate(() => window.speechSynthesis.current.onend());
    await waitForPosition(casePage, 3, "resuming after the deadline did not re-arm the sleep timer");
    await shiftClock(casePage, 11);
    await casePage.evaluate(() => window.speechSynthesis.current.onend());
    await casePage.waitForFunction(() => !document.querySelector(".audio-bar"), { timeout: 5_000 })
      .catch(() => assert.fail("the re-armed sleep timer never ended narration"));
  });

  // ND2 and ND11 at measured scroll positions in chapter 1.
  const readSectionAt = async (casePage, place) => {
    await openLecture(casePage);
    await diagramsSettled(casePage);
    await place();
    await openPanel(casePage);
    await chooseScope(casePage, "Section", "current section");
    await place();
    await clickByText(casePage, ".speech-controls button", "Read current section");
    await waitForBar(casePage, "section narration did not start");
    return (await speakQueue(casePage)).join(" ");
  };
  await issue96Case("section at an H2", {}, async (casePage) => {
    let placed;
    const section = await readSectionAt(casePage, async () => { placed = await placeOnReadingLine(casePage, "5. Learning paradigms"); });
    assert.ok(placed.top <= placed.line && placed.bottom >= placed.line, `the heading is not on the reading line: ${JSON.stringify(placed)}`);
    assert.ok(section.startsWith("5. Learning paradigms"), `section narration started elsewhere: ${section.slice(0, 80)}`);
    assert.match(section, /5\.7 Online, batch, and continual learning/u, `the section at an H2 stopped before its H3 subsections (${section.length} characters: “${section.slice(0, 80)}”)`);
    assert.doesNotMatch(section, /6\. Task taxonomy/u, "the section ran into the next H2");
  });
  await issue96Case("section at the top of a chapter", {}, async (casePage) => {
    const top = await readSectionAt(casePage, () => casePage.$eval(".reader-scroll", (node) => { node.scrollTop = 0; }));
    assert.ok(top.startsWith("Chapter 1"), `the top of the chapter did not start at its title: ${top.slice(0, 80)}`);
    assert.match(top, /An intelligent product observes some context/u, `the top of the chapter read only “${top}”`);
    assert.doesNotMatch(top, /2\. Programmed rules versus learned behavior/u, "the introduction ran into the next section");
  });
  await issue96Case("sentence under the reading line", {}, async (casePage) => {
    await openLecture(casePage);
    await diagramsSettled(casePage);
    // Put a line that holds only a paragraph's second sentence on the line.
    const expected = await casePage.evaluate(() => {
      const scroller = document.querySelector(".reader-scroll");
      const frame = scroller.getBoundingClientRect();
      const line = frame.top + Math.min(140, Math.max(45, frame.height * 0.18));
      const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
      const rawOffset = (raw, cleanOffset) => {
        let index = 0;
        let clean = 0;
        while (index < raw.length && /\s/u.test(raw[index])) index += 1;
        while (index < raw.length && clean < cleanOffset) {
          if (/\s/u.test(raw[index])) while (index < raw.length && /\s/u.test(raw[index])) index += 1;
          else index += 1;
          clean += 1;
        }
        return index;
      };
      for (const paragraph of document.querySelectorAll(".markdown-body p")) {
        if (paragraph.childNodes.length !== 1 || paragraph.firstChild.nodeType !== Node.TEXT_NODE) continue;
        const node = paragraph.firstChild;
        const clean = node.data.replace(/\s+/gu, " ").trim();
        const sentences = [...segmenter.segment(clean)].map((part) => part.segment.trim()).filter(Boolean);
        if (sentences.length < 2 || sentences[1].length > 170) continue;
        const secondAt = clean.indexOf(sentences[1]);
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, rawOffset(node.data, secondAt));
        const firstLines = [...range.getClientRects()].filter((box) => box.height > 0);
        range.setStart(node, rawOffset(node.data, secondAt));
        range.setEnd(node, rawOffset(node.data, secondAt + sentences[1].length));
        const secondLines = [...range.getClientRects()].filter((box) => box.height > 0);
        const lastFirst = Math.max(...firstLines.map((box) => box.top));
        const own = secondLines.filter((box) => box.top > lastFirst + 1).at(-1);
        if (!own) continue;
        scroller.scrollTop += own.top + own.height / 2 - line;
        return { sentence: sentences[1], first: sentences[0] };
      }
      return null;
    });
    assert.ok(expected, "no chapter 1 paragraph has a second sentence on its own line");
    await openPanel(casePage);
    await chooseScope(casePage, "Sentence", "current sentence");
    await clickByText(casePage, ".speech-controls button", "Read current sentence");
    await waitForBar(casePage, "sentence narration did not start");
    const spoken = await casePage.evaluate(() => window.speechSynthesis.current?.text || "");
    assert.equal(spoken, expected.sentence, `Sentence read “${spoken}” with the second sentence on the reading line`);
  });

  // ND9 / AM9: narration storage that throws never replaces the Reader.
  // A full store throws on writes only; a blocked one on reads too.
  const throwingStorage = (methods) => (casePage) => casePage.evaluateOnNewDocument((names) => {
    const blocked = /^lumen-(?:narration-|audio-bookmarks)/u;
    for (const method of names) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function guarded(key, ...rest) {
        if (blocked.test(String(key))) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        return original.call(this, key, ...rest);
      };
    }
  }, methods);
  const narrateWithoutStorage = async (casePage) => {
    const crashed = () => casePage.evaluate(() => document.body.innerText.includes("could not render this screen"));
    await openLecture(casePage);
    await openPanel(casePage);
    await clickByText(casePage, ".speech-controls button", "Read full lecture");
    await casePage.waitForFunction(() => document.querySelector(".audio-bar") || document.body.innerText.includes("could not render this screen"), { timeout: 5_000 }).catch(() => {});
    assert.equal(await crashed(), false, "a storage failure replaced the Reader with “Lumen could not render this screen”");
    await waitForBar(casePage, "full-lecture narration did not start while storage throws");
    for (let step = 2; step <= 5; step += 1) {
      await casePage.evaluate(() => window.speechSynthesis.current?.onend?.());
      await waitForPosition(casePage, step, `narration did not advance to ${step} while storage throws`);
    }
    assert.equal(await crashed(), false, "a storage failure replaced the Reader with “Lumen could not render this screen”");
    await casePage.$eval('button[aria-label="Bookmark this sentence"]', (node) => node.click());
    await casePage.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("could not save the bookmark"), { timeout: 5_000 })
      .catch(() => assert.fail("a bookmark that could not be stored was not reported"));
    await casePage.$eval('button[aria-label="Stop narration"]', (node) => node.click());
    await openPanel(casePage);
    assert.equal(await casePage.$(".speech-bookmarks"), null, "bookmarks must list as empty when storage throws");
  };
  await issue96Case("storage writes that throw", { prepare: throwingStorage(["setItem", "removeItem"]) }, narrateWithoutStorage);
  await issue96Case("storage reads and writes that throw", { prepare: throwingStorage(["getItem", "setItem", "removeItem"]) }, narrateWithoutStorage);

  // ND10: a chosen voice missing on this device is never overwritten.
  await issue96Case("voice removed from the device", {}, async (casePage) => {
    await openLecture(casePage);
    await openPanel(casePage);
    await casePage.waitForFunction(() => document.querySelector(".speech-popover .popover-heading strong")?.textContent.includes("4 device voices"));
    await casePage.select('select[aria-label="Narration voice"]', "rishi-en-in");
    await casePage.waitForFunction(() => document.querySelector('select[aria-label="Narration voice"]')?.value === "rishi-en-in");
    await delay(700);
    assert.equal((await readStoredProfile(casePage)).settings.voiceURI, "rishi-en-in");
    await casePage.evaluate(() => {
      window.__lumenTestVoices = window.__lumenTestVoices.filter((voice) => voice.voiceURI !== "rishi-en-in");
      window.speechSynthesis.dispatch("voiceschanged");
    });
    await casePage.waitForFunction(() => document.querySelector(".speech-popover .popover-heading strong")?.textContent.includes("3 device voices"));
    await clickByText(casePage, ".speech-controls button", "Read full lecture");
    await waitForBar(casePage, "narration did not start with the saved voice missing");
    const voice = await casePage.evaluate(() => window.speechSynthesis.current?.voice?.voiceURI);
    assert.ok(voice && voice !== "rishi-en-in", `another voice must play while the chosen one is missing, got ${voice}`);
    await delay(700);
    const stored = (await readStoredProfile(casePage)).settings.voiceURI;
    assert.equal(stored, "rishi-en-in", `the missing voice was replaced in settings by ${stored}`);
  });

  // ND12: a bookmark plays the full lecture whatever the panel's target.
  await issue96Case("bookmark with the Sentence target", {}, async (casePage) => {
    await openLecture(casePage);
    await openPanel(casePage);
    await clickByText(casePage, ".speech-controls button", "Read full lecture");
    await waitForBar(casePage, "full-lecture narration did not start");
    for (let step = 2; step <= 5; step += 1) {
      await casePage.$eval('button[aria-label="Next narration sentence"]', (node) => node.click());
      await waitForPosition(casePage, step, `Next did not reach ${step}`);
    }
    await casePage.$eval('button[aria-label="Bookmark this sentence"]', (node) => node.click());
    await casePage.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("bookmarked"), { timeout: 5_000 });
    await casePage.$eval('button[aria-label="Stop narration"]', (node) => node.click());
    await openPanel(casePage);
    await chooseScope(casePage, "Sentence", "current sentence");
    await casePage.$eval(".speech-bookmarks .speech-bookmark-play", (node) => node.click());
    await waitForBar(casePage, "a bookmark did not play with the Sentence target selected");
    const position = await barPosition(casePage);
    assert.ok(position.text.includes("Full lecture") && position.current === 5, `the bookmark played ${position.text}`);
  });

  // ND14: saved positions never land on the last chunk and relocate by
  // snippet, then section.
  const readFullWith = async (casePage, stored) => {
    await casePage.evaluate((key, value) => localStorage.setItem(key, value), `lumen-narration-${documentId}`, stored);
    await openPanel(casePage);
    await clickByText(casePage, ".speech-controls button", "Read full lecture");
    await waitForBar(casePage, "full-lecture narration did not start");
    const position = await barPosition(casePage);
    const spoken = await casePage.evaluate(() => window.speechSynthesis.current?.text || "");
    await casePage.$eval('button[aria-label="Stop narration"]', (node) => node.click());
    return { ...position, spoken };
  };
  await issue96Case("a stored 9999", {}, async (casePage) => {
    await openLecture(casePage);
    const stale = await readFullWith(casePage, "9999");
    assert.equal(stale.current, 1, `a stored 9999 resumed at ${stale.text}`);
    await casePage.waitForFunction(() => [...document.querySelectorAll(".toast")].some((node) => node.textContent.includes("changed since you stopped")), { timeout: 5_000 })
      .catch(() => assert.fail("a stale position did not say the lecture changed"));
  });
  await issue96Case("positions relocate after an edit", {}, async (casePage) => {
    await openLecture(casePage);
    await openPanel(casePage);
    await clickByText(casePage, ".speech-controls button", "Read full lecture");
    await waitForBar(casePage, "full-lecture narration did not start");
    const queue = await speakQueue(casePage);
    assert.ok(queue.length > 20, `chapter 1 queued only ${queue.length} chunks`);
    // Saved at index 3 before an edit moved that sentence to chunk 9.
    const moved = await readFullWith(casePage, JSON.stringify({ v: 2, index: 3, total: queue.length - 6, snippet: queue[8].slice(0, 60), section: "" }));
    assert.equal(moved.current, 9, `a snippet saved from chunk 9 resumed at ${moved.text}`);
    // The sentence itself was rewritten; its section is still there.
    const sectioned = await readFullWith(casePage, JSON.stringify({ v: 2, index: 40, total: queue.length + 4, snippet: "A sentence this lecture no longer has.", section: "5. Learning paradigms" }));
    assert.ok(sectioned.spoken.startsWith("5. Learning paradigms"), `a position whose sentence is gone did not resume at its section: ${sectioned.spoken.slice(0, 60)}`);
    // Review follow-up: the section fallback says so, instead of claiming
    // an exact resume.
    await casePage.waitForFunction(() => [...document.querySelectorAll(".toast")].some((node) => node.textContent.includes("resumes at the start of “5. Learning paradigms”")), { timeout: 5_000 })
      .catch(async () => assert.fail(`a section fallback announced “${await casePage.$$eval(".toast", (nodes) => nodes.map((node) => node.textContent).join(" | "))}”`));
  });

  // NM1: with the Mermaid chunk unavailable, the diagram's diagnostic (its
  // message and raw source) is never narrated.
  await issue96Case("Mermaid unavailable", {
    prepare: async (casePage) => {
      await casePage.setBypassServiceWorker(true);
      await casePage.setCacheEnabled(false);
      // Offline as far as the app can tell, so chunk recovery stays out of it.
      await casePage.evaluateOnNewDocument(() => Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => false }));
      await casePage.setRequestInterception(true);
      casePage.on("request", (request) => {
        if (/\/assets\/mermaid\.core-/u.test(request.url()) || request.url().includes("/api/health")) void request.abort("failed");
        else void request.continue();
      });
    },
  }, async (casePage) => {
    await openLecture(casePage);
    await casePage.waitForSelector('.diagram-shell[data-diagram-status="error"]', { timeout: 20_000 })
      .catch(() => assert.fail("the blocked Mermaid chunk did not produce the diagram failure"));
    await openPanel(casePage);
    await clickByText(casePage, ".speech-controls button", "Read full lecture");
    await waitForBar(casePage, "full-lecture narration did not start");
    const leaked = (await speakQueue(casePage)).filter((text) => /Mermaid module|Diagram renderer|flowchart TD|-->|Show Mermaid source|Retry diagram/u.test(text));
    assert.deepEqual(leaked, [], "the diagram diagnostic was narrated");
  });

  // AM10: on WebKit before 27, Next, Previous and a re-read after a real
  // cancel must still speak; the first Read stays inside the tap.
  await issue96Case("WebKit before 27", { webkitLegacy: true }, async (casePage) => {
    await openLecture(casePage);
    await openPanel(casePage);
    const first = await casePage.evaluate(() => {
      [...document.querySelectorAll(".speech-controls button")].find((button) => button.textContent.includes("Read full lecture")).click();
      return window.speechSynthesis.current?.text || "";
    });
    assert.ok(first, "the first utterance was not spoken inside the tap, which iOS needs to unlock audio");
    await casePage.$eval('button[aria-label="Next narration sentence"]', (node) => node.click());
    await waitForPosition(casePage, 2, "Next after a live cancel spoke nothing (the utterance was dropped)");
    const second = await casePage.evaluate(() => window.speechSynthesis.current.text);
    assert.notEqual(second, first);
    // A queued utterance that has not started yet (pending) is live too.
    await casePage.evaluate(() => {
      window.speechSynthesis.speaking = false;
      window.speechSynthesis.pending = true;
    });
    await casePage.$eval('button[aria-label="Next narration sentence"]', (node) => node.click());
    await waitForPosition(casePage, 3, "Next while an utterance was pending spoke nothing");
    await casePage.$eval('button[aria-label="Previous narration sentence"]', (node) => node.click());
    await waitForPosition(casePage, 2, "Previous after a live cancel spoke nothing");
    assert.equal(await casePage.evaluate(() => window.speechSynthesis.current.text), second, "Previous did not replay chunk 2");
    const dropped = await casePage.evaluate(() => window.__lumenSpoken.filter((entry) => entry.dropped).map((entry) => entry.text.slice(0, 40)));
    assert.deepEqual(dropped, [], "utterances were dropped after cancel()");
  });

  // Review follow-ups for issue #96.
  const nextDocumentId = "notes/part-01-foundations/02-problem-framing-and-objectives.md";
  const toastTexts = (casePage) => casePage.$$eval(".toast", (nodes) => nodes.map((node) => node.textContent));
  const liveText = (casePage) => casePage.$eval(".speech-popover .speech-live", (node) => node.textContent);
  // Ends utterances until the queue's last chunk is speaking.
  const walkToLastChunk = async (casePage) => {
    const { current, total } = await barPosition(casePage);
    await casePage.evaluate((count) => {
      for (let step = 0; step < count; step += 1) window.speechSynthesis.current?.onend?.();
    }, total - current);
    await waitForPosition(casePage, total, `narration did not reach its last sentence (${total})`);
  };
  const startPlaylistWithTimer = async (casePage) => {
    await openLecture(casePage);
    await openPanel(casePage);
    await casePage.$eval('.speech-autoadvance-row input[type="checkbox"]', (input) => { if (!input.checked) input.click(); });
    await clickByText(casePage, ".speech-sleep-row button", "10 min");
    await clickByText(casePage, ".speech-controls button", "Read full lecture");
    await waitForBar(casePage, "full-lecture narration did not start");
  };

  // A sleep deadline that passes during a chapter's last sentence ends
  // narration in that chapter: the playlist neither opens the next one nor
  // announces “Continuing narration”.
  await issue96Case("sleep timer lapsing in a chapter's last sentence", {}, async (casePage) => {
    await startPlaylistWithTimer(casePage);
    await walkToLastChunk(casePage);
    await openPanel(casePage);
    await shiftClock(casePage, 11);
    await casePage.evaluate(() => window.speechSynthesis.current.onend());
    await casePage.waitForFunction(() => !document.querySelector(".audio-bar"), { timeout: 5_000 })
      .catch(() => assert.fail("narration kept playing after the sleep deadline passed in the last sentence"));
    await delay(1_200);
    const hash = await casePage.evaluate(() => decodeURIComponent(window.location.hash));
    const toasts = await toastTexts(casePage);
    assert.ok(hash.includes("01-ai-ml-mental-model"), `the playlist opened ${hash} after the sleep deadline passed`);
    assert.ok(!toasts.some((text) => text.includes("Continuing narration")), `a lapsed sleep timer still announced “${toasts.join(" | ")}”`);
    await openPanel(casePage);
    assert.match(await liveText(casePage), /sleep timer ended narration/u);
    assert.equal(await armedChip(casePage), "Off", "an expired sleep timer must return to Off");
  });

  // The deadline passes after chapter 1 ends but before chapter 2 starts
  // (while it loads): chapter 2 opens silently, never claiming to continue.
  await issue96Case("sleep timer lapsing while the next chapter loads", {}, async (casePage) => {
    await startPlaylistWithTimer(casePage);
    await shiftClock(casePage, 5);
    await walkToLastChunk(casePage);
    await casePage.evaluate(() => {
      window.speechSynthesis.current.onend();
      window.__lumenClockOffset += 6 * 60_000;
    });
    await casePage.waitForFunction(() => window.location.hash.includes("02-problem-framing") && document.querySelector(".markdown-body h1")?.textContent.toLowerCase().includes("problem framing"), { timeout: 10_000 })
      .catch(() => assert.fail("the playlist did not open chapter 2 before the deadline"));
    await delay(1_200);
    assert.equal(await casePage.$(".audio-bar"), null, "narration outlived the sleep deadline into chapter 2");
    const toasts = await toastTexts(casePage);
    assert.ok(!toasts.some((text) => text.includes("Continuing narration")), `chapter 2 was announced as continuing although nothing played: “${toasts.join(" | ")}”`);
    await openPanel(casePage);
    assert.match(await liveText(casePage), /sleep timer ended narration/u);
    assert.equal(await armedChip(casePage), "Off", "an expired sleep timer must return to Off");
  });

  // Next or Previous on a player paused past the sleep deadline re-arms the
  // timer, as Resume does, instead of ending narration.
  await issue96Case("Next and Previous while paused past the sleep deadline", {}, async (casePage) => {
    await openLecture(casePage);
    await openPanel(casePage);
    await clickByText(casePage, ".speech-sleep-row button", "10 min");
    await clickByText(casePage, ".speech-controls button", "Read full lecture");
    await waitForBar(casePage, "full-lecture narration did not start");
    const pausePastDeadline = async () => {
      await casePage.$eval('button[aria-label="Pause narration"]', (node) => node.click());
      await casePage.waitForSelector('button[aria-label="Resume narration"]', { timeout: 5_000 });
      await shiftClock(casePage, 11);
    };
    await pausePastDeadline();
    await casePage.$eval('button[aria-label="Next narration sentence"]', (node) => node.click());
    await waitForPosition(casePage, 2, "Next on a player paused past the sleep deadline ended narration");
    await pausePastDeadline();
    await casePage.$eval('button[aria-label="Previous narration sentence"]', (node) => node.click());
    await waitForPosition(casePage, 1, "Previous on a player paused past the sleep deadline ended narration");
    await openPanel(casePage);
    assert.equal(await armedChip(casePage), "10 min", "a tap on a paused player must keep the sleep timer armed");
    // The re-armed timer still ends narration at its new deadline.
    await shiftClock(casePage, 11);
    await casePage.evaluate(() => window.speechSynthesis.current.onend());
    await casePage.waitForFunction(() => !document.querySelector(".audio-bar"), { timeout: 5_000 })
      .catch(() => assert.fail("the re-armed sleep timer never ended narration"));
  });

  // Browser Back while a full lecture plays: the position stays with the
  // lecture that was playing, never the one Back opens.
  await issue96Case("browser Back during full-lecture narration", {}, async (casePage) => {
    await openLecture(casePage, nextDocumentId);
    await casePage.evaluate((hash) => { window.location.hash = hash; }, `#/read/${encodeURIComponent(documentId)}`);
    await casePage.waitForFunction(() => document.querySelector(".markdown-body h1")?.textContent.toLowerCase().includes("mental model"), { timeout: 15_000 });
    await openPanel(casePage);
    await clickByText(casePage, ".speech-controls button", "Read full lecture");
    await waitForBar(casePage, "full-lecture narration did not start");
    for (let step = 2; step <= 5; step += 1) {
      await casePage.$eval('button[aria-label="Next narration sentence"]', (node) => node.click());
      await waitForPosition(casePage, step, `Next did not reach ${step}`);
    }
    await casePage.evaluate(() => history.back());
    await casePage.waitForFunction(() => document.querySelector(".markdown-body h1")?.textContent.toLowerCase().includes("problem framing"), { timeout: 10_000 })
      .catch(() => assert.fail("Back did not return to chapter 2"));
    await delay(500);
    const [own, other] = await casePage.evaluate((ids) => ids.map((id) => localStorage.getItem(`lumen-narration-${id}`)), [documentId, nextDocumentId]);
    assert.equal(other, null, `chapter 1's narration position was saved under chapter 2: ${other}`);
    assert.equal(JSON.parse(own || "null")?.index, 4, `chapter 1 did not keep its own position: ${own}`);
    await openPanel(casePage);
    await clickByText(casePage, ".speech-controls button", "Read full lecture");
    await waitForBar(casePage, "chapter 2 narration did not start");
    const position = await barPosition(casePage);
    const toasts = await toastTexts(casePage);
    assert.equal(position.current, 1, `chapter 2 started at ${position.text}`);
    assert.ok(!toasts.some((text) => /changed since|resumed from/u.test(text)), `chapter 2 claimed a saved position: “${toasts.join(" | ")}”`);
  });

  // A pronunciation override added after stopping rewords the saved
  // sentence but keeps the queue: resume stays on that sentence.
  await issue96Case("pronunciation override after stopping", {}, async (casePage) => {
    await openLecture(casePage);
    await openPanel(casePage);
    await clickByText(casePage, ".speech-controls button", "Read full lecture");
    await waitForBar(casePage, "full-lecture narration did not start");
    const key = `lumen-narration-${documentId}`;
    let chosen = null;
    for (let step = 2; step <= 40 && !chosen; step += 1) {
      await casePage.$eval('button[aria-label="Next narration sentence"]', (node) => node.click());
      await waitForPosition(casePage, step, `Next did not reach ${step}`);
      if (step < 6) continue;
      const saved = await casePage.waitForFunction((storageKey, index) => {
        const value = JSON.parse(localStorage.getItem(storageKey) || "null");
        return value?.index === index ? value : null;
      }, { timeout: 5_000 }, key, step - 1).then((handle) => handle.jsonValue());
      // Not a section's first sentence (the section fallback would land
      // there anyway), with a whole word early in the snippet to override.
      const word = saved.snippet.slice(0, 50).match(/(?<![\p{L}\p{N}])\p{L}{6,}(?![\p{L}\p{N}])/u)?.[0];
      if (word && saved.section && !saved.snippet.startsWith(saved.section.slice(0, 12))) chosen = { step, word, saved };
    }
    assert.ok(chosen, "no chapter 1 sentence past the fifth suits the override");
    await casePage.$eval('button[aria-label="Stop narration"]', (node) => node.click());
    await casePage.$eval('button[aria-label="Open settings"]', (node) => node.click());
    await casePage.waitForSelector(".settings-drawer .pronunciation-editor textarea", { timeout: 10_000 });
    await casePage.$eval(".pronunciation-editor textarea", (node, word) => {
      node.focus();
      node.value = `${word} = ${word}z`;
      node.blur();
    }, chosen.word);
    await casePage.waitForFunction(() => [...document.querySelectorAll(".toast")].some((node) => node.textContent.includes("pronunciation override saved")), { timeout: 5_000 });
    await casePage.$eval('button[aria-label="Close settings"]', (node) => node.click());
    await openPanel(casePage);
    await clickByText(casePage, ".speech-controls button", "Read full lecture");
    await waitForBar(casePage, "full-lecture narration did not start after the override");
    const position = await barPosition(casePage);
    const spoken = await casePage.evaluate(() => window.speechSynthesis.current?.text || "");
    assert.equal(position.current, chosen.step, `stopped at ${chosen.step} (“${chosen.saved.snippet}”), then overriding “${chosen.word}” resumed at ${position.text}: “${spoken.slice(0, 60)}”`);
    assert.ok(spoken.includes(`${chosen.word}z`), `the resumed sentence does not use the override: “${spoken.slice(0, 80)}”`);
  });

  // A long bookmark snippet ellipsizes inside the phone narration sheet; the
  // sheet never scrolls sideways and Delete stays on screen.
  await issue96Case("a long audio bookmark on a phone", {}, async (casePage) => {
    await openLecture(casePage);
    await casePage.evaluate((id) => localStorage.setItem("lumen-audio-bookmarks-v1", JSON.stringify([{
      id: "ab-long",
      documentId: id,
      v: 2,
      index: 6,
      total: 0,
      snippet: "An intelligent product observes some context, chooses an action, and is judged by the consequences of that action.",
      section: "",
      savedAt: new Date().toISOString(),
    }])), documentId);
    await casePage.reload({ waitUntil: "networkidle2", timeout: 30_000 });
    await casePage.waitForSelector(".markdown-body h1", { timeout: 15_000 });
    for (const { width, height, scale } of [{ width: 393, height: 852, scale: 1 }, { width: 320, height: 568, scale: 2 }]) {
      await casePage.setViewport({ width, height, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await casePage.evaluate((factor) => { document.documentElement.style.fontSize = `${16 * factor}px`; }, scale);
      await openPanel(casePage);
      await casePage.waitForSelector(".speech-bookmarks .speech-bookmark-play", { timeout: 5_000 });
      await delay(150);
      const layout = await casePage.evaluate(() => {
        const sheet = document.querySelector(".speech-popover");
        const remove = document.querySelector('.speech-bookmarks button[aria-label="Delete this audio bookmark"]').getBoundingClientRect();
        return { scrollWidth: sheet.scrollWidth, clientWidth: sheet.clientWidth, deleteRight: remove.right, viewport: document.documentElement.clientWidth };
      });
      assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `at ${width} px and ${scale * 100}% text the narration sheet scrolls sideways: ${JSON.stringify(layout)}`);
      assert.ok(layout.deleteRight <= layout.viewport, `at ${width} px and ${scale * 100}% text Delete sits off screen: ${JSON.stringify(layout)}`);
    }
  });

  assert.deepEqual(issue96Failures, [], `issue #96 narration cases failed:\n- ${issue96Failures.join("\n- ")}`);
  console.log("Audio audit passed: section skip, persisted resume position, audio bookmarks (save/jump/delete), sleep-timer arming, multiple voices/languages, preview parameters, sentence/section/selection/document queues with previous/next transport, controls, iOS foreground safety, persistence, empty-voice recovery, opt-in playlist auto-advance into the next chapter, and iPhone layout; issue #96: the sleep timer across auto-advance and armed while idle, the section and sentence at the reading line, throwing storage, a missing chosen voice, bookmarks under the Sentence target, stale saved positions, an unavailable Mermaid chunk, and WebKit before 27; review follow-ups: a sleep deadline passing in a chapter's last sentence or while the next loads, Next/Previous paused past the deadline, browser Back during narration, a pronunciation override after stopping, the section-fallback wording, and a long bookmark on a phone.");
} finally {
  await browser?.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
