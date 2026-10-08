// Диагностика инжекта. Вставить в консоль service worker
// (chrome://extensions -> StudyLens -> service worker).
// Проверяет каждый шаг отдельно. test-inject.js не входит в расширение.

(async () => {
  const OVERLAY_ID = "studylens-overlay";

  try {
    console.log("=== studylens test-inject ===");

    // шаг 1: активная вкладка
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      console.log("step 1 FAIL: no active tab");
      return;
    }
    console.log("step 1 OK: tab id=" + tab.id + " url=" + tab.url);

    // шаг 2: executeScript
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/overlay.js"],
      });
      console.log("step 2 OK: executeScript", res);
    } catch (e) {
      console.log("step 2 FAIL: executeScript error:", e.message, e.stack);
    }

    // шаг 3: insertCSS
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content/overlay.css"],
      });
      console.log("step 3 OK: insertCSS");
    } catch (e) {
      console.log("step 3 FAIL: insertCSS error:", e.message, e.stack);
    }

    // шаг 4: оверлей в DOM
    try {
      const [check] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (id) => {
          const el = document.getElementById(id);
          if (!el) return { found: false };
          const cs = getComputedStyle(el);
          return {
            found: true,
            position: cs.position,
            zIndex: cs.zIndex,
            display: cs.display,
            opacity: cs.opacity,
            visibility: cs.visibility,
            rect: el.getBoundingClientRect().toJSON(),
          };
        },
        args: [OVERLAY_ID],
      });
      console.log("step 4 OK: overlay check", check && check.result);
    } catch (e) {
      console.log("step 4 FAIL: check error:", e.message, e.stack);
    }

    // шаг 5: итог
    console.log("step 5: done. смотри error-строки выше, если оверлей не виден");
  } catch (e) {
    console.log("UNEXPECTED:", e.message, e.stack);
  }
})();