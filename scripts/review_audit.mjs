import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";

const baseUrl = process.env.LUMEN_URL || "http://127.0.0.1:4173/";
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDirectory = await mkdtemp(join(tmpdir(), "lumen-review-profile-"));
const downloadDirectory = await mkdtemp(join(tmpdir(), "lumen-review-downloads-"));
const errors = [];
let browser;

const clickByText = async (page, selector, text) => {
  const clicked = await page.$$eval(selector, (nodes, expected) => {
    const match = nodes.find((node) => node.textContent.replace(/\s+/g, " ").trim().includes(expected));
    match?.click();
    return Boolean(match);
  }, text);
  assert.ok(clicked, `could not find ${selector} containing “${text}”`);
};

const readProfile = (page) => page.evaluate(() => new Promise((resolve, reject) => {
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
    args: ["--disable-background-networking", "--no-first-run", "--no-default-browser-check"],
  });
  const page = await browser.newPage();
  page.on("dialog", (dialog) => dialog.accept());
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDirectory, eventsEnabled: true });
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
  });

  await page.goto(`${baseUrl}#/review`, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForSelector(".review-center-page", { timeout: 5_000 });
  await clickByText(page, ".review-center-page button", "New card");
  await page.waitForSelector(".review-card-dialog");
  const fields = await page.$$(".review-card-dialog textarea");
  assert.equal(fields.length, 2, "review dialog did not expose prompt and answer fields");
  await fields[0].type("Why does data leakage invalidate an offline evaluation?");
  await fields[1].type("It exposes information unavailable at inference time, so the measured metric overestimates production generalization.");
  await page.type(".review-card-dialog input", "evaluation, interview");
  await clickByText(page, ".review-card-dialog button", "Add to review");
  await page.waitForSelector(".review-deck-card");
  assert.equal((await page.$eval(".review-deck-card .review-card-copy .review-markdown", (node) => node.textContent)).trim(), "Why does data leakage invalidate an offline evaluation?");
  assert.equal(await page.$eval(".review-hero strong", (node) => node.textContent), "1");

  // LEARN-002: an exact duplicate is rejected with a warning and no deck growth.
  await clickByText(page, ".review-title button", "New card");
  await page.waitForSelector(".review-card-dialog");
  const duplicateFields = await page.$$(".review-card-dialog textarea");
  await duplicateFields[0].type("Why does data leakage invalidate an offline evaluation?");
  await duplicateFields[1].type("It exposes information unavailable at inference time, so the measured metric overestimates production generalization.");
  await clickByText(page, ".review-card-dialog button", "Add to review");
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.toLowerCase().includes("already exist"), { timeout: 5_000 })
    .catch(() => assert.fail("duplicate card creation did not warn"));
  await page.$eval(".review-card-dialog button[aria-label='Close review card dialog']", (node) => node.click());
  await page.waitForFunction(() => !document.querySelector(".review-card-dialog"));
  assert.equal(await page.$eval(".review-hero strong", (node) => node.textContent), "1", "a duplicate card must not grow the deck");

  await clickByText(page, ".review-hero button", "Start review");
  await page.waitForSelector(".review-session-page");
  await clickByText(page, ".review-session-page button", "Show answer");
  await page.waitForSelector(".review-answer");
  assert.ok((await page.$eval(".review-answer", (node) => node.textContent)).includes("overestimates production generalization"));
  await clickByText(page, ".review-rating", "Good");
  try {
    await page.waitForSelector(".review-center-page", { timeout: 5_000 });
  } catch (error) {
    console.error("Review state after grading:", await page.evaluate(() => document.body.innerText.slice(0, 4_000)), errors);
    throw error;
  }
  await page.waitForFunction(() => document.querySelector(".review-hero strong")?.textContent === "0");
  assert.ok((await page.$eval(".review-deck-card", (node) => node.textContent)).includes("1 day interval"), "Good rating did not schedule a one-day interval");
  assert.ok((await page.$eval(".review-stat-grid", (node) => node.textContent)).includes("100%"), "recall rate was not updated");

  await clickByText(page, ".review-hero-actions button", "Undo last grade");
  await page.waitForFunction(() => document.querySelector(".review-hero strong")?.textContent === "1");
  assert.ok((await page.$eval(".review-deck-card", (node) => node.textContent)).includes("New"), "undo did not restore the pre-grade schedule");
  await clickByText(page, ".review-hero button", "Start review");
  await clickByText(page, ".review-session-page button", "Show answer");
  await page.$eval("button[aria-label=\"Confidence 4 of 5\"]", (node) => node.click());
  await clickByText(page, ".review-rating", "Good");
  await page.waitForSelector(".review-center-page");

  await page.$eval('button[aria-label="Edit review card"]', (node) => node.click());
  await page.waitForSelector(".review-card-dialog");
  await page.focus(".review-card-dialog textarea");
  await page.keyboard.press("End");
  await page.keyboard.type(" [edited]");
  await clickByText(page, ".review-card-dialog button", "Save changes");
  await page.waitForSelector(".review-deck-card");
  assert.ok((await page.$eval(".review-deck-card", (node) => node.textContent)).includes("[edited]"), "card edit was not saved");
  await page.$eval('button[aria-label="Archive review card"]', (node) => node.click());
  await page.waitForFunction(() => [...document.querySelectorAll(".review-deck-tools button")].some((node) => node.textContent.includes("Archived (1)")), { timeout: 5_000 });
  await clickByText(page, ".review-deck-tools button", "Archived (1)");
  await page.waitForSelector('button[aria-label="Restore review card"]');
  await page.$eval('button[aria-label="Restore review card"]', (node) => node.click());
  await clickByText(page, ".review-deck-tools button", "Show active");
  await page.waitForSelector(".review-deck-card");

  await new Promise((resolve) => setTimeout(resolve, 700));
  const stored = await readProfile(page);
  assert.equal(stored.version, 4);
  assert.equal(stored.reviewItems.length, 1);
  assert.equal(stored.reviewItems[0].repetitions, 1);
  assert.equal(stored.reviewAttempts.length, 1);
  assert.equal(stored.reviewAttempts[0].rating, "good");
  assert.equal(stored.reviewAttempts[0].confidence, 4);
  assert.equal(stored.reviewSessions.length, 1);
  assert.equal(stored.reviewSessions[0].newIntroduced, 1, "undo must reverse the first ledger increment before the re-grade");
  assert.ok(stored.reviewItems[0].front.endsWith("[edited]"));

  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForSelector(".review-deck-card");
  assert.ok((await page.$eval(".review-deck-card", (node) => node.textContent)).includes("1 day interval"), "scheduled card did not survive reload");

  // LEARN-005 mistake notebook: a failed recall logs a mistake, repeats merge,
  // the correction persists, and corrective review reschedules the card.
  await clickByText(page, ".review-title button", "New card");
  await page.waitForSelector(".review-card-dialog");
  const mistakeFields = await page.$$(".review-card-dialog textarea");
  await mistakeFields[0].type("Which split tunes hyperparameters?");
  await mistakeFields[1].type("The validation split, never the test split.");
  await clickByText(page, ".review-card-dialog button", "Add to review");
  await page.waitForFunction(() => document.querySelector(".review-hero strong")?.textContent === "1");
  await clickByText(page, ".review-hero button", "Start review");
  await clickByText(page, ".review-session-page button", "Show answer");
  await clickByText(page, ".review-rating", "Again");
  await page.waitForSelector(".review-mistakes");
  assert.equal((await page.$$(".mistake-card")).length, 1, "an Again grade did not log exactly one mistake");
  const mistakeCopy = await page.$eval(".mistake-card", (node) => node.textContent);
  assert.ok(mistakeCopy.includes("Which split tunes hyperparameters?"), "the mistake did not capture the failed prompt");
  assert.ok(mistakeCopy.includes("Misconception"), "the mistake category chip is missing");

  await page.type(".mistake-card textarea", "Only validation data may steer choices; the test split stays untouched.");
  // The field commits on blur so per-keystroke profile writes cannot drop keys.
  await page.$eval(".mistake-card textarea", (node) => node.blur());
  await new Promise((resolve) => setTimeout(resolve, 700));
  const withMistake = await readProfile(page);
  assert.equal(withMistake.mistakes.length, 1);
  assert.equal(withMistake.mistakes[0].occurrences, 1);
  assert.ok(withMistake.mistakes[0].correction.includes("stays untouched"), "the correction was not persisted");
  assert.equal(withMistake.mistakes[0].reviewItemId, withMistake.reviewItems.find((item) => item.front.startsWith("Which split")).id, "the mistake lost its card link");

  // The lapsed card sits in a short relearning delay; corrective scheduling
  // must make it due immediately.
  await clickByText(page, ".mistake-card button", "Schedule corrective review");
  await page.waitForFunction(() => document.querySelector(".review-hero strong")?.textContent === "1");
  await clickByText(page, ".review-hero button", "Start review");
  await clickByText(page, ".review-session-page button", "Show answer");
  await clickByText(page, ".review-rating", "Again");
  await page.waitForSelector(".review-mistakes");
  await page.waitForFunction(() => document.querySelector(".mistake-card")?.textContent.includes("×2"), { timeout: 5_000 });
  assert.equal((await page.$$(".mistake-card")).length, 1, "a repeated failure duplicated the mistake instead of merging");

  // Corrective scheduling for an UNLINKED mistake must create a new tagged
  // card and back-link it (the delete leaves the mistake without its card).
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".review-deck-card")];
    const target = cards.find((card) => card.textContent.includes("Which split tunes hyperparameters?"));
    target?.querySelector('button[aria-label="Delete review card"]')?.click();
  });
  await page.waitForFunction(() => ![...document.querySelectorAll(".review-deck-card")].some((card) => card.textContent.includes("Which split tunes hyperparameters?")), { timeout: 5_000 });
  await clickByText(page, ".mistake-card button", "Schedule corrective review");
  await page.waitForFunction(() => [...document.querySelectorAll(".review-deck-card")].some((card) => card.textContent.includes("Which split tunes hyperparameters?")), { timeout: 5_000 })
    .catch(() => assert.fail("an unlinked mistake did not create a corrective card"));
  await new Promise((resolve) => setTimeout(resolve, 700));
  const relinked = await readProfile(page);
  const correctiveCard = relinked.reviewItems.find((item) => item.front === "Which split tunes hyperparameters?");
  assert.ok(correctiveCard.tags.includes("mistake"), "the corrective card must carry the mistake tag");
  assert.equal(relinked.mistakes[0].reviewItemId, correctiveCard.id, "the mistake must back-link to its new corrective card");

  await clickByText(page, ".mistake-card button", "Mark corrected");
  await page.waitForFunction(() => !document.querySelector(".mistake-card"), { timeout: 5_000 });
  await page.$eval(".mistake-corrected-toggle input", (node) => node.click());
  await page.waitForFunction(() => document.querySelector(".mistake-card")?.textContent.includes("Corrected"), { timeout: 5_000 });
  const categoryFilter = await page.$(".mistake-controls select");
  await categoryFilter.select("code");
  await page.waitForFunction(() => !document.querySelector(".mistake-card"), { timeout: 5_000 });
  await categoryFilter.select("misconception");
  await page.waitForFunction(() => Boolean(document.querySelector(".mistake-card")), { timeout: 5_000 });
  await categoryFilter.select("all");
  await page.$eval(".mistake-corrected-toggle input", (node) => node.click());

  // Manual capture: the Log-mistake dialog records a categorized entry, and
  // repeating the same prompt merges instead of duplicating.
  await clickByText(page, ".review-mistakes button", "Log mistake");
  await page.waitForSelector(".mistake-dialog");
  const manualFields = await page.$$(".mistake-dialog textarea");
  await manualFields[0].type("Wrote the softmax gradient with the wrong sign");
  await manualFields[1].type("The Jacobian diagonal is p_i(1 - p_i); off-diagonals are -p_i p_j.");
  await page.select(".mistake-dialog select", "formula");
  await clickByText(page, ".mistake-dialog button", "Log mistake");
  await page.waitForFunction(() => [...document.querySelectorAll(".mistake-card")].some((card) => card.textContent.includes("softmax gradient") && card.textContent.includes("Formula")), { timeout: 5_000 });
  await clickByText(page, ".review-mistakes button", "Log mistake");
  await page.waitForSelector(".mistake-dialog");
  const repeatFields = await page.$$(".mistake-dialog textarea");
  await repeatFields[0].type("Wrote the softmax gradient with the wrong sign");
  await repeatFields[1].type("Different expected text, same failure.");
  await page.select(".mistake-dialog select", "formula");
  await clickByText(page, ".mistake-dialog button", "Log mistake");
  await page.waitForFunction(() => [...document.querySelectorAll(".mistake-card")].some((card) => card.textContent.includes("softmax gradient") && card.textContent.includes("×2")), { timeout: 5_000 })
    .catch(() => assert.fail("a repeated manual mistake did not merge"));

  // LEARN-005: the notebook exports to Markdown with category and occurrences.
  await clickByText(page, ".mistake-controls button", "Export");
  {
    let exportPath = "";
    const exportDeadline = Date.now() + 10_000;
    while (Date.now() < exportDeadline && !exportPath) {
      const files = await readdir(downloadDirectory);
      const name = files.find((file) => file.startsWith("lumen-mistakes-") && file.endsWith(".md"));
      if (name) exportPath = join(downloadDirectory, name);
      else await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(exportPath, "the mistakes Markdown export was not downloaded");
    const exported = await readFile(exportPath, "utf8");
    assert.match(exported, /# Mistake notebook/);
    assert.ok(exported.includes("softmax gradient") && exported.includes("Category: Formula") && exported.includes("×2"), "the export is missing the merged mistake's details");
  }
  await page.evaluate(() => {
    const card = [...document.querySelectorAll(".mistake-card")].find((node) => node.textContent.includes("softmax gradient"));
    card?.querySelector('button[aria-label="Delete this mistake entry"]')?.click();
  });
  await page.waitForFunction(() => ![...document.querySelectorAll(".mistake-card")].some((card) => card.textContent.includes("softmax gradient")), { timeout: 5_000 });

  // INTERVIEW-002 slice: a timed interview round runs prep → answer → reveal,
  // and a missed question lands in the mistake notebook under Interview.
  await clickByText(page, ".review-hero-actions button", "Interview round");
  await page.waitForSelector(".interview-round .interview-timer", { timeout: 5_000 });
  const roundTotal = Number((await page.$eval(".interview-round .review-session-header strong", (node) => node.textContent)).split("/")[1]);
  assert.ok(roundTotal >= 1, "the interview round must include the interview-tagged card");
  assert.match(await page.$eval(".interview-round .interview-timer", (node) => node.textContent), /0:(30|29|28)/, "the prep countdown must start near 30 seconds");
  assert.ok((await page.$eval(".interview-round .eyebrow", (node) => node.textContent)).includes("Structure your answer"), "the prep phase must coach structuring first");
  for (let question = 0; question < roundTotal; question += 1) {
    await clickByText(page, ".interview-round button", "Start answering");
    await page.waitForFunction(() => document.querySelector(".interview-round .eyebrow")?.textContent.includes("interviewer is listening"), { timeout: 5_000 });
    await clickByText(page, ".interview-round button", "Show expected answer");
    await page.waitForSelector(".interview-round .review-answer", { timeout: 5_000 });
    await clickByText(page, ".interview-round button", question === 0 ? "Missed it" : "Answered well");
  }
  await page.waitForFunction(() => document.querySelector(".interview-summary"), { timeout: 5_000 });
  assert.equal(await page.$eval(".interview-round .review-session-header strong", (node) => node.textContent), `${roundTotal - 1}/${roundTotal}`, "the summary must count the miss");
  assert.ok((await page.$eval(".interview-summary h3", (node) => node.textContent)).includes("1 miss"), "the summary must state the miss was logged");
  await clickByText(page, ".interview-round button", "Back to review center");
  await page.waitForSelector(".review-center-page", { timeout: 5_000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".mistake-card")].some((card) => card.textContent.includes("data leakage") && card.textContent.includes("Interview")), { timeout: 5_000 })
    .catch(() => assert.fail("an interview miss did not create an Interview-category mistake"));
  await page.evaluate(() => {
    const card = [...document.querySelectorAll(".mistake-card")].find((node) => node.textContent.includes("data leakage") && node.textContent.includes("Interview"));
    card?.querySelector('button[aria-label="Delete this mistake entry"]')?.click();
  });
  await page.waitForFunction(() => ![...document.querySelectorAll(".mistake-card")].some((card) => card.textContent.includes("data leakage") && card.textContent.includes("Interview")), { timeout: 5_000 });

  // Clean up the second card so the original deck assertions stay untouched.
  await page.waitForSelector(".review-deck-card");
  const deleteButtons = await page.$$('button[aria-label="Delete review card"]');
  assert.ok(deleteButtons.length >= 1, "delete control missing for cleanup");
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".review-deck-card")];
    const target = cards.find((card) => card.textContent.includes("Which split tunes hyperparameters?"));
    target?.querySelector('button[aria-label="Delete review card"]')?.click();
  });

  // Issue #16: enabling the Adaptive (FSRS) scheduler migrates existing
  // cards once (history replay or SM-2 seed) and grades store FSRS state.
  await page.select('select[aria-label="Scheduling algorithm"]', "fsrs");
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Adaptive scheduling enabled"), { timeout: 5_000 })
    .catch(() => assert.fail("enabling FSRS did not confirm the calibration"));
  await page.waitForSelector('select[aria-label="Target retention"]', { timeout: 5_000 });
  await new Promise((resolve) => setTimeout(resolve, 700));
  const fsrsProfile = await readProfile(page);
  assert.equal(fsrsProfile.reviewSettings.scheduler, "fsrs");
  const seasoned = fsrsProfile.reviewItems.find((item) => item.reviewCount > 0);
  assert.ok(seasoned, "a reviewed card must exist for the migration check");
  assert.ok(seasoned.stability > 0 && seasoned.fsrsState !== "", `migration must seed reviewed cards (stability ${seasoned.stability}, state ${seasoned.fsrsState})`);
  // Issue #16: the workload planner shows steady-state daily reviews per
  // retention choice, monotone in retention, and switches the setting.
  await page.waitForSelector(".review-workload-strip", { timeout: 5_000 });
  const workloads = await page.$$eval(".review-workload-options button span", (nodes) => nodes.map((node) => Number(node.textContent.match(/~([\d.]+)\//)?.[1])));
  assert.equal(workloads.length, 4, "four retention choices must render");
  for (let index = 1; index < workloads.length; index += 1) {
    assert.ok(workloads[index] >= workloads[index - 1], `workload must not fall as retention rises (${workloads.join(", ")})`);
  }
  await clickByText(page, ".review-workload-options button", "95%");
  await page.waitForFunction(() => document.querySelector('select[aria-label="Target retention"]')?.value === "0.95", { timeout: 5_000 })
    .catch(() => assert.fail("choosing a planner option did not update the retention setting"));
  await page.select('select[aria-label="Target retention"]', "0.9");

  // Issue #16: calibration refuses honestly on a thin history instead of
  // overfitting a handful of grades (successful fits are unit-tested).
  await clickByText(page, ".review-calibrate button", "Calibrate from my history");
  await page.waitForFunction(() => document.querySelector(".toast")?.textContent.includes("Calibration needs at least 50 spaced reviews"), { timeout: 5_000 })
    .catch(() => assert.fail("thin-history calibration did not refuse with the typed reason"));
  await page.select('select[aria-label="Scheduling algorithm"]', "sm2");
  await new Promise((resolve) => setTimeout(resolve, 400));

  // Issue #10: an authored track round runs through the interview timers,
  // and a worksheet lab check logs a miss into the notebook.
  await page.waitForSelector(".interview-track-strip", { timeout: 10_000 });
  await page.select('select[aria-label="Interview track"]', "mle");
  await clickByText(page, ".interview-track-strip button", "Start track round");
  await page.waitForSelector(".interview-round .interview-timer", { timeout: 5_000 });
  const trackQuestion = await page.$eval(".interview-round .review-question", (node) => node.textContent);
  assert.ok(trackQuestion.length > 40, "the track round must render an authored question");
  await clickByText(page, ".interview-round button", "Start answering");
  await clickByText(page, ".interview-round button", "Show expected answer");
  await page.waitForFunction(() => document.querySelector(".interview-round .review-answer")?.textContent.includes("Rubric"), { timeout: 5_000 })
    .catch(() => assert.fail("the revealed track answer did not include its rubric"));
  await clickByText(page, ".interview-round button", "End round");
  await page.waitForSelector(".review-center-page");

  await page.waitForSelector(".lab-strip .lab-tile", { timeout: 10_000 });
  await page.$eval(".lab-strip .lab-tile", (node) => node.click());
  await page.waitForSelector(".lab-bench .lab-task", { timeout: 5_000 });
  await page.type(".lab-task input", "definitely-wrong-answer");
  await clickByText(page, ".lab-task button", "Check answer");
  await page.waitForFunction(() => document.querySelector(".lab-outcome.is-incorrect")?.textContent.includes("mistake notebook"), { timeout: 5_000 })
    .catch(() => assert.fail("a wrong lab check did not report the notebook capture"));
  await clickByText(page, ".review-session-header button", "Exit lab");
  await page.waitForSelector(".review-center-page");
  await page.waitForFunction(() => [...document.querySelectorAll(".mistake-card")].some((card) => card.textContent.includes("Code")), { timeout: 5_000 })
    .catch(() => assert.fail("the lab miss did not land as a code-category mistake"));
  await page.evaluate(() => {
    const card = [...document.querySelectorAll(".mistake-card")].find((node) => node.textContent.includes("Code"));
    card?.querySelector('button[aria-label="Delete this mistake entry"]')?.click();
  });
  await new Promise((resolve) => setTimeout(resolve, 400));

  // Exercise the maximum persisted deck size. The center must keep the DOM
  // bounded on an iPhone instead of rendering 10,000 Markdown cards at once.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("lumen-ai-notes", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const transaction = request.result.transaction("study-data", "readwrite");
      const store = transaction.objectStore("study-data");
      const get = store.get("profile");
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        const profile = get.result;
        const template = profile.reviewItems[0];
        profile.reviewItems = Array.from({ length: 10_000 }, (_, index) => ({
          ...template,
          id: `scale-review-${String(index).padStart(5, "0")}`,
          front: `Scale prompt ${index}`,
          back: `Scale answer ${index}`,
        }));
        store.put(profile, "profile");
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    };
  }));
  await page.reload({ waitUntil: "networkidle2", timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll(".review-deck-card").length === 24 && document.querySelector(".review-deck-heading h2")?.textContent.includes("10000 active"));
  assert.equal(await page.$$eval(".review-deck-card", (nodes) => nodes.length), 24, "large deck page must render only the bounded page size");
  assert.equal((await page.$eval(".review-deck-card .review-card-copy", (node) => node.textContent)).trim().startsWith("Scale prompt 0"), true);
  assert.equal((await page.$eval(".review-deck-pagination", (node) => node.getAttribute("aria-label"))), "Review card pages");
  const touchSize = await page.$eval('button[aria-label="Next review card page"]', (button) => {
    const bounds = button.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  assert.ok(touchSize.width >= 44 && touchSize.height >= 44, `pagination touch target is ${touchSize.width}×${touchSize.height}`);
  await page.$eval("button[aria-label=\"Next review card page\"]", (node) => node.click());
  await page.waitForFunction(() => document.querySelector(".review-deck-pagination")?.textContent.includes("Page 2 of 417"));
  assert.equal((await page.$eval(".review-deck-card .review-card-copy", (node) => node.textContent)).trim().startsWith("Scale prompt 24"), true);
  await page.$eval("button[aria-label=\"Last review card page\"]", (node) => node.click());
  await page.waitForFunction(() => document.querySelectorAll(".review-deck-card").length === 16 && document.querySelector(".review-deck-pagination")?.textContent.includes("Page 417 of 417"));

  const search = await page.$('.review-deck-tools input[aria-label="Search review cards"]');
  await search.type("Scale prompt 9999");
  await page.waitForFunction(() => document.querySelectorAll(".review-deck-card").length === 1 && document.querySelector(".review-deck-range")?.textContent.includes("1–1 of 1"));
  assert.ok((await page.$eval(".review-deck-card", (node) => node.textContent)).includes("Scale prompt 9999"), "search must reset a large deck to its matching first page");
  assert.deepEqual(errors, [], `runtime errors: ${errors.join(" | ")}`);
  console.log("Review audit passed: creation, grading, confidence, ledger limits, undo, edit, archive/restore, mistake notebook (auto-log on Again, merge on repeat, manual capture, persisted corrections, linked and unlinked corrective scheduling, corrected/category filters), duplicate-card rejection, timed interview round with miss capture, FSRS opt-in with one-time migration, honest thin-history calibration refusal, the retention-vs-workload planner, authored track rounds with rubric reveal, worksheet-lab miss capture, analytics, reload persistence, and 10,000-card mobile pagination verified.");
} finally {
  if (browser) await browser.close();
  await rm(profileDirectory, { recursive: true, force: true });
  await rm(downloadDirectory, { recursive: true, force: true });
}
