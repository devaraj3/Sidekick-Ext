// Background SW: OpenAI calls, speech, timers, tab nudges
// TIP: keep your key in chrome.storage (Options page), not in source code.

const SOCIAL_HOSTS = ["facebook.com","instagram.com","tiktok.com","x.com","twitter.com","youtube.com","reddit.com"];
const TAB_THRESHOLD = 20;

// Schedule alarms on install/start
chrome.runtime.onInstalled.addListener(() => ensureAlarms());
chrome.runtime.onStartup.addListener(() => ensureAlarms());

function ensureAlarms() {
  chrome.alarms.create("hydrate", { periodInMinutes: 60 });
  chrome.alarms.create("hourlyTick", { periodInMinutes: 60 }); // for greetings/meal checks
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === "hydrate") {
    notifyAndSpeak("Hydration check", "Take a sip of water and a 20-second eye break.");
  }
  if (alarm.name === "hourlyTick") {
    const hour = new Date().getHours();
    let msg = null;
    if (hour === 9) msg = "Good morning! Have some breakfast to start strong.";
    else if (hour === 13) msg = "Good afternoon! Time for lunch and a short walk?";
    else if (hour === 17) msg = "Snack o’clock! Stretch and grab something light.";
    else if (hour === 20) msg = "Dinner time — refuel and unwind.";
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

// Messages from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "SUMMARIZE") {
        const out = await callLLM(`Summarize in 3-5 bullet points for a busy reader:\n\n${msg.text}`);
        return sendResponse({ ok: true, result: out });
      }
      if (msg.type === "TRANSLATE") {
        const out = await callLLM(`Translate to clear, simple English. Keep meaning faithful:\n\n${msg.text}`);
        return sendResponse({ ok: true, result: out });
      }
      if (msg.type === "GRAMMAR") {
        const out = await callLLM(
          `You are a careful copy editor. For the user's draft below, first list 3-6 bullet suggestions (grammar, clarity, tone), ` +
          `then provide a polished rewrite. Format:\nSuggestions:\n• ...\n• ...\n\nRephrase:\n... \n\nText:\n${msg.text}`
        );
        return sendResponse({ ok: true, result: out });
      }
      if (msg.type === "SPEAK") {
        speak(msg.text);
        return sendResponse({ ok: true });
      }
    } catch (e) {
      return sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // keep the message channel open for async
});

async function callLLM(prompt) {
  const { openaiKey } = await chrome.storage.sync.get("openaiKey");
  if (!openaiKey) throw new Error("Missing OpenAI API key. Set it in Options.");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
    body: JSON.stringify({ model: "gpt-5-mini", input: prompt })
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}`);
  const data = await res.json();
  return (data.output_text || "").trim();
}

function speak(text) { chrome.tts.speak(text, { enqueue: false, rate: 1.0 }); } // uses chrome.tts :contentReference[oaicite:9]{index=9}

function notifyAndSpeak(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/128.png", title, message });
  speak(message);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}
