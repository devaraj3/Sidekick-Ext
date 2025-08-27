// CONTENT (no external APIs)
// Translate: show links; Summarize: local extractive; Grammar: rule-based after pause.
// Overlay lives top-right. Privacy shield keeps silent on auth/banking.

const SOCIAL_HOSTS = ["facebook.com","instagram.com","tiktok.com","x.com","twitter.com","youtube.com","reddit.com"];
const overlay = createOverlay(); // top-right white box
document.documentElement.appendChild(overlay);

let privacyMode = detectSensitivePage();
if (privacyMode) showOverlay("🛡️ Privacy shield on. I’m silent here.", true);

// Translate selected text → show translator links (no key)
document.addEventListener("selectionchange", () => {
  if (privacyMode) return;
  const t = String(window.getSelection() || "");
  if (t && t.trim().length > 6 && t.length < 2000) {
    chrome.runtime.sendMessage({ type: "TRANSLATE_LINK", text: t.trim() }, res => {
      if (res?.ok && res.html) showOverlayHTML(res.html, true);
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
          showOverlay(`📰 Quick Summary:\n${res.result}`, true);
          chrome.runtime.sendMessage({ type: "SPEAK", text: "I made a quick summary for you." });
        }
      });
    }
  }, 2500);
});

// Grammar check after pause in larger inputs
observeTypingTargets();

function observeTypingTargets() {
  const debounceMap = new WeakMap();
  const handler = el => {
    const fire = () => {
      if (privacyMode) return;
      const value = getTextFromEditable(el).trim();
      if (wordCount(value) < 40) return; // only longish text
      chrome.runtime.sendMessage({ type: "GRAMMAR", text: value }, res => {
        if (res?.ok) showOverlay(`✍️ Grammar check\n\n${res.result}`, false);
      });
    };
    return () => {
      clearTimeout(debounceMap.get(el));
      const id = setTimeout(fire, 1500); // 1.5s idle
      debounceMap.set(el, id);
    };
  };

  const watch = el => el.addEventListener("input", handler(el));
  document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]').forEach(watch);

  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (!(n instanceof Element)) continue;
      if (n.matches && n.matches('textarea, input[type="text"], [contenteditable="true"]')) watch(n);
      if (n.querySelectorAll) n.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]').forEach(watch);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
}

// Doom-scroll nudges
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

// Receive overlay pushes from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "OVERLAY") showOverlay(msg.text, true);
});

// ---- Helpers ----

function detectSensitivePage() {
  const url = location.href.toLowerCase();
  const authHints = ["/login","/signin","/sign-in","/auth","/checkout","/payment","/pay","/otp","/account"];
  const bankHints = ["bank","paypal","stripe","razorpay","paytm","google.com/pay","phonepe","netbanking","upi"];
  const hasPwd  = !!document.querySelector('input[type="password"], input[autocomplete="one-time-code"]');
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

// Allow HTML (for translator links)
function showOverlayHTML(html, autoHide=false) {
  overlay.innerHTML = html;
  overlay.style.display = "block";
  if (autoHide) setTimeout(() => { overlay.style.display = "none"; }, 15000);
}

function wordCount(s) { return (s||"").trim().split(/\s+/).filter(Boolean).length; }
function getTextFromEditable(el) { return el.isContentEditable ? (el.innerText||"") : (("value" in el) ? el.value : (el.textContent||"")); }
