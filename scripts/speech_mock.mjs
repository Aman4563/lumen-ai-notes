// The iOS speech engine, mocked, for the browser audits (audit:audio,
// audit:a11y). Pass it to page.evaluateOnNewDocument before the app loads, or
// to page.evaluate to swap it in on a running page (the app reads
// window.speechSynthesis when it speaks). `pending` mirrors
// speechSynthesis.pending. `webkitLegacy` reproduces WebKit before 27, where
// cancel() of live speech also removes an utterance queued by speak() in the
// same task ("cancel() removed utterances queued by subsequent speak() calls",
// fixed in 27.0). Date.now() runs `__lumenClockOffset` ms ahead so sleep-timer
// cases can move the clock without waiting.
export const installSpeechMock = ({ webkitLegacy = false } = {}) => {
  if (window.__lumenSpeechMock) return;
  window.__lumenSpeechMock = true;
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

// Taps the player's Next until the Reader marks a block matching `selector`
// (a paragraph, say) as the one being spoken, at most `steps` times. Each tap
// is awaited on what it changes, not a guessed delay (#138): the mocked
// engine speaks the next sentence, then the Reader's highlight moves to the
// first block holding that sentence's opening, as Reader.jsx finds it (or
// stays put when no block holds it).
export const stepToSpokenBlock = async (page, selector, steps = 12) => {
  for (let step = 0; step < steps && !await page.$(selector); step += 1) {
    const before = await page.evaluate(() => window.speechSynthesis.current?.text ?? null);
    await page.$eval('.audio-bar button[aria-label="Next narration sentence"]', (button) => button.click());
    await page.waitForFunction((previous) => {
      const text = window.speechSynthesis.current?.text;
      if (!text || text === previous) return false;
      const needle = text.slice(0, 60).replace(/\s+/g, " ").trim().toLocaleLowerCase();
      if (needle.length < 8) return true;
      const target = [...document.querySelectorAll(".markdown-body :is(h1, h2, h3, h4, p, li, blockquote)")]
        .find((block) => block.textContent.replace(/\s+/g, " ").toLocaleLowerCase().includes(needle));
      return !target || target.classList.contains("narration-active");
    }, { timeout: 5_000 }, before);
  }
};
