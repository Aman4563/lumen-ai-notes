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
  await page.evaluateOnNewDocument(() => {
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
    const listeners = new Map();
    window.__lumenTestVoices = [
      { name: "Samantha", lang: "en-US", voiceURI: "samantha-en-us", default: true, localService: true },
      { name: "Rishi", lang: "en-IN", voiceURI: "rishi-en-in", default: false, localService: true },
      { name: "Lekha", lang: "hi-IN", voiceURI: "lekha-hi-in", default: false, localService: true },
      { name: "Example cloud voice", lang: "en-US", voiceURI: "cloud-en-us", default: false, localService: false },
    ];
    const synthesis = {
      current: null,
      paused: false,
      speaking: false,
      getVoices: () => window.__lumenTestVoices,
      speak(utterance) {
        this.current = utterance;
        this.paused = false;
        this.speaking = true;
        utterance.onstart?.();
      },
      cancel() {
        this.current = null;
        this.paused = false;
        this.speaking = false;
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
  });
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

  assert.equal(await page.$$eval('select[aria-label="Narration voice"] option', (options) => options.length), 4, "all reported voices must be selectable");
  assert.equal(await page.$$eval('select[aria-label="Narration language"] option', (options) => options.length), 4, "all reported languages plus automatic mode must be selectable");
  assert.match(await page.$eval(".speech-popover .microcopy", (node) => node.textContent), /Voices come from iOS/u);
  assert.match(await page.$eval(".speech-popover .microcopy", (node) => node.textContent), /May use network/u);

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

  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.waitForSelector('button[aria-label="Resume narration"]');
  assert.equal(await page.evaluate(() => speechSynthesis.current), null, "backgrounding must cancel native autoplay while preserving the queue");
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
  assert.deepEqual(runtimeErrors, [], `audio runtime errors: ${runtimeErrors.join(" | ")}`);
  console.log("Audio audit passed: multiple voices/languages, preview parameters, scopes, controls, iOS foreground safety, persistence, empty-voice recovery, and iPhone layout.");
} finally {
  await browser?.close();
  await rm(profileDirectory, { recursive: true, force: true });
}
