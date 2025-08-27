// BACKGROUND (no external APIs)
// Voice, reminders, tab nudges, and local processors for summarize/grammar/translate launcher.

const SOCIAL_HOSTS = ["facebook.com","instagram.com","tiktok.com","x.com","twitter.com","youtube.com","reddit.com"];
const TAB_THRESHOLD = 20;

// Install/start alarms
chrome.runtime.onInstalled.addListener(() => ensureAlarms());
chrome.runtime.onStartup.addListener(() => ensureAlarms());

function ensureAlarms() {
  chrome.alarms.create("hydrate", { periodInMinutes: 60 });
  chrome.alarms.create("hourlyTick", { periodInMinutes: 60 }); // greetings/meal prompts
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === "hydrate") {
    notifyAndSpeak("Hydration check", "Take a sip of water and rest your eyes.");
  }
  if (alarm.name === "hourlyTick") {
    const h = new Date().getHours();
    let msg = null;
    if (h === 9)  msg = "Good morning! Have some breakfast to start strong.";
    if (h === 13) msg = "Good afternoon! Time for lunch and a short walk?";
    if (h === 17) msg = "Snack o’clock! Stretch and grab something light.";
    if (h === 20) msg = "Dinner time — refuel and unwind.";
    if (msg) {
      const tab = await getActiveTab();
      if (tab) chrome.tabs.sendMessage(tab.id, { type: "OVERLAY", text: `🍽️ ${msg}` });
      speak(msg);
    }
  }
});

// Gentle tab-count nudge
setInterval(async () => {
  const tabs = await chrome.tabs.query({});
  if (tabs.length >= TAB_THRESHOLD) {
    const tab = await getActiveTab();
    if (tab) {
      const text = `You have ${tabs.length} tabs open. More tabs can overload your brain — want to close a few?`;
      chrome.tabs.sendMessage(tab.id, { type: "OVERLAY", text: `🧠 ${text}` });
      speak(text);
    }
  }
}, 120000);

// Messaging
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "SUMMARIZE") {
        const out = summarizeLocal(msg.text, 5);
        return sendResponse({ ok: true, result: bullets(out) });
      }
      if (msg.type === "GRAMMAR") {
        const { suggestions, rewrite } = grammarLocal(msg.text);
        const txt = `Suggestions:\n${bullets(suggestions)}\n\nRephrase:\n${rewrite}`;
        return sendResponse({ ok: true, result: txt });
      }
      if (msg.type === "TRANSLATE_LINK") {
        // Build a link (no API). We return HTML so the page overlay can render a clickable link.
        const q = encodeURIComponent(msg.text.slice(0, 2000));
        const g = `https://translate.google.com/?sl=auto&tl=en&op=translate&text=${q}`;
        const d = `https://www.deepl.com/translator#auto/en/${q}`;
        const html = `
          <div style="font-weight:600;margin-bottom:6px">💬 Translate (no API)</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a href="${g}" target="_blank" rel="noopener noreferrer">Open in Google Translate</a>
            <a href="${d}" target="_blank" rel="noopener noreferrer">Open in DeepL</a>
          </div>`;
        return sendResponse({ ok: true, html });
      }
      if (msg.type === "SPEAK") {
        speak(msg.text);
        return sendResponse({ ok: true });
      }
    } catch (e) {
      return sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true;
});

// ---- Local processors ----

function summarizeLocal(text, max = 5) {
  // Very simple extractive summarizer:
  // 1) split into sentences
  // 2) score by word frequency (stopwords ignored)
  // 3) return top N in original order
  const sents = splitSentences(text).map(s => s.trim()).filter(s => s.split(/\s+/).length > 4);
  if (sents.length <= max) return sents;

  const stop = new Set(("a an the and or but if while on in at to from of for with without within than then so very really just into onto up down over under again further".split(/\s+/)));
  const freq = Object.create(null);

  const words = text.toLowerCase().match(/[a-z][a-z'-]{1,}/g) || [];
  for (const w of words) if (!stop.has(w)) freq[w] = (freq[w] || 0) + 1;

  const scores = sents.map((s, i) => {
    let sc = 0;
    const ws = s.toLowerCase().match(/[a-z][a-z'-]{1,}/g) || [];
    for (const w of ws) if (freq[w]) sc += freq[w];
    // Length bonus for mid-length sentences
    const len = ws.length;
    if (len >= 10 && len <= 30) sc *= 1.1;
    return { i, sc };
  });

  scores.sort((a,b) => b.sc - a.sc);
  const top = scores.slice(0, max).sort((a,b) => a.i - b.i).map(({i}) => sents[i]);
  return top;
}

function grammarLocal(text) {
  // Heuristic cleanup + suggestions (no AI).
  const suggestions = [];

  // Basic issues
  if (/\s{2,}/.test(text)) suggestions.push("Remove repeated spaces.");
  if (/[!?]{3,}/.test(text)) suggestions.push("Avoid excessive punctuation (!!! or ???).");

  // Long sentences
  const sents = splitSentences(text);
  const long = sents.filter(s => s.trim().split(/\s+/).length > 28);
  if (long.length) suggestions.push(`Split ${long.length} long sentence(s) (>28 words) for clarity.`);

  // Passive voice (very rough)
  const passive = (text.match(/\b(was|were|is|are|been|being|be)\s+[a-z]+ed\b/gi) || []).length;
  if (passive) suggestions.push("Prefer active voice where possible.");

  // Common fixes map
  const repl = [
    [/\bi\b/g, "I"],
    [/\bim\b/gi, "I'm"],
    [/\bdont\b/gi, "don't"],
    [/\bcant\b/gi, "can't"],
    [/\bwont\b/gi, "won't"],
    [/\bdoesnt\b/gi, "doesn't"],
    [/\barent\b/gi, "aren't"],
    [/\bisnt\b/gi, "isn't"],
    [/\bshouldnt\b/gi, "shouldn't"],
    [/\bcouldnt\b/gi, "couldn't"],
    [/\bwasnt\b/gi, "wasn't"],
    [/\bwerent\b/gi, "weren't"],
    [/\bhavent\b/gi, "haven't"],
    [/\bhasnt\b/gi, "hasn't"],
    [/\bhadnt\b/gi, "hadn't"],
    [/\bin order to\b/gi, "to"],
    [/\bdue to the fact that\b/gi, "because"],
    [/\butilize\b/gi, "use"],
    [/\bvery\b/gi, ""]
  ];

  let out = text;

  // Normalize whitespace around punctuation
  out = out.replace(/\s+([,.;:!?])/g, "$1").replace(/([,.;:!?])(?!\s)/g, "$1 ");

  // Apply replacements
  for (const [r, s] of repl) out = out.replace(r, s);

  // Fix a/an (simple heuristic)
  out = out.replace(/\b([Aa])\s+([aeiou])/g, "an $2").replace(/\b([Aa]n)\s+([^aeiou\s])/g, "a $2");

  // Sentence case + final punctuation
  out = sentenceCase(out);
  if (!/[.!?]"?$/.test(out.trim())) out = out.trim() + ".";

  if (!suggestions.length) suggestions.push("Looks good overall. Minor polishing applied.");
  return { suggestions, rewrite: out.trim() };
}

function splitSentences(text) {
  return (text || "")
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"])/)
    .map(s => s.trim())
    .filter(Boolean);
}

function sentenceCase(text) {
  const parts = splitSentences(text);
  const fixed = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1));
  return fixed.join(" ");
}

// Helpers
function bullets(arrOrText) {
  const arr = Array.isArray(arrOrText) ? arrOrText : String(arrOrText).split(/\n+/);
  return arr.filter(Boolean).map(s => `• ${s.trim()}`).join("\n");
}

function speak(text) { chrome.tts.speak(text, { enqueue: false, rate: 1.0 }); }

function notifyAndSpeak(title, message) {
  try {
    chrome.notifications.create({ type: "basic", iconUrl: "icons/128.png", title, message });
  } catch (_) { /* icons optional */ }
  speak(message);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}
