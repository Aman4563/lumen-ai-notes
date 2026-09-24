import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const baseUrl = process.env.LUMEN_URL || "http://127.0.0.1:4187/";
const profile = await mkdtemp(join(tmpdir(), "lumen-live-workflows-"));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, userDataDir: profile,
  args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
});
const results = [];
const errors = [];
const cases = [
  ["Explain", "Explain why test data must not be used for model selection in under 100 words.", ".ai-tutor__response-text"],
  ["Socratic", "Ask one short question about why test data must not be used for model selection.", ".ai-tutor__response-text"],
  ["Quiz", "Create exactly 2 short multiple-choice questions about test leakage.", ".ai-tutor__quiz"],
  ["Flashcards", "Create exactly 2 short flashcards about test leakage.", ".ai-tutor__flashcards"],
  ["Code review", "Review for data leakage in under 100 words: best = max(models, key=lambda m: m.score(X_test, y_test))", ".ai-tutor__response-text"],
  ["Interview", "Ask one short interview question about avoiding test leakage.", ".ai-tutor__response-text"],
  ["Summarize", "Summarize test leakage in 3 short bullets.", ".ai-tutor__response-text"],
  ["Study plan", "Create a short study plan with 2 milestones for learning to prevent test leakage.", ".ai-tutor__study-plan"],
];
const clickText = async (page, selector, text) => {
  assert.ok(await page.$$eval(selector, (nodes, wanted) => {
    const button = nodes.find((node) => node.textContent.trim() === wanted);
    button?.click();
    return Boolean(button);
  }, text), `Missing control: ${text}`);
};
const storedProfile = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open("lumen-ai-notes", 1);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const get = db.transaction("study-data").objectStore("study-data").get("profile");
    get.onsuccess = () => { resolve(get.result); db.close(); };
    get.onerror = () => { reject(get.error); db.close(); };
  };
}));
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.setViewport({ width: 393, height: 852, isMobile: true, hasTouch: true });
  await page.goto(`${baseUrl.replace(/\/$/, "")}/#/ai`, { waitUntil: "networkidle2" });
  await page.waitForSelector(".ai-tutor__connection--ready", { timeout: 30_000 });
  assert.equal(await page.$(".ai-tutor__privacy-body"), null);
  assert.equal(await page.$eval(".ai-engine-picker details", (node) => node.open), false);
  await page.click(".ai-tutor__consent input");
  for (const [mode, prompt, resultSelector] of cases) {
    const started = Date.now();
    try {
      if (await page.$('[aria-label="Clear AI tutor conversation"]')) {
        await page.locator('[aria-label="Clear AI tutor conversation"]').click();
        // Clearing asks in the tutor's own confirmation dialog.
        await page.waitForSelector(".tutor-dialog");
        await clickText(page, ".tutor-dialog button", "Clear conversation");
        await page.waitForFunction(() => !document.querySelector('.ai-tutor__message--assistant'));
      }
      await clickText(page, ".ai-tutor__mode-tabs button", mode);
      await page.waitForFunction((label) => [...document.querySelectorAll('.ai-tutor__mode-tabs button')].some((node) => node.textContent.trim() === label && node.getAttribute('aria-pressed') === 'true'), {}, mode);
      await page.$eval(".ai-tutor__composer textarea", (field, value) => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }, prompt);
      await page.waitForFunction(() => !document.querySelector(".ai-tutor__send")?.disabled);
      await page.$eval('.ai-tutor__send', (node) => node.scrollIntoView({ behavior: 'instant', block: 'center' }));
      await page.waitForFunction(() => {
        const button = document.querySelector('.ai-tutor__send');
        const rect = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      });
      await page.locator(".ai-tutor__send").click();
      await page.waitForSelector(".ai-tutor__message--streaming", { timeout: 10_000 });
      assert.equal(await page.$$eval("[data-ai-engine-option]", (nodes) => nodes.every((node) => node.disabled)), true, "Switching engines can cancel the request silently");
      await page.waitForFunction(() => !document.querySelector(".ai-tutor__message--streaming"), { timeout: 260_000 });
      const failure = await page.$eval(".ai-tutor__request-error", (node) => node.textContent).catch(() => "");
      assert.equal(failure, "", failure);
      const answer = await page.$(`.ai-tutor__message--assistant ${resultSelector}`);
      assert.ok(answer, `${mode} did not render its expected result`);
      assert.ok((await answer.evaluate((node) => node.textContent.trim())).length > 20);
      assert.equal(await page.$$eval("[data-ai-engine-option]", (nodes) => nodes.every((node) => !node.disabled)), true);
      if (mode === "Quiz") {
        await page.click(".ai-tutor__quiz-options input");
        // A grounded quiz question can contain citation buttons; pick Check answer by name.
        await clickText(page, ".ai-tutor__quiz-question button", "Check answer");
        await page.waitForSelector(".ai-tutor__quiz-feedback");
      }
      if (mode === "Flashcards") {
        await page.click(".ai-tutor__flashcard > button");
        await page.waitForSelector(".ai-tutor__flashcard-answer");
        await clickText(page, ".ai-tutor__flashcards button", "Add selected to review");
        await page.waitForSelector(".ai-tutor__draft-status.is-saved");
      }
      if (mode === "Explain") {
        await clickText(page, ".ai-tutor__message--assistant .ai-tutor__message-actions button", "Save to notes");
        await page.waitForFunction(() => [...document.querySelectorAll(".ai-tutor__message-actions button")].some((button) => button.textContent.includes("Saved to notes")));
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2), true, `${mode} overflows on mobile`);
      results.push({ mode, ok: true, ms: Date.now() - started });
    } catch (error) {
      const diagnostic = await page.evaluate(() => {
        const button = document.querySelector('.ai-tutor__send');
        const rect = button?.getBoundingClientRect();
        return {
          route: location.hash,
          tutor: document.querySelector('.ai-tutor')?.innerText.slice(-4_000),
          prompt: document.querySelector('.ai-tutor__composer textarea')?.value,
          sendRect: rect?.toJSON(),
          hit: rect && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.outerHTML.slice(0, 500),
          viewport: { width: innerWidth, height: innerHeight, scrollY },
        };
      });
      results.push({ mode, ok: false, error: error.message, ms: Date.now() - started, page: diagnostic, runtimeErrors: [...errors] });
      // Keep later modes independently testable after a navigation or failure.
      await page.goto(`${baseUrl.replace(/\/$/, "")}/#/ai`, { waitUntil: "networkidle2" });
      await page.waitForSelector(".ai-tutor__connection--ready");
    }
    console.log(JSON.stringify(results.at(-1)));
  }
  // Check the durable boundary before reload, not just React's visible state.
  const saveDeadline = Date.now() + 10_000;
  let beforeReload;
  do {
    beforeReload = await storedProfile(page);
    if (beforeReload?.aiTutorHistory?.some((message) => message.role === "assistant" && message.mode === "study-plan")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < saveDeadline);
  assert.ok(beforeReload?.aiTutorHistory?.some((message) => message.role === "assistant" && message.mode === "study-plan"), "The completed study plan was never persisted");
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector(".ai-tutor__connection--ready");
  assert.equal(await page.$(".ai-tutor__consent input"), null, "Consent was not remembered");
  assert.equal(await page.$(".ai-tutor__privacy-body"), null, "Repeated instructions reopened after reload");
  const saved = await storedProfile(page);
  assert.ok(saved.reviewItems.some((card) => card.front && card.back), "Generated cards were not saved to the review deck");
  assert.ok(saved.clippings.some((note) => note.text && note.note?.includes("AI-generated")), "Generated answer was not saved to the notebook");
  assert.ok(saved.aiTutorHistory.some((message) => message.role === "assistant"), "Answer history did not survive reload");
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: join(tmpdir(), "lumen-ai-mobile.png") });
  await page.setViewport({ width: 1280, height: 852, isMobile: true, hasTouch: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2), true, 'Wide layout overflows');
  console.log(JSON.stringify({ ok: results.every((result) => result.ok), passed: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok).length, persistence: true, runtimeErrors: errors }));
  if (results.some((result) => !result.ok)) process.exitCode = 1;
} finally {
  await browser.close();
  await rm(profile, { recursive: true, force: true });
}
