console.log("StudyLens background loaded");

chrome.commands.onCommand.addListener((command, tab) => {
  console.log("command received:", command);
  if (command !== "capture-area") return;
  startCapture(tab);
});

async function startCapture(tab) {
  // onCommand не гарантирует tab и не даёт url без host-доступа, поэтому тянем сами
  if (!tab || !tab.id) {
    tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  }
  console.log("startCapture for tab:", tab && tab.id, tab && tab.url);
  if (!tab || !tab.id) return;

  console.log("injecting overlay...");
  // CSS и JS инжектим независимо: сбой стилей не должен блокировать оверлей
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content/overlay.css"],
    });
  } catch (err) {
    console.log("insertCSS error:", err.message);
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/overlay.js"],
    });
    console.log("inject done");
  } catch (err) {
    console.log("inject error:", err.message, err.stack);
    console.log("cannot inject here");
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "area-selected") return;
  handleSelection(msg.rect, sender.tab);
});

async function handleSelection(rect, tab) {
  console.log("capture: rect=" + JSON.stringify(rect));
  if (!tab || !tab.id) return;

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
    const base64 = await cropDataUrl(dataUrl, rect);
    await chrome.tabs.sendMessage(tab.id, { type: "captured-image", base64 });
  } catch (err) {
    console.log("capture failed", err.message);
  }
}

async function cropDataUrl(dataUrl, rect) {
  const dpr = rect.dpr || 1;
  const sx = Math.round(rect.x * dpr);
  const sy = Math.round(rect.y * dpr);
  const sw = Math.round(rect.width * dpr);
  const sh = Math.round(rect.height * dpr);

  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  bitmap.close();

  const outBlob = await canvas.convertToBlob({ type: "image/png" });
  return arrayBufferToBase64(await outBlob.arrayBuffer());
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}