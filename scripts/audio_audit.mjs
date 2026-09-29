import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { installSpeechMock } from "./speech_mock.mjs";

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
  // Issue #97 changed this on purpose: the microcopy names the platform the
  // browser runs on (this headless Chrome is not iOS), so it no longer says
  // "Voices come from iOS" everywhere. The #97 cases below pin each platform.
  assert.doesNotMatch(await page.$eval(".speech-popover .microcopy", (node) => node.textContent), /\biOS\b|iPhone/u);
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
  // Issue #97 reuses the runner with its own failure list and viewports.
  const issue96Failures = [];
  const issue97Failures = [];
  const phoneViewport = { width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
  const narrationCase = (failures) => async (name, { webkitLegacy = false, prepare, viewport = phoneViewport } = {}, run) => {
    const context = await browser.createBrowserContext();
    const casePage = await context.newPage();
    const caseErrors = [];
    try {
      await casePage.setViewport(viewport);
      await casePage.evaluateOnNewDocument(installSpeechMock, { webkitLegacy });
      casePage.on("pageerror", (error) => caseErrors.push(error.message));
      casePage.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("Failed to load resource")) caseErrors.push(message.text());
      });
      await prepare?.(casePage);
      await run(casePage);
      assert.deepEqual(caseErrors, [], `runtime errors: ${caseErrors.join(" | ")}`);
    } catch (error) {
      failures.push(`${name}: ${String(error.message).split("\n")[0]}`);
    } finally {
      await context.close().catch(() => {});
    }
  };
  const issue96Case = narrationCase(issue96Failures);
  const issue97Case = narrationCase(issue97Failures);
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

  // Issue #97: the Listen panel, the mini player and Teaching Mode.
  const desktopViewport = { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
  // Outermost live regions whose text holds `needle`, and how many times.
  const announcements = (casePage, needle) => casePage.evaluate((text) => {
    const live = "[aria-live]:not([aria-live='off']), [role='status'], [role='alert'], [role='log']";
    return [...document.querySelectorAll(live)]
      .filter((node) => !node.parentElement?.closest(live) && node.textContent.includes(text))
      .map((node) => ({ region: node.className, role: node.getAttribute("role"), count: node.textContent.split(text).length - 1 }));
  }, needle);
  const narratorRegion = (role) => [{ region: "narration-live visually-hidden", role, count: 1 }];
  const barMessage = (casePage) => casePage.$eval(".audio-bar .audio-label", (node) => node.textContent).catch(() => "");
  const startFullLecture = async (casePage) => {
    await openPanel(casePage);
    await clickByText(casePage, ".speech-controls button", "Read full lecture");
    await waitForBar(casePage, "full-lecture narration did not start");
    assert.equal(await casePage.$(".speech-popover"), null, "Read left the narration panel open");
  };
  // Fails the sentence being read, once one is playing: after Retry or
  // Resume, useSpeech replays it one task after cancelling live speech.
  const failSentence = async (casePage, code) => {
    await casePage.waitForFunction(() => Boolean(window.speechSynthesis.current), { timeout: 5_000 })
      .catch(() => assert.fail(`no sentence was playing to fail with ${code}`));
    return casePage.evaluate((error) => {
      const utterance = window.speechSynthesis.current;
      utterance.onerror({ error });
      return utterance.text;
    }, code);
  };
  // Waits for `text` to be the sentence being spoken (a replay starts one
  // task after the Retry or Resume tap).
  const waitForSpoken = (casePage, text, message) => casePage.waitForFunction((expected) => window.speechSynthesis.current?.text === expected, { timeout: 5_000 }, text)
    .catch(async () => assert.fail(`${message} (speaking “${String(await casePage.evaluate(() => window.speechSynthesis.current?.text)).slice(0, 60)}”)`));
  // Waits until no live region holds `needle` (messages clear as the
  // replayed sentence starts).
  const waitUnannounced = (casePage, needle, message) => casePage.waitForFunction((text) => ![...document.querySelectorAll("[aria-live]:not([aria-live='off']), [role='status'], [role='alert'], [role='log']")].some((node) => node.textContent.includes(text)), { timeout: 5_000 }, needle)
    .catch(async () => assert.fail(`${message}: ${JSON.stringify(await announcements(casePage, needle))}`));
  const tapBar = (casePage, label) => casePage.$eval(`.audio-bar button[aria-label="${label}"]`, (node) => node.click());
  const setTextScale = (casePage, scale) => casePage.evaluate((factor) => new Promise((resolve) => {
    document.documentElement.style.fontSize = factor === 1 ? "" : `${16 * factor}px`;
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }), scale);
  const storeBookmark = (casePage, snippet) => casePage.evaluate((id, text) => localStorage.setItem("lumen-audio-bookmarks-v1", JSON.stringify([{
    id: "ab-97", documentId: id, v: 2, index: 6, total: 0, snippet: text, section: "", savedAt: new Date().toISOString(),
  }])), documentId, snippet);
  const chooseTheme = async (casePage, label) => {
    await casePage.$eval('button[aria-label="Open settings"]', (node) => node.click());
    await casePage.waitForSelector(".settings-drawer .theme-choices", { timeout: 10_000 });
    await clickByText(casePage, ".theme-choices button", label);
    await casePage.$eval(".settings-close", (node) => node.click());
    await casePage.waitForSelector(".settings-drawer", { hidden: true, timeout: 5_000 });
    await delay(450);
  };

  // ND4, NM9: with the panel closed, a failed sentence, an interruption and
  // leaving the foreground keep the player, show the message there, and are
  // announced once each by the Reader's own live region.
  const startAtSentenceTwo = async (casePage) => {
    await openLecture(casePage);
    await startFullLecture(casePage);
    await casePage.$eval('button[aria-label="Next narration sentence"]', (node) => node.click());
    await waitForPosition(casePage, 2, "Next did not reach sentence 2");
  };
  await issue97Case("synthesis-failed with the panel closed", {}, async (casePage) => {
    await startAtSentenceTwo(casePage);
    const failure = "This sentence could not be spoken (synthesis failed). Tap Retry to try it again.";
    const focusedLabel = () => casePage.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName);
    // A keyboard user on Pause: focus follows the play control to Retry.
    await casePage.$eval('.audio-bar button[aria-label="Pause narration"]', (node) => node.focus());
    const failed = await failSentence(casePage, "synthesis-failed");
    await casePage.waitForSelector('.audio-bar button[aria-label="Retry narration"]', { timeout: 5_000 })
      .catch(async () => assert.fail(`after synthesis-failed the player ${await casePage.$(".audio-bar") ? "offers no Retry" : "disappeared"}`));
    assert.equal(await focusedLabel(), "Retry narration", "focus on Pause did not move to Retry when the sentence failed");
    assert.ok((await barMessage(casePage)).includes(failure), `the player does not show “${failure}”: “${await barMessage(casePage)}”`);
    assert.equal(await casePage.$eval('.audio-bar button[aria-label="Retry narration"]', (node) => node.nextElementSibling?.getAttribute("aria-label")), "Stop narration", "Retry is not next to Stop");
    const failureRegions = await announcements(casePage, failure);
    assert.deepEqual(failureRegions, narratorRegion("alert"), `synthesis-failed was announced as ${JSON.stringify(failureRegions)}`);
    // A tooltip names the same action as the button's name.
    const tooltips = await casePage.$$eval(".audio-bar button[title]", (buttons) => buttons.filter((button) => button.title !== button.getAttribute("aria-label")).map((button) => `${button.getAttribute("aria-label")} titled “${button.title}”`));
    assert.deepEqual(tooltips, [], `player tooltips differ from their names: ${tooltips.join(", ")}`);
    await casePage.keyboard.press("Enter");
    await casePage.waitForSelector('.audio-bar button[aria-label="Pause narration"]', { timeout: 5_000 })
      .catch(() => assert.fail("Retry did not resume narration"));
    assert.equal(await focusedLabel(), "Pause narration", "focus on Retry did not move back to Pause when narration resumed");
    await waitForSpoken(casePage, failed, "Retry did not replay the sentence that failed");
    assert.equal((await barPosition(casePage)).current, 2, "Retry moved away from the sentence that failed");
    await waitUnannounced(casePage, failure, "the failure stayed announced after Retry");
    // Stop from the keyboard: the player leaves and focus goes to Listen.
    await casePage.$eval('.audio-bar button[aria-label="Stop narration"]', (node) => node.focus());
    await casePage.keyboard.press("Enter");
    await casePage.waitForFunction(() => !document.querySelector(".audio-bar"), { timeout: 5_000 });
    await delay(50);
    assert.equal(await focusedLabel(), "Listen", "after Stop from the player, focus did not go to Listen");
  });

  await issue97Case("interrupted with the panel closed", {}, async (casePage) => {
    await startAtSentenceTwo(casePage);
    const interruption = "Narration was interrupted.";
    const interrupted = await failSentence(casePage, "interrupted");
    await casePage.waitForSelector('.audio-bar button[aria-label="Resume narration"]', { timeout: 5_000 })
      .catch(() => assert.fail("an interruption did not leave the player paused"));
    assert.ok((await barMessage(casePage)).includes(interruption), `the player does not show “${interruption}”`);
    const interruptionRegions = await announcements(casePage, interruption);
    assert.deepEqual(interruptionRegions, narratorRegion("status"), `an interruption was announced as ${JSON.stringify(interruptionRegions)}`);
    await casePage.$eval('button[aria-label="Resume narration"]', (node) => node.click());
    await casePage.waitForSelector('.audio-bar button[aria-label="Pause narration"]', { timeout: 5_000 });
    await waitForSpoken(casePage, interrupted, "Resume did not replay the interrupted sentence");
    await waitUnannounced(casePage, interruption, "the interruption stayed announced after Resume");
  });

  await issue97Case("pagehide with the panel closed", {}, async (casePage) => {
    await startAtSentenceTwo(casePage);
    const background = "Playback paused when Lumen left the foreground.";
    await casePage.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await casePage.waitForSelector('.audio-bar button[aria-label="Resume narration"]', { timeout: 5_000 })
      .catch(() => assert.fail("pagehide did not leave the player paused"));
    assert.ok((await barMessage(casePage)).includes(background), `the player does not show “${background}”`);
    const backgroundRegions = await announcements(casePage, background);
    assert.deepEqual(backgroundRegions, narratorRegion("status"), `pagehide was announced as ${JSON.stringify(backgroundRegions)}`);
    // Leaving the foreground also reports visibilitychange: still one
    // announcement, not a second copy of the same message.
    await casePage.evaluate(() => {
      document.querySelector(".narration-live[role='status'] span")?.setAttribute("data-first", "");
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await delay(150);
    const repeated = await casePage.evaluate(() => {
      delete document.visibilityState;
      const spans = [...document.querySelectorAll(".narration-live[role='status'] span")];
      return { spans: spans.length, same: spans[0]?.hasAttribute("data-first") === true };
    });
    assert.deepEqual(repeated, { spans: 1, same: true }, `visibilitychange after pagehide announced the pause again: ${JSON.stringify(repeated)}`);
  });

  // Sleep expiry ends the session and the player with it: one toast, read
  // by the app's toast announcer and not by the Reader's region.
  await issue97Case("sleep expiry with the panel closed", {}, async (casePage) => {
    await openLecture(casePage);
    await openPanel(casePage);
    await clickByText(casePage, ".speech-sleep-row button", "10 min");
    await startFullLecture(casePage);
    await shiftClock(casePage, 11);
    await casePage.evaluate(() => window.speechSynthesis.current.onend());
    await casePage.waitForFunction(() => !document.querySelector(".audio-bar"), { timeout: 5_000 })
      .catch(() => assert.fail("the sleep timer did not end narration"));
    const message = "The sleep timer ended narration at a sentence boundary.";
    await casePage.waitForFunction((text) => [...document.querySelectorAll(".toast")].some((node) => node.textContent.includes(text)), { timeout: 5_000 }, message)
      .catch(() => assert.fail("the sleep timer ended narration without a toast"));
    const regions = await announcements(casePage, message);
    assert.deepEqual(regions, [{ region: "visually-hidden toast-live toast-live--polite", role: "status", count: 1 }], `sleep expiry was announced as ${JSON.stringify(regions)}`);
  });

  // The open panel shows the sentence being read but never announces it.
  await issue97Case("the open panel while speaking", {}, async (casePage) => {
    await openLecture(casePage);
    await startFullLecture(casePage);
    await openPanel(casePage);
    await casePage.$eval('.speech-controls button[aria-label="Next narration sentence"]', (node) => node.click());
    await waitForPosition(casePage, 2, "Next in the panel did not reach sentence 2");
    const spoken = (await casePage.evaluate(() => window.speechSynthesis.current.text)).slice(0, 50);
    const panel = await casePage.$eval(".speech-popover .speech-live", (node) => ({
      role: node.getAttribute("role"),
      live: node.getAttribute("aria-live"),
      insideLive: Boolean(node.parentElement.closest("[aria-live], [role='status'], [role='alert'], [role='log']")),
      shows: node.textContent,
    }));
    assert.ok(panel.shows.includes(spoken), `the panel no longer shows the sentence being read: “${panel.shows.slice(0, 80)}”`);
    assert.deepEqual({ role: panel.role, live: panel.live, insideLive: panel.insideLive }, { role: null, live: null, insideLive: false }, "the panel's sentence display is a live region");
    const regions = await announcements(casePage, spoken);
    assert.deepEqual(regions, [], `the spoken sentence is in a live region: ${JSON.stringify(regions)}`);
  });

  // ND7: a 160-character bookmark ellipsizes; the panel never scrolls
  // sideways and Delete stays inside it (#96 fixed the grid track).
  await issue97Case("a 160-character bookmark", {}, async (casePage) => {
    await openLecture(casePage);
    const snippet = "An intelligent product observes some context, chooses an action, and is judged by the consequences of that action, so every design choice starts from its data too.".slice(0, 160);
    assert.equal(snippet.length, 160);
    await storeBookmark(casePage, snippet);
    await casePage.reload({ waitUntil: "networkidle2", timeout: 30_000 });
    await casePage.waitForSelector(".markdown-body h1", { timeout: 15_000 });
    for (const [label, viewport, scale] of [["393 px", phoneViewport, 1], ["320 px", { ...phoneViewport, width: 320, height: 568 }, 1], ["320 px at 200% text", { ...phoneViewport, width: 320, height: 568 }, 2], ["1280 px", desktopViewport, 1]]) {
      // Leaving phone emulation reloads the page.
      await casePage.setViewport(viewport);
      await casePage.waitForSelector(".markdown-body h1", { timeout: 15_000 });
      await setTextScale(casePage, scale);
      await openPanel(casePage);
      await casePage.waitForSelector(".speech-bookmarks .speech-bookmark-play", { timeout: 5_000 });
      const layout = await casePage.evaluate(() => {
        const panel = document.querySelector(".speech-popover");
        const frame = panel.getBoundingClientRect();
        const remove = panel.querySelector('button[aria-label="Delete this audio bookmark"]').getBoundingClientRect();
        return { scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth, panel: [Math.round(frame.left), Math.round(frame.right)], remove: [Math.round(remove.left), Math.round(remove.right)] };
      });
      assert.ok(layout.scrollWidth <= layout.clientWidth, `at ${label} the panel scrolls sideways: ${JSON.stringify(layout)}`);
      assert.ok(layout.remove[0] >= layout.panel[0] && layout.remove[1] <= layout.panel[1], `at ${label} Delete is outside the panel: ${JSON.stringify(layout)}`);
      await casePage.$eval('button[aria-label="Close narration"]', (node) => node.click());
    }
  });

  // ND8: at the end of the lecture the Next card scrolls clear of the
  // player, including when a message makes the player taller, a long message
  // at 200% text on a small phone, and in phone landscape, where the
  // lecture's own end space and the player's must not add up. In short
  // landscape at 200% text (568×320, 667×375) the strip between the reader
  // toolbar and the player is shorter than the card: the card's centre stays
  // in that strip, not under the toolbar, at least 40px of it shows (the
  // player gives back its spare padding there), and a real tap on it opens
  // the next lecture.
  await issue97Case("the Next card with the player visible", {}, async (casePage) => {
    await openLecture(casePage);
    await startFullLecture(casePage);
    const nextCardHit = () => casePage.evaluate(async () => {
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const scroller = document.querySelector(".reader-scroll");
      for (let pass = 0; pass < 3; pass += 1) {
        scroller.scrollTop = scroller.scrollHeight;
        await frame();
      }
      const card = document.querySelector(".document-pagination .next");
      const box = card.getBoundingClientRect();
      const bar = document.querySelector(".audio-bar").getBoundingClientRect();
      const toolbar = document.querySelector(".reader-toolbar").getBoundingClientRect().bottom;
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        onCard: Boolean(hit && card.contains(hit)),
        hit: hit?.className || hit?.tagName || null,
        card: [Math.round(box.top), Math.round(box.bottom)],
        bar: [Math.round(bar.top), Math.round(bar.bottom)],
        toolbar: Math.round(toolbar),
        visible: Math.round(Math.min(box.bottom, bar.top) - Math.max(box.top, toolbar)),
        whole: Math.round(box.height),
        centre: [box.left + box.width / 2, box.top + box.height / 2],
      };
    });
    const problems = [];
    const shown = (label, state, where) => {
      if (!where.onCard) problems.push(`at ${label} the player${state} covers the Next card's centre or it is under the reader toolbar: ${JSON.stringify(where)}`);
      else if (where.visible < Math.min(40, where.whole)) problems.push(`at ${label} only ${where.visible}px of the Next card shows between the reader toolbar and the player${state}: ${JSON.stringify(where)}`);
    };
    const sizes = [
      ["393×852", phoneViewport, 1, "synthesis-failed"],
      ["320×568", { ...phoneViewport, width: 320, height: 568 }, 1, "synthesis-failed"],
      ["393×852 at 200% text", phoneViewport, 2, "synthesis-failed"],
      ["320×568 at 200% text", { ...phoneViewport, width: 320, height: 568 }, 2, "pagehide"],
      ["667×375", { ...phoneViewport, width: 667, height: 375 }, 1, "synthesis-failed"],
      ["852×393", { ...phoneViewport, width: 852, height: 393 }, 1, "pagehide"],
      ["667×375 at 200% text", { ...phoneViewport, width: 667, height: 375 }, 2, "pagehide"],
      ["568×320 at 200% text", { ...phoneViewport, width: 568, height: 320 }, 2, "synthesis-failed"],
    ];
    for (const [index, [label, viewport, scale, message]] of sizes.entries()) {
      await casePage.setViewport(viewport);
      await setTextScale(casePage, scale);
      shown(label, "", await nextCardHit());
      if (message === "pagehide") {
        await casePage.evaluate(() => window.dispatchEvent(new Event("pagehide")));
        await casePage.waitForSelector('.audio-bar button[aria-label="Resume narration"]', { timeout: 5_000 });
      } else {
        await failSentence(casePage, message);
        await casePage.waitForSelector('.audio-bar button[aria-label="Retry narration"]', { timeout: 5_000 });
      }
      const withMessage = await nextCardHit();
      shown(label, ` with the ${message} message`, withMessage);
      if (index === sizes.length - 1) {
        // A learner's tap where the card's centre shows opens the next lecture.
        const before = await casePage.evaluate(() => window.location.hash);
        await casePage.touchscreen.tap(...withMessage.centre);
        const opened = await casePage.waitForFunction((hash) => window.location.hash !== hash, { timeout: 5_000 }, before).then(() => true, () => false);
        if (!opened) problems.push(`at ${label} a tap on the Next card's centre with the ${message} message did not open the next lecture: ${JSON.stringify(withMessage)}`);
        break;
      }
      await tapBar(casePage, message === "pagehide" ? "Resume narration" : "Retry narration");
      await casePage.waitForSelector('.audio-bar button[aria-label="Pause narration"]', { timeout: 5_000 });
    }
    assert.deepEqual(problems, [], problems.join("; "));
  });

  // NU4, NM5, NU17: 44px controls and readable text on phones, one row of
  // player controls down to 320px, no sideways scroll at 200% text.
  await issue97Case("narration control sizes on phones", {}, async (casePage) => {
    const problems = [];
    await openLecture(casePage);
    await storeBookmark(casePage, "A saved sentence.");
    await casePage.reload({ waitUntil: "networkidle2", timeout: 30_000 });
    await casePage.waitForSelector(".markdown-body h1", { timeout: 15_000 });
    // Contrast draws a 2px edge, the tightest fit for the player at 320px.
    for (const [label, viewport, theme] of [["393 px", phoneViewport], ["320 px", { ...phoneViewport, width: 320, height: 568 }], ["320 px in Contrast", { ...phoneViewport, width: 320, height: 568 }, "Contrast"]]) {
      await casePage.setViewport(viewport);
      await setTextScale(casePage, 1);
      if (theme) await chooseTheme(casePage, theme);
      // A selection shows the Selection tile's "Ready" badge.
      await casePage.$eval(".markdown-body", (article) => {
        const paragraph = [...article.querySelectorAll("p")].find((node) => node.textContent.trim().length > 100);
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      });
      await delay(150);
      await openPanel(casePage);
      await casePage.waitForSelector(".speech-scope-grid button span", { timeout: 5_000 });
      const panel = await casePage.evaluate(() => {
        const panelNode = document.querySelector(".speech-popover");
        const height = (node) => Math.round(node.getBoundingClientRect().height * 10) / 10;
        const size = (node) => Number.parseFloat(getComputedStyle(node).fontSize);
        const controls = {
          Close: panelNode.querySelector('button[aria-label="Close narration"]'),
          "sleep chip": panelNode.querySelector(".speech-sleep-row[role='radiogroup'] button"),
          "playlist switch row": panelNode.querySelector(".speech-autoadvance-row .setting-toggle"),
          "bookmark row": panelNode.querySelector(".speech-bookmark-play"),
          "bookmark Delete": panelNode.querySelector('button[aria-label="Delete this audio bookmark"]'),
          "speed preset": panelNode.querySelector(".speech-preset-row button"),
        };
        const texts = {
          "target status": [panelNode.querySelector(".speech-target-status"), 12],
          "preset label": [panelNode.querySelector(".speech-preset-row button"), 12],
          "sleep chip": [panelNode.querySelector(".speech-sleep-row[role='radiogroup'] button"), 12],
          "playlist label": [panelNode.querySelector(".speech-autoadvance-row .setting-toggle span"), 12],
          "preset multiplier": [panelNode.querySelector(".speech-preset-row button span"), 11],
          "Ready badge": [panelNode.querySelector(".speech-scope-grid button span"), 11],
        };
        return {
          short: Object.entries(controls).filter(([, node]) => !node || height(node) < 44).map(([name, node]) => `${name} ${node ? height(node) : "missing"}px`),
          small: Object.entries(texts).filter(([, [node, minimum]]) => !node || size(node) < minimum).map(([name, [node, minimum]]) => `${name} ${node ? size(node) : "missing"}px (needs ${minimum})`),
          playlistBorder: getComputedStyle(controls["playlist switch row"]).borderTopWidth,
        };
      });
      if (panel.short.length) problems.push(`at ${label} panel controls under 44px tall: ${panel.short.join(", ")}`);
      if (panel.small.length) problems.push(`at ${label} panel text too small: ${panel.small.join(", ")}`);
      if (panel.playlistBorder !== "0px") problems.push(`at ${label} the Playlist row draws the settings divider (${panel.playlistBorder})`);
      await casePage.$eval('button[aria-label="Close narration"]', (node) => node.click());
      await casePage.evaluate(() => getSelection().removeAllRanges());
      await startFullLecture(casePage);
      for (const state of ["speaking", "error"]) {
        if (state === "error") {
          await failSentence(casePage, "synthesis-failed");
          if (!await casePage.waitForSelector('.audio-bar button[aria-label="Retry narration"]', { timeout: 5_000 }).catch(() => null)) {
            problems.push(`at ${label} a failed sentence leaves no player to measure`);
            break;
          }
        }
        const bar = await casePage.$eval(".audio-bar", (node) => {
          const frame = node.getBoundingClientRect();
          const buttons = [...node.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
          return {
            count: buttons.length,
            sizes: buttons.map((box) => [Math.round(box.width), Math.round(box.height)]),
            rows: new Set(buttons.map((box) => Math.round(box.top))).size,
            inside: frame.left >= 0 && frame.right <= document.documentElement.clientWidth,
            label: Number.parseFloat(getComputedStyle(node.querySelector(".audio-label strong")).fontSize),
          };
        });
        if (bar.count !== 7) problems.push(`at ${label} the ${state} player has ${bar.count} controls, not 7`);
        if (!bar.sizes.every(([width, height]) => width >= 40 && height >= 44)) problems.push(`at ${label} ${state} player controls under 44px tall or 40px wide: ${bar.sizes.map((size) => size.join("×")).join(", ")}`);
        if (bar.rows !== 1) problems.push(`at ${label} the ${state} player's controls wrap onto ${bar.rows} rows`);
        if (!bar.inside) problems.push(`at ${label} the ${state} player runs off screen`);
        if (bar.label < 12) problems.push(`at ${label} the ${state} player's label is ${bar.label}px`);
      }
      await casePage.evaluate(() => document.querySelector('button[aria-label="Stop narration"]')?.click());
    }
    // 200% text: no sideways page scroll with the player or the panel open.
    for (const width of [393, 320]) {
      await casePage.setViewport({ ...phoneViewport, width, height: width === 320 ? 568 : 852 });
      await setTextScale(casePage, 2);
      await startFullLecture(casePage);
      await openPanel(casePage);
      const overflow = await casePage.evaluate(() => ({
        page: document.scrollingElement.scrollWidth - document.documentElement.clientWidth,
        panel: document.querySelector(".speech-popover").scrollWidth - document.querySelector(".speech-popover").clientWidth,
      }));
      if (overflow.page > 0 || overflow.panel > 0) problems.push(`at ${width} px with 200% text narration scrolls sideways: ${JSON.stringify(overflow)}`);
      await casePage.$eval('button[aria-label="Close narration"]', (node) => node.click());
      await casePage.$eval('button[aria-label="Stop narration"]', (node) => node.click());
    }
    assert.deepEqual(problems, [], problems.join("; "));
  });

  // The player's place (review of #97): its buttons stay clear of the bottom
  // navigation, which shows up to 980px wide and grows with larger text; at
  // 200% text a message keeps the player below the reader toolbar and on
  // screen; and a toast rises above a player that holds a message.
  await issue97Case("the player's place on small, landscape and tablet screens", {}, async (casePage) => {
    const problems = [];
    await openLecture(casePage);
    const place = () => casePage.evaluate(() => {
      const box = (node) => node.getBoundingClientRect();
      const bar = document.querySelector(".audio-bar");
      const frame = box(bar);
      const label = box(bar.querySelector(".audio-label"));
      // Each button is hit at its centre and just above its bottom edge.
      const covered = [...bar.querySelectorAll("button")].filter((button) => {
        const target = box(button);
        const x = target.left + target.width / 2;
        return ![target.top + target.height / 2, target.bottom - 2].every((y) => button.contains(document.elementFromPoint(x, y)));
      }).map((button) => {
        const target = box(button);
        const cover = document.elementFromPoint(target.left + target.width / 2, target.bottom - 2);
        return `${button.getAttribute("aria-label")} (under ${cover?.closest("nav")?.getAttribute("aria-label") || cover?.className || cover?.tagName})`;
      });
      return { top: Math.round(frame.top), bottom: Math.round(frame.bottom), toolbar: Math.round(box(document.querySelector(".reader-toolbar")).bottom), labelInside: label.top >= 0 && label.bottom <= innerHeight, covered };
    });
    for (const [label, viewport, scale] of [
      ["852×393", { ...phoneViewport, width: 852, height: 393 }, 1],
      ["820×1180", { ...phoneViewport, width: 820, height: 1180 }, 1],
      ["393×852 at 200% text", phoneViewport, 2],
      ["320×568 at 200% text", { ...phoneViewport, width: 320, height: 568 }, 2],
      ["667×375 at 200% text", { ...phoneViewport, width: 667, height: 375 }, 2],
      ["568×320 at 200% text", { ...phoneViewport, width: 568, height: 320 }, 2],
    ]) {
      await casePage.setViewport(viewport);
      await setTextScale(casePage, scale);
      await startFullLecture(casePage);
      for (const state of ["speaking", "background"]) {
        if (state === "background") {
          await casePage.evaluate(() => window.dispatchEvent(new Event("pagehide")));
          await casePage.waitForSelector('.audio-bar button[aria-label="Resume narration"]', { timeout: 5_000 });
        }
        await casePage.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const where = await place();
        if (where.covered.length) problems.push(`at ${label} ${state}, the bottom navigation covers ${where.covered.join(", ")}`);
        if (where.top < where.toolbar || !where.labelInside) problems.push(`at ${label} ${state}, the player reaches the reader toolbar or leaves the screen: ${JSON.stringify(where)}`);
      }
      await tapBar(casePage, "Stop narration");
    }
    // A bookmark toast over a player that holds the background message.
    await casePage.setViewport({ ...phoneViewport, width: 320, height: 568 });
    await setTextScale(casePage, 1);
    await startFullLecture(casePage);
    await casePage.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await casePage.waitForSelector('.audio-bar button[aria-label="Resume narration"]', { timeout: 5_000 });
    await tapBar(casePage, "Bookmark this sentence");
    await casePage.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("bookmarked"), { timeout: 5_000 });
    await delay(300);
    const stack = await casePage.evaluate(() => ({ toast: Math.round(document.querySelector(".toast").getBoundingClientRect().bottom), bar: Math.round(document.querySelector(".audio-bar").getBoundingClientRect().top) }));
    if (stack.toast > stack.bar) problems.push(`at 320×568 a toast overlaps the player holding a message: ${JSON.stringify(stack)}`);
    assert.deepEqual(problems, [], problems.join("; "));
  });

  // A message about narration that keeps playing is announced while Settings
  // or the phone menu hides the page, once: the announcer sits outside the
  // page, and closing Settings does not announce it again.
  await issue97Case("messages while Settings or the menu covers the Reader", {}, async (casePage) => {
    const exposure = (needle) => casePage.evaluate((text) => [...document.querySelectorAll(".narration-live")]
      .filter((node) => node.textContent.includes(text))
      .map((node) => ({ role: node.getAttribute("role"), hiddenBy: node.closest("[inert], [aria-hidden='true']")?.className || node.closest("[inert], [aria-hidden='true']")?.id || null })), needle);
    const reached = (needle, message) => casePage.waitForFunction((text) => [...document.querySelectorAll(".narration-live")].some((node) => node.textContent.includes(text)), { timeout: 5_000 }, needle)
      .catch(() => assert.fail(message));
    await openLecture(casePage);
    await startFullLecture(casePage);
    await casePage.$eval('button[aria-label="Open settings"]', (node) => node.click());
    await casePage.waitForSelector(".settings-drawer", { timeout: 10_000 });
    const interruption = "Narration was interrupted.";
    await failSentence(casePage, "interrupted");
    await reached(interruption, "an interruption behind Settings reached no narration region");
    assert.deepEqual(await exposure(interruption), [{ role: "status", hiddenBy: null }], "an interruption behind Settings is hidden from assistive technology");
    assert.deepEqual(await announcements(casePage, interruption), narratorRegion("status"), "an interruption behind Settings was not announced exactly once");
    await casePage.evaluate(() => {
      window.__narrationChanges = 0;
      new MutationObserver((records) => { window.__narrationChanges += records.length; }).observe(document.querySelector(".narration-live[role='status']"), { childList: true, subtree: true, characterData: true });
    });
    await casePage.$eval(".settings-close", (node) => node.click());
    await casePage.waitForSelector(".settings-drawer", { hidden: true, timeout: 5_000 });
    await delay(150);
    assert.equal(await casePage.evaluate(() => window.__narrationChanges), 0, "closing Settings announced the interruption again");
    // The phone menu makes the whole page inert.
    await tapBar(casePage, "Resume narration");
    await casePage.waitForSelector('.audio-bar button[aria-label="Pause narration"]', { timeout: 5_000 });
    await casePage.$eval('button[aria-label="Open menu"]', (node) => node.click());
    await casePage.waitForFunction(() => document.querySelector(".app-sidebar.open") && document.querySelector(".app-main")?.inert, { timeout: 5_000 });
    const failure = "This sentence could not be spoken (synthesis failed).";
    await failSentence(casePage, "synthesis-failed");
    await reached(failure, "a failure behind the phone menu reached no narration region");
    assert.deepEqual(await exposure(failure), [{ role: "alert", hiddenBy: null }], "a failure behind the phone menu is hidden from assistive technology");
  });

  // A lecture still playing after browser Back left the Reader has no player
  // on the new screen: its message is a toast, announced once by the toast
  // announcer. That screen has no Retry or Resume, and opening the lecture
  // again stops the old session, so the toast names neither control.
  await issue97Case("a message after leaving the Reader", {}, async (casePage) => {
    const problems = [];
    for (const [kind, message, trigger, region] of [
      ["a failure", "This sentence could not be spoken (synthesis failed).", () => failSentence(casePage, "synthesis-failed"), { region: "visually-hidden toast-live toast-live--assertive", role: "alert", count: 1 }],
      ["an interruption", "Narration was interrupted.", () => failSentence(casePage, "interrupted"), { region: "visually-hidden toast-live toast-live--polite", role: "status", count: 1 }],
      ["a background pause", "Playback paused when Lumen left the foreground.", () => casePage.evaluate(() => window.dispatchEvent(new Event("pagehide"))), { region: "visually-hidden toast-live toast-live--polite", role: "status", count: 1 }],
    ]) {
      // A fresh load each time, so no earlier toast or session is left over.
      await casePage.goto("about:blank");
      await casePage.goto(`${baseUrl}#/library`, { waitUntil: "networkidle2", timeout: 30_000 });
      await casePage.waitForSelector(".library-page", { timeout: 15_000 });
      await casePage.evaluate((hash) => { window.location.hash = hash; }, `#/read/${encodeURIComponent(documentId)}`);
      await casePage.waitForSelector(".markdown-body h1", { timeout: 15_000 });
      await startFullLecture(casePage);
      await casePage.evaluate(() => history.back());
      await casePage.waitForSelector(".library-page", { timeout: 10_000 });
      await trigger();
      const toast = await casePage.waitForFunction((text) => [...document.querySelectorAll(".toast")].find((node) => node.textContent.includes(text))?.textContent, { timeout: 5_000 }, message)
        .then((handle) => handle.jsonValue(), () => null);
      if (!toast) {
        problems.push(`${kind} after leaving the Reader showed no toast`);
        continue;
      }
      const regions = await announcements(casePage, message);
      if (JSON.stringify(regions) !== JSON.stringify([region])) problems.push(`${kind} after leaving the Reader was announced as ${JSON.stringify(regions)}`);
      if (/\b(?:Retry|Resume)\b|\bTap\b/u.test(toast)) problems.push(`${kind} after leaving the Reader names a control the screen does not show: “${toast}”`);
      if (!toast.includes("Open the lecture to listen again.")) problems.push(`${kind} after leaving the Reader does not say how to listen again: “${toast}”`);
    }
    assert.deepEqual(problems, [], problems.join("; "));
  });

  // After a failed sentence the Listen panel offers what the player offers:
  // Retry in place of Pause, with Previous, Next and Stop; its message is at
  // the panel's 12px phone text size.
  await issue97Case("the Listen panel on a failed sentence", {}, async (casePage) => {
    await startAtSentenceTwo(casePage);
    const failed = await failSentence(casePage, "synthesis-failed");
    await casePage.waitForSelector('.audio-bar button[aria-label="Retry narration"]', { timeout: 5_000 });
    await openPanel(casePage);
    await casePage.waitForSelector(".speech-popover .inline-warning", { timeout: 5_000 });
    const panel = await casePage.$eval(".speech-popover", (node) => ({
      controls: [...node.querySelectorAll(".speech-controls button")].map((button) => (button.getAttribute("aria-label") || button.textContent).trim()),
      message: Number.parseFloat(getComputedStyle(node.querySelector(".inline-warning")).fontSize),
    }));
    assert.deepEqual(panel.controls, ["Previous narration sentence", "Retry", "Next narration sentence", "Stop"], `the panel on a failed sentence offers ${panel.controls.join(", ")}`);
    assert.ok(panel.message >= 12, `the panel shows the message at ${panel.message}px`);
    await clickByText(casePage, ".speech-controls button", "Retry");
    await waitForSpoken(casePage, failed, "Retry in the panel did not replay the sentence that failed");
    assert.equal((await barPosition(casePage)).current, 2, "Retry in the panel moved away from the sentence that failed");
  });

  // Retry and Next on a failed sentence are deliberate taps: past the sleep
  // deadline they re-arm the timer, so narration continues past the next
  // sentence boundary instead of ending there.
  await issue97Case("Retry and Next past the sleep deadline", {}, async (casePage) => {
    await openLecture(casePage);
    await openPanel(casePage);
    await clickByText(casePage, ".speech-sleep-row button", "10 min");
    await startFullLecture(casePage);
    for (const action of ["Retry narration", "Next narration sentence"]) {
      const { current } = await barPosition(casePage);
      const failed = await failSentence(casePage, "synthesis-failed");
      await casePage.waitForSelector('.audio-bar button[aria-label="Retry narration"]', { timeout: 5_000 });
      await shiftClock(casePage, 11);
      await tapBar(casePage, action);
      const played = action === "Retry narration" ? current : current + 1;
      await waitForPosition(casePage, played, `${action} past the sleep deadline did not play sentence ${played}`);
      if (action === "Retry narration") await waitForSpoken(casePage, failed, "Retry past the sleep deadline did not replay the sentence that failed");
      await casePage.evaluate(() => window.speechSynthesis.current.onend());
      await waitForPosition(casePage, played + 1, `after ${action} past the sleep deadline, narration ended at the next sentence boundary`);
    }
    const toasts = await toastTexts(casePage);
    assert.ok(!toasts.some((text) => text.includes("sleep timer ended")), `the sleep timer ended narration after a deliberate tap: “${toasts.join(" | ")}”`);
  });

  // Teaching Mode after a failed sentence: the player is under the slide, so
  // the footer shows the message, and the narration control is Retry, which
  // replays that sentence.
  await issue97Case("Teaching Mode after a failed sentence", {}, async (casePage) => {
    await openLecture(casePage);
    await clickByText(casePage, ".document-tools button", "Teach");
    await casePage.waitForSelector(".teach-mode [data-teach-narrate]", { timeout: 10_000 });
    await casePage.$eval(".teach-mode [data-teach-narrate]", (node) => node.click());
    const failed = await failSentence(casePage, "synthesis-failed");
    await casePage.waitForFunction(() => document.querySelector(".teach-mode [data-teach-narrate]")?.getAttribute("aria-label") !== "Pause narration", { timeout: 5_000 });
    const teaching = await casePage.$eval(".teach-mode", (node) => ({ control: node.querySelector("[data-teach-narrate]").getAttribute("aria-label"), footer: node.querySelector(".teach-footer").textContent }));
    assert.equal(teaching.control, "Retry narration", "Teaching Mode's narration control does not offer Retry on a failed sentence");
    assert.ok(teaching.footer.includes("This sentence could not be spoken"), `Teaching Mode shows no message for the failed sentence: “${teaching.footer.trim()}”`);
    await casePage.$eval(".teach-mode [data-teach-narrate]", (node) => node.click());
    await waitForSpoken(casePage, failed, "Retry in Teaching Mode did not replay the sentence that failed");
    await casePage.waitForFunction(() => !document.querySelector(".teach-footer")?.textContent.includes("could not be spoken"), { timeout: 5_000 })
      .catch(() => assert.fail("Teaching Mode kept the failure message after Retry"));
  });

  // NM4: Review reads 1.25×, and the slider can hold 1.25.
  await issue97Case("the Review speed", {}, async (casePage) => {
    await openLecture(casePage);
    await openPanel(casePage);
    await clickByText(casePage, ".speech-preset-row button", "Review");
    await casePage.waitForFunction(() => document.querySelector(".speech-preset-row button.active")?.textContent.includes("Review"), { timeout: 5_000 });
    const speed = await casePage.evaluate(() => ({
      output: document.querySelector(".speech-range-grid label output")?.textContent,
      slider: document.querySelector('input[aria-label="Narration speed"]').value,
      preset: document.querySelector(".speech-preset-row button.active span")?.textContent,
    }));
    assert.deepEqual(speed, { output: "1.25×", slider: "1.25", preset: "1.25×" }, `Review showed ${JSON.stringify(speed)}`);
  });

  // A target over the 500,000-character limit (a bookmark plays the full
  // lecture, even mid-reading) replaces the reading in progress: the old
  // queue stops, so the player never offers Retry for it, and the panel
  // keeps the message, announced once.
  await issue97Case("an over-long target while reading", {}, async (casePage) => {
    await casePage.goto(`${baseUrl}#/notebook`, { waitUntil: "networkidle2", timeout: 30_000 });
    await casePage.waitForSelector('.notebook-actions input[type="file"]', { timeout: 15_000 });
    await casePage.$eval('.notebook-actions input[type="file"]', (input) => {
      const paragraph = "This sentence keeps the lecture long enough to pass the read-aloud limit. ".repeat(40);
      const body = Array.from({ length: 180 }, (_, index) => `## Part ${index + 1}\n\n${paragraph}\n`).join("\n");
      const transfer = new DataTransfer();
      transfer.items.add(new File([`# Very Long Lecture\n\n${body}`], "very-long-lecture.md", { type: "text/markdown" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await casePage.waitForFunction(() => [...document.querySelectorAll(".notebook-document-row .document-card")].some((card) => card.textContent.includes("Very Long Lecture")), { timeout: 15_000 });
    await casePage.$$eval(".notebook-document-row .document-card", (cards) => cards.find((card) => card.textContent.includes("Very Long Lecture")).click());
    await casePage.waitForFunction(() => document.querySelector(".markdown-body h1")?.textContent.includes("Very Long Lecture"), { timeout: 20_000 });
    const longId = await casePage.evaluate(() => decodeURIComponent(window.location.hash.replace(/^#\/read\//u, "")));
    await casePage.evaluate((id) => localStorage.setItem("lumen-audio-bookmarks-v1", JSON.stringify([{ id: "ab-long-97", documentId: id, v: 2, index: 3, total: 0, snippet: "This sentence keeps the lecture long", section: "", savedAt: new Date().toISOString() }])), longId);
    // Reload (to list the bookmark) only once the upload is saved.
    for (let attempt = 0; attempt < 50 && !(await readStoredProfile(casePage))?.customDocuments?.some((doc) => doc.id === longId); attempt += 1) await delay(200);
    await casePage.reload({ waitUntil: "networkidle2", timeout: 30_000 });
    await casePage.waitForFunction(() => document.querySelector(".markdown-body h1")?.textContent.includes("Very Long Lecture"), { timeout: 20_000 });
    await openPanel(casePage);
    await chooseScope(casePage, "Section", "current section");
    await clickByText(casePage, ".speech-controls button", "Read current section");
    await waitForBar(casePage, "section narration did not start");
    await openPanel(casePage);
    await casePage.$eval(".speech-bookmarks .speech-bookmark-play", (node) => node.click());
    const message = "This reading target exceeds 500,000 characters.";
    await casePage.waitForFunction((text) => document.querySelector(".speech-popover .speech-live")?.textContent.includes(text), { timeout: 5_000 }, message)
      .catch(() => assert.fail("an over-long target left no message in the panel"));
    await delay(150);
    const after = await casePage.evaluate(() => ({ player: Boolean(document.querySelector(".audio-bar")), speaking: Boolean(window.speechSynthesis.current) }));
    assert.deepEqual(after, { player: false, speaking: false }, `an over-long target left the previous reading behind: ${JSON.stringify(after)}`);
    const regions = await announcements(casePage, message);
    assert.deepEqual(regions, narratorRegion("alert"), `the over-long target was announced as ${JSON.stringify(regions)}`);
  });

  // NM3: Teaching Mode opens on its narration control, so Space narrates
  // and pauses; Tab order and Escape stay as they were.
  await issue97Case("Teaching Mode and Space", { viewport: desktopViewport }, async (casePage) => {
    await openLecture(casePage);
    // Opened from the keyboard, so Escape has a focused opener to return to.
    await casePage.$$eval(".document-tools button", (buttons) => buttons.find((button) => button.textContent.trim() === "Teach").focus());
    await casePage.keyboard.press("Enter");
    await casePage.waitForSelector(".teach-mode", { timeout: 10_000 });
    const narrateLabel = () => casePage.evaluate(() => (document.activeElement?.hasAttribute("data-teach-narrate") ? document.activeElement.getAttribute("aria-label") : `focus on ${document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName}`));
    assert.equal(await narrateLabel(), "Narrate this section", "Teaching Mode did not open with focus on its narration control");
    await casePage.keyboard.press("Space");
    await casePage.waitForFunction(() => window.speechSynthesis.current?.text && !window.speechSynthesis.paused, { timeout: 5_000 })
      .catch(async () => assert.fail(`Space did not start narration (teaching ${await casePage.$(".teach-mode") ? "open" : "closed"})`));
    assert.equal(await narrateLabel(), "Pause narration", "after Space the narration control lost focus or its name");
    await casePage.keyboard.press("Space");
    await casePage.waitForFunction(() => window.speechSynthesis.paused === true, { timeout: 5_000 })
      .catch(() => assert.fail("a second Space did not pause narration"));
    assert.equal(await narrateLabel(), "Resume narration", "after the second Space the narration control lost focus or its name");
    // Tab order: the footer still reads the presenter tools, Previous
    // section (disabled on the first section), the narration control, Stop
    // and Next section, and Tab walks it in that order both ways.
    const footer = await casePage.$$eval(".teach-footer button:not(:disabled)", (buttons) => buttons.map((button) => button.getAttribute("aria-label")));
    const at = footer.indexOf("Pause narration") === -1 ? footer.indexOf("Resume narration") : footer.indexOf("Pause narration");
    assert.deepEqual(footer.slice(at - 1), ["Reset teaching timer", "Resume narration", "Stop narration", "Next section"], `Teaching Mode's footer order changed: ${footer.join(", ")}`);
    const order = [];
    for (let step = 0; step < 2; step += 1) {
      await casePage.keyboard.press("Tab");
      order.push(await casePage.evaluate(() => document.activeElement?.getAttribute("aria-label")));
    }
    await casePage.keyboard.down("Shift");
    for (let step = 0; step < 3; step += 1) await casePage.keyboard.press("Tab");
    await casePage.keyboard.up("Shift");
    order.push(await casePage.evaluate(() => document.activeElement?.getAttribute("aria-label")));
    assert.deepEqual(order, ["Stop narration", "Next section", "Reset teaching timer"], `Tab from the narration control reached ${order.join(", ")}`);
    // Stop leaves once narration ends; focus on it returns to the control.
    await casePage.keyboard.press("Tab");
    await casePage.keyboard.press("Tab");
    await casePage.keyboard.press("Enter");
    await casePage.waitForFunction(() => !document.querySelector('.teach-mode button[aria-label="Stop narration"]'), { timeout: 5_000 });
    await delay(50);
    assert.equal(await narrateLabel(), "Narrate this section", "after Stop, focus did not return to the narration control");
    await casePage.keyboard.press("Escape");
    await casePage.waitForSelector(".teach-mode", { hidden: true, timeout: 5_000 })
      .catch(() => assert.fail("Escape did not close Teaching Mode"));
    await delay(150);
    assert.equal(await casePage.evaluate(() => document.activeElement?.textContent.trim()), "Teach", "focus did not return to Teach after Escape");
  });

  // NU13, NM8: the copy names the learner's platform. A Mac never reads
  // "iOS"; iOS gets Safari's built-in voices, not advice to install one.
  const asPlatform = (userAgent, platform, touchPoints = 0) => async (casePage) => {
    const cdp = await casePage.createCDPSession();
    await cdp.send("Emulation.setUserAgentOverride", { userAgent, platform });
    if (touchPoints) await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: touchPoints });
  };
  const narrationWording = async (casePage) => {
    await openLecture(casePage);
    await openPanel(casePage);
    // A network voice shows the platform's privacy note.
    await casePage.select('select[aria-label="Narration voice"]', "cloud-en-us");
    await casePage.waitForFunction(() => /cloud voice/u.test(document.querySelector(".speech-voice-detail")?.textContent || ""), { timeout: 5_000 });
    const panel = await casePage.$eval(".speech-popover", (node) => ({ text: node.innerText, microcopy: node.querySelector(".microcopy")?.textContent || "" }));
    await casePage.evaluate(() => {
      window.__lumenTestVoices = [];
      window.speechSynthesis.dispatch("voiceschanged");
    });
    await clickByText(casePage, ".speech-availability button", "Refresh");
    await casePage.waitForFunction(() => /reported any voices/u.test(document.querySelector(".speech-availability")?.textContent || ""), { timeout: 5_000 });
    const empty = await casePage.$eval(".speech-availability", (node) => node.textContent);
    // A blocked sentence's message, from the player or else the panel.
    await startFullLecture(casePage);
    await failSentence(casePage, "not-allowed");
    await delay(150);
    const blocked = await barMessage(casePage) || await (async () => {
      await openPanel(casePage);
      return casePage.$eval(".speech-popover .speech-live", (node) => node.textContent);
    })();
    assert.match(blocked, /blocked/u, "a blocked sentence left no message");
    return Object.fromEntries(Object.entries({ ...panel, empty, blocked }).map(([where, text]) => [where, text.replace(/\s+/gu, " ").trim()]));
  };
  await issue97Case("Mac Chrome wording", {
    viewport: desktopViewport,
    prepare: asPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", "MacIntel"),
  }, async (casePage) => {
    const wording = await narrationWording(casePage);
    const problems = Object.entries(wording).filter(([, text]) => /\biOS\b|iPhone|iPad/u.test(text)).map(([where, text]) => `${where} names iOS: “…${text.match(/[^.]*\b(?:iOS|iPhone|iPad)\b[^.]*/u)?.[0].trim().slice(-90)}”`);
    if (!/^Voices come from macOS and this browser\./u.test(wording.microcopy)) problems.push(`the microcopy reads “${wording.microcopy}”`);
    assert.deepEqual(problems, [], `Mac Chrome narration wording: ${problems.join(" | ")}`);
  });
  await issue97Case("iPhone wording", {
    prepare: asPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "iPhone", 5),
  }, async (casePage) => {
    const wording = await narrationWording(casePage);
    const problems = Object.entries(wording).filter(([, text]) => /install|Spoken Content/iu.test(text)).map(([where, text]) => `${where} advises installing a voice: “${text.match(/[^.]*(?:install|Spoken Content)[^.]*/iu)?.[0].trim()}”`);
    if (!/^Safari offers the voices built into iOS; voices downloaded in Settings may not appear here\./u.test(wording.microcopy)) problems.push(`the microcopy reads “${wording.microcopy}”`);
    assert.deepEqual(problems, [], `iPhone narration wording: ${problems.join(" | ")}`);
  });

  // ND13, NM6, NU17: measured on screen in Paper, Night, system-dark and
  // Contrast: text on the spoken block's tint and the panel's warnings keep
  // 4.5:1, and the player's edge keeps 3:1 against the page. (axe cannot
  // read colours mixed with color-mix(), such as the panel's message box.)
  await issue97Case("narration colours in every theme", {}, async (casePage) => {
    const problems = [];
    await openLecture(casePage);
    const measure = (selector, { backdrop, edge = false } = {}) => casePage.$eval(selector, (node, options) => {
      const parse = (value) => {
        const rgb = value.match(/^rgba?\(([^)]+)\)$/u);
        if (rgb) {
          const [red, green, blue, alpha = 1] = rgb[1].split(/[\s,/]+/u).filter(Boolean).map(Number);
          return [red, green, blue, alpha];
        }
        const srgb = value.match(/^color\(srgb ([^)]+)\)$/u);
        if (srgb) {
          const [red, green, blue, alpha = 1] = srgb[1].split(/[\s/]+/u).filter(Boolean).map(Number);
          return [red * 255, green * 255, blue * 255, alpha];
        }
        return null;
      };
      const over = (top, bottom) => [0, 1, 2].map((channel) => top[channel] * top[3] + bottom[channel] * (1 - top[3])).concat(1);
      const fill = (element) => {
        const layers = [];
        for (let current = element; current; current = current.parentElement) {
          const colour = parse(getComputedStyle(current).backgroundColor);
          if (colour && colour[3] > 0) {
            layers.push(colour);
            if (colour[3] >= 1) break;
          }
        }
        return layers.reduceRight((below, layer) => over(layer, below), [255, 255, 255, 1]);
      };
      const luminance = (colour) => {
        const [red, green, blue] = colour.slice(0, 3).map((channel) => {
          const value = channel / 255;
          return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const ratio = (first, second) => {
        const [light, dark] = [luminance(first), luminance(second)].sort((left, right) => right - left);
        return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
      };
      const style = getComputedStyle(node);
      if (options.edge) {
        // The border is drawn over the element's own fill.
        const border = over(parse(style.borderTopColor), fill(node));
        return ratio(border, fill(document.querySelector(options.backdrop)));
      }
      const ground = fill(node);
      return ratio(over(parse(style.color), ground), ground);
    }, { backdrop, edge });
    for (const [label, choice, scheme] of [["Paper", "Paper", "light"], ["Night", "Night", "light"], ["system-dark", "System", "dark"], ["Contrast", "Contrast", "light"]]) {
      await casePage.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }]);
      await chooseTheme(casePage, choice);
      await startFullLecture(casePage);
      for (let step = 0; step < 12 && !await casePage.$(".markdown-body p.narration-active"); step += 1) {
        await casePage.$eval('.audio-bar button[aria-label="Next narration sentence"]', (node) => node.click());
        await delay(120);
      }
      await delay(400);
      const readings = {
        "text on the spoken block": [await measure(".markdown-body p.narration-active"), 4.5],
        "the player's edge on the page": [await measure(".audio-bar", { edge: true, backdrop: ".reader-scroll" }), 3],
      };
      await failSentence(casePage, "interrupted");
      await casePage.waitForSelector('.audio-bar button[aria-label="Resume narration"]', { timeout: 5_000 });
      await openPanel(casePage);
      await casePage.waitForSelector(".speech-popover .inline-warning", { timeout: 5_000 });
      await delay(400);
      readings["the panel's message"] = [await measure(".speech-popover .inline-warning"), 4.5];
      await clickByText(casePage, ".speech-scope-grid button", "Selection");
      await casePage.waitForSelector(".speech-target-status.warning", { timeout: 5_000 });
      await delay(400);
      readings["the target warning"] = [await measure(".speech-target-status.warning"), 4.5];
      await clickByText(casePage, ".speech-scope-grid button", "Full");
      await casePage.$eval('button[aria-label="Close narration"]', (node) => node.click());
      await casePage.$eval('button[aria-label="Stop narration"]', (node) => node.click());
      for (const [what, [value, minimum]] of Object.entries(readings)) if (!(value >= minimum)) problems.push(`${label}: ${what} is ${value}:1 (needs ${minimum}:1)`);
    }
    assert.deepEqual(problems, [], problems.join("; "));
  });

  const narrationFailures = [["#96", issue96Failures], ["#97", issue97Failures]].filter(([, list]) => list.length);
  assert.deepEqual(narrationFailures, [], narrationFailures.map(([issue, list]) => `issue ${issue} narration cases failed:\n- ${list.join("\n- ")}`).join("\n"));
  console.log("Audio audit passed: section skip, persisted resume position, audio bookmarks (save/jump/delete), sleep-timer arming, multiple voices/languages, preview parameters, sentence/section/selection/document queues with previous/next transport, controls, iOS foreground safety, persistence, empty-voice recovery, opt-in playlist auto-advance into the next chapter, and iPhone layout; issue #96: the sleep timer across auto-advance and armed while idle, the section and sentence at the reading line, throwing storage, a missing chosen voice, bookmarks under the Sentence target, stale saved positions, an unavailable Mermaid chunk, and WebKit before 27; review follow-ups: a sleep deadline passing in a chapter's last sentence or while the next loads, Next/Previous paused past the deadline, browser Back during narration, a pronunciation override after stopping, the section-fallback wording, and a long bookmark on a phone; issue #97: failed, interrupted and backgrounded sentences in the player with Retry and one announcement each, sleep expiry as one toast, no announced sentences from the open panel, a 160-character bookmark at 393, 320 and 1280 px, the Next card clear of the player, 44px controls and readable text on phones (Contrast included), the Review speed, an over-long target mid-reading, Space in Teaching Mode, Mac and iPhone wording, and measured colour contrast in Paper, Night, system-dark and Contrast; #97 review: Retry and Resume replaying the same sentence, matching tooltips, focus to Listen after Stop, the Next card in phone landscape and with a long message at 200% text, the player clear of the bottom navigation (landscape, tablet, 200% text) and of the reader toolbar, toasts above it, messages announced behind Settings and the phone menu, a toast after leaving the Reader, Retry in the Listen panel and in Teaching Mode, and Retry or Next past the sleep deadline.");
} finally {
  await browser?.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
