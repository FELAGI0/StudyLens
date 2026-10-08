console.log("StudyLens background loaded");

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "capture-area") return;
  startCapture(tab);
});

async function startCapture(tab) {
  if (!tab || !tab.id) {
    tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  }
  if (!tab || !tab.id) return;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content/overlay.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/overlay.js"],
    });
  } catch (err) {
    console.log("cannot inject here", err.message);
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