// Runs in each page: selection-translate, article-summary, grammar-after-pause,
// privacy-shield, doom-scroll nudge, overlay UI (top-right white box)

const SOCIAL_HOSTS = ["facebook.com","instagram.com","tiktok.com","x.com","twitter.com","youtube.com","reddit.com"];
const overlay = createOverlay(); // top-right
document.documentElement.appendChild(overlay);

let privacyMode = detectSensitivePage();
if (privacyMode) showOverlay("🛡️ Privacy shield on. I’m silent here.", true);

// Translate selected text (short snippets)
document.addEventListener("selectionchange", () => {
  if (privacyMode) return;
  const t = String(window.getSelection() || "");
  if (t && t.trim().length > 6 && t.length < 2000) {
    chrome.runtime.sendMessage({ type: "TRANSLATE", text: t.trim() }, res => {
      if (res?.ok) showOverlay(`💬 Translation:\n${res.result}`, true);
    });
  }
});

// Summarize long reads after page settles
window.addEventListener("load", () => {
  if (privacyMode) return;
  setTimeout(() => {
    const text = extractMainText();
    if (wordCount(text) > 400) {
      chrome.runtime.sendMessage({ type: "SUMMARIZE", text }, res => {
        if (res?.ok) {
          showOverlay(`📰 Quick Summary:\n${normalizeBullets(res.result)}`, true);
          chrome.runtime.sendMessage({ type: "SPEAK", text: "I made a quick summary for you." });
        }
      });
    }
  }, 2500);
});

// Grammar check after the user stops typing in large inputs
observeTypingTargets();

function observeTypingTargets() {
  const debounceMap = new WeakMap();
  const handler = el => {
    const fire = () => {
      if (privacyMode) return;
      const value = getTextFromEditable(el).trim();
      if (wordCount(value) < 40) return; // only “long” inputs
      chrome.runtime.sendMessage({ type: "GRAMMAR", text: value }, res => {
        if (res?.ok) showOverlay(`✍️ Grammar check\n\n${res.result}`, false);
      });
    };
    return () => {
      clearTimeout(debounceMap.get(el));
      const id = setTimeout(fire, 1500); // 1.5s pause
      debounceMap.set(el, id);
    };
  };

  const watch = el => {
    const onInput = handler(el);
    el.addEventListener("input", onInput);
  };

  // Initial scan
  document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]').forEach(watch);

  // Future nodes
  new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes && m.addedNodes.forEach(n => {
        if (!(n instanceof Element)) return;
        n.matches && (n.matches('textarea, input[type="text"], [contenteditable="true"]') ? watch(n) : null);
        n.querySelectorAll && n.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]').forEach(watch);
      });
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

// Doom-scroll nudges (per page)
let lastNudge = 0;
setInterval(() => {
  if (privacyMode) return;
  const host = location.hostname.replace(/^www\./,"");
  if (!SOCIAL_HOSTS.some(h => host.endsWith(h))) return;
  const now = Date.now();
  if (now - lastNudge > 10 * 60 * 1000) {
    lastNudge = now;
    const msg = "You’ve been scrolling a while — 2-minute break?";
    showOverlay(`⏳ ${msg}`, true);
    chrome.runtime.sendMessage({ type: "SPEAK", text: msg });
  }
}, 60000);

// Receive overlay pushes from background (greetings, tab warnings)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "OVERLAY") showOverlay(msg.text, true);
});

function detectSensitivePage() {
  const url = location.href.toLowerCase();
  const authHints = ["/login","/signin","/sign-in","/auth","/checkout","/payment","/pay","/otp","/account"];
  const bankHints = ["bank","paypal","stripe","razorpay","paytm","google.com/pay","phonepe","netbanking","upi"];
  const hasPwd = !!document.querySelector('input[type="password"], input[autocomplete="one-time-code"]');
  const hasCard = !!document.querySelector('input[autocomplete="cc-number"], input[autocomplete="cc-csc"], input[name*="card"]');
  const urlFlag = authHints.some(h => url.includes(h)) || bankHints.some(h => url.includes(h));
  return hasPwd || hasCard || urlFlag;
}

function extractMainText() {
  const article = document.querySelector("article");
  const main = article || document.querySelector("main") || document.body;
  [...main.querySelectorAll("script,style,nav,footer,header,aside")].forEach(n => n.remove());
  return (main.innerText || "").replace(/\s+\n/g, "\n").trim();
}

function createOverlay() {
  const host = document.createElement("div");
  host.id = "sidekick-overlay";
  host.style.cssText = `
    position: fixed; right: 16px; top: 16px; max-width: 420px;
    background: #ffffff; color: #111; font: 14px/1.45 system-ui,Segoe UI,Roboto;
    padding: 12px 14px; border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.15);
    z-index: 2147483647; white-space: pre-wrap; display: none; border: 1px solid rgba(0,0,0,.06);
  `;
  host.addEventListener("click", () => host.style.display = "none");
  return host;
}

function showOverlay(text, autoHide=false) {
  overlay.textContent = text;
  overlay.style.display = "block";
  if (autoHide) setTimeout(() => { overlay.style.display = "none"; }, 12000);
}
function normalizeBullets(s) { return s.replace(/^\s*[-•]\s*/gm, "• "); }
function wordCount(s) { return (s||"").trim().split(/\s+/).filter(Boolean).length; }
function getTextFromEditable(el) {
  if (el.isContentEditable) return el.innerText || "";
  return ("value" in el) ? el.value : (el.textContent || "");
}
